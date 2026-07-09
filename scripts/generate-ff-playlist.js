#!/usr/bin/env node

/**
 * DP-1 Playlist Generator for Feral File Exhibitions
 *
 * This script generates a single DP-1 playlist per Feral File exhibition.
 *
 * Playlist Generation Logic (applied uniformly to all exhibition types):
 *
 * 1. Sort all series by displayIndex (ascending).
 * 2. Partition series into:
 *    - Primary series: "1 of 1" (single) + "Edition of n" (multi)
 *    - Generative series: "1 of n" (multi_unique)
 * 3. Primary items come first, flat in series display order.
 * 4. Generative items follow, interleaved round-robin across series in
 *    display order (series 1 item 1, series 2 item 1, ... series 1 item 2, ...).
 * 5. Total items capped at MAX_PLAYLIST_ITEMS (1024).
 *
 * Curator: derived from exhibition.curatorAlumni as a DP-1 curator Entity with a
 * did:pkh key (CAIP-10, from the alumni's wallet address) when available.
 *
 * Slug: matches dp1-feed-v2 makeSlug — uses exhibition.slug when present (client
 * slug path), otherwise slugify(title) + '-' + first 8 chars of playlist id.
 *
 * Output: one flat JSON file per exhibition — <output-dir>/<exhibition-slug>.json
 *
 * Usage:
 *   node scripts/generate-ff-playlist.js <exhibition-id-or-slug> [output-dir] [options]
 *
 * Examples:
 *   node scripts/generate-ff-playlist.js infinite-entropy-xhj
 *   node scripts/generate-ff-playlist.js 71513905-f7b2-4ac1-b617-0d41123b3639
 *   node scripts/generate-ff-playlist.js infinite-entropy-xhj ./playlists --summary-provider openai --summary-api-key sk-...
 *   node scripts/generate-ff-playlist.js infinite-entropy-xhj ./playlists --summary-provider gemini --summary-api-key KEY
 */

import dp1 from 'ff-dp1-js';
import { randomUUID } from 'crypto';

import {
  DEFAULT_MAX_TEXT_LENGTH,
  mechanicalTruncate,
  summarizeLongText,
} from './lib/llm-summarize-summary.js';

const FF_API_BASE = 'https://feralfile.com/api';
const CDN_BASE = 'https://cdn.feralfileassets.com';
const MAX_PLAYLIST_ITEMS = 1024;

/**
 * Fetch a single page from the Feral File API.
 */
async function fetchAPI(endpoint) {
  const url = `${FF_API_BASE}${endpoint}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText} for ${url}`);
  }

  return await response.json();
}

/**
 * Fetch all pages for a paginated Feral File API endpoint.
 */
async function fetchAllPages(endpoint, pageSize = 300) {
  const allResults = [];
  let offset = 0;

  while (true) {
    const sep = endpoint.includes('?') ? '&' : '?';
    const data = await fetchAPI(`${endpoint}${sep}offset=${offset}&limit=${pageSize}`);
    const page = data.result ?? [];
    allResults.push(...page);

    const { paging } = data;
    if (!paging || offset + page.length >= paging.total) {
      break;
    }
    offset += pageSize;
  }

  return allResults;
}

/**
 * Fetch exhibition by ID or slug
 */
async function getExhibition(idOrSlug) {
  console.log(`Fetching exhibition: ${idOrSlug}...`);
  const data = await fetchAPI(`/exhibitions/${idOrSlug}`);
  return data.result;
}

/**
 * Fetch series for an exhibition
 */
async function getSeries(exhibitionId) {
  console.log(`Fetching series for exhibition ${exhibitionId}...`);
  return await fetchAllPages(`/series?exhibitionID=${exhibitionId}&includeArtist=true`);
}

/**
 * Fetch all artworks for a series, handling pagination automatically
 */
async function getArtworks(seriesId) {
  console.log(`Fetching artworks for series ${seriesId}...`);
  return await fetchAllPages(`/artworks?seriesID=${seriesId}&includeActiveSwap=true`);
}

/**
 * Transform URI according to the specified rules.
 * Handles Cloudflare Images, IPFS, relative paths, and other URL types.
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
    resolvedSrc = `${CDN_BASE}/${rawSrc}`;
  }

  return resolvedSrc;
}

/**
 * Pick the best preview URI for an artwork.
 */
function resolvePreviewURI(artwork) {
  const rawSrc = artwork.metadata?.alternativePreviewURI || artwork.previewURI;

  if (!rawSrc) {
    console.warn(`No preview URI found for artwork ${artwork.id}`);
    return null;
  }

  return resolveURI(rawSrc);
}

/**
 * Generate item title based on artwork name and series model.
 */
function generateItemTitle(seriesTitle, artworkName, artworkModel) {
  if (artworkModel === 'single') {
    return seriesTitle;
  }

  const specialCategories = ['AE', 'AP', 'PP'];
  if (specialCategories.includes(artworkName) || artworkName.includes('#')) {
    return `${seriesTitle} ${artworkName}`;
  }

  return artworkName;
}

/**
 * Build a CAIP-10 did:pkh identifier from a Feral File alumni account's
 * `addresses` (ethereum / tezos). Feral File only exposes wallet addresses for
 * curators/artists (not raw public key bytes), so did:pkh — not did:key — is
 * the DID method that can actually be derived here. The production feed
 * server (dp1-go) validates Entity.key against the generic DID pattern
 * `^did:[a-z]+:.+$`, which accepts did:pkh.
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

/**
 * Build a DP-1 curator Entity from a Feral File alumni account (curatorAlumni).
 */
function curatorEntityFromAlumni(alumni) {
  if (!alumni || typeof alumni !== 'object') return null;
  const name = alumni.fullName || alumni.alias;
  if (!name) return null;
  const entity = { name: String(name).trim() };
  const key = alumniAddressToDidPkh(alumni.addresses);
  if (key) entity.key = key;
  if (alumni.alias) {
    entity.url = `https://feralfile.com/curators/${encodeURIComponent(alumni.alias)}`;
  }
  return entity;
}

/**
 * Lowercase, replace non-alphanumeric runs with '-', trim edges (empty → "").
 * Matches dp1-feed-v2 internal/executor slugify().
 */
function slugify(s) {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * First 8 characters of a UUID string. Matches dp1-feed-v2 shortID().
 */
function shortID(uuid) {
  return String(uuid).slice(0, 8);
}

/**
 * URL-friendly slug for playlists (matches dp1-feed-v2 makeSlug).
 * Priority: 1) client-provided slug (slugified), 2) title-based slug + short id suffix.
 */
function makeSlug(clientSlug, title, id, defaultName = 'playlist') {
  if (clientSlug) {
    const slug = slugify(clientSlug);
    if (slug) return slug;
  }
  let base = slugify(title);
  if (!base) base = defaultName;
  return `${base}-${shortID(id)}`;
}

/**
 * Check if artwork should be included based on series settings.
 */
function shouldIncludeArtwork(artwork, series, exhibition, includeCount) {
  const artworkModel = series.settings?.artworkModel;

  if (artworkModel === 'multi' || artworkModel === 'single') {
    if (includeCount > 0) {
      return false;
    }
  }

  if (exhibition.mintBlockchain === 'bitmark') {
    if (!artwork.swap || !artwork.swap.id) {
      console.log(
        `  Skipping artwork ${artwork.name} (index ${artwork.index}): No active swap for bitmark-minted exhibition`
      );
      return false;
    }
  }

  return true;
}

/**
 * Get blockchain chain type from blockchain name.
 */
function getChainType(blockchainType) {
  const evmChains = ['ethereum', 'base', 'arbitrum', 'polygon'];
  const tezosChains = ['tezos'];

  if (evmChains.includes(blockchainType?.toLowerCase())) {
    return 'evm';
  }
  if (tezosChains.includes(blockchainType?.toLowerCase())) {
    return 'tezos';
  }
  return 'evm';
}

/**
 * Get contract standard based on chain type.
 */
function getContractStandard(chainType) {
  return chainType === 'tezos' ? 'fa2' : 'erc721';
}

/**
 * Find the appropriate contract address for the blockchain type.
 */
function findContractAddress(exhibition, blockchainType) {
  if (!exhibition.contracts || exhibition.contracts.length === 0) {
    return null;
  }

  const contract = exhibition.contracts.find(
    c => c.blockchainType?.toLowerCase() === blockchainType?.toLowerCase()
  );

  return contract?.address || exhibition.contracts[0]?.address;
}

/**
 * Create provenance information for an artwork.
 */
function createProvenance(artwork, exhibition) {
  const blockchainType = artwork.swap?.blockchainType || exhibition.mintBlockchain || 'ethereum';
  const chainType = getChainType(blockchainType);
  const standard = getContractStandard(chainType);
  const contractAddress = findContractAddress(exhibition, blockchainType);
  const tokenId = artwork.swap?.token || artwork.id;

  if (!contractAddress) {
    console.warn(`  Warning: No contract address found for ${blockchainType}`);
    return null;
  }

  return {
    type: 'onChain',
    contract: {
      chain: chainType,
      standard: standard,
      address: contractAddress,
      tokenId: tokenId,
    },
  };
}

/**
 * Select artworks from a series based on artworkModel rules.
 */
async function selectArtworksFromSeries(series, exhibition) {
  const artworks = await getArtworks(series.id);
  const artworkModel = series.settings?.artworkModel;

  console.log(`  Series: ${series.title}`);
  console.log(`  Artwork model: ${artworkModel}`);
  console.log(`  Total artworks found: ${artworks.length}`);

  artworks.sort((a, b) => a.index - b.index);

  const selectedArtworks = [];

  for (const artwork of artworks) {
    if (shouldIncludeArtwork(artwork, series, exhibition, selectedArtworks.length)) {
      selectedArtworks.push({ artwork, series });

      if ((artworkModel === 'multi' || artworkModel === 'single') && selectedArtworks.length >= 1) {
        break;
      }
    }
  }

  console.log(`  Selected ${selectedArtworks.length} artwork(s)`);
  return selectedArtworks;
}

/**
 * Interleave artworks from multiple series round-robin.
 * Takes item 0 from each series, then item 1, etc.
 */
function interleaveArtworks(seriesArtworks) {
  const result = [];
  let maxLength = 0;

  for (const artworks of seriesArtworks) {
    maxLength = Math.max(maxLength, artworks.length);
  }

  for (let i = 0; i < maxLength; i++) {
    for (const artworks of seriesArtworks) {
      if (i < artworks.length) {
        result.push(artworks[i]);
      }
    }
  }

  return result;
}

/**
 * Build DP-1 playlist items from a list of {artwork, series} pairs.
 * Stops at MAX_PLAYLIST_ITEMS.
 */
function buildPlaylistItems(selectedItems, exhibition) {
  const playlistItems = [];

  for (const { artwork, series } of selectedItems) {
    const source = resolvePreviewURI(artwork);

    if (!source) {
      console.warn(`Skipping artwork ${artwork.id}: Unable to resolve preview URI`);
      continue;
    }

    const title = generateItemTitle(series.title, artwork.name, series.settings?.artworkModel);

    console.log(`Adding item: ${title}`);
    console.log(`  Source: ${source}`);

    try {
      const provenance = createProvenance(artwork, exhibition);
      if (!provenance) {
        console.warn(`  Skipping artwork ${artwork.name}: Unable to create provenance`);
        continue;
      }

      const item = {
        id: randomUUID(),
        title,
        source,
        duration: 300,
        license: 'open',
        created: new Date().toISOString(),
        provenance,
      };

      const validation = dp1.validatePlaylistItem(item);
      if (!validation.success) {
        console.error(`  ✗ Invalid playlist item: ${validation.error.message}`);
        continue;
      }

      playlistItems.push(item);

      if (playlistItems.length >= MAX_PLAYLIST_ITEMS) {
        console.log(
          `\n⚠️  Reached maximum playlist item limit of ${MAX_PLAYLIST_ITEMS}. Stopping item creation.`
        );
        break;
      }
    } catch (error) {
      console.error(`Error creating playlist item for ${title}:`, error.message);
      continue;
    }
  }

  return playlistItems;
}

/**
 * Build a full DP-1 playlist object from a title, items, and exhibition metadata.
 * Extension fields (summary, coverImage, curators) are emitted as top-level siblings
 * per the DP-1 "playlists" extension (extensions/playlists/schema.json).
 */
async function buildPlaylist(title, items, exhibition, summaryOpts = null) {
  const playlistId = randomUUID();
  const playlistSlug = makeSlug(exhibition.slug, title, playlistId, 'playlist');

  let coverImageUrl = exhibition.coverDisplay || exhibition.coverURI;
  if (coverImageUrl) {
    coverImageUrl = resolveURI(coverImageUrl);
  }

  let summary =
    exhibition.note ||
    exhibition.noteBrief ||
    `A digital art exhibition featuring works from ${exhibition.title}`;

  if (summary.length > DEFAULT_MAX_TEXT_LENGTH) {
    if (summaryOpts?.provider && summaryOpts?.apiKey) {
      try {
        summary = await summarizeLongText(
          summaryOpts,
          {
            kind: 'playlist summary',
            labels: { Title: title, Slug: playlistSlug },
          },
          summary
        );
      } catch (err) {
        console.warn(`  ⚠ Summary LLM failed (${err.message}); using mechanical truncate.`);
        summary = mechanicalTruncate(summary, DEFAULT_MAX_TEXT_LENGTH);
      }
    } else {
      summary = mechanicalTruncate(summary, DEFAULT_MAX_TEXT_LENGTH);
    }
  }

  const playlist = {
    dpVersion: '1.1.0',
    id: playlistId,
    slug: playlistSlug,
    title,
    summary,
    coverImage: coverImageUrl,
    created: new Date().toISOString(),
    defaults: {
      license: 'open',
      duration: 300,
    },
    items,
  };

  const curatorAlumni = exhibition.curatorAlumni || exhibition.curator?.alumniAccount;
  const curatorEntity = curatorEntityFromAlumni(curatorAlumni);
  if (curatorEntity) {
    playlist.curators = [curatorEntity];
  }

  playlist.signature =
    'ed25519:0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';

  return playlist;
}

/**
 * Validate and log a playlist, throwing if invalid.
 *
 * Note: the local `ff-dp1-js` package's Entity.key validator only accepts
 * did:key (multibase Ed25519 pubkey) and rejects did:pkh, even though the
 * actual production feed server (dp1-go) validates Entity.key against the
 * generic DID pattern `^did:[a-z]+:.+$` and accepts did:pkh fine. Since
 * curators here use did:pkh (the only DID method derivable from Feral File's
 * wallet-address-only alumni data), structural validation runs on a
 * curators-stripped copy to avoid a false failure from this local package.
 */
function validatePlaylist(playlist) {
  const { curators, ...structural } = playlist;
  const result = dp1.parseDP1Playlist(structural);
  if (result.error) {
    console.error('\n✗ Playlist validation failed:');
    console.error(result.error.message);
    if (result.error.details) {
      console.error('Details:', result.error.details);
    }
    throw new Error('Playlist validation failed');
  }

  console.log(`\n✓ Playlist created successfully!`);
  console.log(`  Title: ${playlist.title}`);
  console.log(`  ID: ${playlist.id}`);
  console.log(`  Slug: ${playlist.slug}`);
  console.log(`  Items: ${playlist.items.length}`);
  if (curators?.length) {
    console.log(`  Curators: ${curators.map(c => `${c.name} (${c.key || 'no key'})`).join(', ')}`);
  }
}

/**
 * Generate a single DP-1 playlist from an exhibition.
 *
 * Ordering:
 *  1. Primary series (single/multi) items, flat, in display_index order.
 *  2. Generative series (multi_unique) items, interleaved round-robin in display_index order.
 *  3. Capped at MAX_PLAYLIST_ITEMS total.
 *
 * Returns { playlist, exhibitionSlug }.
 */
async function generatePlaylist(exhibitionIdOrSlug, summaryOpts = null) {
  try {
    const exhibition = await getExhibition(exhibitionIdOrSlug);
    console.log(`\nExhibition: ${exhibition.title}`);
    console.log(`Type: ${exhibition.type}`);
    console.log(`Mint blockchain: ${exhibition.mintBlockchain}`);

    const seriesList = await getSeries(exhibition.id);
    console.log(`\nFound ${seriesList.length} series\n`);

    // Sort series by displayIndex ascending
    seriesList.sort((a, b) => {
      if (
        a.displayIndex !== undefined &&
        b.displayIndex !== undefined &&
        a.displayIndex !== b.displayIndex
      ) {
        return a.displayIndex - b.displayIndex;
      }
      const aMatch = a.title.match(/(\d+)$/);
      const bMatch = b.title.match(/(\d+)$/);
      if (aMatch && bMatch) {
        return parseInt(aMatch[1]) - parseInt(bMatch[1]);
      }
      return new Date(a.createdAt) - new Date(b.createdAt);
    });

    // Select artworks from each series
    const allSeriesArtworks = [];
    for (const series of seriesList) {
      const artworks = await selectArtworksFromSeries(series, exhibition);
      allSeriesArtworks.push({ series, artworks });
    }

    // Partition into primary (single/multi) and generative (multi_unique)
    const primarySeries = allSeriesArtworks.filter(({ series }) => {
      const model = series.settings?.artworkModel;
      return model === 'single' || model === 'multi';
    });

    const generativeSeries = allSeriesArtworks.filter(({ series }) => {
      return series.settings?.artworkModel === 'multi_unique';
    });

    // Primary items: flat in display_index order
    const primaryItems = primarySeries.flatMap(({ artworks }) => artworks);

    // Generative items: interleaved round-robin across generative series
    const generativeItems = interleaveArtworks(generativeSeries.map(({ artworks }) => artworks));

    const combinedItems = [...primaryItems, ...generativeItems];

    console.log(
      `\nCombined: ${primaryItems.length} primary + ${generativeItems.length} generative = ${combinedItems.length} total (cap: ${MAX_PLAYLIST_ITEMS})`
    );

    if (combinedItems.length === 0) {
      throw new Error('No artworks could be selected for this exhibition');
    }

    const items = buildPlaylistItems(combinedItems, exhibition);

    if (items.length === 0) {
      throw new Error('No valid playlist items could be created');
    }

    const playlist = await buildPlaylist(exhibition.title, items, exhibition, summaryOpts);
    validatePlaylist(playlist);

    console.log(`\n✓ Generated 1 playlist.`);
    console.log(
      'Note: Signature is a placeholder. Use a proper Ed25519 key to sign in production.'
    );

    const exhibitionSlug = exhibition.slug || makeSlug(null, exhibition.title, playlist.id, 'playlist');
    return { playlist, exhibitionSlug };
  } catch (error) {
    console.error('\n✗ Error generating playlist:', error.message);
    throw error;
  }
}

function parseGenerateArgs(argv) {
  const out = {
    positional: [],
    summaryProvider: null,
    summaryApiKey: null,
    summaryBaseUrl: null,
    summaryModel: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--summary-provider' && argv[i + 1]) {
      const p = argv[++i].toLowerCase();
      if (p !== 'openai' && p !== 'gemini') {
        throw new Error(`--summary-provider must be openai or gemini, got: ${p}`);
      }
      out.summaryProvider = p;
    } else if (a === '--summary-api-key' && argv[i + 1]) {
      out.summaryApiKey = argv[++i];
    } else if (a === '--summary-base-url' && argv[i + 1]) {
      out.summaryBaseUrl = argv[++i];
    } else if (a === '--summary-model' && argv[i + 1]) {
      out.summaryModel = argv[++i];
    } else {
      out.positional.push(a);
    }
  }
  return out;
}

/**
 * Main function
 */
async function main() {
  let parsed;
  try {
    parsed = parseGenerateArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  if (parsed.positional.length === 0) {
    console.error(
      'Usage: node generate-ff-playlist.js <exhibition-id-or-slug> [output-dir] [options]'
    );
    console.error('\nExamples:');
    console.error('  node scripts/generate-ff-playlist.js infinite-entropy-xhj');
    console.error('  node scripts/generate-ff-playlist.js 71513905-f7b2-4ac1-b617-0d41123b3639');
    console.error('  node scripts/generate-ff-playlist.js infinite-entropy-xhj ./playlists');
    console.error(
      '  node scripts/generate-ff-playlist.js infinite-entropy-xhj ./playlists --summary-provider openai --summary-api-key KEY'
    );
    process.exit(1);
  }

  const exhibitionIdOrSlug = parsed.positional[0];
  const outputDir = parsed.positional[1] || '.';

  const sp = parsed.summaryProvider || process.env.SUMMARY_PROVIDER;
  const sk = parsed.summaryApiKey || process.env.SUMMARY_API_KEY;
  const sb = parsed.summaryBaseUrl || process.env.SUMMARY_BASE_URL;
  const sm = parsed.summaryModel || process.env.SUMMARY_MODEL;

  let summaryOpts = null;
  if (sp && sk) {
    const p = String(sp).toLowerCase();
    if (p !== 'openai' && p !== 'gemini') {
      console.error(
        `Error: --summary-provider / SUMMARY_PROVIDER must be openai or gemini, got: ${sp}`
      );
      process.exit(1);
    }
    summaryOpts = {
      provider: p,
      apiKey: sk,
      ...(sb ? { baseUrl: String(sb).replace(/\/$/, '') } : {}),
      ...(sm ? { model: sm } : {}),
    };
  }

  try {
    const { playlist, exhibitionSlug } = await generatePlaylist(exhibitionIdOrSlug, summaryOpts);
    const fs = await import('fs');
    const path = await import('path');

    fs.mkdirSync(outputDir, { recursive: true });

    const outputFile = path.join(outputDir, `${exhibitionSlug}.json`);
    fs.writeFileSync(outputFile, JSON.stringify(playlist, null, 2), 'utf-8');
    console.log(`\n✓ Playlist saved to: ${outputFile}`);
  } catch (error) {
    console.error('\n✗ Failed to generate playlist');
    process.exit(1);
  }
}

// Run the script
main();
