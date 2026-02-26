#!/usr/bin/env node

/**
 * Upload DP-1 Playlists and Channels to Feed Server
 *
 * This script uploads playlists from local files to the DP-1 Feed API.
 * It processes exhibition folders, creates channels, and uploads playlists.
 *
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
 *   # Dry-run with summary output (Markdown format)
 *   node scripts/upload-to-feed.js --api-key YOUR_API_KEY --feed-endpoint https://feed.feralfile.com --playlists-path ./playlists --dry-run --output SUMMARY.md
 *
 *   # Upload with summary report
 *   node scripts/upload-to-feed.js --api-key YOUR_API_KEY --feed-endpoint https://feed.feralfile.com --playlists-path ./playlists --output UPLOAD-REPORT.md
 *
 */

import fs from 'fs';
import path from 'path';

const FF_API_BASE = 'https://feralfile.com/api';

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
    .filter(file => file.endsWith('.json'))
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
  const playlistUrls = uploadedPlaylists.map(p => `${feedEndpoint}/api/v1/playlists/${p.id}`);

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
      exhibition: {
        title: exhibition.title,
        slug: exhibitionSlug,
      },
      channel: {
        id: channel.id,
        slug: channel.slug,
        title: channel.title,
        playlistCount: uploadedPlaylists.length,
      },
      playlists: uploadedPlaylists,
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

/**
 * Write summary report to file
 */
function writeSummaryReport(summaryPath, results, startTime, endTime, isDryRun = false) {
  const successful = results.filter(r => r.status === 'success' || r.status === 'validated');
  const failed = results.filter(r => r.status === 'failed' || r.status === 'validation_failed');
  const skipped = results.filter(r => r.status === 'skipped');

  const totalDuration = endTime - startTime;
  const totalPlaylists = results.reduce((sum, r) => sum + (r.playlists?.length || 0), 0);

  // Build Markdown content
  let markdown = '';

  // Header
  markdown += `# DP-1 Feed Upload Summary\n\n`;
  markdown += `**Mode**: ${isDryRun ? 'Dry Run (Validation Only)' : 'Upload'}\n`;
  markdown += `**Date**: ${new Date().toISOString()}\n`;
  markdown += `**Duration**: ${(totalDuration / 1000).toFixed(2)}s\n\n`;

  // Statistics
  markdown += `## Summary Statistics\n\n`;
  markdown += `| Metric | Count |\n`;
  markdown += `|--------|-------|\n`;
  markdown += `| Total Exhibitions | ${results.length} |\n`;
  markdown += `| ${isDryRun ? 'Validated' : 'Successful'} | ${successful.length} |\n`;
  markdown += `| Failed | ${failed.length} |\n`;
  markdown += `| Skipped | ${skipped.length} |\n`;
  markdown += `| Total Playlists | ${totalPlaylists} |\n`;
  if (!isDryRun) {
    markdown += `| Total Channels Created | ${successful.length} |\n`;
  }
  markdown += `\n`;

  // Successful exhibitions
  if (successful.length > 0) {
    markdown += `## ${isDryRun ? 'Validated' : 'Successful'} Exhibitions\n\n`;

    for (const result of successful) {
      const duration = result.duration ? `${(result.duration / 1000).toFixed(2)}s` : '0s';
      markdown += `### ✓ ${result.exhibition?.title || result.exhibitionSlug}\n\n`;
      markdown += `- **Exhibition Slug**: \`${result.exhibitionSlug}\`\n`;
      markdown += `- **Duration**: ${duration}\n`;

      if (result.curator) {
        markdown += `- **Curator**: ${result.curator.name}\n`;
      }

      if (!isDryRun && result.channel) {
        markdown += `- **Channel ID**: \`${result.channel.id}\`\n`;
        markdown += `- **Channel Slug**: \`${result.channel.slug}\`\n`;
      }

      markdown += `\n`;

      // Playlists
      if (result.playlists && result.playlists.length > 0) {
        markdown += `#### Playlists (${result.playlists.length})\n\n`;
        markdown += `| # | Title | Items |${!isDryRun ? ' ID | Slug |' : ''}\n`;
        markdown += `|---|-------|-------|${!isDryRun ? '----|----|' : ''}\n`;

        result.playlists.forEach((playlist, index) => {
          if (!isDryRun) {
            markdown += `| ${index + 1} | ${playlist.title} | ${playlist.itemCount} | \`${playlist.id}\` | \`${playlist.slug}\` |\n`;
          } else {
            markdown += `| ${index + 1} | ${playlist.title} | ${playlist.itemCount} |\n`;
          }
        });

        markdown += `\n`;
      }

      if (isDryRun && result.wouldCreateChannel) {
        markdown += `> ✓ Would create channel with ${result.playlists?.length || 0} playlist(s)\n\n`;
      }
    }
  }

  // Failed exhibitions
  if (failed.length > 0) {
    markdown += `## Failed Exhibitions\n\n`;

    for (const result of failed) {
      const duration = result.duration ? `${(result.duration / 1000).toFixed(2)}s` : '0s';
      markdown += `### ✗ ${result.exhibitionSlug}\n\n`;
      markdown += `- **Status**: ${result.status}\n`;
      markdown += `- **Duration**: ${duration}\n`;
      markdown += `- **Reason**: ${result.reason || 'Unknown error'}\n`;

      if (result.invalidPlaylists && result.invalidPlaylists.length > 0) {
        markdown += `\n**Invalid Playlists:**\n\n`;
        result.invalidPlaylists.forEach(p => {
          markdown += `- \`${p.file}\`: ${p.error}\n`;
        });
      }

      markdown += `\n`;
    }
  }

  // Skipped exhibitions
  if (skipped.length > 0) {
    markdown += `## Skipped Exhibitions\n\n`;

    for (const result of skipped) {
      markdown += `### ⊘ ${result.exhibitionSlug}\n\n`;
      markdown += `- **Reason**: ${result.reason || 'Unknown'}\n\n`;
    }
  }

  // Footer
  markdown += `---\n\n`;
  markdown += `*Generated by DP-1 Feed Upload Script*\n`;

  fs.writeFileSync(summaryPath, markdown, 'utf-8');
  console.log(`\n📄 Summary report written to: ${summaryPath}`);
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
  const feedEndpoint = getFlag('--feed-endpoint');
  const playlistsPath = getFlag('--playlists-path');
  const isDryRun = args.includes('--dry-run');
  const outputPath = getFlag('--output');

  // Validate required flags
  if (!apiKey || !feedEndpoint || !playlistsPath) {
    console.error(
      'Usage: node upload-to-feed.js --api-key <key> --feed-endpoint <url> --playlists-path <path> [--dry-run] [--output <summary-file>]'
    );
    console.error('\nRequired flags:');
    console.error('  --api-key         API key for Feed server authentication');
    console.error('  --feed-endpoint   Feed server URL (e.g., https://feed.feralfile.com)');
    console.error('  --playlists-path  Path to playlists folder or exhibition folder');
    console.error('\nOptional flags:');
    console.error('  --dry-run         Validate playlists without uploading');
    console.error('  --output          Write summary report to specified file');
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
    console.error(
      '  node scripts/upload-to-feed.js --api-key YOUR_API_KEY --feed-endpoint https://feed.feralfile.com --playlists-path ./playlists --output SUMMARY.md'
    );
    console.error(
      '  node scripts/upload-to-feed.js --api-key YOUR_API_KEY --feed-endpoint https://feed.feralfile.com --playlists-path ./playlists --dry-run --output DRY-RUN.md'
    );
    process.exit(1);
  }

  if (isDryRun) {
    console.log('🔍 DRY RUN MODE - No data will be uploaded\n');
  }

  if (outputPath) {
    console.log(`📄 Summary will be written to: ${outputPath}\n`);
  }

  const startTime = Date.now();

  // Validate paths
  if (!fs.existsSync(playlistsPath)) {
    console.error(`Error: Path does not exist: ${playlistsPath}`);
    process.exit(1);
  }

  const stat = fs.statSync(playlistsPath);
  const results = [];

  try {
    if (stat.isDirectory()) {
      // Check if it's an exhibition folder (contains JSON files) or a parent folder
      const files = fs.readdirSync(playlistsPath);
      const hasJsonFiles = files.some(f => f.endsWith('.json'));

      if (hasJsonFiles) {
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

        console.log(`Found ${subDirs.length} exhibition folder(s) to process\n`);

        for (const subDir of subDirs) {
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

    // Write summary report if output path specified
    if (outputPath && results.length > 0) {
      writeSummaryReport(outputPath, results, startTime, endTime, isDryRun);
    }

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
    .filter(file => file.endsWith('.json'))
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
