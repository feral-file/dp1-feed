import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const setupDuration = new Trend('setup_duration');

import { lightLoad, normalLoad, stressTest, spikeTest, soakTest } from './config.js';

// Test configuration - select based on environment variable
const testType = __ENV.TEST_TYPE || 'normal';
const configMap = {
  light: lightLoad,
  normal: normalLoad,
  stress: stressTest,
  spike: spikeTest,
  soak: soakTest,
};

export const options = {
  ...configMap[testType],

  // Test data export
  summaryTrendStats: ['min', 'avg', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
};

// Configuration
const BASE_URL = __ENV.BASE_URL || 'https://dp1-feed-operator-api-dev.autonomy-system.workers.dev';
const API_SECRET = __ENV.API_SECRET || __ENV.BENCHMARK_API_SECRET;

// Test data cache
let cachedPlaylists = [];
let cachedChannels = [];

// Generate realistic test data
function generatePlaylistData(index = 0) {
  return {
    dpVersion: '1.0.0',
    title: `K6 Benchmark Playlist ${index + 1} - ${Date.now()}`,
    curators: [
      {
        name: `K6 Test Curator ${index + 1}`,
        key: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
        url: `https://example.com/k6-test-curator-${index + 1}.html`,
      },
    ],
    summary: `K6 benchmark test playlist (${index + 1})`,
    coverImage: `https://example.com/k6-cover-${index + 1}.jpg`,
    items: [
      {
        title: `K6 Test Item ${index + 1}`,
        source: `https://example.com/k6-test-${index + 1}.mp4`,
        duration: Math.max(1, 30 + (index % 60)),
        license: 'open',
        display: {
          scaling: 'fill',
          margin: 0,
          background: 'transparent',
          autoplay: true,
          loop: true,
        },
        provenance: {
          type: 'onChain',
          contract: {
            chain: 'evm',
            standard: 'erc721',
            address: '0x1234567890123456789012345678901234567890',
            tokenId: String(2000 + index),
          },
        },
      },
    ],
  };
}

function generateChannelData(index = 0) {
  // Use real playlist URLs if available
  let playlistUrls = [];

  if (cachedPlaylists.length >= 2) {
    const playlist1 = cachedPlaylists[index % cachedPlaylists.length];
    const playlist2 = cachedPlaylists[(index + 1) % cachedPlaylists.length];
    playlistUrls = [
      `${BASE_URL}/api/v1/playlists/${playlist1.id}`,
      `${BASE_URL}/api/v1/playlists/${playlist2.id}`,
    ];
  } else {
    playlistUrls = [
      `https://example.com/k6-playlist-${index + 1}`,
      `https://example.com/k6-playlist-${index + 2}`,
    ];
  }

  return {
    title: `K6 Benchmark Group ${index + 1} - ${Date.now()}`,
    curator: `K6 Test Curator ${index + 1}`,
    curators: [
      {
        name: `K6 Test Curator ${index + 1}`,
        key: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
        url: `https://example.com/k6-test-curator-${index + 1}.html`,
      },
    ],
    summary: `K6 benchmark test channel (${index + 1})`,
    publisher: {
      name: `K6 Test Publisher ${index + 1}`,
      key: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
      url: `https://example.com/k6-test-publisher-${index + 1}.html`,
    },
    playlists: playlistUrls,
    coverImage: `https://example.com/k6-cover-${index + 1}.jpg`,
  };
}

// HTTP helper with authentication
function makeRequest(endpoint, method = 'GET', body = null, tags = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'K6-DP1-Benchmark/1.0',
  };

  // Add authentication for write operations
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && API_SECRET) {
    headers['Authorization'] = `Bearer ${API_SECRET}`;
  }

  const params = {
    headers,
    tags: { method, ...tags },
  };

  return http.request(method, url, body ? JSON.stringify(body) : null, params);
}

// Setup function - runs once before the test
export function setup() {
  console.log(`🚀 Setting up K6 benchmark tests for ${BASE_URL}`);
  const setupStart = Date.now();

  try {
    // Fetch existing playlists
    console.log('📥 Fetching existing playlists...');
    const playlistsResponse = makeRequest('/api/v1/playlists?limit=10', 'GET', null, {
      setup: 'true',
    });

    if (playlistsResponse.status === 200) {
      const responseData = JSON.parse(playlistsResponse.body);
      const playlists = Array.isArray(responseData) ? responseData : responseData.items || [];
      if (Array.isArray(playlists)) {
        cachedPlaylists = playlists;
        console.log(`✅ Found ${cachedPlaylists.length} existing playlists`);
      }
    }

    // Only create playlists if none exist
    if (cachedPlaylists.length === 0) {
      console.log('📝 No existing playlists found, creating test playlists...');

      for (let i = 0; i < 2; i++) {
        const playlistData = generatePlaylistData(i + 3000); // High index to avoid conflicts
        console.log(`📤 Creating playlist ${i + 1}/2...`);
        const response = makeRequest('/api/v1/playlists', 'POST', playlistData, { setup: 'true' });

        if (response.status === 201) {
          const playlist = JSON.parse(response.body);
          cachedPlaylists.push(playlist);
          console.log(`✅ Created playlist: ${playlist.id}`);
        } else {
          console.log(`❌ Failed to create playlist: ${response.status}`);
          try {
            const errorBody = JSON.parse(response.body);
            console.log(`❌ Error details: ${JSON.stringify(errorBody)}`);
          } catch (e) {
            console.log(`❌ Error: ${e.message}`);
          }
        }

        sleep(0.1); // Small delay between creations
      }
    }

    // Fetch existing channels
    console.log('📥 Fetching existing channels...');
    const groupsResponse = makeRequest('/api/v1/channels?limit=10', 'GET', null, {
      setup: 'true',
    });

    if (groupsResponse.status === 200) {
      const responseData = JSON.parse(groupsResponse.body);
      const groups = Array.isArray(responseData) ? responseData : responseData.items || [];
      if (Array.isArray(groups)) {
        cachedChannels = groups;
        console.log(`✅ Found ${cachedChannels.length} existing channels`);
      }
    }

    // Only create channels if none exist and we have playlists to reference
    if (cachedChannels.length === 0 && cachedPlaylists.length >= 2) {
      console.log('📝 No existing channels found, creating test channel...');

      const channelData = generateChannelData(0);
      console.log('📤 Creating channel...');
      const response = makeRequest('/api/v1/channels', 'POST', channelData, { setup: 'true' });

      if (response.status === 201) {
        const channel = JSON.parse(response.body);
        cachedChannels.push(channel);
        console.log(`✅ Created channel: ${channel.id}`);
      } else {
        console.log(`❌ Failed to create channel: ${response.status}`);
        try {
          const errorBody = JSON.parse(response.body);
          console.log(`❌ Error details: ${JSON.stringify(errorBody)}`);
        } catch (e) {
          console.log(`❌ Error: ${e.message}`);
        }
      }
    }

    const setupTime = Date.now() - setupStart;
    setupDuration.add(setupTime);

    console.log(`🎯 Setup completed in ${setupTime}ms`);
    console.log(
      `📊 Available for testing: ${cachedPlaylists.length} playlists, ${cachedChannels.length} channels`
    );

    return {
      playlists: cachedPlaylists,
      groups: cachedChannels,
    };
  } catch (error) {
    console.error(`❌ Setup failed: ${error.message}`);
    return { playlists: [], groups: [] };
  }
}

// Main test function
export default function (data) {
  // Update cached data from setup
  cachedPlaylists = data.playlists || [];
  cachedChannels = data.groups || [];

  // Test API info endpoint
  testAPIInfo();

  // Test health endpoint
  testHealthCheck();

  // Test playlist operations
  testPlaylistOperations();

  // Test channel operations
  testChannelOperations();

  // Test playlist items (read-only)
  testPlaylistItems();

  // Small sleep between iterations
  sleep(Math.random() * 2 + 1); // 1-3 seconds
}

function testAPIInfo() {
  const response = makeRequest('/api/v1', 'GET', null, { endpoint: 'api_info' });

  const success = check(response, {
    'API Info: status is 200': r => r.status === 200,
    'API Info: has name field': r => {
      try {
        const data = JSON.parse(r.body);
        return data.name && data.name.length > 0;
      } catch {
        return false;
      }
    },
  });

  if (!success) errorRate.add(1);
}

function testHealthCheck() {
  const response = makeRequest('/api/v1/health', 'GET', null, { endpoint: 'health' });

  const success = check(response, {
    'Health Check: status is 200': r => r.status === 200,
    'Health Check: status is healthy': r => {
      try {
        const data = JSON.parse(r.body);
        return data.status === 'healthy';
      } catch {
        return false;
      }
    },
  });

  if (!success) errorRate.add(1);
}

function testPlaylistOperations() {
  // List playlists
  const listResponse = makeRequest('/api/v1/playlists?limit=10', 'GET', null, {
    endpoint: 'list_playlists',
  });

  const listSuccess = check(listResponse, {
    'List Playlists: status is 200': r => r.status === 200,
    'List Playlists: returns paginated data': r => {
      try {
        const data = JSON.parse(r.body);
        return Array.isArray(data) || (data && Array.isArray(data.items));
      } catch {
        return false;
      }
    },
  });

  if (!listSuccess) errorRate.add(1);

  // Create playlist (if authenticated) - test creation only
  if (API_SECRET) {
    const playlistData = generatePlaylistData(Math.floor(Math.random() * 1000));
    const createResponse = makeRequest('/api/v1/playlists', 'POST', playlistData, {
      endpoint: 'create_playlist',
    });

    const createSuccess = check(createResponse, {
      'Create Playlist: status is 201': r => r.status === 201,
      'Create Playlist: returns playlist with ID': r => {
        try {
          const data = JSON.parse(r.body);
          return data.id && data.title;
        } catch {
          return false;
        }
      },
    });

    if (!createSuccess) errorRate.add(1);
  }

  // Test GET and UPDATE operations using cached playlists (to avoid KV async issues)
  if (cachedPlaylists.length > 0) {
    const existingPlaylist = cachedPlaylists[Math.floor(Math.random() * cachedPlaylists.length)];

    // Get playlist by ID
    const getResponse = makeRequest(`/api/v1/playlists/${existingPlaylist.id}`, 'GET', null, {
      endpoint: 'get_playlist',
    });

    const getSuccess = check(getResponse, {
      'Get Playlist: status is 200': r => r.status === 200,
      'Get Playlist: returns correct playlist': r => {
        try {
          const data = JSON.parse(r.body);
          return data.id === existingPlaylist.id;
        } catch {
          return false;
        }
      },
    });

    if (!getSuccess) errorRate.add(1);

    // Update playlist (if authenticated)
    if (API_SECRET) {
      const updateData = {
        title: `Updated ${existingPlaylist.title.slice(0, 64)} - ${Date.now()}`,
        items: existingPlaylist.items || [],
      };

      const updateResponse = makeRequest(
        `/api/v1/playlists/${existingPlaylist.id}`,
        'PATCH',
        updateData,
        { endpoint: 'update_playlist' }
      );

      const updateSuccess = check(updateResponse, {
        'Update Playlist: status is 200': r => r.status === 200,
        'Update Playlist: title updated': r => {
          try {
            const data = JSON.parse(r.body);
            return data.title.includes('Updated');
          } catch {
            return false;
          }
        },
      });

      if (!updateSuccess) errorRate.add(1);
    }
  }
}

function testChannelOperations() {
  // List channels
  const listResponse = makeRequest('/api/v1/channels?limit=10', 'GET', null, {
    endpoint: 'list_channels',
  });

  const listSuccess = check(listResponse, {
    'List Channels: status is 200': r => r.status === 200,
    'List Channels: returns paginated data': r => {
      try {
        const data = JSON.parse(r.body);
        return Array.isArray(data) || (data && Array.isArray(data.items));
      } catch {
        return false;
      }
    },
  });

  if (!listSuccess) errorRate.add(1);

  // Create channel (if authenticated and have playlists) - test creation only
  if (API_SECRET && cachedPlaylists.length >= 2) {
    const channelData = generateChannelData(Math.floor(Math.random() * 1000));
    const createResponse = makeRequest('/api/v1/channels', 'POST', channelData, {
      endpoint: 'create_channel',
    });

    const createSuccess = check(createResponse, {
      'Create Channel: status is 201': r => r.status === 201,
      'Create Channel: returns channel with ID': r => {
        try {
          const data = JSON.parse(r.body);
          return data.id && data.title;
        } catch {
          return false;
        }
      },
    });

    if (!createSuccess) errorRate.add(1);
  }

  // Test GET and UPDATE operations using cached channels (to avoid KV async issues)
  if (cachedChannels.length > 0) {
    const existingChannel = cachedChannels[Math.floor(Math.random() * cachedChannels.length)];

    // Get channel by ID
    const getResponse = makeRequest(`/api/v1/channels/${existingChannel.id}`, 'GET', null, {
      endpoint: 'get_channel',
    });

    const getSuccess = check(getResponse, {
      'Get Channel: status is 200': r => r.status === 200,
      'Get Channel: returns correct channel': r => {
        try {
          const data = JSON.parse(r.body);
          return data.id === existingChannel.id;
        } catch {
          return false;
        }
      },
    });

    if (!getSuccess) errorRate.add(1);

    // Update channel (if authenticated)
    if (API_SECRET) {
      const updateData = {
        title: `Updated ${existingChannel.title.slice(0, 64)} - ${Date.now()}`,
        curator: existingChannel.curator || `Updated Curator - ${Date.now()}`,
        playlists: existingChannel.playlists || [],
      };

      const updateResponse = makeRequest(
        `/api/v1/channels/${existingChannel.id}`,
        'PATCH',
        updateData,
        { endpoint: 'update_channel' }
      );

      const updateSuccess = check(updateResponse, {
        'Update Channel: status is 200': r => r.status === 200,
        'Update Channel: title updated': r => {
          try {
            const data = JSON.parse(r.body);
            return data.title.includes('Updated');
          } catch {
            return false;
          }
        },
      });

      if (!updateSuccess) errorRate.add(1);
    }
  }
}

function testPlaylistItems() {
  // List all playlist items
  const listResponse = makeRequest('/api/v1/playlist-items?limit=10', 'GET', null, {
    endpoint: 'list_items',
  });

  const listSuccess = check(listResponse, {
    'List Items: status is 200': r => r.status === 200,
    'List Items: returns paginated data': r => {
      try {
        const data = JSON.parse(r.body);
        return Array.isArray(data) || (data && Array.isArray(data.items));
      } catch {
        return false;
      }
    },
  });

  if (!listSuccess) errorRate.add(1);

  // Test getting individual playlist items from the list response (to avoid KV async issues)
  if (listResponse.status === 200) {
    try {
      const responseData = JSON.parse(listResponse.body);
      const items = Array.isArray(responseData) ? responseData : responseData.items || [];

      if (items.length > 0) {
        const randomItem = items[Math.floor(Math.random() * items.length)];
        if (randomItem && randomItem.id) {
          const getResponse = makeRequest(`/api/v1/playlist-items/${randomItem.id}`, 'GET', null, {
            endpoint: 'get_item',
          });

          const getSuccess = check(getResponse, {
            'Get Item: status is 200': r => r.status === 200,
            'Get Item: returns item': r => {
              try {
                const data = JSON.parse(r.body);
                return data.id === randomItem.id;
              } catch {
                return false;
              }
            },
          });

          if (!getSuccess) errorRate.add(1);
        }
      }
    } catch (error) {
      console.error(`Error in playlist items operations: ${error.message}`);
      errorRate.add(1);
    }
  }
}

// Teardown function - runs once after the test
export function teardown(_data) {
  console.log('🧹 Test completed - K6 benchmark finished');
}
