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
let cachedPlaylistGroups = [];

// Generate realistic test data
function generatePlaylistData(index = 0) {
  return {
    dpVersion: '0.9.0',
    title: `K6 Benchmark Playlist ${index + 1} - ${Date.now()}`,
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

function generatePlaylistGroupData(index = 0) {
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
    summary: `K6 benchmark test playlist group (${index + 1})`,
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
  if (['POST', 'PUT', 'DELETE'].includes(method) && API_SECRET) {
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
    const playlistsResponse = makeRequest('/api/v1/playlists', 'GET', null, { setup: 'true' });

    if (playlistsResponse.status === 200) {
      const responseData = JSON.parse(playlistsResponse.body);
      const playlists = Array.isArray(responseData) ? responseData : responseData.items || [];
      if (Array.isArray(playlists)) {
        cachedPlaylists = playlists;
        console.log(`✅ Found ${cachedPlaylists.length} existing playlists`);
      }
    }

    // Create additional playlists if needed
    const playlistsNeeded = Math.max(2 - cachedPlaylists.length, 2);
    if (playlistsNeeded > 0) {
      console.log(`📝 Creating ${playlistsNeeded} additional playlists for testing...`);

      for (let i = 0; i < playlistsNeeded; i++) {
        const playlistData = generatePlaylistData(i + 3000); // High index to avoid conflicts
        console.log(`📤 Sending playlist data: ${JSON.stringify(playlistData)}`);
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
            console.log(`❌ Error body: ${response.body}`);
          }
        }

        sleep(0.1); // Small delay between creations
      }
    }

    // Fetch existing playlist groups
    console.log('📥 Fetching existing playlist groups...');
    const groupsResponse = makeRequest('/api/v1/playlist-groups', 'GET', null, { setup: 'true' });

    if (groupsResponse.status === 200) {
      const responseData = JSON.parse(groupsResponse.body);
      const groups = Array.isArray(responseData) ? responseData : responseData.items || [];
      if (Array.isArray(groups)) {
        cachedPlaylistGroups = groups;
        console.log(`✅ Found ${cachedPlaylistGroups.length} existing playlist groups`);
      }
    }

    const setupTime = Date.now() - setupStart;
    setupDuration.add(setupTime);

    console.log(`🎯 Setup completed in ${setupTime}ms`);
    console.log(
      `📊 Available for testing: ${cachedPlaylists.length} playlists, ${cachedPlaylistGroups.length} groups`
    );

    return {
      playlists: cachedPlaylists,
      groups: cachedPlaylistGroups,
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
  cachedPlaylistGroups = data.groups || [];

  // Test API info endpoint
  testAPIInfo();

  // Test health endpoint
  testHealthCheck();

  // Test playlist operations
  testPlaylistOperations();

  // Test playlist group operations
  testPlaylistGroupOperations();

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

  let listSuccess = check(listResponse, {
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

  // Create playlist (if authenticated)
  if (API_SECRET) {
    const playlistData = generatePlaylistData(Math.floor(Math.random() * 1000));
    const createResponse = makeRequest('/api/v1/playlists', 'POST', playlistData, {
      endpoint: 'create_playlist',
    });

    let createSuccess = check(createResponse, {
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

    // If creation successful, test get and update
    if (createResponse.status === 201) {
      try {
        const createdPlaylist = JSON.parse(createResponse.body);

        // Get playlist by ID
        const getResponse = makeRequest(`/api/v1/playlists/${createdPlaylist.id}`, 'GET', null, {
          endpoint: 'get_playlist',
        });

        let getSuccess = check(getResponse, {
          'Get Playlist: status is 200': r => r.status === 200,
          'Get Playlist: returns correct playlist': r => {
            try {
              const data = JSON.parse(r.body);
              return data.id === createdPlaylist.id;
            } catch {
              return false;
            }
          },
        });

        if (!getSuccess) errorRate.add(1);

        // Update playlist
        const updateData = {
          title: `Updated ${createdPlaylist.title}`,
          items: playlistData.items,
        };

        const updateResponse = makeRequest(
          `/api/v1/playlists/${createdPlaylist.id}`,
          'PUT',
          updateData,
          { endpoint: 'update_playlist' }
        );

        let updateSuccess = check(updateResponse, {
          'Update Playlist: status is 200': r => r.status === 200,
          'Update Playlist: title updated': r => {
            try {
              const data = JSON.parse(r.body);
              return data.title.startsWith('Updated');
            } catch {
              return false;
            }
          },
        });

        if (!updateSuccess) errorRate.add(1);
      } catch (error) {
        console.error(`Error in playlist operations: ${error.message}`);
        errorRate.add(1);
      }
    }
  } else {
    // Test with existing playlist if available
    if (cachedPlaylists.length > 0) {
      const playlist = cachedPlaylists[Math.floor(Math.random() * cachedPlaylists.length)];
      const getResponse = makeRequest(`/api/v1/playlists/${playlist.id}`, 'GET', null, {
        endpoint: 'get_playlist',
      });

      let getSuccess = check(getResponse, {
        'Get Existing Playlist: status is 200': r => r.status === 200,
      });

      if (!getSuccess) errorRate.add(1);
    }
  }
}

function testPlaylistGroupOperations() {
  // List playlist groups
  const listResponse = makeRequest('/api/v1/playlist-groups?limit=10', 'GET', null, {
    endpoint: 'list_groups',
  });

  let listSuccess = check(listResponse, {
    'List Groups: status is 200': r => r.status === 200,
    'List Groups: returns paginated data': r => {
      try {
        const data = JSON.parse(r.body);
        return Array.isArray(data) || (data && Array.isArray(data.items));
      } catch {
        return false;
      }
    },
  });

  if (!listSuccess) errorRate.add(1);

  // Create playlist group (if authenticated and have playlists)
  if (API_SECRET && cachedPlaylists.length >= 2) {
    const groupData = generatePlaylistGroupData(Math.floor(Math.random() * 1000));
    const createResponse = makeRequest('/api/v1/playlist-groups', 'POST', groupData, {
      endpoint: 'create_group',
    });

    let createSuccess = check(createResponse, {
      'Create Group: status is 201': r => r.status === 201,
      'Create Group: returns group with ID': r => {
        try {
          const data = JSON.parse(r.body);
          return data.id && data.title;
        } catch {
          return false;
        }
      },
    });

    if (!createSuccess) errorRate.add(1);

    // If creation successful, test get and update
    if (createResponse.status === 201) {
      try {
        const createdGroup = JSON.parse(createResponse.body);

        // Get group by ID
        const getResponse = makeRequest(`/api/v1/playlist-groups/${createdGroup.id}`, 'GET', null, {
          endpoint: 'get_group',
        });

        let getSuccess = check(getResponse, {
          'Get Group: status is 200': r => r.status === 200,
          'Get Group: returns correct group': r => {
            try {
              const data = JSON.parse(r.body);
              return data.id === createdGroup.id;
            } catch {
              return false;
            }
          },
        });

        if (!getSuccess) errorRate.add(1);

        // Update group
        const updateData = {
          title: `Updated ${createdGroup.title}`,
          curator: createdGroup.curator,
          playlists: groupData.playlists,
        };

        const updateResponse = makeRequest(
          `/api/v1/playlist-groups/${createdGroup.id}`,
          'PUT',
          updateData,
          { endpoint: 'update_group' }
        );

        let updateSuccess = check(updateResponse, {
          'Update Group: status is 200': r => r.status === 200,
          'Update Group: title updated': r => {
            try {
              const data = JSON.parse(r.body);
              return data.title.startsWith('Updated');
            } catch {
              return false;
            }
          },
        });

        if (!updateSuccess) errorRate.add(1);
      } catch (error) {
        console.error(`Error in playlist group operations: ${error.message}`);
        errorRate.add(1);
      }
    }
  } else {
    // Test with existing group if available
    if (cachedPlaylistGroups.length > 0) {
      const group = cachedPlaylistGroups[Math.floor(Math.random() * cachedPlaylistGroups.length)];
      const getResponse = makeRequest(`/api/v1/playlist-groups/${group.id}`, 'GET', null, {
        endpoint: 'get_group',
      });

      let getSuccess = check(getResponse, {
        'Get Existing Group: status is 200': r => r.status === 200,
      });

      if (!getSuccess) errorRate.add(1);
    }
  }
}

function testPlaylistItems() {
  // List all playlist items
  const listResponse = makeRequest('/api/v1/playlist-items', 'GET', null, {
    endpoint: 'list_items',
  });

  let listSuccess = check(listResponse, {
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

  // Test getting individual playlist items if we have playlists
  if (cachedPlaylists.length > 0) {
    const playlist = cachedPlaylists[Math.floor(Math.random() * cachedPlaylists.length)];
    if (playlist.items && playlist.items.length > 0) {
      const item = playlist.items[Math.floor(Math.random() * playlist.items.length)];
      const getResponse = makeRequest(`/api/v1/playlist-items/${item.id}`, 'GET', null, {
        endpoint: 'get_item',
      });

      let getSuccess = check(getResponse, {
        'Get Item: status is 200': r => r.status === 200,
        'Get Item: returns item': r => {
          try {
            const data = JSON.parse(r.body);
            return data.id === item.id;
          } catch {
            return false;
          }
        },
      });

      if (!getSuccess) errorRate.add(1);
    }
  }
}

// Teardown function - runs once after the test
export function teardown(data) {
  console.log('🧹 Test completed - K6 benchmark finished');
}
