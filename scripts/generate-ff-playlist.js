#!/usr/bin/env node

/**
 * DP-1 Playlist Generator for Feral File Exhibitions
 * 
 * This script generates a DP-1 playlist from a Feral File exhibition
 * using the Feral File API and the dp1-js library.
 * 
 * Usage:
 *   node scripts/generate-ff-playlist.js <exhibition-id-or-slug> [--private-key <key>]
 * 
 * Example:
 *   node scripts/generate-ff-playlist.js infinite-entropy-xhj
 *   node scripts/generate-ff-playlist.js 71513905-f7b2-4ac1-b617-0d41123b3639
 */

import dp1 from 'ff-dp1-js';
import { randomUUID } from 'crypto';

const FF_API_BASE = 'https://feralfile.com/api';
const CDN_BASE = 'https://cdn.feralfileassets.com';
const MAX_PLAYLIST_ITEMS = 1024;

/**
 * Fetch data from Feral File API
 */
async function fetchAPI(endpoint) {
  const url = `${FF_API_BASE}${endpoint}`;
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText} for ${url}`);
  }
  
  const data = await response.json();
  return data.result;
}

/**
 * Fetch exhibition by ID or slug
 */
async function getExhibition(idOrSlug) {
  console.log(`Fetching exhibition: ${idOrSlug}...`);
  return await fetchAPI(`/exhibitions/${idOrSlug}`);
}

/**
 * Fetch series for an exhibition
 */
async function getSeries(exhibitionId) {
  console.log(`Fetching series for exhibition ${exhibitionId}...`);
  return await fetchAPI(`/series?exhibitionID=${exhibitionId}&includeArtist=true`);
}

/**
 * Fetch artworks for a series
 */
async function getArtworks(seriesId) {
  console.log(`Fetching artworks for series ${seriesId}...`);
  return await fetchAPI(`/artworks?seriesID=${seriesId}&includeActiveSwap=true`);
}

/**
 * Transform URI according to the specified rules
 * Handles Cloudflare Images, IPFS, relative paths, and other URL types
 */
function resolveURI(rawSrc) {
  if (!rawSrc) {
    return null;
  }
  
  // Step 2: Transform the candidate
  let resolvedSrc = rawSrc;
  
  // If starts with https
  if (rawSrc.startsWith('https://')) {
    // Check if it's Cloudflare Images
    if (rawSrc.includes('imagedelivery.net')) {
      // Remove any existing variant (like /thumbnail, /public, etc.)
      // Cloudflare Images URL format: https://imagedelivery.net/<account-id>/<image-id>[/variant]
      const cfImageMatch = rawSrc.match(/^(https:\/\/imagedelivery\.net\/[^\/]+\/[^\/]+)/);
      if (cfImageMatch) {
        // Remove existing variant and append /raw
        resolvedSrc = `${cfImageMatch[1]}/raw`;
      } else {
        // Fallback: just append /raw if pattern doesn't match
        resolvedSrc = rawSrc.replace(/\/(thumbnail|public|[^\/]+)$/, '') + '/raw';
      }
    }
    // Otherwise (any other HTTPS host), leave as is
  }
  // If starts with ipfs://
  else if (rawSrc.startsWith('ipfs://')) {
    // Convert to HTTP gateway: ipfs://<CID/...> → https://ipfs.io/ipfs/<CID/...>
    const ipfsPath = rawSrc.substring(7); // Remove 'ipfs://'
    resolvedSrc = `https://ipfs.io/ipfs/${ipfsPath}`;
  }
  // Else (relative or non-standard path)
  else {
    // Prefix with CDN
    resolvedSrc = `${CDN_BASE}/${rawSrc}`;
  }
  
  return resolvedSrc;
}

/**
 * Transform preview URI according to the specified rules
 */
function resolvePreviewURI(artwork) {
  // Step 1: Pick the best raw candidate
  let rawSrc = artwork.metadata?.alternativePreviewURI || artwork.previewURI;
  
  if (!rawSrc) {
    console.warn(`No preview URI found for artwork ${artwork.id}`);
    return null;
  }
  
  return resolveURI(rawSrc);
}

/**
 * Generate item title based on artwork name
 */
function generateItemTitle(seriesTitle, artworkName) {
  // If artwork.name is AE, AP, PP or contains #, use formula "series.title artwork.name"
  const specialCategories = ['AE', 'AP', 'PP'];
  
  if (specialCategories.includes(artworkName) || artworkName.includes('#')) {
    return `${seriesTitle} ${artworkName}`;
  }
  
  // Otherwise, just use artwork.name
  return artworkName;
}

/**
 * Create a slug from a title
 */
function createSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 64);
}

/**
 * Check if artwork should be included based on series settings
 */
function shouldIncludeArtwork(artwork, series, exhibition, includeCount) {
  const artworkModel = series.settings?.artworkModel;
  
  // For 'multi' or 'single', only include the first artwork (index 0)
  if (artworkModel === 'multi' || artworkModel === 'single') {
    if (includeCount > 0) {
      return false;
    }
  }
  // For 'multi_unique', include all artworks
  // (no additional filtering needed)
  
  // If exhibition was minted on bitmark blockchain, only pick artworks with active swap
  if (exhibition.mintBlockchain === 'bitmark') {
    if (!artwork.swap || !artwork.swap.id) {
      console.log(`  Skipping artwork ${artwork.name} (index ${artwork.index}): No active swap for bitmark-minted exhibition`);
      return false;
    }
  }
  
  return true;
}

/**
 * Get blockchain chain type from blockchain name
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
  // Default to evm for bitmark-migrated tokens (they go to ethereum)
  return 'evm';
}

/**
 * Get contract standard based on chain type
 */
function getContractStandard(chainType) {
  return chainType === 'tezos' ? 'fa2' : 'erc721';
}

/**
 * Find the appropriate contract address for the blockchain type
 */
function findContractAddress(exhibition, blockchainType) {
  if (!exhibition.contracts || exhibition.contracts.length === 0) {
    return null;
  }
  
  // Find contract matching the blockchain type
  const contract = exhibition.contracts.find(c => 
    c.blockchainType?.toLowerCase() === blockchainType?.toLowerCase()
  );
  
  return contract?.address || exhibition.contracts[0]?.address;
}

/**
 * Create provenance information for an artwork
 */
function createProvenance(artwork, exhibition) {
  // Determine blockchain type - prefer swap blockchain, fallback to exhibition mint blockchain
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
    }
  };
}

/**
 * Select artworks from a series based on the rules
 */
async function selectArtworksFromSeries(series, exhibition) {
  const artworks = await getArtworks(series.id);
  const artworkModel = series.settings?.artworkModel;
  
  console.log(`  Series: ${series.title}`);
  console.log(`  Artwork model: ${artworkModel}`);
  console.log(`  Total artworks found: ${artworks.length}`);
  
  // Sort artworks by index to ensure we pick lower index first
  artworks.sort((a, b) => a.index - b.index);
  
  const selectedArtworks = [];
  
  for (const artwork of artworks) {
    if (shouldIncludeArtwork(artwork, series, exhibition, selectedArtworks.length)) {
      selectedArtworks.push({
        artwork,
        series,
      });
      
      // For multi or single, stop after first artwork
      if ((artworkModel === 'multi' || artworkModel === 'single') && selectedArtworks.length >= 1) {
        break;
      }
    }
  }
  
  console.log(`  Selected ${selectedArtworks.length} artwork(s)`);
  return selectedArtworks;
}

/**
 * Interleave artworks from multiple series for group exhibitions
 */
function interleaveArtworks(seriesArtworks) {
  const result = [];
  let maxLength = 0;
  
  // Find the maximum number of artworks in any series
  for (const artworks of seriesArtworks) {
    maxLength = Math.max(maxLength, artworks.length);
  }
  
  // Interleave: take one from each series in turn
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
 * Generate DP-1 playlist from exhibition
 */
async function generatePlaylist(exhibitionIdOrSlug) {
  try {
    // 1. Fetch exhibition
    const exhibition = await getExhibition(exhibitionIdOrSlug);
    console.log(`\nExhibition: ${exhibition.title}`);
    console.log(`Type: ${exhibition.type}`);
    console.log(`Mint blockchain: ${exhibition.mintBlockchain}`);
    
    // 2. Fetch series
    const seriesList = await getSeries(exhibition.id);
    console.log(`\nFound ${seriesList.length} series\n`);
    
    // Sort series by displayIndex (ascending) to ensure proper order
    seriesList.sort((a, b) => {
      // First try to sort by displayIndex if they differ
      if (a.displayIndex !== undefined && b.displayIndex !== undefined && a.displayIndex !== b.displayIndex) {
        return a.displayIndex - b.displayIndex;
      }
      // Fallback: try to extract number from title (e.g., "Infinite Entropy 1" -> 1)
      const aMatch = a.title.match(/(\d+)$/);
      const bMatch = b.title.match(/(\d+)$/);
      if (aMatch && bMatch) {
        return parseInt(aMatch[1]) - parseInt(bMatch[1]);
      }
      // Final fallback: use createdAt timestamp
      return new Date(a.createdAt) - new Date(b.createdAt);
    });
    
    // 3. Select artworks from each series
    const allSeriesArtworks = [];
    for (const series of seriesList) {
      const artworks = await selectArtworksFromSeries(series, exhibition);
      allSeriesArtworks.push(artworks);
    }
    
    // 4. For group exhibitions, interleave artworks; otherwise just flatten
    let selectedItems;
    if (exhibition.type === 'group' || exhibition.type === 'curated') {
      console.log('\nInterleaving artworks from multiple series...');
      selectedItems = interleaveArtworks(allSeriesArtworks);
    } else {
      selectedItems = allSeriesArtworks.flat();
    }
    
    console.log(`\nTotal artworks selected: ${selectedItems.length}\n`);
    
    // 5. Create playlist items
    const playlistItems = [];
    
    for (const { artwork, series } of selectedItems) {
      const source = resolvePreviewURI(artwork);
      
      if (!source) {
        console.warn(`Skipping artwork ${artwork.id}: Unable to resolve preview URI`);
        continue;
      }
      
      const title = generateItemTitle(series.title, artwork.name);
      
      console.log(`Adding item: ${title}`);
      console.log(`  Source: ${source}`);
      
      try {
        // Create provenance information
        const provenance = createProvenance(artwork, exhibition);
        if (!provenance) {
          console.warn(`  Skipping artwork ${artwork.name}: Unable to create provenance`);
          continue;
        }
        
        // Create playlist item following DP-1 schema
        const item = {
          id: randomUUID(),
          title,
          source,
          duration: 300, // Default 300 seconds per artwork
          license: 'open', // Feral File artworks are open access
          created: new Date().toISOString(),
          provenance,
        };
        
        // Validate the item
        const validation = dp1.validatePlaylistItem(item);
        if (!validation.success) {
          console.error(`  ✗ Invalid playlist item: ${validation.error.message}`);
          continue;
        }
        
        playlistItems.push(item);
        
        // Cap playlist items at MAX_PLAYLIST_ITEMS
        if (playlistItems.length >= MAX_PLAYLIST_ITEMS) {
          console.log(`\n⚠️  Reached maximum playlist item limit of ${MAX_PLAYLIST_ITEMS}. Stopping item creation.`);
          break;
        }
      } catch (error) {
        console.error(`Error creating playlist item for ${title}:`, error.message);
        continue;
      }
    }
    
    if (playlistItems.length === 0) {
      throw new Error('No valid playlist items could be created');
    }
    
    // 6. Create playlist
    console.log(`\nCreating playlist with ${playlistItems.length} items...`);
    
    const playlistId = randomUUID();
    const playlistSlug = createSlug(exhibition.title);
    
    // Process cover image - apply same URL transformation
    let coverImageUrl = exhibition.coverDisplay || exhibition.coverURI;
    if (coverImageUrl) {
      coverImageUrl = resolveURI(coverImageUrl);
    }
    
    // Process summary - truncate to max 4096 characters as per DP-1 spec
    let summary = exhibition.note || exhibition.noteBrief || `A digital art exhibition featuring works from ${exhibition.title}`;
    if (summary.length > 4096) {
      summary = summary.substring(0, 4093) + '...';
    }
    
    const playlist = {
      dpVersion: '1.1.0',
      id: playlistId,
      slug: playlistSlug,
      title: exhibition.title,
      summary,
      coverImage: coverImageUrl,
      created: new Date().toISOString(),
      defaults: {
        license: 'open',
        duration: 300,
      },
      items: playlistItems,
    };
    
    // Generate a temporary signature (should be replaced with real signing)
    // For now, use a placeholder that matches the pattern
    playlist.signature = 'ed25519:0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';
    
    // Validate the full playlist
    const playlistValidation = dp1.parseDP1Playlist(playlist);
    if (playlistValidation.error) {
      console.error('\n✗ Playlist validation failed:');
      console.error(playlistValidation.error.message);
      if (playlistValidation.error.details) {
        console.error('Details:', playlistValidation.error.details);
      }
      throw new Error('Playlist validation failed');
    }
    
    console.log('\n✓ Playlist created successfully!');
    console.log(`  Title: ${playlist.title}`);
    console.log(`  ID: ${playlist.id}`);
    console.log(`  Slug: ${playlist.slug}`);
    console.log(`  Items: ${playlist.items.length}`);
    console.log('\nNote: Signature is a placeholder. Use a proper Ed25519 key to sign in production.');
    
    return playlist;
    
  } catch (error) {
    console.error('\n✗ Error generating playlist:', error.message);
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage: node generate-ff-playlist.js <exhibition-id-or-slug>');
    console.error('\nExamples:');
    console.error('  node scripts/generate-ff-playlist.js infinite-entropy-xhj');
    console.error('  node scripts/generate-ff-playlist.js 71513905-f7b2-4ac1-b617-0d41123b3639');
    process.exit(1);
  }
  
  const exhibitionIdOrSlug = args[0];
  
  try {
    const playlist = await generatePlaylist(exhibitionIdOrSlug);
    
    // Output the playlist JSON
    const playlistJson = JSON.stringify(playlist, null, 2);
    
    // Write to file
    const outputFile = `playlist-${exhibitionIdOrSlug}.json`;
    const fs = await import('fs');
    fs.writeFileSync(outputFile, playlistJson, 'utf-8');
    
    console.log(`\n✓ Playlist saved to: ${outputFile}`);
    console.log('\nPlaylist JSON:');
    console.log(playlistJson);
    
  } catch (error) {
    console.error('\n✗ Failed to generate playlist');
    process.exit(1);
  }
}

// Run the script
main();

