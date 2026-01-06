#!/usr/bin/env node

/**
 * Script to cast a playlist to a DP-1 device
 * Usage: node scripts/cast-playlist.js <playlist-file-path> <device-id>
 * Example: node scripts/cast-playlist.js playlists/primordium-i8m.json FF1-HTXIER6J
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('❌ Error: Missing required arguments');
  console.error('Usage: node scripts/cast-playlist.js <playlist-file-path> <device-id>');
  console.error(
    'Example: node scripts/cast-playlist.js playlists/primordium-i8m.json FF1-HTXIER6J'
  );
  process.exit(1);
}

const playlistFilePath = args[0];
const deviceId = args[1];

// Resolve playlist file path (support both relative and absolute paths)
let resolvedPath;
if (playlistFilePath.startsWith('/')) {
  resolvedPath = playlistFilePath;
} else {
  resolvedPath = resolve(process.cwd(), playlistFilePath);
}

// Read and parse playlist file
let playlist;
try {
  const playlistContent = readFileSync(resolvedPath, 'utf-8');
  playlist = JSON.parse(playlistContent);
  console.log(`📖 Loaded playlist: ${playlist.title || playlist.id || 'Unknown'}`);
} catch (error) {
  if (error.code === 'ENOENT') {
    console.error(`❌ Error: Playlist file not found: ${resolvedPath}`);
  } else if (error instanceof SyntaxError) {
    console.error(`❌ Error: Invalid JSON in playlist file: ${error.message}`);
  } else {
    console.error(`❌ Error reading playlist file: ${error.message}`);
  }
  process.exit(1);
}

// Construct the API payload
const payload = {
  command: 'displayPlaylist',
  request: {
    dp1_call: playlist,
    intent: {
      action: 'now_display',
    },
  },
};

// Construct the API URL
const apiUrl = `http://${deviceId}.local:1111/api/cast`;

console.log(`📡 Sending playlist to device: ${deviceId}`);
console.log(`🔗 API endpoint: ${apiUrl}`);

// Make the API request
try {
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ API request failed with status ${response.status}: ${response.statusText}`);
    if (errorText) {
      console.error(`Response body: ${errorText}`);
    }
    process.exit(1);
  }

  const responseData = await response.json().catch(() => {
    // If response is not JSON, try to get text
    return response.text().then(text => ({ message: text }));
  });

  console.log('✅ Playlist cast successfully!');
  if (responseData && Object.keys(responseData).length > 0) {
    console.log('📋 Response:', JSON.stringify(responseData, null, 2));
  }
} catch (error) {
  if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
    console.error(`❌ Error: Could not connect to device ${deviceId}.local:1111`);
    console.error('   Make sure the device is on the same network and reachable.');
  } else {
    console.error(`❌ Error making API request: ${error.message}`);
  }
  process.exit(1);
}
