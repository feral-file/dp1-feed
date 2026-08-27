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
 * 5. Burned artworks (owner is a burn address — see BURN_ADDRESSES) are excluded
 *    at every step. Exhibitions with token merging enabled (settings.burn) send
 *    every merged-away source token to the zero address; those tokens no longer
 *    exist and must not be published.
 * 6. Total items bounded by MAX_PLAYLIST_ITEMS, a runaway-output guard set
 *    above the largest real exhibition rather than a protocol limit.
 *
 * Curator: derived from exhibition.curatorAlumni as a DP-1 curator Entity with a
 * did:pkh key (CAIP-10, from the alumni's wallet address) when available.
 *
 * Slug: matches dp1-feed-v2 makeSlug — uses exhibition.slug when present (client
 * slug path), otherwise slugify(title) + '-' + first 8 chars of playlist id.
 *
 * Output: one flat JSON file per exhibition — <output-dir>/<exhibition-slug>.json
 *
 * Special case — unsupervised-sla: the main exhibition playlist also appends items
 * from three companion "burned" solo exhibitions (2D, 3D, and Dreams), matching
 * the legacy combined highlight reel that previously lived as a second playlist.
 *
 * Special case — ex-nihilo-a3c: the playlist also appends all tokens from the
 * Art Blocks collection "Ex Nihilo (Cosmos)" (256 generative works), matching
 * the legacy full-collection playlist that combined Feral File + Art Blocks items.
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

// Cloudflare Images variant used for playlist/channel cover images. Item
// sources stay on /raw — that is the artwork itself and must not be resized.
const COVER_IMAGE_VARIANT = 'public';
/**
 * Upper bound on items in a generated playlist.
 *
 * This is a runaway-output sanity guard, not a protocol limit — DP-1 itself
 * does not cap playlist length. It was 1024, which silently truncated the two
 * largest exhibitions (crystalline-work-5ze at 9048 items, n-12-2ts at 1728),
 * so it is now set well above the largest real exhibition.
 */
const MAX_PLAYLIST_ITEMS = 16384;

/**
 * Item-count ceiling baked into ff-dp1-js@1.0.0's playlist schema
 * (items: z.array(...).max(1024)). See validatePlaylist() for why the
 * generator validates around it rather than honouring it.
 */
const DP1_LIB_MAX_ITEMS = 1024;

/**
 * Well-known burn sinks. An artwork owned by one of these is no longer a live
 * token and must not appear in a playlist.
 *
 * Some Feral File exhibitions enable token merging (exhibition.settings.burn):
 * a collector merges several tokens of a series into one new token, and every
 * source token is transferred to the EVM zero address. CRAWL is the clearest
 * case — 60 of its 512 tokens were merged into the "CRAWL MULTI LEVEL" series
 * (each merged token records its sources in metadata.ts044MergedIndexes), and
 * merged tokens can themselves be merged again, so 4 intermediate MULTI LEVEL
 * tokens are burned too.
 */
const BURN_ADDRESSES = new Set([
  '0x0000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000dead',
  'tz1burnburnburnburnburnburnburjayjjx',
]);

/** Main Unsupervised exhibition slug (includes companion burned exhibitions below). */
const UNSUPERVISED_SLUG = 'unsupervised-sla';

/** Companion burned solo exhibitions merged into the unsupervised-sla playlist. */
const UNSUPERVISED_BURNED_EXHIBITION_SLUGS = [
  'unsupervised-burned-data-universe-moma-2d-tlf',
  'unsupervised-burned-data-universe-moma-3d-6pj',
  'unsupervised-burned-machine-hallucinations-moma-dreams-b9c',
];

/** Ex Nihilo exhibition slug (includes Art Blocks Cosmos collection below). */
const EX_NIHILO_SLUG = 'ex-nihilo-a3c';

/** Art Blocks collection merged into the ex-nihilo-a3c playlist. */
const EX_NIHILO_ARTBLOCKS_COLLECTION = {
  collectionSlug: 'ex-nihilo-cosmos-by-casey-reas',
  chainId: 1,
  itemDuration: 60,
};

const ART_BLOCKS_GRAPHQL = 'https://data.artblocks.io/v1/graphql';

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
 * Run a GraphQL query against the Art Blocks Hasura API.
 * @see https://docs.artblocks.io/developer/graphql/
 */
async function fetchArtBlocksGraphQL(query) {
  const response = await fetch(ART_BLOCKS_GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    throw new Error(`Art Blocks GraphQL request failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(`Art Blocks GraphQL error: ${payload.errors[0].message}`);
  }

  return payload.data;
}

/**
 * Fetch an Art Blocks project by public collection slug.
 */
async function fetchArtBlocksProject(collectionSlug, chainId = 1) {
  const query = `{
    projects_metadata(
      where: { slug: { _eq: ${JSON.stringify(collectionSlug)} }, chain_id: { _eq: ${chainId} } }
      limit: 1
    ) {
      id
      name
      artist_name
      contract_address
    }
  }`;

  const data = await fetchArtBlocksGraphQL(query);
  const project = data.projects_metadata?.[0];
  if (!project) {
    throw new Error(
      `Art Blocks project not found for collection slug: ${collectionSlug} (chain ${chainId})`
    );
  }
  return project;
}

/**
 * Fetch all tokens for an Art Blocks project, ordered by invocation ascending.
 */
async function fetchArtBlocksProjectTokens(projectId, chainId = 1) {
  const allTokens = [];
  const pageSize = 100;
  let offset = 0;

  while (true) {
    const query = `{
      tokens_metadata(
        where: {
          project_id: { _eq: ${JSON.stringify(projectId)} }
          chain_id: { _eq: ${chainId} }
        }
        order_by: { invocation: asc }
        limit: ${pageSize}
        offset: ${offset}
      ) {
        token_id
        invocation
        live_view_url
      }
    }`;

    const data = await fetchArtBlocksGraphQL(query);
    const page = data.tokens_metadata ?? [];
    allTokens.push(...page);

    if (page.length < pageSize) {
      break;
    }
    offset += pageSize;
  }

  return allTokens;
}

/**
 * Build DP-1 playlist items from Art Blocks token metadata.
 */
function buildArtBlocksPlaylistItems(tokens, project, chainId, itemDuration) {
  const playlistItems = [];
  const contractAddress = project.contract_address;
  const projectName = project.name;

  for (const token of tokens) {
    const tokenId = String(token.token_id);
    const invocation = token.invocation ?? token.token_id;
    const source =
      token.live_view_url ||
      `https://generator.artblocks.io/${chainId}/${contractAddress.toLowerCase()}/${tokenId}`;

    const item = {
      id: randomUUID(),
      title: `${projectName} — #${invocation}`,
      source,
      duration: itemDuration,
      license: 'open',
      created: new Date().toISOString(),
      provenance: {
        type: 'onChain',
        contract: {
          chain: 'evm',
          standard: 'erc721',
          address: contractAddress,
          tokenId,
        },
      },
    };

    const validation = dp1.validatePlaylistItem(item);
    if (!validation.success) {
      console.error(
        `  ✗ Invalid Art Blocks playlist item #${invocation}: ${validation.error.message}`
      );
      continue;
    }

    playlistItems.push(item);

    if (playlistItems.length >= MAX_PLAYLIST_ITEMS) {
      console.warn(
        `\n⚠️  Reached maximum playlist item limit of ${MAX_PLAYLIST_ITEMS}. Stopping Art Blocks item creation.`
      );
      break;
    }
  }

  return playlistItems;
}

/**
 * Append Art Blocks collection tokens to an existing playlist item list.
 */
async function appendArtBlocksCollectionItems(playlistItems, collectionConfig) {
  const { collectionSlug, chainId, itemDuration } = collectionConfig;

  console.log(`\nFetching Art Blocks collection: ${collectionSlug}...`);
  const project = await fetchArtBlocksProject(collectionSlug, chainId);
  console.log(`  Project: ${project.name} by ${project.artist_name}`);
  console.log(`  Contract: ${project.contract_address}`);

  const tokens = await fetchArtBlocksProjectTokens(project.id, chainId);
  console.log(`  Tokens found: ${tokens.length}`);

  const remaining = MAX_PLAYLIST_ITEMS - playlistItems.length;
  if (remaining <= 0) {
    console.warn('  ⚠️  Playlist already at item cap; skipping Art Blocks tokens');
    return playlistItems;
  }

  const artBlocksItems = buildArtBlocksPlaylistItems(
    tokens.slice(0, remaining),
    project,
    chainId,
    itemDuration
  );
  console.log(`  Added ${artBlocksItems.length} Art Blocks item(s)`);

  return [...playlistItems, ...artBlocksItems];
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
 * Pick the URI for a playlist cover image.
 *
 * Covers are chrome, not artwork: they are rendered as cards and grids, so the
 * full-resolution original is the wrong trade. resolveURI() normalises every
 * Cloudflare Images URL to /raw because that IS right for item sources, where
 * the artwork itself is on screen. Here we want the resized variant instead —
 * for the Social Codes cover that is 65 KB of JPEG rather than 3.0 MB of PNG.
 *
 * Only Cloudflare Images URLs carry variants; anything else (notably
 * cdn.feralfileassets.com exhibition thumbnails) is returned untouched.
 */
function resolveCoverImageURI(rawSrc) {
  const resolved = resolveURI(rawSrc);
  if (!resolved || !resolved.includes('imagedelivery.net')) {
    return resolved;
  }
  return resolved.replace(/\/raw$/, `/${COVER_IMAGE_VARIANT}`);
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
 * True when the artwork's current owner is a burn address, i.e. the token has
 * been destroyed (merged away, or burned outright) and should be excluded.
 */
function isBurnedArtwork(artwork) {
  const owner = artwork.ownerAddress;
  if (typeof owner !== 'string') {
    return false;
  }
  return BURN_ADDRESSES.has(owner.trim().toLowerCase());
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

  if (isBurnedArtwork(artwork)) {
    console.log(
      `  Skipping artwork ${artwork.name} (index ${artwork.index}): burned (owner ${artwork.ownerAddress})`
    );
    return false;
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
 * Sort series by displayIndex (ascending), with numeric suffix and createdAt fallbacks.
 */
function sortSeriesByDisplayIndex(seriesList) {
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
}

/**
 * Select artwork pairs for one exhibition using the unified ordering algorithm.
 * Returns [{ artwork, series, exhibition }, ...].
 */
async function selectExhibitionArtworkPairs(exhibition) {
  const seriesList = await getSeries(exhibition.id);
  sortSeriesByDisplayIndex(seriesList);

  const allSeriesArtworks = [];
  for (const series of seriesList) {
    const artworks = await selectArtworksFromSeries(series, exhibition);
    allSeriesArtworks.push({ series, artworks });
  }

  const primarySeries = allSeriesArtworks.filter(({ series }) => {
    const model = series.settings?.artworkModel;
    return model === 'single' || model === 'multi';
  });

  const generativeSeries = allSeriesArtworks.filter(({ series }) => {
    return series.settings?.artworkModel === 'multi_unique';
  });

  const primaryItems = primarySeries.flatMap(({ artworks }) =>
    artworks.map(pair => ({ ...pair, exhibition }))
  );

  const generativeItems = interleaveArtworks(generativeSeries.map(({ artworks }) => artworks)).map(
    pair => ({ ...pair, exhibition })
  );

  return [...primaryItems, ...generativeItems];
}

/**
 * Build DP-1 playlist items from a list of {artwork, series, exhibition} pairs.
 * Stops at MAX_PLAYLIST_ITEMS.
 */
function buildPlaylistItems(selectedItems) {
  const playlistItems = [];

  for (const { artwork, series, exhibition } of selectedItems) {
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
    coverImageUrl = resolveCoverImageURI(coverImageUrl);
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
 *
 * The same package also caps items at DP1_LIB_MAX_ITEMS, which DP-1 itself does
 * not require and which would reject the largest exhibitions outright. Coverage
 * is preserved rather than dropped: the envelope is parsed with a bounded slice
 * of the items, and then every item — including the ones outside that slice —
 * is validated individually.
 */
function validatePlaylist(playlist) {
  const { curators, ...structural } = playlist;
  const oversized = structural.items.length > DP1_LIB_MAX_ITEMS;
  const envelope = oversized
    ? { ...structural, items: structural.items.slice(0, DP1_LIB_MAX_ITEMS) }
    : structural;

  const result = dp1.parseDP1Playlist(envelope);
  if (result.error) {
    console.error('\n✗ Playlist validation failed:');
    console.error(result.error.message);
    if (result.error.details) {
      console.error('Details:', result.error.details);
    }
    throw new Error('Playlist validation failed');
  }

  if (oversized) {
    for (const [index, item] of structural.items.entries()) {
      const itemResult = dp1.validatePlaylistItem(item);
      if (!itemResult.success) {
        console.error(`\n✗ Invalid playlist item at index ${index}: ${itemResult.error.message}`);
        throw new Error('Playlist validation failed');
      }
    }
    console.log(
      `  Note: ${structural.items.length} items exceeds the ff-dp1-js schema cap of ` +
        `${DP1_LIB_MAX_ITEMS}; envelope validated on a bounded slice, all items validated individually.`
    );
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

    let combinedItems = await selectExhibitionArtworkPairs(exhibition);

    console.log(
      `\n${exhibition.slug || exhibition.title}: ${combinedItems.length} item(s) selected`
    );

    if (exhibition.slug === UNSUPERVISED_SLUG) {
      console.log('\nIncluding companion burned exhibitions for unsupervised-sla...');
      for (const burnedSlug of UNSUPERVISED_BURNED_EXHIBITION_SLUGS) {
        const burnedExhibition = await getExhibition(burnedSlug);
        const burnedItems = await selectExhibitionArtworkPairs(burnedExhibition);
        console.log(`  ${burnedSlug}: ${burnedItems.length} item(s)`);
        combinedItems = [...combinedItems, ...burnedItems];
      }
      console.log(
        `\nCombined with burned exhibitions: ${combinedItems.length} total (cap: ${MAX_PLAYLIST_ITEMS})`
      );
    }

    if (combinedItems.length === 0) {
      throw new Error('No artworks could be selected for this exhibition');
    }

    const items = buildPlaylistItems(combinedItems);

    if (items.length === 0) {
      throw new Error('No valid playlist items could be created');
    }

    let playlistItems = items;

    if (exhibition.slug === EX_NIHILO_SLUG) {
      playlistItems = await appendArtBlocksCollectionItems(
        playlistItems,
        EX_NIHILO_ARTBLOCKS_COLLECTION
      );
      console.log(
        `\nCombined with Art Blocks collection: ${playlistItems.length} total (cap: ${MAX_PLAYLIST_ITEMS})`
      );
    }

    const playlist = await buildPlaylist(exhibition.title, playlistItems, exhibition, summaryOpts);
    validatePlaylist(playlist);

    console.log(`\n✓ Generated 1 playlist.`);
    console.log(
      'Note: Signature is a placeholder. Use a proper Ed25519 key to sign in production.'
    );

    const exhibitionSlug =
      exhibition.slug || makeSlug(null, exhibition.title, playlist.id, 'playlist');
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
