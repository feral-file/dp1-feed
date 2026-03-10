#!/usr/bin/env node

/**
 * Upload DP-1 Playlists and Channels to Feed Server
 *
 * This script uploads playlists from local files to the DP-1 Feed API.
 * It processes exhibition folders, creates channels, and uploads playlists.
 *
 * Channel Ordering:
 *   When processing multiple exhibitions, you can control the upload order using a
 *   channels-manifest.json file in the playlists folder. If no manifest exists, the
 *   script will create a default one with exhibitions in alphabetical order.
 *
 *   Manifest format:
 *   {
 *     "_comment": "Reorder the 'channels' array to change upload sequence",
 *     "channels": ["exhibition-slug-1", "exhibition-slug-2", ...]
 *   }
 *
 * Playlist Ordering:
 *   Within each exhibition, playlists are ordered by their numeric filename prefix
 *   (e.g., 01-intro.json, 02-main.json, 03-outro.json).
 *
 * Usage:
 *   node scripts/upload-to-feed.js --api-key <key> --feed-endpoint <url> --playlists-path <path> [--dry-run] [--output <summary-file>]
 *
 * Examples:
 *   # Upload all exhibitions
 *   node scripts/upload-to-feed.js --api-key YOUR_API_KEY --feed-endpoint https://feed.feralfile.com --playlists-path ./playlists
 *
 *   # Upload a single exhibition
 *   node scripts/upload-to-feed.js --api-key YOUR_API_KEY --feed-endpoint https://feed.feralfile.com --playlists-path ./playlists/net-evil-das
 *
 *   # Use local development server
 *   node scripts/upload-to-feed.js --api-key YOUR_API_KEY --feed-endpoint http://localhost:8787 --playlists-path ./playlists/net-evil-das
 *
 *   # Dry-run mode
 *   node scripts/upload-to-feed.js --api-key YOUR_API_KEY --feed-endpoint https://feed.feralfile.com --playlists-path ./playlists --dry-run
 *
 */

import fs from 'fs';
import path from 'path';

const FF_API_BASE = 'https://feralfile.com/api';
const PUBLISH_ARTIFACT_SCHEMA_VERSION = 1;

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
 * Get exhibition info from Feral File API
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
 * Build channel data from exhibition
 */
function buildChannelFromExhibition(exhibition, playlistUrls) {
  // Build curators from curatorAlumni (single object)
  const curators = [];

  if (exhibition.curatorAlumni && typeof exhibition.curatorAlumni === 'object') {
    const curator = exhibition.curatorAlumni;
    const curatorEntity = {
      name: curator.alias || curator.fullName || 'Unknown Curator',
    };

    // Add URL if available
    if (curator.alias) {
      // URL encode the alias to handle spaces and special characters
      const encodedAlias = encodeURIComponent(curator.alias);
      curatorEntity.url = `https://feralfile.com/curators/${encodedAlias}`;
    }

    curators.push(curatorEntity);
  }

  // Build publisher (Feral File)
  const publisher = {
    name: 'Feral File',
    url: 'https://feralfile.com',
  };

  // Build summary
  let summary =
    exhibition.note ||
    exhibition.noteBrief ||
    `A digital art exhibition featuring works from ${exhibition.title}`;

  // Truncate if too long
  if (summary.length > 4096) {
    summary = summary.substring(0, 4093) + '...';
  }

  // Build cover image
  let coverImage = exhibition.coverDisplay || exhibition.coverURI;
  if (coverImage) {
    coverImage = resolveURI(coverImage);
  }

  const channel = {
    title: exhibition.title,
    curators,
    publisher,
    summary,
    playlists: playlistUrls,
  };

  if (coverImage) {
    channel.coverImage = coverImage;
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
 * Process a single exhibition folder
 */
async function processExhibition(feedEndpoint, apiKey, exhibitionPath) {
  const exhibitionSlug = path.basename(exhibitionPath);
  const startTime = Date.now();

  console.log(`\n${'='.repeat(80)}`);
  console.log(`Processing exhibition: ${exhibitionSlug}`);
  console.log('='.repeat(80));

  // Get all playlist files in the exhibition folder
  const files = fs
    .readdirSync(exhibitionPath)
    .filter(file => file.endsWith('.json') && file !== 'channels-manifest.json')
    .sort((a, b) => {
      // Sort by the index number at the start of filename
      const aIndex = parseInt(a.split('-')[0]);
      const bIndex = parseInt(b.split('-')[0]);
      return aIndex - bIndex;
    });

  if (files.length === 0) {
    console.log(`⚠️  No playlist files found in ${exhibitionPath}`);
    return {
      exhibitionSlug,
      status: 'skipped',
      reason: 'No playlist files found',
      playlists: [],
    };
  }

  console.log(`Found ${files.length} playlist(s)`);

  // Upload all playlists
  const uploadedPlaylists = [];
  const failedPlaylists = [];

  for (const file of files) {
    const playlistPath = path.join(exhibitionPath, file);
    const playlistData = JSON.parse(fs.readFileSync(playlistPath, 'utf-8'));

    try {
      const result = await uploadPlaylist(feedEndpoint, apiKey, playlistData);
      uploadedPlaylists.push({
        file,
        id: result.id,
        slug: result.slug,
        title: result.title,
        itemCount: result.items?.length || 0,
      });
    } catch (error) {
      console.error(`  ✗ Failed to upload ${file}:`, error.message);
      failedPlaylists.push({
        file,
        error: error.message,
      });
      throw error;
    }
  }

  // Build playlist URLs from uploaded playlists
  const playlistUrls = uploadedPlaylists.map(
    p => `${feedEndpoint}/api/v1/playlists/${encodeURIComponent(p.id)}`
  );

  // Fetch exhibition info from Feral File API
  const exhibition = await getExhibition(exhibitionSlug);

  // Build channel data
  const channelData = buildChannelFromExhibition(exhibition, playlistUrls);

  // Create channel
  try {
    const channel = await createChannel(feedEndpoint, apiKey, channelData);
    const duration = Date.now() - startTime;

    console.log(`\n✓ Exhibition "${exhibition.title}" uploaded successfully!`);
    console.log(`  Channel ID: ${channel.id}`);
    console.log(`  Channel Slug: ${channel.slug}`);
    console.log(`  Playlists: ${uploadedPlaylists.length}`);
    console.log(`  Duration: ${(duration / 1000).toFixed(2)}s`);

    return {
      exhibitionSlug,
      status: 'success',
      publishedAt: new Date().toISOString(),
      exhibition: {
        title: exhibition.title,
        slug: exhibitionSlug,
      },
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
      exhibitionSlug,
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

function validatePublishedExhibition({ result, canonicalOrigin }) {
  if (result.status !== 'success') {
    return;
  }
  if (!result.channel?.id || !result.channel?.slug || !result.channel?.url) {
    throw new Error(
      `validation failed for exhibition ${result.exhibitionSlug}: missing required channel fields`
    );
  }
  if (!Array.isArray(result.playlists) || result.playlists.length === 0) {
    throw new Error(
      `validation failed for exhibition ${result.exhibitionSlug}: no playlists in success result`
    );
  }

  const expectedChannelUrl = `${canonicalOrigin}/api/v1/channels/${encodeURIComponent(result.channel.id)}`;
  if (result.channel.url !== expectedChannelUrl) {
    throw new Error(
      `validation failed for exhibition ${result.exhibitionSlug}: channel url mismatch (expected ${expectedChannelUrl}, got ${result.channel.url})`
    );
  }

  for (const playlist of result.playlists) {
    if (!playlist?.id || !playlist?.slug || !playlist?.url) {
      throw new Error(
        `validation failed for exhibition ${result.exhibitionSlug}: playlist is missing id/slug/url`
      );
    }
    const expectedPlaylistUrl = `${canonicalOrigin}/api/v1/playlists/${encodeURIComponent(playlist.id)}`;
    if (playlist.url !== expectedPlaylistUrl) {
      throw new Error(
        `validation failed for exhibition ${result.exhibitionSlug}: playlist url mismatch for ${playlist.id} (expected ${expectedPlaylistUrl}, got ${playlist.url})`
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
  return {
    schema_version: PUBLISH_ARTIFACT_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    mode: isDryRun ? 'dry-run' : 'upload',
    started_at: startedAt,
    completed_at: completedAt,
    canonical_origin: canonicalOrigin,
    feed_endpoint_input: feedEndpointInput,
    exhibitions: results.map(result => ({
      exhibition_slug: result.exhibitionSlug,
      status: result.status,
      published_at: result.publishedAt || null,
      duration_ms: result.duration || 0,
      reason: result.reason || null,
      exhibition: result.exhibition || null,
      channel:
        result.channel && result.status === 'success'
          ? {
              id: result.channel.id,
              slug: result.channel.slug,
              title: result.channel.title,
              url: result.channel.url,
            }
          : null,
      playlists: Array.isArray(result.playlists)
        ? result.playlists.map(playlist => ({
            file: playlist.file || null,
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
  if (!Array.isArray(artifact.exhibitions)) {
    throw new Error('artifact validation failed: exhibitions must be an array');
  }
  for (const exhibition of artifact.exhibitions) {
    if (!exhibition?.exhibition_slug || !exhibition?.status) {
      throw new Error('artifact validation failed: exhibition_slug/status are required');
    }
    if (exhibition.status === 'success') {
      if (!exhibition.channel?.id || !exhibition.channel?.url) {
        throw new Error(
          `artifact validation failed: success exhibition ${exhibition.exhibition_slug} missing channel`
        );
      }
      if (!Array.isArray(exhibition.playlists) || exhibition.playlists.length === 0) {
        throw new Error(
          `artifact validation failed: success exhibition ${exhibition.exhibition_slug} missing playlists`
        );
      }
      for (const playlist of exhibition.playlists) {
        if (!playlist?.id || !playlist?.url || !playlist?.slug) {
          throw new Error(
            `artifact validation failed: success exhibition ${exhibition.exhibition_slug} has incomplete playlist rows`
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
      // Check if it's an exhibition folder (contains playlist JSON files) or a parent folder
      const files = fs.readdirSync(playlistsPath);
      const hasPlaylistFiles = files.some(
        f => f.endsWith('.json') && f !== 'channels-manifest.json'
      );

      if (hasPlaylistFiles) {
        // It's an exhibition folder
        if (isDryRun) {
          const result = await processExhibitionDryRun(playlistsPath);
          if (result) {
            results.push(result);
          }
        } else {
          const result = await processExhibition(feedEndpoint, apiKey, playlistsPath);
          if (result) {
            results.push(result);
          }
        }
      } else {
        // It's a parent folder, process all subdirectories
        const subDirs = files.filter(f => {
          const subPath = path.join(playlistsPath, f);
          return fs.statSync(subPath).isDirectory();
        });

        console.log(`Found ${subDirs.length} exhibition folder(s)\n`);

        // Check for channels manifest
        const manifest = getChannelsManifest(playlistsPath);
        let orderedSubDirs;

        if (manifest && manifest.channels.length > 0) {
          // Use manifest order
          orderedSubDirs = manifest.channels;

          // Warn about exhibitions in filesystem but not in manifest
          const missingFromManifest = subDirs.filter(dir => !orderedSubDirs.includes(dir));
          if (missingFromManifest.length > 0) {
            console.warn(
              `⚠️  Warning: ${missingFromManifest.length} exhibition(s) found but not in manifest:`
            );
            missingFromManifest.forEach(dir => console.warn(`    - ${dir}`));
            console.warn(
              '    These will be skipped. Update channels-manifest.json to include them.\n'
            );
          }

          // Warn about exhibitions in manifest but not in filesystem
          const missingFromFilesystem = orderedSubDirs.filter(dir => !subDirs.includes(dir));
          if (missingFromFilesystem.length > 0) {
            console.warn(
              `⚠️  Warning: ${missingFromFilesystem.length} exhibition(s) in manifest but not found:`
            );
            missingFromFilesystem.forEach(dir => console.warn(`    - ${dir}`));
            console.warn('    These will be skipped.\n');
          }

          // Filter to only process exhibitions that exist
          orderedSubDirs = orderedSubDirs.filter(dir => subDirs.includes(dir));
          console.log(`Processing ${orderedSubDirs.length} exhibition(s) in manifest order:\n`);
          orderedSubDirs.forEach((dir, idx) => console.log(`  ${idx + 1}. ${dir}`));
          console.log('');
        } else {
          // No manifest, create default one
          console.log('No channels manifest found. Creating default...\n');
          orderedSubDirs = createDefaultManifest(playlistsPath, subDirs);
          console.log(`Processing ${orderedSubDirs.length} exhibition(s) in alphabetical order\n`);
        }

        for (const subDir of orderedSubDirs) {
          const subPath = path.join(playlistsPath, subDir);
          try {
            if (isDryRun) {
              const result = await processExhibitionDryRun(subPath);
              if (result) {
                results.push(result);
              }
            } else {
              const result = await processExhibition(feedEndpoint, apiKey, subPath);
              if (result) {
                results.push(result);
              }
            }
          } catch (error) {
            console.error(`\n✗ Failed to process ${subDir}:`, error.message);
            results.push({
              exhibitionSlug: subDir,
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
        console.log(`  Total Exhibitions: ${results.length}`);
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
          console.log(`\nFailed exhibitions:`);
          for (const result of failed) {
            console.log(`  ✗ ${result.exhibitionSlug}: ${result.reason || 'Validation failed'}`);
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
      validatePublishedExhibition({
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

/**
 * Process exhibition in dry-run mode (validation only)
 */
async function processExhibitionDryRun(exhibitionPath) {
  const exhibitionSlug = path.basename(exhibitionPath);
  const startTime = Date.now();

  console.log(`\n${'='.repeat(80)}`);
  console.log(`[DRY RUN] Processing exhibition: ${exhibitionSlug}`);
  console.log('='.repeat(80));

  // Get all playlist files
  const files = fs
    .readdirSync(exhibitionPath)
    .filter(file => file.endsWith('.json') && file !== 'channels-manifest.json')
    .sort((a, b) => {
      const aIndex = parseInt(a.split('-')[0]);
      const bIndex = parseInt(b.split('-')[0]);
      return aIndex - bIndex;
    });

  if (files.length === 0) {
    console.log(`⚠️  No playlist files found in ${exhibitionPath}`);
    return {
      exhibitionSlug,
      status: 'skipped',
      reason: 'No playlist files found',
      playlists: [],
      duration: Date.now() - startTime,
    };
  }

  console.log(`Found ${files.length} playlist(s)`);

  const validatedPlaylists = [];
  const invalidPlaylists = [];

  // Validate each playlist
  for (const file of files) {
    const playlistPath = path.join(exhibitionPath, file);
    try {
      const playlistData = JSON.parse(fs.readFileSync(playlistPath, 'utf-8'));
      console.log(`  ✓ ${file}: ${playlistData.title} (${playlistData.items?.length || 0} items)`);
      validatedPlaylists.push({
        file,
        title: playlistData.title,
        itemCount: playlistData.items?.length || 0,
      });
    } catch (error) {
      console.error(`  ✗ ${file}: Failed to parse - ${error.message}`);
      invalidPlaylists.push({
        file,
        error: error.message,
      });
    }
  }

  // Fetch exhibition info
  let exhibitionInfo = null;
  let curator = null;

  try {
    const exhibition = await getExhibition(exhibitionSlug);
    exhibitionInfo = {
      title: exhibition.title,
      slug: exhibitionSlug,
    };

    console.log(`\n  Exhibition: ${exhibition.title}`);

    const hasCurator = exhibition.curatorAlumni && typeof exhibition.curatorAlumni === 'object';
    console.log(`  Curator: ${hasCurator ? '✓' : 'None'}`);

    if (hasCurator) {
      const curatorData = exhibition.curatorAlumni;
      const name = curatorData.alias || curatorData.fullName;
      console.log(`    - ${name}`);

      curator = {
        name,
        alias: curatorData.alias,
      };
    }

    console.log(`\n  Would create channel with ${files.length} playlist(s)`);
  } catch (error) {
    console.error(`\n  ⚠️  Could not fetch exhibition info: ${error.message}`);
  }

  const duration = Date.now() - startTime;

  return {
    exhibitionSlug,
    status: invalidPlaylists.length > 0 ? 'validation_failed' : 'validated',
    exhibition: exhibitionInfo,
    curator,
    playlists: validatedPlaylists,
    invalidPlaylists,
    wouldCreateChannel: invalidPlaylists.length === 0,
    duration,
  };
}

// Run the script
main();
