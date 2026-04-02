#!/usr/bin/env node

/**
 * Upload DP-1 Playlists and Channels to Feed Server
 *
 * This script uploads playlists from local files to the DP-1 Feed API.
 * It processes channel folders, creates channels, and uploads playlists.
 *
 * Concept:
 *   - Each folder contains a group of playlists that will be combined into one channel
 *   - Channel metadata can be provided via channels-manifest.json
 *   - If no metadata is provided, the script can optionally fallback to Feral File Exhibition API
 *
 * Channel Ordering:
 *   When processing multiple channels, you can control the upload order using a
 *   channels-manifest.json file in the playlists folder. If no manifest exists, the
 *   script will create a default one with channels in alphabetical order.
 *
 *   Manifest format:
 *   {
 *     "_comment": "Reorder the 'channels' array to change upload sequence",
 *     "channels": ["channel-slug-1", "channel-slug-2", ...],
 *     "metadata": {
 *       "channel-slug-1": {
 *         "title": "Channel Title",
 *         "curators": [{"name": "Curator Name", "addresses": {"ethereum": "0x..."}, "url": "..."}],
 *         "summary": "Description... (if over 2000 chars, use --summary-* / SUMMARY_* env; see generate-ff-playlist)",
 *         "publisher": {"name": "Feral File", "url": "https://feralfile.com"}  // key added automatically
 *         "coverImage": "https://..."
 *       }
 *     }
 *   }
 *
 * Playlist Ordering:
 *   Within each channel, playlists are ordered by their numeric filename prefix
 *   (e.g., 01-intro.json, 02-main.json, 03-outro.json).
 *
 * Usage:
 *   node scripts/upload-to-feed.js --api-key <key> --feed-endpoint <url> --playlists-path <path> [--dry-run] [--output <summary-file>]
 *
 * Examples:
 *   # Upload all channels
 *   node scripts/upload-to-feed.js --api-key YOUR_API_KEY --feed-endpoint https://feed.feralfile.com --playlists-path ./playlists
 *
 *   # Upload a single channel
 *   node scripts/upload-to-feed.js --api-key YOUR_API_KEY --feed-endpoint https://feed.feralfile.com --playlists-path ./playlists/net-evil-das
 *
 *   # Use local development server
 *   node scripts/upload-to-feed.js --api-key YOUR_API_KEY --feed-endpoint http://localhost:8787 --playlists-path ./playlists/net-evil-das
 *
 *   # Dry-run mode
 *   node scripts/upload-to-feed.js --api-key YOUR_API_KEY --feed-endpoint https://feed.feralfile.com --playlists-path ./playlists --dry-run
 *
 *   # Long channel summaries (over 2000 chars): same flags/env as generate-ff-playlist (--summary-provider, SUMMARY_API_KEY, …)
 *   node scripts/upload-to-feed.js ... --summary-provider openai --summary-api-key sk-...
 *
 */

import fs from 'fs';
import path from 'path';
import { summarizeLongText, DEFAULT_MAX_TEXT_LENGTH } from './lib/llm-summarize-summary.js';

const FF_API_BASE = 'https://feralfile.com/api';
const PUBLISH_ARTIFACT_SCHEMA_VERSION = 1;
const CHANNEL_SCHEMA_TITLE_MAX = 200;

/** Ethereum address used for default publisher `Entity.key` (`did:pkh:eip155:1:…`) */
const FERAL_FILE_PUBLISHER_ETH = '0x1d05cf6c6BEb0c869851BFdb9510D4E44E855ad6';

/**
 * Build did:pkh from Feral File alumni `addresses` (ethereum / tezos).
 * @param {Record<string, string> | null | undefined} addresses
 * @returns {string | null}
 */
function alumniAddressToDidPkh(addresses) {
  if (!addresses || typeof addresses !== 'object') return null;
  const eth = addresses.ethereum;
  if (typeof eth === 'string' && /^0x[a-fA-F0-9]{40}$/.test(eth.trim())) {
    return `did:pkh:eip155:1:${eth.trim().toLowerCase()}`;
  }
  const tz = addresses.tezos;
  if (typeof tz === 'string' && /^tz[123][1-9A-HJ-NP-Za-km-z]{33}$/.test(tz.trim())) {
    return `did:pkh:tezos:mainnet:${tz.trim()}`;
  }
  return null;
}

const FERAL_FILE_PUBLISHER_KEY = alumniAddressToDidPkh({ ethereum: FERAL_FILE_PUBLISHER_ETH });

function isValidDidPkhKey(key) {
  return (
    typeof key === 'string' && key.startsWith('did:pkh:') && /^did:[a-z]+:.+$/.test(key.trim())
  );
}

/**
 * Curator entity for the channel schema: requires did:pkh from addresses or an existing did:pkh key.
 * @returns {({ name: string, key: string, url?: string }) | null}
 */
function curatorEntityFromManifestOrApi(entity) {
  if (!entity || typeof entity !== 'object') return null;
  const name =
    (entity.name != null && String(entity.name).trim()) ||
    (entity.alias != null && String(entity.alias).trim()) ||
    (entity.fullName != null && String(entity.fullName).trim()) ||
    'Unknown';
  let key = null;
  if (isValidDidPkhKey(entity.key)) {
    key = entity.key.trim();
  } else {
    key = alumniAddressToDidPkh(entity.addresses);
  }
  if (!key) return null;
  const out = { name, key };
  if (entity.url != null && String(entity.url).trim()) {
    out.url = String(entity.url).trim();
  }
  return out;
}

/**
 * Merge singular `curator` into `curators`, drop non-schema `curator`, keep only curators with did:pkh.
 */
function mergeCuratorFields(channel) {
  const merged = [];
  if (channel.curator) merged.push(channel.curator);
  if (Array.isArray(channel.curators)) merged.push(...channel.curators);
  delete channel.curator;
  const out = merged.map(curatorEntityFromManifestOrApi).filter(Boolean);
  if (out.length) {
    channel.curators = out;
  } else {
    delete channel.curators;
  }
}

/**
 * Default Feral File publisher in manifest often omits `key`; fill from FERAL_FILE_PUBLISHER_ETH.
 */
function ensureDefaultPublisherKey(channel) {
  if (!FERAL_FILE_PUBLISHER_KEY) return;
  const p = channel.publisher;
  if (!p || typeof p !== 'object' || p.key) return;
  const name = String(p.name || '').trim();
  const url = String(p.url || '').trim();
  if (name === 'Feral File' && (!url || url === 'https://feralfile.com')) {
    channel.publisher = { ...p, key: FERAL_FILE_PUBLISHER_KEY };
  }
}

function assertChannelTitleLength(title) {
  if (title == null) return;
  const t = String(title);
  if (t.length > CHANNEL_SCHEMA_TITLE_MAX) {
    throw new Error(
      `Channel title exceeds ${CHANNEL_SCHEMA_TITLE_MAX} characters (got ${t.length}). Shorten the title in channels-manifest.json or the exhibition source.`
    );
  }
}

/**
 * Validates title length, merges curators, strips version/created, LLM-shortens long summaries.
 */
async function prepareChannelPayload(raw, summaryOpts, context) {
  assertChannelTitleLength(raw.title);
  const channel = { ...raw };
  mergeCuratorFields(channel);
  ensureDefaultPublisherKey(channel);
  delete channel.version;
  delete channel.created;
  delete channel.id;

  if (channel.summary != null && String(channel.summary).length > DEFAULT_MAX_TEXT_LENGTH) {
    if (!summaryOpts?.apiKey || !summaryOpts?.provider) {
      throw new Error(
        `Channel summary exceeds ${DEFAULT_MAX_TEXT_LENGTH} characters (length ${String(channel.summary).length}). ` +
          `Set --summary-provider and --summary-api-key (or SUMMARY_PROVIDER and SUMMARY_API_KEY).`
      );
    }
    channel.summary = await summarizeLongText(
      summaryOpts,
      {
        kind: 'channel summary',
        subject: context.title ?? channel.title,
        labels: context.channelSlug ? { Slug: context.channelSlug } : {},
      },
      String(channel.summary)
    );
  }

  return channel;
}

/**
 * Fetch data from Feral File API
 */
async function fetchFeralFileAPI(endpoint) {
  const url = `${FF_API_BASE}${endpoint}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Feral File API request failed: ${response.status} ${response.statusText} for ${url}`
    );
  }

  return await response.json();
}

/**
 * Get exhibition info from Feral File API (used as fallback for channel metadata)
 */
async function getExhibition(slug) {
  console.log(`Fetching exhibition info for: ${slug}...`);
  const data = await fetchFeralFileAPI(`/exhibitions/${slug}`);
  return data.result;
}

/**
 * Transform URI according to resolveURI rules
 */
function resolveURI(rawSrc) {
  if (!rawSrc) {
    return null;
  }

  let resolvedSrc = rawSrc;

  if (rawSrc.startsWith('https://')) {
    if (rawSrc.includes('imagedelivery.net')) {
      const cfImageMatch = rawSrc.match(/^(https:\/\/imagedelivery\.net\/[^\/]+\/[^\/]+)/);
      if (cfImageMatch) {
        resolvedSrc = `${cfImageMatch[1]}/raw`;
      } else {
        resolvedSrc = rawSrc.replace(/\/(thumbnail|public|[^\/]+)$/, '') + '/raw';
      }
    }
  } else if (rawSrc.startsWith('ipfs://')) {
    const ipfsPath = rawSrc.substring(7);
    resolvedSrc = `https://ipfs.io/ipfs/${ipfsPath}`;
  } else {
    resolvedSrc = `https://cdn.feralfileassets.com/${rawSrc}`;
  }

  return resolvedSrc;
}

/**
 * Build channel data from Feral File exhibition API response (fallback option)
 */
function buildChannelFromExhibition(exhibition, playlistUrls) {
  // Curators only when we can derive did:pkh from Feral File alumni addresses (schema Entity.key)
  const curatorAlumni = exhibition.curatorAlumni;
  const did =
    curatorAlumni && typeof curatorAlumni === 'object'
      ? alumniAddressToDidPkh(curatorAlumni.addresses)
      : null;

  // Build publisher (Feral File) — schema Entity.key from fixed org address
  const publisher = {
    name: 'Feral File',
    url: 'https://feralfile.com',
    key: FERAL_FILE_PUBLISHER_KEY,
  };

  // Build summary (long HTML/plain notes: prepareChannelPayload + LLM if over 2000 chars)
  let summary =
    exhibition.note ||
    exhibition.noteBrief ||
    `A digital art exhibition featuring works from ${exhibition.title}`;

  // Build cover image
  let coverImage = exhibition.coverDisplay || exhibition.coverURI;
  if (coverImage) {
    coverImage = resolveURI(coverImage);
  }

  const channel = {
    title: exhibition.title,
    publisher,
    summary,
    playlists: playlistUrls,
  };

  if (did && curatorAlumni) {
    const curator = curatorAlumni;
    const curatorEntity = {
      name: curator.alias || curator.fullName || 'Unknown Curator',
      key: did,
    };
    if (curator.alias) {
      const encodedAlias = encodeURIComponent(curator.alias);
      curatorEntity.url = `https://feralfile.com/curators/${encodedAlias}`;
    }
    channel.curators = [curatorEntity];
  }

  if (coverImage) {
    channel.coverImage = coverImage;
  }

  return channel;
}

/**
 * Build channel data from manifest metadata
 */
function buildChannelFromMetadata(metadata, playlistUrls) {
  const channel = {
    playlists: playlistUrls,
  };

  // Copy all metadata fields to channel
  if (metadata.title) {
    channel.title = metadata.title;
  }

  if (metadata.curator) {
    channel.curator = metadata.curator;
  }

  if (metadata.curators) {
    channel.curators = metadata.curators;
  }

  if (metadata.summary) {
    channel.summary = metadata.summary;
  }

  if (metadata.publisher) {
    channel.publisher = metadata.publisher;
  }

  if (metadata.coverImage) {
    channel.coverImage = metadata.coverImage;
  }

  return channel;
}

/**
 * Upload playlist to feed server
 */
async function uploadPlaylist(feedEndpoint, apiKey, playlist) {
  const url = `${feedEndpoint}/api/v1/playlists`;

  console.log(`  Uploading playlist: ${playlist.title}...`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(playlist),
  });

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
 * Create channel on feed server
 */
async function createChannel(feedEndpoint, apiKey, channel) {
  const url = `${feedEndpoint}/api/v1/channels`;

  console.log(`Creating channel: ${channel.title}...`);
  console.log(`  Curators count: ${channel.curators?.length || 0}`);
  console.log(`  Publisher: ${channel.publisher?.name || 'N/A'}`);

  // Debug: log the channel data being sent
  if (process.env.DEBUG) {
    console.log('\nDEBUG - Channel data:');
    console.log(JSON.stringify(channel, null, 2));
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(channel),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('\n❌ Channel creation failed!');
    console.error('Request body:');
    console.error(JSON.stringify(channel, null, 2));
    throw new Error(
      `Failed to create channel: ${response.status} ${response.statusText}\n${errorText}`
    );
  }

  const result = await response.json();
  console.log(`✓ Channel created: ${result.id} (slug: ${result.slug})`);

  return result;
}

/**
 * Process a single channel folder (creates one channel from multiple playlists)
 */
async function processChannel(
  feedEndpoint,
  apiKey,
  channelPath,
  channelMetadata = null,
  dryrun = false,
  summaryOpts = null
) {
  const channelSlug = path.basename(channelPath);
  const startTime = Date.now();

  console.log(`\n${'='.repeat(80)}`);
  console.log(`${dryrun ? '[DRY RUN] ' : ''}Processing channel: ${channelSlug}`);
  console.log('='.repeat(80));

  // Get all playlist files in the folder
  const files = fs
    .readdirSync(channelPath)
    .filter(file => file.endsWith('.json') && file !== 'channels-manifest.json')
    .sort((a, b) => {
      // Sort by the index number at the start of filename
      const aIndex = parseInt(a.split('-')[0]);
      const bIndex = parseInt(b.split('-')[0]);
      return aIndex - bIndex;
    });

  if (files.length === 0) {
    console.log(`⚠️  No playlist files found in ${channelPath}`);
    return {
      channelSlug,
      status: 'skipped',
      reason: 'No playlist files found',
      playlists: [],
    };
  }

  console.log(`Found ${files.length} playlist(s)`);

  // Upload all playlists (or validate in dry-run mode)
  const uploadedPlaylists = [];
  const failedPlaylists = [];

  for (const file of files) {
    const playlistPath = path.join(channelPath, file);

    try {
      const playlistData = JSON.parse(fs.readFileSync(playlistPath, 'utf-8'));

      if (dryrun) {
        // Dry-run: validate playlist structure
        console.log(
          `  ✓ ${file}: ${playlistData.title} (${playlistData.items?.length || 0} items) [VALIDATED]`
        );
        uploadedPlaylists.push({
          file,
          id: 'dry-run-id',
          slug: 'dry-run-slug',
          title: playlistData.title,
          itemCount: playlistData.items?.length || 0,
        });
      } else {
        // Actually upload
        const result = await uploadPlaylist(feedEndpoint, apiKey, playlistData);
        uploadedPlaylists.push({
          file,
          id: result.id,
          slug: result.slug,
          title: result.title,
          itemCount: result.items?.length || 0,
        });
      }
    } catch (error) {
      console.error(`  ✗ Failed to ${dryrun ? 'validate' : 'upload'} ${file}:`, error.message);
      failedPlaylists.push({
        file,
        error: error.message,
      });
      if (!dryrun) {
        throw error;
      }
    }
  }

  // Build playlist URLs from uploaded playlists
  const playlistUrls = uploadedPlaylists.map(
    p => `${feedEndpoint}/api/v1/playlists/${encodeURIComponent(p.id)}`
  );

  // Build channel data - prefer manifest metadata, fallback to Feral File Exhibition API
  let channelData;
  let channelTitle = null;
  let dataSource = 'unknown';

  if (channelMetadata) {
    // Use metadata from channels-manifest.json
    console.log(`${dryrun ? '\n' : ''}Using channel metadata from channels-manifest.json`);
    channelData = buildChannelFromMetadata(channelMetadata, playlistUrls);
    dataSource = 'manifest';
  } else {
    // Fallback to Feral File Exhibition API (treating channel slug as exhibition slug)
    console.log(
      `${dryrun ? '\n' : ''}No manifest metadata found, attempting fallback to Feral File Exhibition API...`
    );
    try {
      const exhibition = await getExhibition(channelSlug);
      channelData = buildChannelFromExhibition(exhibition, playlistUrls);
      dataSource = 'feral-file-api';
    } catch (error) {
      console.error(`✗ Failed to fetch from Feral File Exhibition API: ${error.message}`);

      // In dry-run mode, return validation failure instead of throwing
      if (dryrun) {
        return {
          channelSlug,
          status: 'validation_failed',
          reason: `No channel metadata in manifest and Feral File Exhibition API failed: ${error.message}`,
          dataSource: null,
          playlists: uploadedPlaylists,
          invalidPlaylists: failedPlaylists,
          duration: Date.now() - startTime,
        };
      }

      throw new Error(
        `No channel metadata in manifest and Feral File Exhibition API failed: ${error.message}`
      );
    }
  }

  // Validate that we have at least a title
  if (!channelData.title) {
    const errorMsg = `Channel data must include a title. Source: ${dataSource}`;

    if (dryrun) {
      return {
        channelSlug,
        status: 'validation_failed',
        reason: errorMsg,
        dataSource,
        playlists: uploadedPlaylists,
        invalidPlaylists: failedPlaylists,
        duration: Date.now() - startTime,
      };
    }

    throw new Error(errorMsg);
  }

  let preparedChannelData;
  try {
    preparedChannelData = await prepareChannelPayload(channelData, summaryOpts, {
      channelSlug,
      title: channelData.title,
    });
  } catch (prepareErr) {
    const duration = Date.now() - startTime;
    if (dryrun) {
      return {
        channelSlug,
        status: 'validation_failed',
        reason: prepareErr.message,
        dataSource,
        playlists: uploadedPlaylists,
        invalidPlaylists: failedPlaylists,
        duration,
      };
    }
    console.error(`✗ Channel preparation failed:`, prepareErr.message);
    return {
      channelSlug,
      status: 'failed',
      reason: prepareErr.message,
      playlists: uploadedPlaylists,
      failedPlaylists: failedPlaylists,
      duration,
    };
  }

  channelTitle = preparedChannelData.title;

  // Create channel (or validate in dry-run mode)
  try {
    if (dryrun) {
      // Dry-run: just validate and report what would be created
      const duration = Date.now() - startTime;

      console.log(`\n  Would create channel: "${channelTitle}"`);
      console.log(`  Playlists: ${uploadedPlaylists.length}`);
      console.log(`  Data Source: ${dataSource}`);
      console.log(`  Duration: ${(duration / 1000).toFixed(2)}s`);

      if (failedPlaylists.length > 0) {
        console.log(`  ⚠️  ${failedPlaylists.length} playlist(s) failed validation`);
      }

      return {
        channelSlug,
        status: failedPlaylists.length > 0 ? 'validation_failed' : 'validated',
        dataSource,
        wouldCreateChannel: failedPlaylists.length === 0,
        channelData: {
          title: channelTitle,
          playlistCount: uploadedPlaylists.length,
        },
        playlists: uploadedPlaylists,
        invalidPlaylists: failedPlaylists,
        duration,
      };
    }

    // Actually create channel
    const channel = await createChannel(feedEndpoint, apiKey, preparedChannelData);
    const duration = Date.now() - startTime;

    console.log(`\n✓ Channel "${channelTitle}" uploaded successfully!`);
    console.log(`  Channel ID: ${channel.id}`);
    console.log(`  Channel Slug: ${channel.slug}`);
    console.log(`  Playlists: ${uploadedPlaylists.length}`);
    console.log(`  Data Source: ${dataSource}`);
    console.log(`  Duration: ${(duration / 1000).toFixed(2)}s`);

    return {
      channelSlug,
      status: 'success',
      publishedAt: new Date().toISOString(),
      dataSource,
      channel: {
        id: channel.id,
        slug: channel.slug,
        title: channel.title,
        url: `${feedEndpoint}/api/v1/channels/${encodeURIComponent(channel.id)}`,
        playlistCount: uploadedPlaylists.length,
      },
      playlists: uploadedPlaylists.map(playlist => ({
        ...playlist,
        url: `${feedEndpoint}/api/v1/playlists/${encodeURIComponent(playlist.id)}`,
      })),
      duration,
    };
  } catch (error) {
    console.error(`✗ Failed to create channel:`, error.message);

    return {
      channelSlug,
      status: 'failed',
      reason: `Failed to create channel: ${error.message}`,
      playlists: uploadedPlaylists,
      failedPlaylists,
      duration: Date.now() - startTime,
    };
  }
}

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

function writePublishArtifact({ artifactPath, artifact }) {
  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2), 'utf-8');
  console.log(`\n📦 Publish artifact written to: ${artifactPath}`);
}

function validatePublishedChannel({ result, canonicalOrigin }) {
  if (result.status !== 'success') {
    return;
  }
  if (!result.channel?.id || !result.channel?.slug || !result.channel?.url) {
    throw new Error(
      `validation failed for channel ${result.channelSlug}: missing required channel fields`
    );
  }
  if (!Array.isArray(result.playlists) || result.playlists.length === 0) {
    throw new Error(
      `validation failed for channel ${result.channelSlug}: no playlists in success result`
    );
  }

  const expectedChannelUrl = `${canonicalOrigin}/api/v1/channels/${encodeURIComponent(result.channel.id)}`;
  if (result.channel.url !== expectedChannelUrl) {
    throw new Error(
      `validation failed for channel ${result.channelSlug}: channel url mismatch (expected ${expectedChannelUrl}, got ${result.channel.url})`
    );
  }

  for (const playlist of result.playlists) {
    if (!playlist?.id || !playlist?.slug || !playlist?.url) {
      throw new Error(
        `validation failed for channel ${result.channelSlug}: playlist is missing id/slug/url`
      );
    }
    const expectedPlaylistUrl = `${canonicalOrigin}/api/v1/playlists/${encodeURIComponent(playlist.id)}`;
    if (playlist.url !== expectedPlaylistUrl) {
      throw new Error(
        `validation failed for channel ${result.channelSlug}: playlist url mismatch for ${playlist.id} (expected ${expectedPlaylistUrl}, got ${playlist.url})`
      );
    }
  }
}

function buildPublishArtifact({
  results,
  canonicalOrigin,
  feedEndpointInput,
  startedAt,
  completedAt,
  isDryRun,
}) {
  // Calculate summary statistics
  const successful = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status === 'failed').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const totalPlaylists = results.reduce((sum, r) => sum + (r.playlists?.length || 0), 0);
  const totalDuration = results.reduce((sum, r) => sum + (r.duration || 0), 0);

  return {
    schema_version: PUBLISH_ARTIFACT_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    mode: isDryRun ? 'dry-run' : 'upload',
    started_at: startedAt,
    completed_at: completedAt,
    canonical_origin: canonicalOrigin,
    summary: {
      total: results.length,
      successful,
      failed,
      skipped,
      total_playlists: totalPlaylists,
      total_duration_ms: totalDuration,
    },
    channels: results.map(result => ({
      source_folder: result.channelSlug,
      status: result.status,
      published_at: result.publishedAt || null,
      duration_ms: result.duration || 0,
      data_source: result.dataSource || null,
      reason: result.reason || null,
      channel:
        result.channel && result.status === 'success'
          ? {
              id: result.channel.id,
              slug: result.channel.slug,
              title: result.channel.title,
              url: result.channel.url,
              playlist_count: result.channel.playlistCount || 0,
            }
          : null,
      playlists: Array.isArray(result.playlists)
        ? result.playlists.map(playlist => ({
            source_file: playlist.file || null,
            id: playlist.id || null,
            slug: playlist.slug || null,
            title: playlist.title || null,
            item_count: playlist.itemCount || 0,
            url: playlist.url || null,
          }))
        : [],
    })),
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
  if (!artifact.summary || typeof artifact.summary !== 'object') {
    throw new Error('artifact validation failed: missing summary object');
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
      for (const playlist of channel.playlists) {
        if (!playlist?.id || !playlist?.url || !playlist?.slug) {
          throw new Error(
            `artifact validation failed: success channel ${channel.source_folder} has incomplete playlist rows`
          );
        }
      }
    }
  }
}

/**
 * Read or create channels manifest file
 */
function getChannelsManifest(playlistsPath) {
  const manifestPath = path.join(playlistsPath, 'channels-manifest.json');

  // Check if manifest exists
  if (fs.existsSync(manifestPath)) {
    try {
      const manifestData = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      console.log(`📋 Using channels manifest: ${manifestPath}`);
      return {
        path: manifestPath,
        channels: manifestData.channels || [],
        metadata: manifestData.metadata || {},
        existed: true,
      };
    } catch (error) {
      console.warn(`⚠️  Failed to parse manifest file: ${error.message}`);
      console.warn('    Falling back to alphabetical order');
      return null;
    }
  }

  return null;
}

/**
 * Create default channels manifest file
 */
function createDefaultManifest(playlistsPath, subDirs) {
  const manifestPath = path.join(playlistsPath, 'channels-manifest.json');

  const manifest = {
    _comment:
      "This file defines the order in which exhibition channels are processed and uploaded. Reorder the 'channels' array to change the upload sequence.",
    channels: subDirs.sort(),
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(`📝 Created default channels manifest: ${manifestPath}`);
  console.log(`   Contains ${subDirs.length} exhibition(s) in alphabetical order`);
  console.log(`   Edit this file to customize the upload order\n`);

  return manifest.channels;
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);

  // Parse flags
  const getFlag = flag => {
    const index = args.indexOf(flag);
    if (index !== -1 && args[index + 1]) {
      return args[index + 1];
    }
    return null;
  };

  const apiKey = getFlag('--api-key');
  const feedEndpointInput = getFlag('--feed-endpoint');
  const playlistsPath = getFlag('--playlists-path');
  const isDryRun = args.includes('--dry-run');
  const artifactOutputPath = getFlag('--artifact-output');

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

  // Validate required flags
  if (!apiKey || !feedEndpointInput || !playlistsPath) {
    console.error(
      'Usage: node upload-to-feed.js --api-key <key> --feed-endpoint <url> --playlists-path <path> [--dry-run]'
    );
    console.error('\nRequired flags:');
    console.error('  --api-key         API key for Feed server authentication');
    console.error('  --feed-endpoint   Feed server URL (e.g., https://feed.feralfile.com)');
    console.error('  --playlists-path  Path to playlists folder or exhibition folder');
    console.error('  --artifact-output Path to machine-readable JSON publish artifact');
    console.error('\nOptional flags:');
    console.error('  --dry-run         Validate playlists without uploading');
    console.error(
      '\nChannel summary (when text over 2000 chars), same flags as generate-ff-playlist:'
    );
    console.error('  --summary-provider  openai | gemini (or SUMMARY_PROVIDER)');
    console.error('  --summary-api-key   API key (or SUMMARY_API_KEY)');
    console.error('  --summary-model     Optional (or SUMMARY_MODEL)');
    console.error('  --summary-base-url  Optional (or SUMMARY_BASE_URL)');
    console.error('\nExamples:');
    console.error(
      '  node scripts/upload-to-feed.js --api-key YOUR_API_KEY --feed-endpoint https://feed.feralfile.com --playlists-path ./playlists'
    );
    console.error(
      '  node scripts/upload-to-feed.js --api-key YOUR_API_KEY --feed-endpoint http://localhost:8787 --playlists-path ./playlists/net-evil-das'
    );
    console.error(
      '  node scripts/upload-to-feed.js --api-key YOUR_API_KEY --feed-endpoint https://feed.feralfile.com --playlists-path ./playlists --dry-run'
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

  // Validate paths
  if (!fs.existsSync(playlistsPath)) {
    console.error(`Error: Path does not exist: ${playlistsPath}`);
    process.exit(1);
  }

  const stat = fs.statSync(playlistsPath);
  const results = [];

  try {
    if (stat.isDirectory()) {
      // Check if it's an channel folder (contains playlist JSON files) or a parent folder
      const files = fs.readdirSync(playlistsPath);
      const hasPlaylistFiles = files.some(
        f => f.endsWith('.json') && f !== 'channels-manifest.json'
      );

      if (hasPlaylistFiles) {
        // It's a channel folder
        // When processing a single channel folder, check for manifest in parent
        const channelSlug = path.basename(playlistsPath);
        const parentPath = path.dirname(playlistsPath);
        const manifest = getChannelsManifest(parentPath);
        const channelMetadata = manifest?.metadata?.[channelSlug] || null;

        const result = await processChannel(
          feedEndpoint,
          apiKey,
          playlistsPath,
          channelMetadata,
          isDryRun,
          summaryOpts
        );
        if (result) {
          results.push(result);
        }
      } else {
        // It's a parent folder, process all subdirectories (channels)
        const subDirs = files.filter(f => {
          const subPath = path.join(playlistsPath, f);
          return fs.statSync(subPath).isDirectory();
        });

        console.log(`Found ${subDirs.length} channel folder(s)\n`);

        // Check for channels manifest
        const manifest = getChannelsManifest(playlistsPath);
        let orderedSubDirs;

        if (manifest && manifest.channels.length > 0) {
          // Use manifest order
          orderedSubDirs = manifest.channels;

          // Warn about channels in filesystem but not in manifest
          const missingFromManifest = subDirs.filter(dir => !orderedSubDirs.includes(dir));
          if (missingFromManifest.length > 0) {
            console.warn(
              `⚠️  Warning: ${missingFromManifest.length} channel(s) found but not in manifest:`
            );
            missingFromManifest.forEach(dir => console.warn(`    - ${dir}`));
            console.warn(
              '    These will be skipped. Update channels-manifest.json to include them.\n'
            );
          }

          // Warn about channels in manifest but not in filesystem
          const missingFromFilesystem = orderedSubDirs.filter(dir => !subDirs.includes(dir));
          if (missingFromFilesystem.length > 0) {
            console.warn(
              `⚠️  Warning: ${missingFromFilesystem.length} channel(s) in manifest but not found:`
            );
            missingFromFilesystem.forEach(dir => console.warn(`    - ${dir}`));
            console.warn('    These will be skipped.\n');
          }

          // Filter to only process channels that exist
          orderedSubDirs = orderedSubDirs.filter(dir => subDirs.includes(dir));
          console.log(`Processing ${orderedSubDirs.length} channel(s) in manifest order:\n`);
          orderedSubDirs.forEach((dir, idx) => console.log(`  ${idx + 1}. ${dir}`));
          console.log('');
        } else {
          // No manifest, create default one
          console.log('No channels manifest found. Creating default...\n');
          orderedSubDirs = createDefaultManifest(playlistsPath, subDirs);
          console.log(`Processing ${orderedSubDirs.length} channel(s) in alphabetical order\n`);
        }

        for (const subDir of orderedSubDirs) {
          const subPath = path.join(playlistsPath, subDir);
          const channelMetadata = manifest?.metadata?.[subDir] || null;

          try {
            const result = await processChannel(
              feedEndpoint,
              apiKey,
              subPath,
              channelMetadata,
              isDryRun,
              summaryOpts
            );
            if (result) {
              results.push(result);
            }
          } catch (error) {
            console.error(`\n✗ Failed to process ${subDir}:`, error.message);
            results.push({
              channelSlug: subDir,
              status: 'failed',
              reason: error.message,
              playlists: [],
              duration: 0,
            });
          }
        }

        // Print summary
        const successful = results.filter(r => r.status === 'success' || r.status === 'validated');
        const failed = results.filter(
          r => r.status === 'failed' || r.status === 'validation_failed'
        );
        const skipped = results.filter(r => r.status === 'skipped');

        console.log(`\n${'='.repeat(80)}`);
        console.log('Summary:');
        console.log(`  Total Channels: ${results.length}`);
        if (isDryRun) {
          console.log(`  Validated: ${successful.length}`);
          console.log(`  Validation Failed: ${failed.length}`);
        } else {
          console.log(`  Successful: ${successful.length}`);
          console.log(`  Failed: ${failed.length}`);
        }
        console.log(`  Skipped: ${skipped.length}`);
        console.log(
          `  Total Playlists: ${results.reduce((sum, r) => sum + (r.playlists?.length || 0), 0)}`
        );
        console.log('='.repeat(80));

        if (failed.length > 0) {
          console.log(`\nFailed channels:`);
          for (const result of failed) {
            console.log(`  ✗ ${result.channelSlug}: ${result.reason || 'Validation failed'}`);
          }
        }
      }
    } else {
      console.error('Error: Path must be a directory');
      process.exit(1);
    }

    const endTime = Date.now();
    const completedAtIso = new Date(endTime).toISOString();

    for (const result of results) {
      validatePublishedChannel({
        result,
        canonicalOrigin: feedEndpoint,
      });
    }

    const publishArtifact = buildPublishArtifact({
      results,
      canonicalOrigin: feedEndpoint,
      feedEndpointInput,
      startedAt: startedAtIso,
      completedAt: completedAtIso,
      isDryRun,
    });
    validatePublishArtifactOrThrow(publishArtifact);
    writePublishArtifact({
      artifactPath,
      artifact: publishArtifact,
    });

    if (isDryRun) {
      console.log('\n✓ Dry run complete! No data was uploaded.');
    } else {
      console.log('\n✓ Upload complete!');
    }
  } catch (error) {
    console.error('\n✗ Upload failed:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run the script
main();
