#!/usr/bin/env node

/**
 * Upload DP-1 Playlists to the Feed Server and Update the Single Feral File Channel
 *
 * This script reads exhibition playlist files from playlists/<slug>.json,
 * uploads each as a DP-1 playlist to the feed server, then creates or updates
 * a single persistent "Feral File" channel whose playlists array covers all
 * uploaded exhibitions.
 *
 * Channel model:
 *   - One persistent "Feral File" channel holds all exhibition playlists.
 *   - The channel id/slug is tracked in channels-manifest.json (channel.id).
 *   - On first run the channel is created (POST); on subsequent runs it is
 *     updated (PATCH) with the full up-to-date playlists array.
 *   - playlistUrls{} in the manifest caches slug → live playlist URL so the
 *     full channel playlists array can be assembled even when only some
 *     exhibitions are re-uploaded in a given run.
 *
 * Playlist overrides:
 *   - channels-manifest.json metadata{} may override title, curators, summary,
 *     and coverImage for any individual exhibition playlist.
 *
 * Manifest shape expected (see playlists/channels-manifest.json.example):
 *   {
 *     "channel": { "id": null|"<uuid>", "slug": "feral-file", "title": "...",
 *                  "publisher": { "name": "Feral File", "url": "..." }, ... },
 *     "playlists": ["slug-a", "slug-b", ...],
 *     "playlistUrls": { "slug-a": "https://feed.../api/v1/playlists/<uuid>", ... },
 *     "metadata": { "slug-a": { "title": "...", "curators": [...], ... } }
 *   }
 *
 * Usage:
 *   node scripts/upload-to-feed.js --api-key <key> --feed-endpoint <url> \
 *     --playlists-path <path> [--only <slug1,slug2,...>] [--dry-run] \
 *     [--artifact-output <path>] [--summary-provider openai|gemini] \
 *     [--summary-api-key KEY] [--summary-model MODEL] [--summary-base-url URL]
 *
 * Examples:
 *   # Upload / refresh all exhibitions
 *   node scripts/upload-to-feed.js --api-key KEY --feed-endpoint https://feed.feralfile.com \
 *     --playlists-path ./playlists
 *
 *   # Upload / refresh a single exhibition
 *   node scripts/upload-to-feed.js --api-key KEY --feed-endpoint https://feed.feralfile.com \
 *     --playlists-path ./playlists --only gray-matter-dn1
 *
 *   # Dry-run (validate without uploading)
 *   node scripts/upload-to-feed.js --api-key KEY --feed-endpoint https://feed.feralfile.com \
 *     --playlists-path ./playlists --dry-run
 *
 *   # Long channel/playlist summaries (over 2000 chars)
 *   node scripts/upload-to-feed.js ... --summary-provider openai --summary-api-key sk-...
 */

import fs from 'fs';
import path from 'path';
import { summarizeLongText, DEFAULT_MAX_TEXT_LENGTH } from './lib/llm-summarize-summary.js';

const PUBLISH_ARTIFACT_SCHEMA_VERSION = 2;
const CHANNEL_SCHEMA_TITLE_MAX = 200;

/** Ethereum address used for the default "Feral File" publisher Entity.key (did:pkh:eip155:1:…) */
const FERAL_FILE_PUBLISHER_ETH = '0x1d05cf6c6BEb0c869851BFdb9510D4E44E855ad6';

/**
 * The production feed server (dp1-feed-v2, Go) validates Entity.key against the DP-1
 * JSON Schema pattern `^did:[a-z]+:.+$`, which accepts any DID method — both
 * did:key (multibase Ed25519 pubkey) and did:pkh (CAIP-10 chain-account, e.g.
 * did:pkh:eip155:1:0x...). Feral File only has Ethereum/Tezos *addresses* for
 * curators/publisher (not raw public key bytes), so did:pkh is the only DID
 * method that can be derived for them; did:key is not achievable without real
 * key material. Do not tighten this to did:key-only — that matches a stricter
 * third-party JS validator, not what's actually enforced in production.
 */
const GENERIC_DID_REGEX = /^did:[a-z]+:.+$/;

function isValidDidKeyOrPkh(key) {
  return typeof key === 'string' && GENERIC_DID_REGEX.test(key.trim());
}

/**
 * Build did:pkh from Feral File alumni `addresses` (ethereum / tezos), CAIP-10 style.
 */
function alumniAddressToDidPkh(addresses) {
  if (!addresses || typeof addresses !== 'object') return null;
  const eth = addresses.ethereum;
  if (typeof eth === 'string' && /^0x[a-fA-F0-9]{40}$/.test(eth.trim())) {
    return `did:pkh:eip155:1:${eth.trim()}`;
  }
  const tz = addresses.tezos;
  if (typeof tz === 'string' && /^tz[123][1-9A-HJ-NP-Za-km-z]{33}$/.test(tz.trim())) {
    return `did:pkh:tezos:mainnet:${tz.trim()}`;
  }
  return null;
}

const FERAL_FILE_PUBLISHER_KEY = alumniAddressToDidPkh({ ethereum: FERAL_FILE_PUBLISHER_ETH });

/**
 * Curator entity for the channel/playlist schema. Keeps `key` if it's already
 * a valid did:key/did:pkh, otherwise derives did:pkh from `entity.addresses`.
 */
function curatorEntityFromInput(entity) {
  if (!entity || typeof entity !== 'object') return null;
  const name =
    (entity.name != null && String(entity.name).trim()) ||
    (entity.alias != null && String(entity.alias).trim()) ||
    (entity.fullName != null && String(entity.fullName).trim()) ||
    null;
  if (!name) return null;
  const out = { name };
  const key = isValidDidKeyOrPkh(entity.key)
    ? entity.key.trim()
    : alumniAddressToDidPkh(entity.addresses);
  if (key) {
    out.key = key;
  }
  if (entity.url != null && String(entity.url).trim()) {
    out.url = String(entity.url).trim();
  }
  return out;
}

/**
 * Merge singular `curator` into `curators`, normalising each entity's key.
 */
function mergeCuratorFields(obj) {
  const merged = [];
  if (obj.curator) merged.push(obj.curator);
  if (Array.isArray(obj.curators)) merged.push(...obj.curators);
  delete obj.curator;
  const out = merged.map(curatorEntityFromInput).filter(Boolean);
  if (out.length) {
    obj.curators = out;
  } else {
    delete obj.curators;
  }
}

/**
 * Fill the publisher key for the well-known Feral File org if omitted, and drop
 * any publisher.key that isn't a validly-formatted DID (defense in depth).
 */
function sanitizePublisherKey(obj) {
  const p = obj.publisher;
  if (!p || typeof p !== 'object') return;
  if (!p.key) {
    const name = String(p.name || '').trim();
    const url = String(p.url || '').trim();
    if (FERAL_FILE_PUBLISHER_KEY && name === 'Feral File' && (!url || url === 'https://feralfile.com')) {
      obj.publisher = { ...p, key: FERAL_FILE_PUBLISHER_KEY };
    }
    return;
  }
  if (!isValidDidKeyOrPkh(p.key)) {
    const { key, ...rest } = p;
    obj.publisher = rest;
  }
}

function assertTitleLength(title, label) {
  if (title == null) return;
  const t = String(title);
  if (t.length > CHANNEL_SCHEMA_TITLE_MAX) {
    throw new Error(
      `${label} title exceeds ${CHANNEL_SCHEMA_TITLE_MAX} characters (got ${t.length}). Shorten the title in channels-manifest.json or the exhibition source.`
    );
  }
}

/**
 * Prepare a payload for POST/PATCH: normalise curators, publisher key, title length,
 * LLM-shorten long summaries, strip server-managed fields.
 */
async function preparePayload(raw, summaryOpts, contextLabel) {
  assertTitleLength(raw.title, contextLabel);
  const obj = { ...raw };
  if ('curators' in obj || 'curator' in obj) {
    mergeCuratorFields(obj);
  }
  sanitizePublisherKey(obj);
  delete obj.id;
  delete obj.version;
  delete obj.created;
  // manifest placeholders (e.g. channel.coverImage: null before it's first set) must be
  // omitted rather than sent as JSON null — the schema expects a string or nothing.
  for (const k of Object.keys(obj)) {
    if (obj[k] === null) delete obj[k];
  }

  if (obj.summary != null && String(obj.summary).length > DEFAULT_MAX_TEXT_LENGTH) {
    if (!summaryOpts?.apiKey || !summaryOpts?.provider) {
      throw new Error(
        `${contextLabel} summary exceeds ${DEFAULT_MAX_TEXT_LENGTH} characters ` +
          `(length ${String(obj.summary).length}). ` +
          `Set --summary-provider and --summary-api-key (or SUMMARY_PROVIDER and SUMMARY_API_KEY).`
      );
    }
    obj.summary = await summarizeLongText(
      summaryOpts,
      { kind: `${contextLabel} summary`, labels: {} },
      String(obj.summary)
    );
  }

  return obj;
}

/**
 * Normalise a feed endpoint URL to origin only (strip any path).
 */
function normalizeFeedOrigin(rawFeedEndpoint) {
  if (typeof rawFeedEndpoint !== 'string' || rawFeedEndpoint.trim() === '') {
    throw new Error('feed endpoint is required');
  }
  let parsed;
  try {
    parsed = new URL(rawFeedEndpoint);
  } catch {
    throw new Error(`invalid --feed-endpoint URL: ${rawFeedEndpoint}`);
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error(
      `unsupported --feed-endpoint protocol: ${parsed.protocol} (expected http/https)`
    );
  }
  const normalizedOrigin = parsed.origin;
  const normalizedPath = parsed.pathname.replace(/\/+$/, '');
  if (normalizedPath && normalizedPath !== '') {
    console.warn(
      `⚠️  Ignoring path in --feed-endpoint (${parsed.pathname}); using origin only: ${normalizedOrigin}`
    );
  }
  return normalizedOrigin;
}

// ---------------------------------------------------------------------------
// Manifest helpers
// ---------------------------------------------------------------------------

/**
 * Load and validate the new-shape channels-manifest.json.
 * Throws a clear error if the file is missing or has the old shape.
 */
function loadManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `channels-manifest.json not found at ${manifestPath}.\n` +
        `Copy playlists/channels-manifest.json.example and fill in your channel metadata.`
    );
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch (e) {
    throw new Error(`Failed to parse channels-manifest.json: ${e.message}`);
  }

  // Detect old shape (had top-level "channels" array + no "channel" object)
  if (Array.isArray(data.channels) && !data.channel) {
    throw new Error(
      `channels-manifest.json is in the old format (has "channels" array but no "channel" object).\n` +
        `Please migrate to the new format documented in playlists/channels-manifest.json.example.\n` +
        `Key changes: "channels" → "playlists", add "channel" block with id/slug/title/publisher, add "playlistUrls" map.`
    );
  }

  if (!data.channel || typeof data.channel !== 'object') {
    throw new Error(
      `channels-manifest.json missing required "channel" object. See playlists/channels-manifest.json.example.`
    );
  }
  if (!Array.isArray(data.playlists)) {
    throw new Error(
      `channels-manifest.json missing required "playlists" array. See playlists/channels-manifest.json.example.`
    );
  }

  data.playlistUrls = data.playlistUrls || {};
  data.metadata = data.metadata || {};

  return data;
}

/**
 * Persist the manifest back to disk with updated channel.id and playlistUrls.
 */
function saveManifest(manifestPath, manifest) {
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// Feed API helpers
// ---------------------------------------------------------------------------

async function apiRequest(method, url, apiKey, body = null) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
  };
  if (body !== null) {
    opts.body = JSON.stringify(body);
  }
  const response = await fetch(url, opts);
  return response;
}

/**
 * Upload a playlist JSON to the feed server.
 */
async function uploadPlaylist(feedEndpoint, apiKey, playlistData) {
  console.log(`  Uploading playlist: ${playlistData.title}...`);
  const url = `${feedEndpoint}/api/v1/playlists`;
  const response = await apiRequest('POST', url, apiKey, playlistData);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to upload playlist: ${response.status} ${response.statusText}\n${errorText}`
    );
  }
  const result = await response.json();
  console.log(`  ✓ Playlist uploaded: ${result.id} (slug: ${result.slug})`);
  return result;
}

/**
 * Check whether a channel with a given id currently exists on the feed server.
 */
async function getChannel(feedEndpoint, apiKey, channelId) {
  const url = `${feedEndpoint}/api/v1/channels/${encodeURIComponent(channelId)}`;
  const response = await apiRequest('GET', url, apiKey);
  if (response.status === 404) return null;
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch channel ${channelId}: ${response.status}\n${errorText}`);
  }
  return await response.json();
}

/**
 * Create a new channel on the feed server.
 */
async function createChannel(feedEndpoint, apiKey, channelData) {
  console.log(`Creating channel: ${channelData.title}...`);
  const url = `${feedEndpoint}/api/v1/channels`;
  const response = await apiRequest('POST', url, apiKey, channelData);
  if (!response.ok) {
    const errorText = await response.text();
    console.error('\n❌ Channel creation failed!');
    console.error('Request body:', JSON.stringify(channelData, null, 2));
    throw new Error(
      `Failed to create channel: ${response.status} ${response.statusText}\n${errorText}`
    );
  }
  const result = await response.json();
  console.log(`✓ Channel created: ${result.id} (slug: ${result.slug})`);
  return result;
}

/**
 * Update an existing channel via PATCH.
 */
async function patchChannel(feedEndpoint, apiKey, channelId, channelData) {
  console.log(`Updating channel ${channelId}: ${channelData.title}...`);
  const url = `${feedEndpoint}/api/v1/channels/${encodeURIComponent(channelId)}`;
  const response = await apiRequest('PATCH', url, apiKey, channelData);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to update channel: ${response.status} ${response.statusText}\n${errorText}`
    );
  }
  const result = await response.json();
  console.log(`✓ Channel updated: ${result.id} (slug: ${result.slug})`);
  return result;
}

// ---------------------------------------------------------------------------
// Publish artifact helpers
// ---------------------------------------------------------------------------

function buildPublishArtifact({
  channelResult,
  playlistResults,
  canonicalOrigin,
  startedAt,
  completedAt,
  isDryRun,
}) {
  const successful = playlistResults.filter(r => r.status === 'success').length;
  const failed = playlistResults.filter(r => r.status === 'failed').length;
  const skipped = playlistResults.filter(r => r.status === 'skipped').length;

  return {
    schema_version: PUBLISH_ARTIFACT_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    mode: isDryRun ? 'dry-run' : 'upload',
    started_at: startedAt,
    completed_at: completedAt,
    canonical_origin: canonicalOrigin,
    summary: {
      total_playlists: playlistResults.length,
      successful_playlists: successful,
      failed_playlists: failed,
      skipped_playlists: skipped,
    },
    channels: channelResult
      ? [
          {
            source_folder: 'feral-file',
            status: channelResult.status,
            published_at: channelResult.publishedAt || null,
            duration_ms: channelResult.duration || 0,
            data_source: 'manifest',
            reason: channelResult.reason || null,
            channel:
              channelResult.channel && channelResult.status === 'success'
                ? {
                    id: channelResult.channel.id,
                    slug: channelResult.channel.slug,
                    title: channelResult.channel.title,
                    url: channelResult.channel.url,
                    playlist_count: channelResult.channel.playlistCount || 0,
                  }
                : null,
            playlists: playlistResults.map(r => ({
              source_file: `${r.slug}.json`,
              id: r.id || null,
              slug: r.slug || null,
              title: r.title || null,
              item_count: r.itemCount || 0,
              url: r.url || null,
            })),
          },
        ]
      : [],
  };
}

function validatePublishArtifactOrThrow(artifact) {
  if (!artifact || typeof artifact !== 'object') {
    throw new Error('artifact validation failed: expected object');
  }
  if (artifact.schema_version !== PUBLISH_ARTIFACT_SCHEMA_VERSION) {
    throw new Error(
      `artifact validation failed: schema_version must be ${PUBLISH_ARTIFACT_SCHEMA_VERSION}`
    );
  }
  if (!artifact.canonical_origin || !artifact.started_at || !artifact.completed_at) {
    throw new Error('artifact validation failed: missing canonical_origin/started_at/completed_at');
  }
  if (!Array.isArray(artifact.channels)) {
    throw new Error('artifact validation failed: channels must be an array');
  }
  for (const channel of artifact.channels) {
    if (!channel?.source_folder || !channel?.status) {
      throw new Error('artifact validation failed: source_folder/status are required');
    }
    if (channel.status === 'success') {
      if (!channel.channel?.id || !channel.channel?.url) {
        throw new Error(
          `artifact validation failed: success channel ${channel.source_folder} missing channel data`
        );
      }
      if (!Array.isArray(channel.playlists) || channel.playlists.length === 0) {
        throw new Error(
          `artifact validation failed: success channel ${channel.source_folder} missing playlists`
        );
      }
    }
  }
}

function validatePublishedChannel({ result, canonicalOrigin }) {
  if (result.status !== 'success') return;
  if (!result.channel?.id || !result.channel?.slug || !result.channel?.url) {
    throw new Error(
      `validation failed for channel ${result.source_folder}: missing required channel fields`
    );
  }
  const expectedChannelUrl = `${canonicalOrigin}/api/v1/channels/${encodeURIComponent(result.channel.id)}`;
  if (result.channel.url !== expectedChannelUrl) {
    throw new Error(
      `validation failed: channel url mismatch (expected ${expectedChannelUrl}, got ${result.channel.url})`
    );
  }
}

function writePublishArtifact({ artifactPath, artifact }) {
  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2), 'utf-8');
  console.log(`\n📦 Publish artifact written to: ${artifactPath}`);
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);

  const getFlag = flag => {
    const index = args.indexOf(flag);
    if (index !== -1 && args[index + 1]) return args[index + 1];
    return null;
  };

  const apiKey = getFlag('--api-key');
  const feedEndpointInput = getFlag('--feed-endpoint');
  const playlistsPath = getFlag('--playlists-path');
  const isDryRun = args.includes('--dry-run');
  const artifactOutputPath = getFlag('--artifact-output');
  const onlyFlag = getFlag('--only'); // comma-separated slugs to target this run

  const summaryProvider = getFlag('--summary-provider') || process.env.SUMMARY_PROVIDER;
  const summaryApiKey = getFlag('--summary-api-key') || process.env.SUMMARY_API_KEY;
  const summaryBaseUrl = getFlag('--summary-base-url') || process.env.SUMMARY_BASE_URL;
  const summaryModel = getFlag('--summary-model') || process.env.SUMMARY_MODEL;

  let summaryOpts = null;
  if (summaryProvider && summaryApiKey) {
    const p = String(summaryProvider).toLowerCase();
    if (p !== 'openai' && p !== 'gemini') {
      console.error(
        `Error: --summary-provider / SUMMARY_PROVIDER must be openai or gemini, got: ${summaryProvider}`
      );
      process.exit(1);
    }
    summaryOpts = {
      provider: p,
      apiKey: summaryApiKey,
      ...(summaryBaseUrl ? { baseUrl: String(summaryBaseUrl).replace(/\/$/, '') } : {}),
      ...(summaryModel ? { model: summaryModel } : {}),
    };
  }

  if (!apiKey || !feedEndpointInput || !playlistsPath) {
    console.error(
      'Usage: node upload-to-feed.js --api-key <key> --feed-endpoint <url> --playlists-path <path> [options]'
    );
    console.error('\nRequired flags:');
    console.error('  --api-key         API key for feed server authentication');
    console.error('  --feed-endpoint   Feed server URL (e.g., https://feed.feralfile.com)');
    console.error('  --playlists-path  Path to the playlists/ directory');
    console.error('\nOptional flags:');
    console.error('  --only            Comma-separated exhibition slugs to upload/refresh');
    console.error('  --dry-run         Validate without uploading');
    console.error('  --artifact-output Path for the machine-readable JSON artifact');
    console.error('  --summary-provider  openai | gemini (or SUMMARY_PROVIDER)');
    console.error('  --summary-api-key   API key (or SUMMARY_API_KEY)');
    console.error('  --summary-model     Optional model override (or SUMMARY_MODEL)');
    console.error('  --summary-base-url  Optional base URL (or SUMMARY_BASE_URL)');
    console.error('\nExamples:');
    console.error(
      '  node scripts/upload-to-feed.js --api-key KEY --feed-endpoint https://feed.feralfile.com --playlists-path ./playlists'
    );
    console.error(
      '  node scripts/upload-to-feed.js --api-key KEY --feed-endpoint https://feed.feralfile.com --playlists-path ./playlists --only gray-matter-dn1,net-evil-das'
    );
    process.exit(1);
  }

  if (isDryRun) {
    console.log('🔍 DRY RUN MODE - No data will be uploaded\n');
  }

  const startTime = Date.now();
  const startedAtIso = new Date(startTime).toISOString();
  const feedEndpoint = normalizeFeedOrigin(feedEndpointInput);
  const artifactPath = artifactOutputPath
    ? path.resolve(artifactOutputPath)
    : path.resolve(process.cwd(), 'dp1-feed-publish-artifact.json');

  if (!fs.existsSync(playlistsPath)) {
    console.error(`Error: playlists path does not exist: ${playlistsPath}`);
    process.exit(1);
  }

  const manifestPath = path.join(playlistsPath, 'channels-manifest.json');

  let manifest;
  try {
    manifest = loadManifest(manifestPath);
  } catch (e) {
    console.error(`\n❌ ${e.message}`);
    process.exit(1);
  }

  // Determine which slugs to upload this run
  const onlySlugs = onlyFlag
    ? onlyFlag
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    : null;

  const targetSlugs = onlySlugs
    ? manifest.playlists.filter(slug => onlySlugs.includes(slug))
    : [...manifest.playlists];

  if (onlySlugs) {
    const unknown = onlySlugs.filter(s => !manifest.playlists.includes(s));
    if (unknown.length > 0) {
      console.warn(`⚠️  The following slugs from --only are not in the manifest playlists array:`);
      unknown.forEach(s => console.warn(`    - ${s}`));
    }
  }

  console.log(`\nTarget exhibitions: ${targetSlugs.length}`);
  if (onlySlugs) {
    console.log(`  (--only filter applied: ${onlySlugs.join(', ')})`);
  }

  // ---------------------------------------------------------------------------
  // Step 1: Upload playlists
  // ---------------------------------------------------------------------------
  const playlistResults = [];

  for (const slug of targetSlugs) {
    const playlistFile = path.join(playlistsPath, `${slug}.json`);

    if (!fs.existsSync(playlistFile)) {
      console.warn(`\n⚠️  Playlist file not found, skipping: ${playlistFile}`);
      playlistResults.push({
        slug,
        status: 'skipped',
        reason: `File not found: ${playlistFile}`,
      });
      continue;
    }

    let playlistData;
    try {
      playlistData = JSON.parse(fs.readFileSync(playlistFile, 'utf-8'));
    } catch (e) {
      console.error(`\n✗ Failed to parse ${playlistFile}: ${e.message}`);
      playlistResults.push({ slug, status: 'failed', reason: e.message });
      continue;
    }

    // Apply metadata overrides from the manifest
    const overrides = manifest.metadata[slug];
    if (overrides) {
      if (overrides.title) playlistData.title = overrides.title;
      if (overrides.summary) playlistData.summary = overrides.summary;
      if (overrides.coverImage) playlistData.coverImage = overrides.coverImage;
      if (overrides.curators) playlistData.curators = overrides.curators;
    }

    // Normalise curators and truncate summary if needed
    let preparedPlaylist;
    try {
      preparedPlaylist = await preparePayload(playlistData, summaryOpts, `Playlist[${slug}]`);
    } catch (e) {
      console.error(`\n✗ Failed to prepare playlist ${slug}: ${e.message}`);
      playlistResults.push({ slug, status: 'failed', reason: e.message });
      continue;
    }

    if (isDryRun) {
      console.log(
        `  ✓ [DRY RUN] ${slug}: "${preparedPlaylist.title}" (${preparedPlaylist.items?.length || 0} items)`
      );
      playlistResults.push({
        slug,
        status: 'success',
        id: 'dry-run-id',
        title: preparedPlaylist.title,
        itemCount: preparedPlaylist.items?.length || 0,
        url: null,
      });
    } else {
      try {
        const result = await uploadPlaylist(feedEndpoint, apiKey, preparedPlaylist);
        const url = `${feedEndpoint}/api/v1/playlists/${encodeURIComponent(result.id)}`;
        manifest.playlistUrls[slug] = url;
        playlistResults.push({
          slug,
          status: 'success',
          id: result.id,
          title: result.title,
          itemCount: result.items?.length || 0,
          url,
        });
      } catch (e) {
        console.error(`\n✗ Failed to upload ${slug}: ${e.message}`);
        playlistResults.push({ slug, status: 'failed', reason: e.message });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Step 2: Create or update the single Feral File channel
  // ---------------------------------------------------------------------------

  // Assemble the full ordered playlists array from the cache
  const missingUrls = manifest.playlists.filter(slug => !manifest.playlistUrls[slug]);
  if (missingUrls.length > 0) {
    console.warn(
      `\n⚠️  The following exhibitions have no cached playlist URL yet (never uploaded):`,
      missingUrls
    );
    console.warn(`   They will be excluded from the channel playlists array this run.`);
  }

  const channelPlaylistUrls = manifest.playlists
    .map(slug => manifest.playlistUrls[slug])
    .filter(Boolean);

  if (channelPlaylistUrls.length === 0) {
    console.error(
      '\n❌ No playlist URLs available. Upload at least one playlist before updating the channel.'
    );
    process.exit(1);
  }

  // Build channel payload from manifest.channel
  const rawChannel = {
    ...manifest.channel,
    playlists: channelPlaylistUrls,
  };

  let channelPayload;
  try {
    channelPayload = await preparePayload(rawChannel, summaryOpts, 'Channel[Feral File]');
    if (!channelPayload.title) {
      throw new Error('manifest.channel must have a title');
    }
  } catch (e) {
    console.error(`\n❌ Failed to prepare channel payload: ${e.message}`);
    process.exit(1);
  }

  let channelResult;
  const channelStart = Date.now();

  if (isDryRun) {
    console.log(`\n✓ [DRY RUN] Would create/update channel "${channelPayload.title}"`);
    console.log(`  Playlists in channel: ${channelPlaylistUrls.length}`);
    console.log(`  Existing channel id: ${manifest.channel.id || '(none — will create)'}`);
    channelResult = {
      status: 'success',
      publishedAt: new Date().toISOString(),
      duration: Date.now() - channelStart,
      channel: {
        id: manifest.channel.id || 'dry-run-id',
        slug: manifest.channel.slug || 'feral-file',
        title: channelPayload.title,
        url: `${feedEndpoint}/api/v1/channels/${manifest.channel.id || 'dry-run-id'}`,
        playlistCount: channelPlaylistUrls.length,
      },
    };
  } else {
    try {
      let channelObj;

      if (manifest.channel.id) {
        // Try to fetch the existing channel
        const existing = await getChannel(feedEndpoint, apiKey, manifest.channel.id);
        if (existing) {
          channelObj = await patchChannel(feedEndpoint, apiKey, manifest.channel.id, channelPayload);
        } else {
          console.warn(
            `⚠️  Stored channel id ${manifest.channel.id} not found on server; creating a new one.`
          );
          channelObj = await createChannel(feedEndpoint, apiKey, channelPayload);
        }
      } else {
        channelObj = await createChannel(feedEndpoint, apiKey, channelPayload);
      }

      const channelUrl = `${feedEndpoint}/api/v1/channels/${encodeURIComponent(channelObj.id)}`;
      const duration = Date.now() - channelStart;

      console.log(`\n✓ Channel "${channelObj.title}" ready`);
      console.log(`  Channel ID: ${channelObj.id}`);
      console.log(`  Playlists: ${channelPlaylistUrls.length}`);

      channelResult = {
        status: 'success',
        publishedAt: new Date().toISOString(),
        duration,
        channel: {
          id: channelObj.id,
          slug: channelObj.slug,
          title: channelObj.title,
          url: channelUrl,
          playlistCount: channelPlaylistUrls.length,
        },
      };

      // Persist updated channel id and playlistUrls back to the manifest
      manifest.channel.id = channelObj.id;
      manifest.channel.slug = channelObj.slug;
      saveManifest(manifestPath, manifest);
      console.log(`  ✓ Manifest updated with channel id and playlistUrls`);
    } catch (e) {
      console.error(`\n✗ Failed to create/update channel: ${e.message}`);
      channelResult = {
        status: 'failed',
        reason: e.message,
        duration: Date.now() - channelStart,
        channel: null,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Step 3: Build and write publish artifact
  // ---------------------------------------------------------------------------
  const endTime = Date.now();
  const completedAtIso = new Date(endTime).toISOString();

  // Validate channel result structure before building artifact
  validatePublishedChannel({
    result: { ...channelResult, source_folder: 'feral-file' },
    canonicalOrigin: feedEndpoint,
  });

  const artifact = buildPublishArtifact({
    channelResult,
    playlistResults,
    canonicalOrigin: feedEndpoint,
    startedAt: startedAtIso,
    completedAt: completedAtIso,
    isDryRun,
  });

  try {
    validatePublishArtifactOrThrow(artifact);
  } catch (e) {
    console.warn(`\n⚠️  Artifact validation warning: ${e.message}`);
  }

  writePublishArtifact({ artifactPath, artifact });

  // Print summary
  const successCount = playlistResults.filter(r => r.status === 'success').length;
  const failCount = playlistResults.filter(r => r.status === 'failed').length;
  const skipCount = playlistResults.filter(r => r.status === 'skipped').length;

  console.log(`\n${'='.repeat(80)}`);
  console.log(`Summary:`);
  console.log(`  Target playlists: ${targetSlugs.length}`);
  if (isDryRun) {
    console.log(`  Validated: ${successCount}`);
  } else {
    console.log(`  Uploaded: ${successCount}`);
  }
  console.log(`  Failed: ${failCount}`);
  console.log(`  Skipped: ${skipCount}`);
  console.log(`  Channel: ${channelResult.status}`);
  console.log(`  Total playlists in channel: ${channelPlaylistUrls.length}`);
  console.log('='.repeat(80));

  if (isDryRun) {
    console.log('\n✓ Dry run complete! No data was uploaded.');
  } else {
    console.log('\n✓ Upload complete!');
  }

  if (failCount > 0) {
    process.exit(1);
  }
}

// Run the script
main().catch(error => {
  console.error('\n✗ Upload failed:', error.message);
  if (error.stack) {
    console.error('\nStack trace:');
    console.error(error.stack);
  }
  process.exit(1);
});
