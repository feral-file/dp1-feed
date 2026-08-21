#!/usr/bin/env node

/**
 * One-off: consolidate the Objkt channels into a single DP-1 channel.
 *
 * The channel registry lists ~52 separate Objkt channels, each hosted on
 * objkt's own feed (dp1-feed.objkt.com) and each holding a handful of playlist
 * URLs. This mirrors the per-exhibition channel sprawl that Feral File already
 * collapsed into one channel. This script does the equivalent flattening for
 * Objkt: read every channel the registry lists for the publisher, concatenate
 * their `playlists` arrays in registry order, and emit ONE channel object that
 * references all of them.
 *
 * The playlists themselves are not touched, refetched, or rewritten — they stay
 * where they are and the consolidated channel just points at the same URLs.
 *
 * By default this script performs NO remote writes: it reads the public
 * registry and channel endpoints and writes a JSON file to disk. Passing
 * --publish additionally creates (or updates) the channel on a feed server.
 * Updating the registry to point at it (see scripts/update-channel-registry.js
 * --mode replace) is always left as a separate, manual step.
 *
 * Usage:
 *   node scripts/consolidate-objkt-channels.js [options]
 *
 * Options:
 *   --registry <url>       Registry endpoint
 *                          (default: https://feed.feralfile.com/api/v1/registry/channels)
 *   --publisher <name>     Registry publisher to consolidate (default: Objkt)
 *   --output <path>        Output channel JSON
 *                          (default: ./objkt-consolidated-channel.json)
 *   --report <path>        Optional per-source-channel CSV report
 *   --title <str>          Channel title (default: objkt.com)
 *   --slug <str>           Channel slug (default: objkt)
 *   --summary <str>        Channel summary (default: see DEFAULT_SUMMARY)
 *   --cover-image <url>    Channel cover image (default: first source channel's)
 *   --curator-name <str>   Curator entity name (default: objkt.com)
 *   --curator-url <url>    Curator entity url (default: https://objkt.com)
 *   --publisher-key <did>  Publisher entity key (did:...). Without it the
 *                          publisher block is omitted; DP-1 requires a key and
 *                          the feed rejects an entity that lacks one.
 *   --curator-key <did>    Curator entity key. Must be did:key:z... — the DP-1
 *                          schema rejects other DID methods. Omitted if unset.
 *   --concurrency <n>      Parallel channel fetches (default: 6)
 *   --limit <n>            Mirror only the first n playlists. For staged
 *                          verification before a full run; the resulting
 *                          channel is incomplete, so do not leave it published.
 *   --allow-partial        Continue even if some source channels fail to fetch.
 *                          Off by default: a channel that fails to load would
 *                          silently drop its playlists from the result.
 *   --publish <endpoint>   Create/update the channel on this feed, e.g.
 *                          https://feed.feralfile.com. Omit for dry output.
 *                          Implies mirroring every source playlist onto that
 *                          feed (see --no-mirror) because the feed rejects
 *                          objkt's 0x-prefixed signatures.
 *   --no-mirror            Reference the source playlists directly instead of
 *                          mirroring them. Only useful against a feed that
 *                          tolerates 0x-prefixed signatures; feed.feralfile.com
 *                          does not, and will reject the channel.
 *   --api-key <key>        API key for --publish. Falls back to FEED_API_KEY.
 *                          Never logged.
 *
 * Example:
 *   node scripts/consolidate-objkt-channels.js \
 *     --output ./objkt-consolidated-channel.json \
 *     --report ./objkt-consolidation-report.csv
 */

import fs from 'fs';
import { createHash, randomUUID } from 'crypto';

import dp1 from 'ff-dp1-js';

const DEFAULT_REGISTRY = 'https://feed.feralfile.com/api/v1/registry/channels';
const DEFAULT_PUBLISHER = 'Objkt';
const DEFAULT_OUTPUT = './objkt-consolidated-channel.json';
const DEFAULT_CONCURRENCY = 6;

/**
 * Default channel summary. Deliberately mirrors the sentence shape of the
 * consolidated Feral File channel ("X is a ... This channel brings together
 * ... in one place") so the two publishers read as a set in the registry, and
 * describes the art rather than the consolidation, which is an internal
 * migration detail with a count that would go stale.
 */
const DEFAULT_SUMMARY =
  'objkt.com is a marketplace for digital art on Tezos. This channel brings ' +
  'together works from every objkt.com gallery and curated space in one place.';

/** Placeholder signature; the real one is applied at publish time. */
const PLACEHOLDER_SIGNATURE = `ed25519:0x${'0'.repeat(128)}`;

/** DP-1 caps a channel's `playlists` array at this length. */
const MAX_CHANNEL_PLAYLISTS = 1024;

/**
 * GET JSON with a few retries. Read-only; this script never writes remotely.
 */
async function fetchJSON(url, attempts = 4) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.json();
      }
      lastError = new Error(`HTTP ${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }
    if (i < attempts - 1) {
      await new Promise(resolve => setTimeout(resolve, 400 * (i + 1)));
    }
  }
  throw new Error(`${url}: ${lastError.message}`);
}

/**
 * Normalise registry shapes: dp1-feed-v2 returns { publishers: [...] }, older
 * deployments returned a bare array. Matches update-channel-registry.js.
 */
function normalizeRegistry(registry) {
  if (Array.isArray(registry)) return registry;
  if (Array.isArray(registry?.publishers)) return registry.publishers;
  throw new Error('Unrecognised registry response shape');
}

/**
 * Collect a publisher's channel URLs. The registry splits them into `static`
 * and `living`; both are taken so nothing is missed, static first.
 */
function channelUrlsForPublisher(publishers, publisherName) {
  const wanted = String(publisherName).toLowerCase();
  const entry = publishers.find(p => String(p?.name ?? '').toLowerCase() === wanted);

  if (!entry) {
    const names = publishers.map(p => p?.name).join(', ');
    throw new Error(`Publisher "${publisherName}" not found in registry. Present: ${names}`);
  }

  const staticUrls = Array.isArray(entry.static) ? entry.static : [];
  const livingUrls = Array.isArray(entry.living) ? entry.living : [];
  const flatUrls = Array.isArray(entry.channel_urls) ? entry.channel_urls : [];
  const urls = [...staticUrls, ...livingUrls, ...flatUrls];

  console.log(
    `  Publisher "${entry.name}": ${urls.length} channel(s) ` +
      `(${staticUrls.length} static, ${livingUrls.length} living, ${flatUrls.length} channel_urls)`
  );

  return urls;
}

/**
 * Fetch every source channel, preserving registry order in the result.
 * Failures are collected rather than thrown so the caller can report all of
 * them at once instead of one per run.
 */
async function fetchChannels(urls, concurrency) {
  const channels = new Array(urls.length).fill(null);
  const failures = [];
  let cursor = 0;

  const worker = async () => {
    while (cursor < urls.length) {
      const index = cursor++;
      const url = urls[index];
      try {
        channels[index] = await fetchJSON(url);
      } catch (error) {
        failures.push({ url, error: error.message });
        console.error(`  ✗ ${url}: ${error.message}`);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

  return { channels, failures };
}

/**
 * Flatten source channels into one ordered, de-duplicated playlist URL list.
 *
 * The Objkt channels observed had no overlap at all, but a URL appearing in two
 * channels would otherwise land in the consolidated channel twice, so it is
 * de-duplicated (first occurrence wins) and reported.
 */
function flattenPlaylists(channels) {
  const seen = new Set();
  const playlists = [];
  const duplicates = [];
  const empty = [];

  for (const channel of channels) {
    if (!channel) continue;

    const refs = Array.isArray(channel.playlists) ? channel.playlists : [];
    if (refs.length === 0) {
      empty.push(channel.slug || channel.id);
    }

    for (const ref of refs) {
      if (seen.has(ref)) {
        duplicates.push({ ref, channel: channel.slug || channel.id });
        continue;
      }
      seen.add(ref);
      playlists.push(ref);
    }
  }

  return { playlists, duplicates, empty };
}

/**
 * Build the curator entity. `key` is omitted unless supplied, because the DP-1
 * Entity schema only accepts did:key and there is no way to derive one here.
 */
function buildCurator(options) {
  const curator = { name: options.curatorName };
  if (options.curatorKey) curator.key = options.curatorKey;
  if (options.curatorUrl) curator.url = options.curatorUrl;
  return curator;
}

/**
 * DP-1 Entity requires both `name` and `key`, where `key` is a DID matching
 * `^did:[a-z]+:.+$`. A keyless entity is not merely incomplete: dp1-feed
 * materialises the absent key as an empty string and then fails its own
 * post-sign validation on it, producing a confusing 400 that points at a field
 * we never sent. Since `publisher` and `curators` are both optional at the top
 * level, dropping an unkeyed entity is better than sending an invalid one.
 *
 * objkt publishes no DID for itself (their own channels carry a keyless
 * publisher, which their feed tolerates), so by default both are omitted and
 * attribution rests on the channel title, summary and slug. Supply
 * --curator-key / --publisher-key to include them properly.
 */
function withValidKey(entity, label) {
  if (!entity) return undefined;
  if (typeof entity.key === 'string' && /^did:[a-z]+:.+$/.test(entity.key)) return entity;
  console.log(
    `  Note: omitting ${label} — DP-1 requires a did: key and none was supplied. ` +
      `Attribution stays in the title/summary.`
  );
  return undefined;
}

/**
 * Assemble the consolidated DP-1 channel.
 */
function buildChannel(sourceChannels, playlists, options) {
  const present = sourceChannels.filter(Boolean);

  const sourcePublisher = present.find(c => c.publisher)?.publisher;
  const publisher = options.publisherKey
    ? { name: options.curatorName, key: options.publisherKey, url: options.curatorUrl }
    : withValidKey(sourcePublisher, 'publisher');

  const coverImage = options.coverImage ?? present.find(c => c.coverImage)?.coverImage;

  const summary = options.summary ?? DEFAULT_SUMMARY;

  const curator = withValidKey(buildCurator(options), 'curators');

  const channel = {
    id: randomUUID(),
    slug: options.slug,
    title: options.title,
    summary,
    playlists,
    created: new Date().toISOString(),
    signature: PLACEHOLDER_SIGNATURE,
  };

  if (publisher) channel.publisher = publisher;
  if (curator) channel.curators = [curator];
  if (coverImage) channel.coverImage = coverImage;

  return channel;
}

/**
 * Validate against the DP-1 channel schema, throwing on failure.
 */
function validateChannel(channel) {
  const result = dp1.parseChannel(channel);
  if (result.error) {
    console.error('\n✗ Channel validation failed:');
    console.error(result.error.message);
    if (result.error.details) console.error('Details:', result.error.details);
    throw new Error('Channel validation failed');
  }
}

/**
 * Write a per-source-channel CSV so the flattening can be audited by hand.
 */
function writeReport(path, sourceUrls, channels) {
  const rows = ['source_url,channel_id,channel_slug,channel_title,playlist_count,status'];

  sourceUrls.forEach((url, index) => {
    const channel = channels[index];
    const csv = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    rows.push(
      [
        csv(url),
        csv(channel?.id),
        csv(channel?.slug),
        csv(channel?.title),
        channel ? (channel.playlists?.length ?? 0) : '',
        channel ? 'ok' : 'failed',
      ].join(',')
    );
  });

  fs.writeFileSync(path, `${rows.join('\n')}\n`, 'utf-8');
  console.log(`  ✓ Report written to ${path}`);
}

/**
 * Fields the feed accepts when creating or updating a channel. `id`, `created`
 * and `signature` are server-managed and must not be sent.
 */
/**
 * RFC 4122 URL namespace. Mirrored playlist ids are UUIDv5 over the *source*
 * URL, which makes the id itself a reproducible fingerprint of where the copy
 * came from. The feed drops unknown top-level fields, so there is nowhere else
 * to record provenance; deriving the id is what preserves it. It also makes
 * re-runs idempotent: the same source URL always maps to the same local id,
 * so a repeat run updates in place instead of duplicating 390 playlists.
 */
const UUID_URL_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

/** Slug prefix marking a playlist as a mirror rather than a Feral File original. */
const MIRROR_SLUG_PREFIX = 'objkt-';

/** Fields the feed accepts when writing a playlist. Anything else is discarded. */
const PLAYLIST_WRITE_FIELDS = [
  'dpVersion',
  'id',
  'slug',
  'title',
  'created',
  'defaults',
  'items',
  'summary',
  'coverImage',
  'curators',
  'dynamicQuery',
  'signature',
];

/**
 * UUIDv5 (SHA-1, name-based) per RFC 4122 §4.3. Node has randomUUID for v4 but
 * no name-based generator, and pulling in a dependency for ~10 lines is not
 * worth it. Cross-checked against Python's uuid.uuid5.
 */
function uuidv5(name, namespace = UUID_URL_NAMESPACE) {
  const nsBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1')
    .update(Buffer.concat([nsBytes, Buffer.from(name, 'utf8')]))
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Rewrite a source playlist into the copy we host.
 *
 * The signature rewrite is the reason this whole mirror exists. DP-1 §7.1.2
 * specifies `"signature": "ed25519:<hex>"` and every schema in the ecosystem
 * enforces `^ed25519:[a-f0-9]+$` — bare lowercase hex. ff-dp1-js@1.0.0 (which
 * objkt signs with) emits `ed25519:0x<hex>` instead, so dp1-go rejects those
 * playlists and a channel referencing them cannot be created.
 *
 * Stripping `0x` is lossless, not a re-sign: the signature covers the document
 * with its own `signature` field removed (see DP-1 §7.1), so the prefix is pure
 * encoding of the signature bytes. The same bytes still verify afterwards.
 */
function toMirroredPlaylist(playlist, sourceUrl) {
  const payload = {};
  for (const field of PLAYLIST_WRITE_FIELDS) {
    if (playlist[field] !== undefined) payload[field] = playlist[field];
  }

  if (typeof payload.signature === 'string') {
    payload.signature = payload.signature.replace(/^ed25519:0x/i, 'ed25519:');
  }

  payload.id = uuidv5(sourceUrl);
  payload.slug = `${MIRROR_SLUG_PREFIX}${playlist.slug}`;
  return payload;
}

/**
 * Mirror one playlist, creating it or updating the existing copy in place.
 * Looked up by derived id rather than slug: the id is the stable identity here,
 * and a source playlist that gets renamed upstream should update its existing
 * mirror rather than strand it and create a second copy.
 */
async function mirrorPlaylist(sourceUrl, endpoint, apiKey) {
  const base = endpoint.replace(/\/$/, '');
  const source = await fetchJSON(sourceUrl);
  const payload = toMirroredPlaylist(source, sourceUrl);
  const target = `${base}/api/v1/playlists/${payload.id}`;

  const lookup = await apiRequest('GET', target, apiKey);
  let response;
  let action;
  if (lookup.ok) {
    action = 'updated';
    response = await apiRequest('PATCH', target, apiKey, payload);
  } else if (lookup.status === 404) {
    action = 'created';
    response = await apiRequest('POST', `${base}/api/v1/playlists`, apiKey, payload);
  } else {
    throw new Error(`Lookup failed for ${sourceUrl}: ${lookup.status} ${lookup.statusText}`);
  }

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400);
    throw new Error(
      `Mirror failed for ${sourceUrl}: ${response.status} ${response.statusText}\n  ${detail}`
    );
  }

  return { url: target, action, slug: payload.slug, sourceUrl };
}

/**
 * Mirror every source playlist, preserving order. Unlike channel fetching this
 * refuses to continue on any failure: a channel built from a partial mirror
 * would silently omit playlists, which is exactly the kind of quiet data loss
 * that is hard to notice once published.
 */
async function mirrorPlaylists(sourceUrls, endpoint, apiKey, concurrency) {
  const results = new Array(sourceUrls.length);
  let next = 0;
  let done = 0;

  const worker = async () => {
    while (next < sourceUrls.length) {
      const index = next++;
      results[index] = await mirrorPlaylist(sourceUrls[index], endpoint, apiKey);
      done += 1;
      if (done % 25 === 0 || done === sourceUrls.length) {
        process.stdout.write(`\r  Mirrored ${done}/${sourceUrls.length}`);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, sourceUrls.length) }, worker));
  process.stdout.write('\n');
  return results;
}

const CHANNEL_WRITE_FIELDS = [
  'slug',
  'title',
  'summary',
  'publisher',
  'curators',
  'playlists',
  'coverImage',
];

/**
 * Reduce a channel object to the fields the feed accepts on write.
 */
function toChannelPayload(channel) {
  const payload = {};
  for (const field of CHANNEL_WRITE_FIELDS) {
    if (channel[field] !== undefined) payload[field] = channel[field];
  }
  return payload;
}

/**
 * Issue an authenticated request. The key is only ever placed in the header,
 * never logged or echoed.
 */
async function apiRequest(method, url, apiKey, body) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
  };
  if (body !== undefined) options.body = JSON.stringify(body);
  return fetch(url, options);
}

/**
 * Create the channel, or update it in place when one already exists under the
 * same slug. Channel slugs are unique on the feed, so a blind create of an
 * already published channel would fail with a duplicate-key error.
 */
async function publishChannel(channel, endpoint, apiKey) {
  const base = endpoint.replace(/\/$/, '');
  const payload = toChannelPayload(channel);

  const lookup = await apiRequest(
    'GET',
    `${base}/api/v1/channels/${encodeURIComponent(channel.slug)}`,
    apiKey
  );

  let response;
  let action;
  if (lookup.ok) {
    const existing = await lookup.json();
    action = 'updated';
    console.log(`\nUpdating existing channel ${existing.id} (slug: ${channel.slug})...`);
    response = await apiRequest(
      'PATCH',
      `${base}/api/v1/channels/${encodeURIComponent(existing.id)}`,
      apiKey,
      payload
    );
  } else if (lookup.status === 404) {
    action = 'created';
    console.log(`\nCreating channel (slug: ${channel.slug})...`);
    response = await apiRequest('POST', `${base}/api/v1/channels`, apiKey, payload);
  } else {
    throw new Error(`Channel lookup failed: ${lookup.status} ${lookup.statusText}`);
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Failed to publish channel: ${response.status} ${response.statusText}\n${detail}`
    );
  }

  const result = await response.json();
  const url = `${base}/api/v1/channels/${encodeURIComponent(result.id)}`;
  console.log(`  ✓ Channel ${action}: ${result.id} (slug: ${result.slug})`);
  return { result, url, action };
}

function parseArgs(argv) {
  const options = {
    registry: DEFAULT_REGISTRY,
    publisher: DEFAULT_PUBLISHER,
    output: DEFAULT_OUTPUT,
    report: null,
    title: 'objkt.com',
    slug: 'objkt',
    summary: null,
    coverImage: null,
    curatorName: 'objkt.com',
    curatorUrl: 'https://objkt.com',
    curatorKey: null,
    publisherKey: null,
    concurrency: DEFAULT_CONCURRENCY,
    allowPartial: false,
    publish: null,
    apiKey: process.env.FEED_API_KEY || null,
    mirror: true,
    limit: null,
  };

  const withValue = {
    '--registry': 'registry',
    '--publisher': 'publisher',
    '--output': 'output',
    '--report': 'report',
    '--title': 'title',
    '--slug': 'slug',
    '--summary': 'summary',
    '--cover-image': 'coverImage',
    '--curator-name': 'curatorName',
    '--curator-url': 'curatorUrl',
    '--curator-key': 'curatorKey',
    '--publisher-key': 'publisherKey',
    '--publish': 'publish',
    '--api-key': 'apiKey',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--allow-partial') {
      options.allowPartial = true;
    } else if (arg === '--no-mirror') {
      options.mirror = false;
    } else if (arg === '--limit') {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error(`--limit must be a positive integer, got: ${argv[i]}`);
      }
      options.limit = value;
    } else if (arg === '--concurrency') {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error(`--concurrency must be a positive integer, got: ${argv[i]}`);
      }
      options.concurrency = value;
    } else if (withValue[arg]) {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      options[withValue[arg]] = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.publish && !options.apiKey) {
    throw new Error('--publish requires --api-key (or FEED_API_KEY in the environment)');
  }

  if (options.curatorKey && !/^did:key:z[1-9A-HJ-NP-Za-km-z]+$/.test(options.curatorKey)) {
    throw new Error(
      `--curator-key must be a did:key (e.g. did:key:z6Mk...); DP-1 rejects other DID methods. Got: ${options.curatorKey}`
    );
  }

  return options;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`Error: ${error.message}`);
    console.error('\nRun with no arguments to use the defaults, or see the header for options.');
    process.exit(1);
  }

  try {
    console.log(`Fetching registry: ${options.registry}`);
    const publishers = normalizeRegistry(await fetchJSON(options.registry));
    const urls = channelUrlsForPublisher(publishers, options.publisher);

    if (urls.length === 0) {
      throw new Error(`Publisher "${options.publisher}" lists no channels`);
    }

    console.log(`\nFetching ${urls.length} source channel(s)...`);
    const { channels, failures } = await fetchChannels(urls, options.concurrency);
    const fetched = channels.filter(Boolean).length;
    console.log(`  Fetched ${fetched}/${urls.length}`);

    if (failures.length > 0 && !options.allowPartial) {
      throw new Error(
        `${failures.length} source channel(s) failed to fetch; their playlists would be silently ` +
          `dropped. Re-run with --allow-partial to proceed anyway.`
      );
    }

    const { playlists, duplicates, empty } = flattenPlaylists(channels);

    console.log(`\nFlattened ${fetched} channel(s) → ${playlists.length} playlist reference(s)`);
    if (empty.length > 0) {
      console.log(
        `  Note: ${empty.length} source channel(s) had no playlists: ${empty.join(', ')}`
      );
    }
    if (duplicates.length > 0) {
      console.log(`  Note: dropped ${duplicates.length} duplicate playlist reference(s):`);
      for (const dup of duplicates) console.log(`    ${dup.ref} (again in ${dup.channel})`);
    }

    if (playlists.length === 0) {
      throw new Error('No playlist references found across the source channels');
    }
    if (playlists.length > MAX_CHANNEL_PLAYLISTS) {
      throw new Error(
        `${playlists.length} playlists exceeds the DP-1 channel cap of ${MAX_CHANNEL_PLAYLISTS}. ` +
          `Consolidating into a single channel is not possible without splitting.`
      );
    }

    // The channel stores playlist URLs, and the feed re-fetches and validates
    // each one on write. objkt's copies carry 0x-prefixed signatures that DP-1
    // forbids, so a channel pointing straight at them is rejected outright.
    // Mirroring rewrites the signature encoding onto locally hosted copies and
    // points the channel at those instead.
    let channelPlaylists = playlists;
    if (options.publish && options.mirror) {
      const toMirror = options.limit ? playlists.slice(0, options.limit) : playlists;
      if (options.limit) {
        console.log(`\n--limit ${options.limit}: mirroring only the first ${toMirror.length}`);
      }
      console.log(`\nMirroring playlist(s) to ${options.publish}...`);
      const mirrored = await mirrorPlaylists(
        toMirror,
        options.publish,
        options.apiKey,
        options.concurrency
      );
      const created = mirrored.filter(m => m.action === 'created').length;
      console.log(`  ${created} created, ${mirrored.length - created} updated`);
      channelPlaylists = mirrored.map(m => m.url);
    }

    const channel = buildChannel(channels, channelPlaylists, options);
    validateChannel(channel);

    fs.writeFileSync(options.output, `${JSON.stringify(channel, null, 2)}\n`, 'utf-8');

    console.log(`\n✓ Consolidated channel written to ${options.output}`);
    console.log(`  Title: ${channel.title}`);
    console.log(`  Slug: ${channel.slug}`);
    console.log(`  ID: ${channel.id}`);
    console.log(`  Publisher: ${channel.publisher ? channel.publisher.name : '(omitted)'}`);
    console.log(
      `  Curators: ${channel.curators ? channel.curators.map(c => c.name).join(', ') : '(omitted)'}`
    );
    console.log(`  Playlists: ${channel.playlists.length}`);
    console.log(
      `  Source channels: ${fetched}${failures.length ? ` (${failures.length} failed)` : ''}`
    );

    if (options.report) writeReport(options.report, urls, channels);

    if (options.publish) {
      const { url } = await publishChannel(channel, options.publish, options.apiKey);
      console.log(`  Channel URL: ${url}`);
      console.log('\nThe registry was NOT touched. To point it at this channel:');
      console.log(
        `  node scripts/update-channel-registry.js --publisher "${options.publisher}" --mode replace ...`
      );
      console.log('The old channels stay on their feed, orphaned but intact.');
    } else {
      console.log('\nNothing was published. Next steps are manual:');
      console.log('  1. Create the channel on the target feed from this file,');
      console.log('     or re-run with --publish <endpoint> --api-key <key>.');
      console.log('  2. Point the registry at it:');
      console.log(
        `     node scripts/update-channel-registry.js --publisher "${options.publisher}" --mode replace ...`
      );
      console.log('  3. The old channels stay on their feed, orphaned but intact.');
    }
  } catch (error) {
    console.error(`\n✗ ${error.message}`);
    process.exit(1);
  }
}

main();
