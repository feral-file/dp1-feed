#!/usr/bin/env node

/**
 * Generate ff-app snapshot input in legacy config shape.
 *
 * Supported sources:
 * - publish artifact JSON emitted by upload-to-feed.js (`--artifact`)
 * - authoritative feed /channels endpoint (`--feed-endpoint`)
 *
 * Output shape preserves the existing ff-app snapshot builder contract:
 * { dp1_playlist: { publishers: [{ name, channel_urls: [] }] } }
 */

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_OUTPUT = 'ff-app-snapshot-input.json';
const DEFAULT_PUBLISHER_NAME = 'Feral File';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputPath = path.resolve(args.output || DEFAULT_OUTPUT);

  let channelUrls;
  if (args.artifact) {
    channelUrls = loadFromArtifact(args.artifact);
  } else if (args.feedEndpoint) {
    channelUrls = await loadFromFeed(args.feedEndpoint);
  } else {
    throw new Error('one source is required: --artifact <file> OR --feed-endpoint <url>');
  }

  const deduped = [...new Set(channelUrls)];
  if (deduped.length === 0) {
    throw new Error('no channel URLs generated');
  }

  const payload = {
    dp1_playlist: {
      publishers: [
        {
          name: args.publisherName || DEFAULT_PUBLISHER_NAME,
          channel_urls: deduped,
        },
      ],
    },
  };

  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`[ok] wrote ${deduped.length} channel URLs -> ${outputPath}`);
}

function parseArgs(argv) {
  const out = {
    artifact: null,
    feedEndpoint: null,
    output: null,
    publisherName: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--artifact':
        out.artifact = next;
        i += 1;
        break;
      case '--feed-endpoint':
        out.feedEndpoint = next;
        i += 1;
        break;
      case '--output':
        out.output = next;
        i += 1;
        break;
      case '--publisher-name':
        out.publisherName = next;
        i += 1;
        break;
      default:
        if (arg.startsWith('-')) {
          throw new Error(`unknown argument: ${arg}`);
        }
        break;
    }
  }
  if (out.artifact && out.feedEndpoint) {
    throw new Error('choose exactly one source: --artifact or --feed-endpoint');
  }
  return out;
}

function normalizeOrigin(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`invalid URL: ${rawUrl}`);
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error(`unsupported protocol ${parsed.protocol}; expected http/https`);
  }
  return parsed.origin;
}

function loadFromArtifact(rawPath) {
  const filePath = path.resolve(rawPath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`artifact not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  const artifact = JSON.parse(raw);
  if (!Array.isArray(artifact?.exhibitions)) {
    throw new Error('invalid artifact: missing exhibitions[]');
  }
  const channelUrls = [];
  for (const exhibition of artifact.exhibitions) {
    if (exhibition?.status !== 'success') {
      continue;
    }
    const url = String(exhibition?.channel?.url || '').trim();
    if (!url) {
      throw new Error(
        `invalid artifact: success exhibition ${exhibition?.exhibition_slug || '<unknown>'} missing channel.url`
      );
    }
    channelUrls.push(url);
  }
  return channelUrls;
}

async function loadFromFeed(rawFeedEndpoint) {
  const origin = normalizeOrigin(rawFeedEndpoint);
  const channelIds = await fetchAllChannelIds(origin);
  return channelIds.map((id) => `${origin}/api/v1/channels/${encodeURIComponent(id)}`);
}

async function fetchAllChannelIds(origin) {
  const ids = [];
  let cursor = null;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({limit: '100'});
    if (cursor) {
      params.set('cursor', cursor);
    }
    const url = `${origin}/api/v1/channels?${params.toString()}`;
    const page = await fetchJson(url);
    const items = Array.isArray(page?.items) ? page.items : [];
    for (const item of items) {
      if (!item?.id) {
        throw new Error(`invalid /channels payload: item missing id for ${url}`);
      }
      ids.push(String(item.id));
    }
    hasMore = Boolean(page?.hasMore);
    cursor = typeof page?.cursor === 'string' ? page.cursor : null;
    if (hasMore && !cursor) {
      throw new Error('invalid /channels payload: hasMore=true but cursor missing');
    }
  }

  return ids;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
    },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} for ${url} - ${body.slice(0, 800)}`);
  }
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(`invalid JSON from ${url}: ${error}`);
  }
}

main().catch((error) => {
  console.error(`[error] ${error?.stack || String(error)}`);
  process.exit(1);
});
