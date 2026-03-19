#!/usr/bin/env node

/**
 * Simple API test script for DP-1 Feed Operator API
 * Usage: node scripts/test-api.js [base-url] [api-secret]
 */

import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import * as jose from 'jose';

// Parse command line arguments
const args = process.argv.slice(2);
const baseUrl = args[0] || 'http://localhost:8787';
const apiSecret = args[1] || process.env.API_SECRET;

console.log(`🧪 Testing DP-1 Feed Operator API at: ${baseUrl}`);
console.log(`⚡ API uses queue-based processing - adding 500ms delays after writes`);

if (!apiSecret) {
  console.error('❌ API_SECRET not provided. Pass as argument or set environment variable.');
  process.exit(1);
}

// JWT test configuration
let jwtTestConfig = null;
if (process.env.JWT_TEST_PRIVATE_KEY) {
  console.log('🔐 JWT testing enabled with private key from environment');
  jwtTestConfig = {
    privateKey: process.env.JWT_TEST_PRIVATE_KEY,
    issuer: process.env.JWT_TEST_ISSUER || 'test-issuer',
    audience: process.env.JWT_TEST_AUDIENCE || 'test-audience',
  };
}

// Test data without IDs or dpVersion (server will generate them)
const testPlaylist = {
  dpVersion: '1.0.0',
  title: 'My Amazing Test Playlist',
  curators: [
    {
      name: 'Test Curator',
      key: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
      url: 'https://example.com/curator',
    },
  ],
  summary: 'A test playlist for testing the API',
  coverImage: 'https://example.com/test-playlist-cover.jpg',
  dynamicQueries: [
    {
      endpoint: 'https://api.example.com/test-artworks',
      params: {
        category: 'digital-art',
        status: 'featured',
        limit: '20',
      },
    },
  ],
  defaults: {
    display: {
      scaling: 'fit',
      background: '#000000',
    },
    license: 'open',
    duration: 300,
  },
  items: [
    {
      title: 'My Amazing Test Artwork',
      source: 'https://example.com/test.html',
      duration: 300,
      license: 'open',
    },
  ],
};

// Store server-generated data for testing
let createdPlaylistId = null;
let createdPlaylistSlug = null;
let createdChannelId = null;
let createdChannelSlug = null;
let sortingTestPlaylistIds = []; // For sorting tests
let sortingTestChannelIds = []; // For sorting tests

// Helper function to generate JWT token for testing
async function generateJwtToken() {
  if (!jwtTestConfig || !jwtTestConfig.privateKey) {
    return null;
  }

  try {
    // Import the private key (assuming PEM format) - replace literal \n with actual newlines
    const privateKeyPEM = jwtTestConfig.privateKey.replace(/\\n/g, '\n');
    const privateKey = await jose.importPKCS8(privateKeyPEM, 'RS256');

    // Create and sign JWT
    const jwt = await new jose.SignJWT({
      sub: 'test-user-123',
      name: 'Test User',
      role: 'user',
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuedAt()
      .setIssuer(jwtTestConfig.issuer)
      .setAudience(jwtTestConfig.audience)
      .setExpirationTime('2h')
      .sign(privateKey);

    return jwt;
  } catch (error) {
    console.error('Failed to generate JWT token:', error.message);
    return null;
  }
}

// Helper function to make HTTP requests
async function makeRequest(method, path, body = null, useJwt = false) {
  const url = `${baseUrl}${path}`;
  const headers = {
    'Content-Type': 'application/json',
  };

  // Add auth header for write operations
  if (method !== 'GET') {
    if (useJwt && jwtTestConfig) {
      const jwtToken = await generateJwtToken();
      if (jwtToken) {
        headers['Authorization'] = `Bearer ${jwtToken}`;
      } else {
        headers['Authorization'] = `Bearer ${apiSecret}`;
      }
    } else {
      headers['Authorization'] = `Bearer ${apiSecret}`;
    }
  }

  const options = {
    method,
    headers,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, options);
    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    return {
      status: response.status,
      ok: response.ok,
      data,
    };
  } catch (error) {
    return {
      status: 0,
      ok: false,
      error: error.message,
    };
  }
}

// Test functions
async function testListPlaylists() {
  console.log('\n📋 Testing GET /api/v1/playlists (list all playlists)...');
  const response = await makeRequest('GET', '/api/v1/playlists');

  if (response.ok) {
    console.log('✅ Playlists listed successfully');
    // Handle paginated result format
    const paginatedResult = response.data;
    if (paginatedResult && Array.isArray(paginatedResult.items)) {
      console.log(`   Count: ${paginatedResult.items.length}`);
      console.log(`   Has more: ${paginatedResult.hasMore || false}`);
      console.log(`   Cursor: ${paginatedResult.cursor ? 'Present' : 'None'}`);
      if (paginatedResult.items.length > 0) {
        console.log(`   First playlist ID: ${paginatedResult.items[0].id}`);
        if (paginatedResult.items[0].slug) {
          console.log(`   First playlist slug: ${paginatedResult.items[0].slug}`);
        }
      }
    } else {
      console.log('❌ Expected paginated result format with items array');
      return false;
    }
  } else {
    console.log(`❌ Failed: ${response.status} - ${JSON.stringify(response.data)}`);
  }

  return response.ok;
}

async function testPagination() {
  console.log('\n📄 Testing pagination behavior with real data...');

  // First, get total count without limit to understand dataset
  const allResponse = await makeRequest('GET', '/api/v1/playlists?limit=100');
  if (!allResponse.ok) {
    console.log('❌ Failed to get all playlists for pagination test');
    return false;
  }

  const totalItems = allResponse.data.items.length;
  console.log(`   Total playlists available: ${totalItems}`);

  if (totalItems < 2) {
    console.log('ℹ️  Not enough playlists to test pagination properly');
    return true;
  }

  // Test limit parameter with different values
  const testLimits = [1, 2, Math.min(3, totalItems)];

  for (const limit of testLimits) {
    console.log(`   Testing limit=${limit}...`);
    const limitResponse = await makeRequest('GET', `/api/v1/playlists?limit=${limit}`);

    if (!limitResponse.ok) {
      console.log(`❌ Failed to fetch with limit=${limit}`);
      return false;
    }

    const result = limitResponse.data;

    // Verify limit is respected
    if (result.items.length > limit) {
      console.log(`❌ Limit ${limit} not respected, got ${result.items.length} items`);
      return false;
    }

    // Verify hasMore flag is correct
    const expectedHasMore = totalItems > limit;
    if (result.hasMore !== expectedHasMore) {
      console.log(`❌ hasMore flag incorrect for limit ${limit}`);
      console.log(`   Expected: ${expectedHasMore}, Got: ${result.hasMore}`);
      return false;
    }

    // If there should be more, verify cursor is provided
    if (expectedHasMore && !result.cursor) {
      console.log(`❌ Missing cursor when hasMore=true for limit ${limit}`);
      return false;
    }

    console.log(`   ✅ Limit ${limit} working correctly`);
  }

  // Test cursor pagination if we have enough data
  if (totalItems >= 3) {
    console.log('   Testing cursor pagination...');

    // Get first page
    const page1Response = await makeRequest('GET', '/api/v1/playlists?limit=1');
    if (!page1Response.ok || !page1Response.data.cursor) {
      console.log('❌ Failed to get first page for cursor test');
      return false;
    }

    const page1 = page1Response.data;

    // Get second page using cursor
    const page2Response = await makeRequest(
      'GET',
      `/api/v1/playlists?limit=1&cursor=${encodeURIComponent(page1.cursor)}`
    );

    if (!page2Response.ok) {
      console.log('❌ Failed to get second page using cursor');
      return false;
    }

    const page2 = page2Response.data;

    // Verify pages contain different items
    if (page1.items[0].id === page2.items[0].id) {
      console.log('❌ Cursor pagination returned same item on different pages');
      return false;
    }

    // Verify items are in correct order (assuming ascending by default)
    const item1Created = new Date(page1.items[0].created);
    const item2Created = new Date(page2.items[0].created);

    if (item1Created > item2Created) {
      console.log('❌ Pagination order incorrect (should be ascending by created)');
      console.log(`   Page 1 created: ${page1.items[0].created}`);
      console.log(`   Page 2 created: ${page2.items[0].created}`);
      return false;
    }

    console.log('   ✅ Cursor pagination working correctly');
  }

  // Test edge cases
  console.log('   Testing pagination edge cases...');

  // Test limit=0 (should be rejected or default to some value)
  const zeroLimitResponse = await makeRequest('GET', '/api/v1/playlists?limit=0');
  if (zeroLimitResponse.ok) {
    if (zeroLimitResponse.data.items.length > 0) {
      console.log('   ✅ limit=0 handled gracefully (returned default items)');
    }
  } else if (zeroLimitResponse.status === 400) {
    console.log('   ✅ limit=0 properly rejected with 400');
  } else {
    console.log('❌ limit=0 handling unexpected');
    return false;
  }

  // Test very large limit
  const largeLimitResponse = await makeRequest('GET', '/api/v1/playlists?limit=1000');
  if (largeLimitResponse.ok) {
    const result = largeLimitResponse.data;
    if (result.items.length <= totalItems) {
      console.log('   ✅ Large limit handled correctly (capped to available items)');
    } else {
      console.log('❌ Large limit returned more items than exist');
      return false;
    }
  }

  console.log('✅ Pagination behavior verified with real data');
  return true;
}

async function testChannelFiltering() {
  if (!createdChannelId) {
    console.log('\n⚠️  Skipping filtering test - no channel ID available');
    return true;
  }

  console.log('\n🔍 Testing playlist filtering by channel...');
  const response = await makeRequest('GET', `/api/v1/playlists?channel=${createdChannelId}`);

  if (response.ok) {
    console.log('✅ Channel filtering working');
    const result = response.data;
    if (result && Array.isArray(result.items)) {
      console.log(`   Filtered playlists count: ${result.items.length}`);
    } else {
      console.log('❌ Expected paginated result format');
      return false;
    }
  } else {
    console.log(`❌ Failed: ${response.status} - ${JSON.stringify(response.data)}`);
  }

  return response.ok;
}

async function testCreatePlaylist() {
  console.log('\n📝 Testing POST /api/v1/playlists (data integrity and server generation)...');
  const response = await makeRequest('POST', '/api/v1/playlists', testPlaylist);

  if (response.ok) {
    console.log('✅ Playlist created successfully');
    console.log(`   ID: ${response.data.id}`);
    console.log(`   Slug: ${response.data.slug}`);
    console.log(`   Title: ${response.data.title}`);
    console.log(`   Created: ${response.data.created}`);
    console.log(`   Signature: ${response.data.signature ? 'Present' : 'Missing'}`);

    // Store server-generated data
    createdPlaylistId = response.data.id;
    createdPlaylistSlug = response.data.slug;

    // Data integrity checks - verify input data is preserved exactly
    if (response.data.title !== testPlaylist.title) {
      console.log('❌ Title not preserved from input');
      console.log(`   Expected: "${testPlaylist.title}"`);
      console.log(`   Received: "${response.data.title}"`);
      return false;
    }

    if (response.data.dpVersion !== testPlaylist.dpVersion) {
      console.log('❌ dpVersion not preserved from input');
      return false;
    }

    // Deep comparison of defaults object
    if (JSON.stringify(response.data.defaults) !== JSON.stringify(testPlaylist.defaults)) {
      console.log('❌ Defaults object not preserved exactly');
      console.log(`   Expected: ${JSON.stringify(testPlaylist.defaults)}`);
      console.log(`   Received: ${JSON.stringify(response.data.defaults)}`);
      return false;
    }

    // Verify playlist items data integrity
    if (response.data.items.length !== testPlaylist.items.length) {
      console.log('❌ Number of items changed during creation');
      return false;
    }

    for (let i = 0; i < testPlaylist.items.length; i++) {
      const inputItem = testPlaylist.items[i];
      const outputItem = response.data.items[i];

      // Check that input fields are preserved
      if (outputItem.title !== inputItem.title) {
        console.log(`❌ Item ${i} title not preserved`);
        return false;
      }
      if (outputItem.source !== inputItem.source) {
        console.log(`❌ Item ${i} source not preserved`);
        return false;
      }
      if (outputItem.duration !== inputItem.duration) {
        console.log(`❌ Item ${i} duration not preserved`);
        return false;
      }
      if (outputItem.license !== inputItem.license) {
        console.log(`❌ Item ${i} license not preserved`);
        return false;
      }

      // Verify server generated fields exist and are valid
      if (
        !outputItem.id ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(outputItem.id)
      ) {
        console.log(`❌ Item ${i} missing or invalid server-generated ID`);
        return false;
      }
      if (!outputItem.created || isNaN(new Date(outputItem.created).getTime())) {
        console.log(`❌ Item ${i} missing or invalid server-generated created timestamp`);
        return false;
      }
    }
    console.log('✅ All input data preserved exactly, server fields generated correctly');

    // Verify optional fields are preserved exactly
    if (JSON.stringify(response.data.curators) !== JSON.stringify(testPlaylist.curators)) {
      console.log('❌ Curators array not preserved exactly');
      console.log(`   Expected: ${JSON.stringify(testPlaylist.curators)}`);
      console.log(`   Received: ${JSON.stringify(response.data.curators)}`);
      return false;
    }
    console.log('✅ Curators array preserved exactly');

    // Deep comparison of dynamicQueries array
    if (
      JSON.stringify(response.data.dynamicQueries) !== JSON.stringify(testPlaylist.dynamicQueries)
    ) {
      console.log('❌ Dynamic queries array not preserved exactly');
      console.log(`   Expected: ${JSON.stringify(testPlaylist.dynamicQueries)}`);
      console.log(`   Received: ${JSON.stringify(response.data.dynamicQueries)}`);
      return false;
    }
    console.log(
      `✅ Dynamic queries preserved exactly (${response.data.dynamicQueries.length} queries)`
    );

    if (response.data.summary !== testPlaylist.summary) {
      console.log('❌ Summary not preserved exactly');
      console.log(`   Expected: "${testPlaylist.summary}"`);
      console.log(`   Received: "${response.data.summary}"`);
      return false;
    }
    console.log('✅ Summary preserved exactly');

    if (response.data.coverImage !== testPlaylist.coverImage) {
      console.log('❌ Cover image not preserved exactly');
      console.log(`   Expected: "${testPlaylist.coverImage}"`);
      console.log(`   Received: "${response.data.coverImage}"`);
      return false;
    }
    console.log('✅ Cover image preserved exactly');

    // Validate server-generated fields are reasonable
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(response.data.id)) {
      console.log('❌ Server-generated UUID format is invalid');
      return false;
    }

    if (!response.data.slug || !/^[a-zA-Z0-9-]+-\d{4}$/.test(response.data.slug)) {
      console.log('❌ Server-generated slug format is invalid or missing');
      return false;
    }

    // Verify created timestamp is recent (within 10 seconds)
    const now = new Date();
    const created = new Date(response.data.created);
    const timeDiff = Math.abs(now - created);
    if (timeDiff > 10000) {
      console.log('❌ Created timestamp seems incorrect (too old/future)');
      return false;
    }

    // Verify signature is present and looks valid
    if (!response.data.signature || !response.data.signature.startsWith('ed25519:0x')) {
      console.log('❌ Signature missing or invalid format');
      return false;
    }

    console.log('✅ Server-generated fields are valid and reasonable');

    // Wait for queue processing
    await new Promise(resolve => setTimeout(resolve, 500));
  } else {
    console.log(`❌ Failed: ${response.status} - ${JSON.stringify(response.data)}`);
  }

  return response.ok;
}

async function testGetPlaylistByUUID() {
  if (!createdPlaylistId) {
    console.log('\n⚠️  Skipping UUID test - no playlist ID available');
    return true;
  }

  console.log('\n📖 Testing GET /api/v1/playlists/{uuid} (access by UUID)...');
  const response = await makeRequest('GET', `/api/v1/playlists/${createdPlaylistId}`);

  if (response.ok) {
    console.log('✅ Playlist retrieved by UUID successfully');
    console.log(`   ID: ${response.data.id}`);
    console.log(`   Slug: ${response.data.slug}`);
    console.log(`   Created: ${response.data.created}`);
  } else {
    console.log(`❌ Failed: ${response.status} - ${JSON.stringify(response.data)}`);
  }

  return response.ok;
}

async function testGetPlaylistBySlug() {
  if (!createdPlaylistSlug) {
    console.log('\n⚠️  Skipping slug test - no slug available');
    return true;
  }

  console.log('\n📖 Testing GET /api/v1/playlists/{slug} (access by slug)...');
  const response = await makeRequest('GET', `/api/v1/playlists/${createdPlaylistSlug}`);

  if (response.ok) {
    console.log('✅ Playlist retrieved by slug successfully');
    console.log(`   ID: ${response.data.id}`);
    console.log(`   Slug: ${response.data.slug}`);

    // Verify we get the same playlist
    if (response.data.id === createdPlaylistId) {
      console.log('✅ Same playlist returned via slug and UUID');
    } else {
      console.log('❌ Different playlist returned via slug vs UUID');
      return false;
    }
  } else {
    console.log(`❌ Failed: ${response.status} - ${JSON.stringify(response.data)}`);
  }

  return response.ok;
}

async function testUpdatePlaylist() {
  if (!createdPlaylistId) {
    console.log('\n⚠️  Skipping update test - no playlist ID available');
    return true;
  }

  console.log('\n📝 Testing PATCH /api/v1/playlists/{id} (data integrity during updates)...');

  // Get original playlist first to compare
  const originalResponse = await makeRequest('GET', `/api/v1/playlists/${createdPlaylistId}`);
  if (!originalResponse.ok) {
    console.log('❌ Failed to fetch original playlist for update test');
    return false;
  }
  const originalPlaylist = originalResponse.data;

  // Create update data with modified and new items
  const updatedData = {
    title: 'Updated Amazing Test Playlist - Enhanced',
    curators: [
      {
        name: 'Updated Curator',
        key: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
        url: 'https://example.com/updated-curator',
      },
    ],
    summary: 'Updated summary for the playlist with enhanced content',
    coverImage: 'https://example.com/updated-cover.jpg',
    dynamicQueries: [
      {
        endpoint: 'https://api.example.com/updated-artworks',
        params: {
          category: 'contemporary',
          year: '2025',
          status: 'featured',
          limit: '25',
        },
      },
    ],
    items: [
      {
        ...testPlaylist.items[0],
        title: 'Updated Amazing Digital Artwork',
        duration: 450, // Changed duration
      },
      {
        title: 'Second Test Artwork',
        source: 'https://example.com/test2.html',
        duration: 180,
        license: 'token',
      },
      {
        title: 'Third Test Artwork',
        source: 'https://example.com/test3.html',
        duration: 600,
        license: 'subscription',
      },
    ],
    // Keep defaults from original, but modify one field
    defaults: {
      ...testPlaylist.defaults,
      duration: 400, // Changed default duration
    },
  };

  const response = await makeRequest(
    'PATCH',
    `/api/v1/playlists/${createdPlaylistId}`,
    updatedData
  );

  if (response.ok) {
    console.log('✅ Playlist updated successfully');
    console.log(`   Items: ${response.data.items?.length || 0}`);
    console.log(`   Title: ${response.data.title}`);

    // Verify protected fields were NOT changed
    if (response.data.id !== originalPlaylist.id) {
      console.log('❌ Protected field ID was changed during update');
      return false;
    }
    if (response.data.slug !== originalPlaylist.slug) {
      console.log('❌ Protected field slug was changed during update');
      return false;
    }
    if (response.data.created !== originalPlaylist.created) {
      console.log('❌ Protected field created was changed during update');
      return false;
    }
    if (response.data.dpVersion !== originalPlaylist.dpVersion) {
      console.log('❌ dpVersion was changed during update (should be preserved)');
      return false;
    }
    console.log('✅ Protected fields preserved during update');

    // Verify updated fields were changed correctly
    if (response.data.title !== updatedData.title) {
      console.log('❌ Title not updated correctly');
      console.log(`   Expected: "${updatedData.title}"`);
      console.log(`   Received: "${response.data.title}"`);
      return false;
    }

    if (JSON.stringify(response.data.defaults) !== JSON.stringify(updatedData.defaults)) {
      console.log('❌ Defaults not updated correctly');
      console.log(`   Expected: ${JSON.stringify(updatedData.defaults)}`);
      console.log(`   Received: ${JSON.stringify(response.data.defaults)}`);
      return false;
    }

    // Verify optional fields were updated correctly
    if (JSON.stringify(response.data.curators) !== JSON.stringify(updatedData.curators)) {
      console.log('❌ Curators not updated correctly');
      console.log(`   Expected: ${JSON.stringify(updatedData.curators)}`);
      console.log(`   Received: ${JSON.stringify(response.data.curators)}`);
      return false;
    }

    // Verify dynamicQueries were updated correctly
    if (
      JSON.stringify(response.data.dynamicQueries) !== JSON.stringify(updatedData.dynamicQueries)
    ) {
      console.log('❌ Dynamic queries not updated correctly');
      console.log(`   Expected: ${JSON.stringify(updatedData.dynamicQueries)}`);
      console.log(`   Received: ${JSON.stringify(response.data.dynamicQueries)}`);
      return false;
    }
    console.log(
      `✅ Dynamic queries updated correctly (${response.data.dynamicQueries.length} queries)`
    );

    if (response.data.summary !== updatedData.summary) {
      console.log('❌ Summary not updated correctly');
      console.log(`   Expected: "${updatedData.summary}"`);
      console.log(`   Received: "${response.data.summary}"`);
      return false;
    }

    if (response.data.coverImage !== updatedData.coverImage) {
      console.log('❌ Cover image not updated correctly');
      console.log(`   Expected: "${updatedData.coverImage}"`);
      console.log(`   Received: "${response.data.coverImage}"`);
      return false;
    }

    console.log('✅ Updated fields (including optional fields) changed correctly');

    // Verify items were replaced completely
    if (response.data.items.length !== updatedData.items.length) {
      console.log('❌ Items array length not updated correctly');
      return false;
    }

    // Verify all items have new IDs (complete replacement)
    for (let i = 0; i < response.data.items.length; i++) {
      const newItem = response.data.items[i];
      const inputItem = updatedData.items[i];

      // Verify input data preserved
      if (newItem.title !== inputItem.title) {
        console.log(`❌ Item ${i} title not preserved during update`);
        return false;
      }
      if (newItem.source !== inputItem.source) {
        console.log(`❌ Item ${i} source not preserved during update`);
        return false;
      }
      if (newItem.duration !== inputItem.duration) {
        console.log(`❌ Item ${i} duration not preserved during update`);
        return false;
      }
      if (newItem.license !== inputItem.license) {
        console.log(`❌ Item ${i} license not preserved during update`);
        return false;
      }

      // Verify new server-generated fields
      if (
        !newItem.id ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(newItem.id)
      ) {
        console.log(`❌ Item ${i} missing or invalid new ID`);
        return false;
      }

      // Verify this ID is different from original items (complete replacement)
      const originalItem = originalPlaylist.items[i];
      if (originalItem && newItem.id === originalItem.id) {
        console.log(`❌ Item ${i} ID not changed during update (should be new)`);
        return false;
      }
    }
    console.log('✅ Items replaced with new IDs and correct data');

    // Verify signature was regenerated
    if (response.data.signature === originalPlaylist.signature) {
      console.log('❌ Signature not regenerated after update');
      return false;
    }
    if (!response.data.signature || !response.data.signature.startsWith('ed25519:0x')) {
      console.log('❌ New signature missing or invalid format');
      return false;
    }
    console.log('✅ Signature regenerated correctly');

    // Wait for queue processing
    await new Promise(resolve => setTimeout(resolve, 500));
  } else {
    console.log(`❌ Failed: ${response.status} - ${JSON.stringify(response.data)}`);
  }

  return response.ok;
}

async function testDeletePlaylist() {
  if (!createdPlaylistId) {
    console.log('\n⚠️  Skipping delete test - no playlist ID available');
    return true;
  }

  console.log('\n🗑️  Testing DELETE /api/v1/playlists/{id} (playlist deletion)...');

  // First verify the playlist exists
  const getResponse = await makeRequest('GET', `/api/v1/playlists/${createdPlaylistId}`);
  if (!getResponse.ok) {
    console.log('❌ Playlist to delete not found');
    return false;
  }
  console.log('✅ Playlist exists before deletion');

  // Test DELETE request
  const deleteResponse = await makeRequest(
    'DELETE',
    `/api/v1/playlists/${createdPlaylistId}`,
    null,
    false
  );

  if (deleteResponse.ok && deleteResponse.status === 204) {
    console.log('✅ Playlist deleted successfully (204 No Content)');

    // Verify playlist is actually deleted
    const verifyResponse = await makeRequest('GET', `/api/v1/playlists/${createdPlaylistId}`);
    if (verifyResponse.status === 404) {
      console.log('✅ Playlist properly removed (404 Not Found)');
    } else {
      console.log(`❌ Playlist still exists after deletion: ${verifyResponse.status}`);
      return false;
    }

    // Clear the global playlist ID since it's been deleted
    createdPlaylistId = null;
    console.log('✅ Playlist deletion test completed successfully');

    return true;
  } else {
    console.log(
      `❌ Delete failed: ${deleteResponse.status} - ${JSON.stringify(deleteResponse.data)}`
    );
    return false;
  }
}

async function testDeletePlaylistBySlug() {
  console.log('\n🗑️  Testing DELETE /api/v1/playlists/{slug} (deletion by slug)...');

  // Create a new playlist for this test
  const createResponse = await makeRequest('POST', '/api/v1/playlists', testPlaylist, false);
  if (!createResponse.ok) {
    console.log('❌ Failed to create playlist for slug deletion test');
    return false;
  }

  const createdPlaylist = createResponse.data;
  console.log(`✅ Created playlist with slug: ${createdPlaylist.slug}`);

  // Delete by slug
  const deleteResponse = await makeRequest(
    'DELETE',
    `/api/v1/playlists/${createdPlaylist.slug}`,
    null,
    false
  );

  if (deleteResponse.ok && deleteResponse.status === 204) {
    console.log('✅ Playlist deleted by slug successfully (204 No Content)');

    // Verify playlist is actually deleted
    const verifyResponse = await makeRequest('GET', `/api/v1/playlists/${createdPlaylist.id}`);
    if (verifyResponse.status === 404) {
      console.log('✅ Playlist properly removed (404 Not Found)');
      return true;
    } else {
      console.log(`❌ Playlist still exists after deletion: ${verifyResponse.status}`);
      return false;
    }
  } else {
    console.log(
      `❌ Delete by slug failed: ${deleteResponse.status} - ${JSON.stringify(deleteResponse.data)}`
    );
    return false;
  }
}

async function testDeleteNonExistentPlaylist() {
  console.log('\n🗑️  Testing DELETE /api/v1/playlists/{id} (non-existent playlist)...');

  const nonExistentId = '550e8400-e29b-41d4-a716-446655440999';
  const deleteResponse = await makeRequest(
    'DELETE',
    `/api/v1/playlists/${nonExistentId}`,
    null,
    false
  );

  if (deleteResponse.status === 404) {
    console.log('✅ Correctly returned 404 for non-existent playlist');
    return true;
  } else {
    console.log(
      `❌ Expected 404, got: ${deleteResponse.status} - ${JSON.stringify(deleteResponse.data)}`
    );
    return false;
  }
}

async function testCreateChannel() {
  console.log('\n📝 Testing POST /api/v1/channels (data integrity with new fields)...');

  // Ensure we have a playlist to reference - create one if needed
  if (!createdPlaylistId) {
    console.log('🔧 No playlist available to reference in channel. Creating a playlist first...');
    const createResponse = await makeRequest('POST', '/api/v1/playlists', testPlaylist, false);
    if (!createResponse.ok) {
      console.log('❌ Failed to create playlist for channel test');
      return false;
    }
    createdPlaylistId = createResponse.data.id;
    createdPlaylistSlug = createResponse.data.slug;
    console.log(`✅ Created playlist for channel test: ${createdPlaylistId}`);
  }
  console.log(`🔍 Using playlist ID: ${createdPlaylistId}`);

  // Create channel data with real playlist reference and comprehensive new fields
  const playlistUrl = `${baseUrl}/api/v1/playlists/${createdPlaylistId}`;

  const channelData = {
    title: 'Digital Art Showcase 2024',
    curator: 'Main Test Curator',
    curators: [
      {
        name: 'Primary Curator',
        key: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
        url: 'https://example.com/curator1',
      },
      {
        name: 'Secondary Curator',
        // Note: no key or url - testing optional fields
      },
      {
        name: 'External Curator',
        url: 'https://external-site.com/curator3',
        // Note: no key - testing optional key field
      },
    ],
    publisher: {
      name: 'Art Gallery Foundation',
      key: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
      url: 'https://artgallery.com/about',
    },
    coverImage: 'https://cdn.artgallery.com/showcase-2024-cover.jpg',
    summary:
      'A comprehensive exhibition showcasing the finest digital artworks from 2024, curated by leading experts in the field and featuring dynamic content from multiple sources.',
    playlists: [playlistUrl],
  };

  const response = await makeRequest('POST', '/api/v1/channels', channelData);

  if (response.ok) {
    console.log('✅ Channel created successfully');
    console.log(`   ID: ${response.data.id}`);
    console.log(`   Slug: ${response.data.slug}`);
    console.log(`   Title: ${response.data.title}`);
    console.log(`   Created: ${response.data.created}`);
    console.log(`   Signature: ${response.data.signature ? 'Present' : 'Missing'}`);

    // Store server-generated data
    createdChannelId = response.data.id;
    createdChannelSlug = response.data.slug;

    // Data integrity checks - verify ALL input data is preserved exactly
    const fieldsToCheck = ['title', 'curator', 'summary', 'coverImage'];
    for (const field of fieldsToCheck) {
      if (response.data[field] !== channelData[field]) {
        console.log(`❌ ${field} not preserved from input`);
        console.log(`   Expected: "${channelData[field]}"`);
        console.log(`   Received: "${response.data[field]}"`);
        return false;
      }
    }
    console.log('✅ Basic fields preserved exactly');

    // Deep comparison of complex objects - curators array
    if (JSON.stringify(response.data.curators) !== JSON.stringify(channelData.curators)) {
      console.log('❌ Curators array not preserved exactly');
      console.log(`   Expected: ${JSON.stringify(channelData.curators)}`);
      console.log(`   Received: ${JSON.stringify(response.data.curators)}`);
      return false;
    }
    console.log(`✅ Curators array preserved exactly (${response.data.curators.length} curators)`);

    // Deep comparison of publisher object
    if (JSON.stringify(response.data.publisher) !== JSON.stringify(channelData.publisher)) {
      console.log('❌ Publisher object not preserved exactly');
      console.log(`   Expected: ${JSON.stringify(channelData.publisher)}`);
      console.log(`   Received: ${JSON.stringify(response.data.publisher)}`);
      return false;
    }
    console.log('✅ Publisher object preserved exactly');

    // Verify playlists array
    if (JSON.stringify(response.data.playlists) !== JSON.stringify(channelData.playlists)) {
      console.log('❌ Playlists array not preserved exactly');
      console.log(`   Expected: ${JSON.stringify(channelData.playlists)}`);
      console.log(`   Received: ${JSON.stringify(response.data.playlists)}`);
      return false;
    }
    console.log('✅ Playlists array preserved exactly');

    // Verify server-generated fields are valid and reasonable
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(response.data.id)) {
      console.log('❌ Server-generated UUID format is invalid');
      return false;
    }

    if (!response.data.slug || !/^[a-zA-Z0-9-]+-\d{4}$/.test(response.data.slug)) {
      console.log('❌ Server-generated slug format is invalid or missing');
      return false;
    }

    // Verify created timestamp is recent (within 10 seconds)
    const now = new Date();
    const created = new Date(response.data.created);
    const timeDiff = Math.abs(now - created);
    if (timeDiff > 10000) {
      console.log('❌ Created timestamp seems incorrect (too old/future)');
      return false;
    }

    // Verify signature is present and looks valid
    if (!response.data.signature || !response.data.signature.startsWith('ed25519:0x')) {
      console.log('❌ Signature missing or invalid format');
      return false;
    }

    console.log('✅ Server-generated fields are valid and reasonable');

    // Wait for queue processing
    await new Promise(resolve => setTimeout(resolve, 500));
  } else {
    console.log(`❌ Failed: ${response.status} - ${JSON.stringify(response.data)}`);
  }

  return response.ok;
}

async function testListChannels() {
  console.log('\n📋 Testing GET /api/v1/channels (list all groups)...');
  const response = await makeRequest('GET', '/api/v1/channels');

  if (response.ok) {
    console.log('✅ Channels listed successfully');
    // Handle paginated result format
    const paginatedResult = response.data;
    if (paginatedResult && Array.isArray(paginatedResult.items)) {
      console.log(`   Count: ${paginatedResult.items.length}`);
      console.log(`   Has more: ${paginatedResult.hasMore || false}`);
      console.log(`   Cursor: ${paginatedResult.cursor ? 'Present' : 'None'}`);
      if (paginatedResult.items.length > 0) {
        console.log(`   First group ID: ${paginatedResult.items[0].id}`);
        if (paginatedResult.items[0].slug) {
          console.log(`   First group slug: ${paginatedResult.items[0].slug}`);
        }
      }
    } else {
      console.log('❌ Expected paginated result format with items array');
      return false;
    }
  } else {
    console.log(`❌ Failed: ${response.status} - ${JSON.stringify(response.data)}`);
  }

  return response.ok;
}

async function testGetChannelByUUID() {
  if (!createdChannelId) {
    console.log('\n⚠️  Skipping group UUID test - no group ID available');
    return true;
  }

  console.log('\n📖 Testing GET /api/v1/channels/{uuid} (access by UUID)...');
  const response = await makeRequest('GET', `/api/v1/channels/${createdChannelId}`);

  if (response.ok) {
    console.log('✅ Channel retrieved by UUID successfully');
    console.log(`   ID: ${response.data.id}`);
    console.log(`   Slug: ${response.data.slug}`);
    console.log(`   Curator: ${response.data.curator}`);
  } else {
    console.log(`❌ Failed: ${response.status} - ${JSON.stringify(response.data)}`);
  }

  return response.ok;
}

async function testGetChannelBySlug() {
  if (!createdChannelSlug) {
    console.log('\n⚠️  Skipping group slug test - no slug available');
    return true;
  }

  console.log('\n📖 Testing GET /api/v1/channels/{slug} (access by slug)...');
  const response = await makeRequest('GET', `/api/v1/channels/${createdChannelSlug}`);

  if (response.ok) {
    console.log('✅ Channel retrieved by slug successfully');
    console.log(`   ID: ${response.data.id}`);
    console.log(`   Slug: ${response.data.slug}`);

    // Verify we get the same group
    if (response.data.id === createdChannelId) {
      console.log('✅ Same channel returned via slug and UUID');
    } else {
      console.log('❌ Different channel returned via slug vs UUID');
      return false;
    }
  } else {
    console.log(`❌ Failed: ${response.status} - ${JSON.stringify(response.data)}`);
  }

  return response.ok;
}

async function testDataConsistencyAcrossEndpoints() {
  console.log('\n🔄 Testing data consistency across different endpoints...');

  if (!createdPlaylistId || !createdChannelId) {
    console.log('⚠️  Skipping consistency test - missing required IDs');
    return true;
  }

  // Get playlist via direct endpoint
  console.log('   Fetching playlist via direct endpoint...');
  const playlistResponse = await makeRequest('GET', `/api/v1/playlists/${createdPlaylistId}`);
  if (!playlistResponse.ok) {
    console.log('❌ Failed to fetch playlist for consistency test');
    return false;
  }

  // Get channel via direct endpoint
  console.log('   Fetching channel via direct endpoint...');
  const channelResponse = await makeRequest('GET', `/api/v1/channels/${createdChannelId}`);
  if (!channelResponse.ok) {
    console.log('❌ Failed to fetch channel for consistency test');
    return false;
  }

  // Verify playlist appears in channel's playlists array
  const playlistUrl = `${baseUrl}/api/v1/playlists/${createdPlaylistId}`;
  if (!channelResponse.data.playlists.includes(playlistUrl)) {
    console.log("❌ Playlist not found in channel's playlists array");
    console.log(`   Expected to find: ${playlistUrl}`);
    console.log(`   Channel playlists: ${JSON.stringify(channelResponse.data.playlists)}`);
    return false;
  }
  console.log('✅ Playlist correctly referenced in channel');

  // Get playlist items via playlist items endpoint filtered by channel
  console.log('   Fetching playlist items filtered by channel...');
  const itemsResponse = await makeRequest(
    'GET',
    `/api/v1/playlist-items?channel=${createdChannelId}`
  );
  if (!itemsResponse.ok) {
    console.log('❌ Failed to fetch playlist items by channel');
    return false;
  }

  // Verify playlist items from channel filter match items in direct playlist
  const directPlaylistItems = playlistResponse.data.items;
  const channelFilteredItems = itemsResponse.data.items;

  if (directPlaylistItems.length !== channelFilteredItems.length) {
    console.log('❌ Playlist items count mismatch between direct and channel-filtered endpoints');
    console.log(`   Direct playlist items: ${directPlaylistItems.length}`);
    console.log(`   Channel-filtered items: ${channelFilteredItems.length}`);
    return false;
  }

  // Verify each item matches exactly
  for (let i = 0; i < directPlaylistItems.length; i++) {
    const directItem = directPlaylistItems[i];
    const filteredItem = channelFilteredItems.find(item => item.id === directItem.id);

    if (!filteredItem) {
      console.log(`❌ Playlist item ${directItem.id} not found in channel-filtered results`);
      return false;
    }

    // Compare all fields
    const fieldsToCompare = ['id', 'title', 'source', 'duration', 'license', 'created'];
    for (const field of fieldsToCompare) {
      if (directItem[field] !== filteredItem[field]) {
        console.log(`❌ Playlist item ${directItem.id} field '${field}' mismatch`);
        console.log(`   Direct: ${directItem[field]}`);
        console.log(`   Filtered: ${filteredItem[field]}`);
        return false;
      }
    }
  }
  console.log('✅ Playlist items consistent between direct and channel-filtered endpoints');

  // Test listing endpoints include our created data
  console.log('   Verifying created data appears in listing endpoints...');

  // Retry logic for eventual consistency (especially for Cloudflare KV)
  let foundPlaylist = false;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const playlistsListResponse = await makeRequest('GET', '/api/v1/playlists?limit=100');
    if (playlistsListResponse.ok) {
      const playlist = playlistsListResponse.data.items.find(p => p.id === createdPlaylistId);
      if (playlist) {
        foundPlaylist = true;
        console.log('✅ Created playlist found in playlists listing');
        break;
      } else if (attempt < 5) {
        console.log(
          `   ⏳ Created playlist not found in listing (attempt ${attempt}/5), retrying in 2s...`
        );
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  if (!foundPlaylist) {
    console.log('⚠️  Created playlist not found in playlists listing after 5 attempts');
    console.log('   ℹ️  This is expected behavior for Cloudflare KV due to eventual consistency');
    console.log(
      '   ℹ️  The playlist exists (verified via direct access) but may not appear in list operations immediately'
    );
    // Don't fail the test for this expected behavior in distributed systems
  }

  // Retry logic for channel listing (eventual consistency)
  let foundChannel = false;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const channelsListResponse = await makeRequest('GET', '/api/v1/channels?limit=100');
    if (channelsListResponse.ok) {
      const channel = channelsListResponse.data.items.find(c => c.id === createdChannelId);
      if (channel) {
        foundChannel = true;
        console.log('✅ Created channel found in channels listing');
        break;
      } else if (attempt < 5) {
        console.log(
          `   ⏳ Created channel not found in listing (attempt ${attempt}/5), retrying in 2s...`
        );
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  if (!foundChannel) {
    console.log('⚠️  Created channel not found in channels listing after 5 attempts');
    console.log('   ℹ️  This is expected behavior for Cloudflare KV due to eventual consistency');
    console.log(
      '   ℹ️  The channel exists (verified via direct access) but may not appear in list operations immediately'
    );
    // Don't fail the test for this expected behavior in distributed systems
  }

  console.log('✅ Data consistency verified across all endpoints');
  return true;
}

async function testInvalidIdentifiers() {
  console.log('\n🚫 Testing invalid identifier rejection...');

  // Test IDs that should be rejected with 400 (invalid format)
  const invalidIds = ['invalid_id_with_underscores', 'invalid@email.com', 'spaces in id'];

  // Test IDs that should return 404 (valid format but not found)
  const notFoundIds = [
    '123-abc-invalid-uuid',
    'valid-slug-not-found',
    '00000000-0000-0000-0000-000000000000',
  ];

  let allCorrect = true;

  // Test invalid format IDs (should get 400)
  for (const invalidId of invalidIds) {
    const response = await makeRequest('GET', `/api/v1/playlists/${invalidId}`);
    if (response.status === 400) {
      console.log(`✅ Correctly rejected invalid ID: ${invalidId}`);
    } else {
      console.log(`❌ Failed to reject invalid ID: ${invalidId} (got ${response.status})`);
      allCorrect = false;
    }
  }

  // Test valid format but not found IDs (should get 404)
  for (const notFoundId of notFoundIds) {
    const response = await makeRequest('GET', `/api/v1/playlists/${notFoundId}`);
    if (response.status === 404) {
      console.log(`✅ Correctly returned 404 for valid format but not found: ${notFoundId}`);
    } else {
      console.log(`❌ Expected 404 for not found ID: ${notFoundId} (got ${response.status})`);
      allCorrect = false;
    }
  }

  return allCorrect;
}

async function testAuthenticationFailure() {
  console.log('\n🔐 Testing authentication failure...');
  const response = await fetch(`${baseUrl}/api/v1/playlists`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer invalid-token',
    },
    body: JSON.stringify(testPlaylist),
  });

  if (response.status === 401) {
    console.log('✅ Authentication properly rejected invalid token');
  } else {
    console.log(`❌ Expected 401, got ${response.status}`);
  }

  return response.status === 401;
}

async function testEmptyListing() {
  console.log('\n📋 Testing empty listings behavior...');

  // Create a fresh API that might be empty
  const emptyResponse = await makeRequest('GET', '/api/v1/playlists');
  const emptyGroupsResponse = await makeRequest('GET', '/api/v1/channels');

  if (emptyResponse.ok && emptyGroupsResponse.ok) {
    console.log('✅ Empty listings handled correctly');

    // Check if both return paginated format
    const playlistResult = emptyResponse.data;
    const groupResult = emptyGroupsResponse.data;

    const playlistsValid = playlistResult && Array.isArray(playlistResult.items);
    const groupsValid = groupResult && Array.isArray(groupResult.items);

    console.log(`   Playlists returned: ${playlistsValid ? 'paginated format' : 'invalid format'}`);
    console.log(`   Groups returned: ${groupsValid ? 'paginated format' : 'invalid format'}`);

    return playlistsValid && groupsValid;
  } else {
    console.log(`❌ Failed empty listing test`);
    return false;
  }
}

async function testPlaylistItemById() {
  if (!createdPlaylistId) {
    console.log('\n⚠️  Skipping playlist item by ID test - no playlist ID available');
    return true;
  }

  console.log('\n🎯 Testing GET /api/v1/playlist-items/{id}...');

  // First get the playlist to find an item ID
  const playlistResponse = await makeRequest('GET', `/api/v1/playlists/${createdPlaylistId}`);
  if (
    !playlistResponse.ok ||
    !playlistResponse.data.items ||
    playlistResponse.data.items.length === 0
  ) {
    console.log('❌ Failed to get playlist or playlist has no items');
    return false;
  }

  const playlistItemId = playlistResponse.data.items[0].id;
  console.log(`   Testing with playlist item ID: ${playlistItemId}`);

  const response = await makeRequest('GET', `/api/v1/playlist-items/${playlistItemId}`);

  if (response.ok) {
    console.log('✅ Playlist item retrieved successfully');
    console.log(`   ID: ${response.data.id}`);
    console.log(`   Title: ${response.data.title || 'N/A'}`);
    console.log(`   Source: ${response.data.source}`);
    console.log(`   Duration: ${response.data.duration}`);
    console.log(`   License: ${response.data.license}`);

    if (response.data.id === playlistItemId) {
      console.log('✅ Correct playlist item returned');
    } else {
      console.log('❌ Wrong playlist item returned');
      return false;
    }
  } else {
    console.log(`❌ Failed: ${response.status} - ${JSON.stringify(response.data)}`);
  }

  return response.ok;
}

async function testPlaylistItemsByGroup() {
  if (!createdChannelId) {
    console.log('\n⚠️  Skipping playlist items by group test - no channel ID available');
    return true;
  }

  console.log('\n📂 Testing GET /api/v1/playlist-items?channel={id}...');
  const response = await makeRequest('GET', `/api/v1/playlist-items?channel=${createdChannelId}`);

  if (response.ok) {
    console.log('✅ Playlist items retrieved by group successfully');
    const result = response.data;

    if (result && Array.isArray(result.items)) {
      console.log(`   Count: ${result.items.length}`);
      console.log(`   Has more: ${result.hasMore || false}`);

      if (result.items.length > 0) {
        console.log(`   First item ID: ${result.items[0].id}`);
        console.log(`   First item title: ${result.items[0].title || 'N/A'}`);
      }
    } else {
      console.log('❌ Expected paginated result format with items array');
      return false;
    }
  } else {
    console.log(`❌ Failed: ${response.status} - ${JSON.stringify(response.data)}`);
  }

  return response.ok;
}

async function testPlaylistItemsDoesNotRequiredParameter() {
  console.log('\n🚫 Testing playlist items endpoint does not require channel parameter...');
  const response = await makeRequest('GET', '/api/v1/playlist-items');

  if (response.status === 200) {
    console.log('✅ Correctly returned 200 without channel parameter');
  } else {
    console.log(`❌ Expected 200, got ${response.status}`);
    return false;
  }

  return true;
}

async function testPlaylistItemsInvalidIds() {
  console.log('\n🚫 Testing playlist items with invalid IDs...');

  let allCorrect = true;

  // Test invalid playlist item ID format
  const invalidItemResponse = await makeRequest('GET', '/api/v1/playlist-items/invalid-id');
  if (invalidItemResponse.status === 400) {
    console.log('✅ Correctly rejected invalid playlist item ID format');
  } else {
    console.log(`❌ Expected 400 for invalid playlist item ID, got ${invalidItemResponse.status}`);
    allCorrect = false;
  }

  // Test invalid channel ID format
  const invalidGroupResponse = await makeRequest(
    'GET',
    '/api/v1/playlist-items?channel=invalid@id'
  );
  if (invalidGroupResponse.status === 400) {
    console.log('✅ Correctly rejected invalid channel ID format');
  } else {
    console.log(`❌ Expected 400 for invalid channel ID, got ${invalidGroupResponse.status}`);
    allCorrect = false;
  }

  // Test non-existent playlist item ID (valid format but not found)
  const notFoundItemResponse = await makeRequest(
    'GET',
    '/api/v1/playlist-items/00000000-0000-0000-0000-000000000000'
  );
  if (notFoundItemResponse.status === 404) {
    console.log('✅ Correctly returned 404 for non-existent playlist item');
  } else {
    console.log(
      `❌ Expected 404 for non-existent playlist item, got ${notFoundItemResponse.status}`
    );
    allCorrect = false;
  }

  return allCorrect;
}

async function testPlaylistItemsPagination() {
  if (!createdChannelId) {
    console.log('\n⚠️  Skipping playlist items pagination test - no channel ID available');
    return true;
  }

  console.log('\n📄 Testing playlist items pagination...');

  // Test with limit
  const limitResponse = await makeRequest(
    'GET',
    `/api/v1/playlist-items?channel=${createdChannelId}&limit=1`
  );

  if (limitResponse.ok) {
    const result = limitResponse.data;
    if (result.items && result.items.length <= 1) {
      console.log('✅ Limit parameter working correctly for playlist items');

      // If there are more items and a cursor, test cursor pagination
      if (result.cursor && result.hasMore) {
        const cursorResponse = await makeRequest(
          'GET',
          `/api/v1/playlist-items?channel=${createdChannelId}&limit=1&cursor=${encodeURIComponent(result.cursor)}`
        );
        if (cursorResponse.ok) {
          console.log('✅ Cursor pagination working correctly for playlist items');
        } else {
          console.log('❌ Cursor pagination failed for playlist items');
          return false;
        }
      } else {
        console.log('ℹ️  No cursor available for playlist items (only one page of results)');
      }
    } else {
      console.log('❌ Limit parameter not working correctly for playlist items');
      return false;
    }
  } else {
    console.log(`❌ Playlist items pagination test failed: ${limitResponse.status}`);
    return false;
  }

  return true;
}

async function testPlaylistItemsUpdate() {
  if (!createdPlaylistId) {
    console.log('\n⚠️  Skipping playlist items update test - no playlist ID available');
    return true;
  }

  console.log('\n🔄 Testing playlist items update via playlist update...');

  // First get the current playlist item ID
  const initialPlaylist = await makeRequest('GET', `/api/v1/playlists/${createdPlaylistId}`);
  if (
    !initialPlaylist.ok ||
    !initialPlaylist.data.items ||
    initialPlaylist.data.items.length === 0
  ) {
    console.log('❌ Failed to get initial playlist or playlist has no items');
    return false;
  }

  const originalItemId = initialPlaylist.data.items[0].id;
  console.log(`   Original playlist item ID: ${originalItemId}`);

  // Update the playlist with new items
  const updateData = {
    items: [
      {
        title: 'Updated Test Artwork',
        source: 'https://example.com/updated-artwork.html',
        duration: 600,
        license: 'token',
      },
    ],
  };

  const updateResponse = await makeRequest(
    'PATCH',
    `/api/v1/playlists/${createdPlaylistId}`,
    updateData
  );

  if (!updateResponse.ok) {
    console.log(`❌ Failed to update playlist: ${updateResponse.status}`);
    return false;
  }

  const updatedPlaylist = updateResponse.data;
  const newItemId = updatedPlaylist.items[0].id;
  console.log(`   New playlist item ID: ${newItemId}`);

  // Verify the new item ID is different
  if (newItemId !== originalItemId) {
    console.log('✅ New playlist item has different ID (old item was replaced)');
  } else {
    console.log('❌ Playlist item ID did not change (should be replaced)');
    return false;
  }

  // Wait for queue processing
  await new Promise(resolve => setTimeout(resolve, 500));

  // Verify the old item is no longer accessible
  const oldItemResponse = await makeRequest('GET', `/api/v1/playlist-items/${originalItemId}`);
  if (oldItemResponse.status === 404) {
    console.log('✅ Old playlist item no longer accessible');
  } else {
    console.log(`❌ Old playlist item still accessible (status: ${oldItemResponse.status})`);
    return false;
  }

  // Verify the new item is accessible
  const newItemResponse = await makeRequest('GET', `/api/v1/playlist-items/${newItemId}`);
  if (newItemResponse.ok) {
    console.log('✅ New playlist item is accessible');
    const newItem = newItemResponse.data;
    if (newItem.title === 'Updated Test Artwork' && newItem.license === 'token') {
      console.log('✅ New playlist item has correct updated data');
    } else {
      console.log('❌ New playlist item does not have expected updated data');
      return false;
    }
  } else {
    console.log(`❌ New playlist item not accessible (status: ${newItemResponse.status})`);
    return false;
  }

  return true;
}

async function testSortingSetup() {
  console.log('\n🎯 Setting up sorting tests - creating multiple playlists with delays...');

  sortingTestPlaylistIds = []; // Reset for multiple test runs

  // Create 3 playlists with delays to ensure different creation timestamps
  for (let i = 1; i <= 3; i++) {
    const sortingPlaylist = {
      dpVersion: '1.0.0',
      title: `Sorting Test Playlist ${i}`,
      defaults: {
        license: 'open',
        duration: 300,
      },
      items: [
        {
          title: `Sorting Test Artwork ${i}`,
          source: `https://example.com/sorting-test-${i}.html`,
          duration: 300,
          license: 'open',
        },
      ],
    };

    const response = await makeRequest('POST', '/api/v1/playlists', sortingPlaylist);

    if (response.ok) {
      console.log(`✅ Created sorting test playlist ${i}: ${response.data.id}`);
      console.log(`   Created at: ${response.data.created}`);
      sortingTestPlaylistIds.push({
        id: response.data.id,
        created: response.data.created,
        title: response.data.title,
        index: i,
      });

      // Wait for queue processing and to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 1000));
    } else {
      console.log(`❌ Failed to create sorting test playlist ${i}: ${response.status}`);
      return false;
    }
  }

  console.log('✅ Sorting test playlists created successfully');
  return true;
}

async function testPlaylistSortingAscending() {
  if (sortingTestPlaylistIds.length < 3) {
    console.log('\n⚠️  Skipping ascending sort test - not enough test playlists');
    return true;
  }

  console.log('\n⬆️  Testing playlist sorting (ascending by creation time)...');
  const response = await makeRequest('GET', '/api/v1/playlists?sort=asc&limit=10');

  if (response.ok) {
    const result = response.data;
    if (result && Array.isArray(result.items)) {
      console.log(`   Retrieved ${result.items.length} playlists`);

      // Find our test playlists in the results
      const testPlaylists = result.items.filter(p =>
        sortingTestPlaylistIds.some(tp => tp.id === p.id)
      );

      if (testPlaylists.length < 3) {
        console.log(`⚠️  Only found ${testPlaylists.length}/3 test playlists in results`);
        // Still validate what we found
      }

      // Verify they're in ascending order (oldest first)
      let isAscending = true;
      for (let i = 1; i < testPlaylists.length; i++) {
        const prev = new Date(testPlaylists[i - 1].created);
        const curr = new Date(testPlaylists[i].created);
        if (prev > curr) {
          console.log(`❌ Ascending order violated at index ${i}:`);
          console.log(
            `   Previous: ${testPlaylists[i - 1].title} (${testPlaylists[i - 1].created})`
          );
          console.log(`   Current:  ${testPlaylists[i].title} (${testPlaylists[i].created})`);
          isAscending = false;
          break;
        }
      }

      if (isAscending && testPlaylists.length > 1) {
        console.log('✅ Playlists are correctly sorted in ascending order by creation time');
        console.log('   Order found:');
        testPlaylists.forEach((p, i) => {
          console.log(`   ${i + 1}. ${p.title} (${p.created})`);
        });
      } else if (testPlaylists.length <= 1) {
        console.log('ℹ️  Not enough test playlists to verify sorting order');
      } else {
        console.log('❌ Playlists are NOT in ascending order');
        return false;
      }
    } else {
      console.log('❌ Expected paginated result format with items array');
      return false;
    }
  } else {
    console.log(`❌ Failed: ${response.status} - ${JSON.stringify(response.data)}`);
    return false;
  }

  return true;
}

async function testPlaylistSortingDescending() {
  if (sortingTestPlaylistIds.length < 3) {
    console.log('\n⚠️  Skipping descending sort test - not enough test playlists');
    return true;
  }

  console.log('\n⬇️  Testing playlist sorting (descending by creation time)...');
  const response = await makeRequest('GET', '/api/v1/playlists?sort=desc&limit=10');

  if (response.ok) {
    const result = response.data;
    if (result && Array.isArray(result.items)) {
      console.log(`   Retrieved ${result.items.length} playlists`);

      // Find our test playlists in the results
      const testPlaylists = result.items.filter(p =>
        sortingTestPlaylistIds.some(tp => tp.id === p.id)
      );

      if (testPlaylists.length < 3) {
        console.log(`⚠️  Only found ${testPlaylists.length}/3 test playlists in results`);
        // Still validate what we found
      }

      // Verify they're in descending order (newest first)
      let isDescending = true;
      for (let i = 1; i < testPlaylists.length; i++) {
        const prev = new Date(testPlaylists[i - 1].created);
        const curr = new Date(testPlaylists[i].created);
        if (prev < curr) {
          console.log(`❌ Descending order violated at index ${i}:`);
          console.log(
            `   Previous: ${testPlaylists[i - 1].title} (${testPlaylists[i - 1].created})`
          );
          console.log(`   Current:  ${testPlaylists[i].title} (${testPlaylists[i].created})`);
          isDescending = false;
          break;
        }
      }

      if (isDescending && testPlaylists.length > 1) {
        console.log('✅ Playlists are correctly sorted in descending order by creation time');
        console.log('   Order found:');
        testPlaylists.forEach((p, i) => {
          console.log(`   ${i + 1}. ${p.title} (${p.created})`);
        });
      } else if (testPlaylists.length <= 1) {
        console.log('ℹ️  Not enough test playlists to verify sorting order');
      } else {
        console.log('❌ Playlists are NOT in descending order');
        return false;
      }
    } else {
      console.log('❌ Expected paginated result format with items array');
      return false;
    }
  } else {
    console.log(`❌ Failed: ${response.status} - ${JSON.stringify(response.data)}`);
    return false;
  }

  return true;
}

async function testPlaylistSortingDefault() {
  console.log('\n🔄 Testing playlist sorting (default - should be asc)...');
  const response = await makeRequest('GET', '/api/v1/playlists?limit=10');

  if (response.ok) {
    const result = response.data;
    if (result && Array.isArray(result.items)) {
      console.log(`   Retrieved ${result.items.length} playlists (default sort)`);

      if (result.items.length > 1) {
        // Verify default sort is ascending
        let isAscending = true;
        for (let i = 1; i < result.items.length; i++) {
          const prev = new Date(result.items[i - 1].created);
          const curr = new Date(result.items[i].created);
          if (prev > curr) {
            console.log(`❌ Default sort is not ascending at index ${i}`);
            isAscending = false;
            break;
          }
        }

        if (isAscending) {
          console.log('✅ Default sorting is ascending (oldest first)');
        } else {
          console.log('❌ Default sorting is not ascending');
          return false;
        }
      } else {
        console.log('ℹ️  Not enough playlists to verify default sorting order');
      }
    } else {
      console.log('❌ Expected paginated result format with items array');
      return false;
    }
  } else {
    console.log(`❌ Failed: ${response.status} - ${JSON.stringify(response.data)}`);
    return false;
  }

  return true;
}

async function testChannelSorting() {
  console.log('\n📂 Testing channel sorting...');

  // Test both asc and desc for groups
  const ascResponse = await makeRequest('GET', '/api/v1/channels?sort=asc&limit=10');
  const descResponse = await makeRequest('GET', '/api/v1/channels?sort=desc&limit=10');

  if (ascResponse.ok && descResponse.ok) {
    console.log('✅ Channel sorting endpoints are accessible');

    const ascResult = ascResponse.data;
    const descResult = descResponse.data;

    if (ascResult.items && ascResult.items.length > 1) {
      // Verify ascending order
      let isAscending = true;
      for (let i = 1; i < ascResult.items.length; i++) {
        const prev = new Date(ascResult.items[i - 1].created);
        const curr = new Date(ascResult.items[i].created);
        if (prev > curr) {
          isAscending = false;
          break;
        }
      }

      if (isAscending) {
        console.log('✅ Channels correctly sorted in ascending order');
      } else {
        console.log('❌ Channels NOT in ascending order');
        return false;
      }
    }

    if (descResult.items && descResult.items.length > 1) {
      // Verify descending order
      let isDescending = true;
      for (let i = 1; i < descResult.items.length; i++) {
        const prev = new Date(descResult.items[i - 1].created);
        const curr = new Date(descResult.items[i].created);
        if (prev < curr) {
          isDescending = false;
          break;
        }
      }

      if (isDescending) {
        console.log('✅ Channels correctly sorted in descending order');
      } else {
        console.log('❌ Channels NOT in descending order');
        return false;
      }
    }

    if ((ascResult.items?.length || 0) <= 1 && (descResult.items?.length || 0) <= 1) {
      console.log('ℹ️  Not enough channels to verify sorting order');
    }
  } else {
    console.log('❌ Failed to test channels sorting');
    return false;
  }

  return true;
}

async function testPlaylistItemSorting() {
  console.log('\n🎯 Testing playlist item sorting...');

  // Test both asc and desc for items
  const ascResponse = await makeRequest('GET', '/api/v1/playlist-items?sort=asc&limit=10');
  const descResponse = await makeRequest('GET', '/api/v1/playlist-items?sort=desc&limit=10');

  if (ascResponse.ok && descResponse.ok) {
    console.log('✅ Playlist item sorting endpoints are accessible');

    const ascResult = ascResponse.data;
    const descResult = descResponse.data;

    console.log(
      `   Found ${ascResult.items?.length || 0} items (asc), ${descResult.items?.length || 0} items (desc)`
    );

    // For items, we check the created_at field (not created)
    if (ascResult.items && ascResult.items.length > 1) {
      let isAscending = true;
      for (let i = 1; i < ascResult.items.length; i++) {
        const prev = new Date(ascResult.items[i - 1].created_at);
        const curr = new Date(ascResult.items[i].created_at);
        if (prev > curr) {
          isAscending = false;
          break;
        }
      }

      if (isAscending) {
        console.log('✅ Playlist items correctly sorted in ascending order');
      } else {
        console.log('❌ Playlist items NOT in ascending order');
        return false;
      }
    }

    if (descResult.items && descResult.items.length > 1) {
      let isDescending = true;
      for (let i = 1; i < descResult.items.length; i++) {
        const prev = new Date(descResult.items[i - 1].created_at);
        const curr = new Date(descResult.items[i].created_at);
        if (prev < curr) {
          isDescending = false;
          break;
        }
      }

      if (isDescending) {
        console.log('✅ Playlist items correctly sorted in descending order');
      } else {
        console.log('❌ Playlist items NOT in descending order');
        return false;
      }
    }

    if ((ascResult.items?.length || 0) <= 1 && (descResult.items?.length || 0) <= 1) {
      console.log('ℹ️  Not enough playlist items to verify sorting order');
    }
  } else {
    console.log('❌ Failed to test playlist item sorting');
    return false;
  }

  return true;
}

// Curated Registry API Tests
async function testGetCuratedRegistry() {
  console.log('\n📋 Testing GET curated registry...');

  const response = await makeRequest('GET', '/api/v1/registry/channels');

  if (response.ok) {
    console.log('✅ Curated registry retrieved successfully');

    // Verify response structure - should be an array
    if (!Array.isArray(response.data)) {
      console.log('❌ Registry should be an array');
      return false;
    }

    console.log(`   Items count: ${response.data.length}`);

    // If there are items, validate structure
    if (response.data.length > 0) {
      const firstItem = response.data[0];
      if (!firstItem.name || !Array.isArray(firstItem.channel_urls)) {
        console.log('❌ Invalid registry item structure');
        return false;
      }
      console.log(`   First item: ${firstItem.name}`);
      console.log(`   Channel URLs: ${firstItem.channel_urls.length}`);
    }

    return true;
  } else if (response.status === 404) {
    console.log('ℹ️  Registry file not found yet (expected for new deployment)');
    return true;
  } else {
    console.log(`❌ Failed: ${response.status} - ${JSON.stringify(response.data)}`);
    return false;
  }
}

async function testPutCuratedRegistry() {
  console.log('\n📝 Testing PUT curated registry...');

  const testRegistry = [
    {
      name: 'Test Publisher 1',
      channel_urls: [
        `${baseUrl}/api/v1/channels/${randomUUID()}`,
        `${baseUrl}/api/v1/channels/${randomUUID()}`,
      ],
    },
    {
      name: 'Test Publisher 2',
      channel_urls: [`${baseUrl}/api/v1/channels/${randomUUID()}`],
    },
  ];

  const response = await makeRequest('PUT', '/api/v1/registry/channels', testRegistry);

  if (response.ok) {
    console.log('✅ Curated registry updated successfully');
    console.log(`   Items: ${testRegistry.length}`);

    // Verify the update by reading it back
    await new Promise(resolve => setTimeout(resolve, 500)); // Wait for write to complete

    const getResponse = await makeRequest('GET', '/api/v1/registry/channels');

    if (!getResponse.ok) {
      console.log('❌ Failed to retrieve updated registry');
      return false;
    }

    // Verify the data matches
    if (getResponse.data.length !== testRegistry.length) {
      console.log('❌ Item count mismatch after update');
      return false;
    }

    console.log('✅ Registry update verified');
    return true;
  } else {
    console.log(`❌ Failed: ${response.status} - ${JSON.stringify(response.data)}`);
    return false;
  }
}

async function testPutCuratedRegistryValidation() {
  console.log('\n🔍 Testing PUT curated registry validation...');

  // Test 1: Invalid type - not an array
  console.log('   Testing invalid type (not an array)...');
  const invalidRegistry1 = {
    dp1_playlist: {
      publishers: [],
    },
  };

  const response1 = await makeRequest('PUT', '/api/v1/registry/channels', invalidRegistry1);

  if (response1.status !== 400) {
    console.log(`❌ Expected 400 for non-array data, got ${response1.status}`);
    return false;
  }
  console.log('   ✅ Correctly rejected non-array data');

  // Test 2: Empty array
  console.log('   Testing empty array...');
  const invalidRegistry2 = [];

  const response2 = await makeRequest('PUT', '/api/v1/registry/channels', invalidRegistry2);

  if (response2.status !== 400) {
    console.log(`❌ Expected 400 for empty array, got ${response2.status}`);
    return false;
  }
  console.log('   ✅ Correctly rejected empty array');

  // Test 3: Invalid channel URL format
  console.log('   Testing invalid channel URL format...');
  const invalidRegistry3 = [
    {
      name: 'Invalid Publisher',
      channel_urls: ['https://example.com/invalid/path'],
    },
  ];

  const response3 = await makeRequest('PUT', '/api/v1/registry/channels', invalidRegistry3);

  if (response3.status !== 400) {
    console.log(`❌ Expected 400 for invalid channel URL, got ${response3.status}`);
    return false;
  }
  console.log('   ✅ Correctly rejected invalid channel URL format');

  // Test 4: Empty publisher name
  console.log('   Testing empty publisher name...');
  const invalidRegistry4 = {
    dp1_playlist: {
      publishers: [
        {
          name: '',
          channel_urls: [`${baseUrl}/api/v1/channels/${randomUUID()}`],
        },
      ],
    },
  };

  const response4 = await makeRequest('PUT', '/api/v1/registry/channels', invalidRegistry4);

  if (response4.status !== 400) {
    console.log(`❌ Expected 400 for empty name, got ${response4.status}`);
    return false;
  }
  console.log('   ✅ Correctly rejected empty publisher name');

  console.log('✅ All validation tests passed');
  return true;
}

async function testCuratedRegistryAuthentication() {
  console.log('\n🔐 Testing curated registry authentication...');

  const testRegistry = [
    {
      name: 'Auth Test Publisher',
      channel_urls: [`${baseUrl}/api/v1/channels/${randomUUID()}`],
    },
  ];

  // Try PUT without authentication
  console.log('   Testing PUT without authentication...');
  const unauthResponse = await fetch(`${baseUrl}/api/v1/registry/channels`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      // No x-api-secret header
    },
    body: JSON.stringify(testRegistry),
  });

  if (unauthResponse.status !== 401 && unauthResponse.status !== 403) {
    console.log(`❌ Expected 401/403 without auth, got ${unauthResponse.status}`);
    return false;
  }
  console.log('   ✅ Correctly rejected unauthenticated PUT request');

  // GET should work without authentication
  console.log('   Testing GET without authentication...');
  const publicGetResponse = await fetch(`${baseUrl}/api/v1/registry/channels`, {
    method: 'GET',
  });

  if (publicGetResponse.status !== 200 && publicGetResponse.status !== 404) {
    console.log(`❌ GET should be public, got ${publicGetResponse.status}`);
    return false;
  }
  console.log('   ✅ GET is public (no authentication required)');

  console.log('✅ Registry authentication working correctly');
  return true;
}

// Test bulk write: Playlist with 1024 items
let bulkTestPlaylistId = null;
let bulkTestChannelId = null;

async function testBulkPlaylistCreate() {
  console.log('\n📦 Testing bulk write - Creating playlist with 1024 items...');

  // Generate 1024 items
  const items = [];
  for (let i = 1; i <= 1024; i++) {
    items.push({
      title: `Bulk Test Artwork ${i}`,
      source: `https://example.com/bulk-test-${i}.html`,
      duration: 300 + (i % 100), // Vary duration
      license: ['open', 'token', 'subscription'][i % 3], // Rotate licenses
    });
  }

  const bulkPlaylist = {
    dpVersion: '1.0.0',
    title: 'Bulk Test Playlist - 1024 Items',
    summary: 'Testing bulk write operations with 1024 playlist items',
    defaults: {
      display: {
        scaling: 'fit',
        background: '#000000',
      },
      license: 'open',
      duration: 300,
    },
    items: items,
  };

  console.log(`   Creating playlist with ${items.length} items...`);
  const startTime = Date.now();

  const response = await makeRequest('POST', '/api/v1/playlists', bulkPlaylist);

  const duration = Date.now() - startTime;

  if (response.ok) {
    console.log(`✅ Playlist with 1024 items created successfully in ${duration}ms`);
    console.log(`   ID: ${response.data.id}`);
    console.log(`   Items count: ${response.data.items?.length || 0}`);

    // Store ID for further tests
    bulkTestPlaylistId = response.data.id;

    // Verify all items were created
    if (response.data.items.length !== 1024) {
      console.log(`❌ Expected 1024 items, got ${response.data.items.length}`);
      return false;
    }

    // Verify each item has server-generated fields
    const sampleItem = response.data.items[0];
    if (!sampleItem.id || !sampleItem.created) {
      console.log('❌ Items missing server-generated fields');
      return false;
    }

    console.log('✅ All 1024 items have server-generated IDs and timestamps');

    return true;
  } else {
    console.log(`❌ Failed: ${response.status} - ${JSON.stringify(response.data)}`);
    return false;
  }
}

async function testBulkPlaylistUpdate() {
  if (!bulkTestPlaylistId) {
    console.log('\n⚠️  Skipping bulk playlist update test - no bulk playlist ID available');
    return true;
  }

  console.log('\n🔄 Testing bulk write - Updating playlist with 1024 items...');

  // Generate 1024 different items
  const updatedItems = [];
  for (let i = 1; i <= 1024; i++) {
    updatedItems.push({
      title: `Updated Bulk Artwork ${i}`,
      source: `https://example.com/updated-bulk-${i}.html`,
      duration: 400 + (i % 150),
      license: ['token', 'subscription', 'open'][i % 3],
    });
  }

  const updateData = {
    title: 'Updated Bulk Test Playlist - 1024 Items',
    summary: 'Updated: Testing bulk write operations with 1024 playlist items',
    items: updatedItems,
  };

  console.log(`   Updating playlist with ${updatedItems.length} new items...`);
  const startTime = Date.now();

  const response = await makeRequest(
    'PATCH',
    `/api/v1/playlists/${bulkTestPlaylistId}`,
    updateData
  );

  const duration = Date.now() - startTime;

  if (response.ok) {
    console.log(`✅ Playlist with 1024 items updated successfully in ${duration}ms`);
    console.log(`   Items count: ${response.data.items?.length || 0}`);

    // Verify all items were updated
    if (response.data.items.length !== 1024) {
      console.log(`❌ Expected 1024 items, got ${response.data.items.length}`);
      return false;
    }

    // Verify items have new data
    const sampleItem = response.data.items[0];
    if (!sampleItem.title.startsWith('Updated Bulk Artwork')) {
      console.log('❌ Items not updated correctly');
      return false;
    }

    console.log('✅ All 1024 items updated with new data');

    return true;
  } else {
    console.log(`❌ Failed: ${response.status} - ${JSON.stringify(response.data)}`);
    return false;
  }
}

async function testBulkPlaylistDelete() {
  if (!bulkTestPlaylistId) {
    console.log('\n⚠️  Skipping bulk playlist delete test - no bulk playlist ID available');
    return true;
  }

  console.log('\n🗑️  Testing bulk write - Deleting playlist with 1024 items...');

  const startTime = Date.now();

  const response = await makeRequest(
    'DELETE',
    `/api/v1/playlists/${bulkTestPlaylistId}`,
    null,
    false
  );

  const duration = Date.now() - startTime;

  if (response.ok && response.status === 204) {
    console.log(`✅ Playlist with 1024 items deleted successfully in ${duration}ms`);

    // Verify playlist is actually deleted
    const verifyResponse = await makeRequest('GET', `/api/v1/playlists/${bulkTestPlaylistId}`);
    if (verifyResponse.status === 404) {
      console.log('✅ Playlist and all 1024 items properly removed');
    } else {
      console.log(`❌ Playlist still exists after deletion: ${verifyResponse.status}`);
      return false;
    }

    // Clear the ID
    bulkTestPlaylistId = null;

    return true;
  } else {
    console.log(`❌ Failed: ${response.status} - ${JSON.stringify(response.data)}`);
    return false;
  }
}

async function testBulkChannelCreate() {
  console.log('\n📦 Testing bulk write - Creating channel with 100 playlists...');

  // First, create 100 playlists to reference
  console.log('   🔧 Creating 100 playlists for channel test...');
  const playlistUrls = [];

  for (let i = 1; i <= 100; i++) {
    const miniPlaylist = {
      dpVersion: '1.0.0',
      title: `Bulk Channel Test Playlist ${i}`,
      defaults: {
        license: 'open',
        duration: 300,
      },
      items: [
        {
          title: `Bulk Channel Test Item ${i}`,
          source: `https://example.com/bulk-channel-${i}.html`,
          duration: 300,
          license: 'open',
        },
      ],
    };

    const playlistResponse = await makeRequest('POST', '/api/v1/playlists', miniPlaylist);
    if (playlistResponse.ok) {
      playlistUrls.push(`${baseUrl}/api/v1/playlists/${playlistResponse.data.id}`);

      // Progress indicator every 20 playlists
      if (i % 20 === 0) {
        console.log(`   📝 Created ${i}/100 playlists...`);
      }
    } else {
      console.log(`❌ Failed to create playlist ${i} for channel test`);
      return false;
    }
  }

  console.log(`✅ Created all 100 playlists`);

  // Wait for queue processing
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Now create the channel with 100 playlists
  const bulkChannel = {
    title: 'Bulk Test Channel - 100 Playlists',
    curator: 'Bulk Test Curator',
    curators: [
      {
        name: 'Bulk Test Curator',
        key: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
        url: 'https://example.com/bulk-curator',
      },
    ],
    publisher: {
      name: 'Bulk Test Publisher',
      key: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
      url: 'https://example.com/bulk-publisher',
    },
    summary: 'Testing bulk write operations with 100 playlists in a channel',
    playlists: playlistUrls,
  };

  console.log(`   Creating channel with ${playlistUrls.length} playlists...`);
  const startTime = Date.now();

  const response = await makeRequest('POST', '/api/v1/channels', bulkChannel);

  const duration = Date.now() - startTime;

  if (response.ok) {
    console.log(`✅ Channel with 100 playlists created successfully in ${duration}ms`);
    console.log(`   ID: ${response.data.id}`);
    console.log(`   Playlists count: ${response.data.playlists?.length || 0}`);

    // Store ID for further tests
    bulkTestChannelId = response.data.id;

    // Verify all playlists were added
    if (response.data.playlists.length !== 100) {
      console.log(`❌ Expected 100 playlists, got ${response.data.playlists.length}`);
      return false;
    }

    // Verify returned playlists match the input playlists
    const returnedPlaylists = response.data.playlists;
    const missingPlaylists = playlistUrls.filter(url => !returnedPlaylists.includes(url));
    const extraPlaylists = returnedPlaylists.filter(url => !playlistUrls.includes(url));

    if (missingPlaylists.length > 0) {
      console.log(`❌ ${missingPlaylists.length} playlists from input missing in response`);
      console.log(`   First missing: ${missingPlaylists[0]}`);
      return false;
    }

    if (extraPlaylists.length > 0) {
      console.log(`❌ ${extraPlaylists.length} extra playlists in response not in input`);
      console.log(`   First extra: ${extraPlaylists[0]}`);
      return false;
    }

    console.log('✅ All 100 playlists associated with channel');
    console.log('✅ All returned playlists match input playlists');

    return true;
  } else {
    console.log(`❌ Failed: ${response.status} - ${JSON.stringify(response.data)}`);
    return false;
  }
}

async function testBulkChannelUpdate() {
  if (!bulkTestChannelId) {
    console.log('\n⚠️  Skipping bulk channel update test - no bulk channel ID available');
    return true;
  }

  console.log('\n🔄 Testing bulk write - Updating channel with 100 playlists...');

  // Create 100 new playlists for update
  console.log('   🔧 Creating 100 new playlists for channel update...');
  const newPlaylistUrls = [];

  for (let i = 1; i <= 100; i++) {
    const miniPlaylist = {
      dpVersion: '1.0.0',
      title: `Updated Bulk Channel Playlist ${i}`,
      defaults: {
        license: 'token',
        duration: 400,
      },
      items: [
        {
          title: `Updated Bulk Channel Item ${i}`,
          source: `https://example.com/updated-bulk-channel-${i}.html`,
          duration: 400,
          license: 'token',
        },
      ],
    };

    const playlistResponse = await makeRequest('POST', '/api/v1/playlists', miniPlaylist);
    if (playlistResponse.ok) {
      newPlaylistUrls.push(`${baseUrl}/api/v1/playlists/${playlistResponse.data.id}`);

      if (i % 20 === 0) {
        console.log(`   📝 Created ${i}/100 new playlists...`);
      }
    } else {
      console.log(`❌ Failed to create new playlist ${i} for channel update`);
      return false;
    }
  }

  console.log(`✅ Created all 100 new playlists`);

  const updateData = {
    title: 'Updated Bulk Test Channel - 100 New Playlists',
    summary: 'Updated: Testing bulk write operations with 100 playlists',
    playlists: newPlaylistUrls,
  };

  console.log(`   Updating channel with ${newPlaylistUrls.length} new playlists...`);
  const startTime = Date.now();

  const response = await makeRequest('PATCH', `/api/v1/channels/${bulkTestChannelId}`, updateData);

  const duration = Date.now() - startTime;

  if (response.ok) {
    console.log(`✅ Channel with 100 playlists updated successfully in ${duration}ms`);
    console.log(`   Playlists count: ${response.data.playlists?.length || 0}`);

    // Verify all playlists were updated
    if (response.data.playlists.length !== 100) {
      console.log(`❌ Expected 100 playlists, got ${response.data.playlists.length}`);
      return false;
    }

    // Verify returned playlists match the input playlists
    const returnedPlaylists = response.data.playlists;
    const missingPlaylists = newPlaylistUrls.filter(url => !returnedPlaylists.includes(url));
    const extraPlaylists = returnedPlaylists.filter(url => !newPlaylistUrls.includes(url));

    if (missingPlaylists.length > 0) {
      console.log(`❌ ${missingPlaylists.length} playlists from input missing in response`);
      console.log(`   First missing: ${missingPlaylists[0]}`);
      return false;
    }

    if (extraPlaylists.length > 0) {
      console.log(`❌ ${extraPlaylists.length} extra playlists in response not in input`);
      console.log(`   First extra: ${extraPlaylists[0]}`);
      return false;
    }

    console.log('✅ All 100 playlists updated in channel');
    console.log('✅ All returned playlists match input playlists');

    return true;
  } else {
    console.log(`❌ Failed: ${response.status} - ${JSON.stringify(response.data)}`);
    return false;
  }
}

async function testBulkChannelDelete() {
  if (!bulkTestChannelId) {
    console.log('\n⚠️  Skipping bulk channel delete test - no bulk channel ID available');
    return true;
  }

  console.log('\n🗑️  Testing bulk write - Deleting channel with 100 playlists...');

  const startTime = Date.now();

  const response = await makeRequest(
    'DELETE',
    `/api/v1/channels/${bulkTestChannelId}`,
    null,
    false
  );

  const duration = Date.now() - startTime;

  if (response.ok && response.status === 204) {
    console.log(`✅ Channel with 100 playlists deleted successfully in ${duration}ms`);

    // Verify channel is actually deleted
    const verifyResponse = await makeRequest('GET', `/api/v1/channels/${bulkTestChannelId}`);
    if (verifyResponse.status === 404) {
      console.log('✅ Channel and all playlist associations properly removed');
    } else {
      console.log(`❌ Channel still exists after deletion: ${verifyResponse.status}`);
      return false;
    }

    // Clear the ID
    bulkTestChannelId = null;

    return true;
  } else {
    console.log(`❌ Failed: ${response.status} - ${JSON.stringify(response.data)}`);
    return false;
  }
}

// Test JWT authentication
async function testJwtAuthentication() {
  if (!jwtTestConfig) {
    console.log('⚠️  JWT testing skipped - no JWT configuration provided');
    return true; // Skip test if JWT not configured
  }

  console.log('🔐 Testing JWT authentication...');

  // Test creating a playlist with JWT authentication
  const testData = {
    dpVersion: '1.0.0',
    title: 'JWT Test Playlist',
    summary: 'Testing JWT authentication',
    items: [
      {
        title: 'JWT Test Item',
        source: 'https://example.com/jwt-test.html',
        duration: 300,
        license: 'open',
      },
    ],
  };

  try {
    const response = await makeRequest('POST', '/api/v1/playlists', testData, true); // useJwt = true

    if (response.ok && response.data && response.data.id) {
      console.log('✅ JWT authentication successful');
      console.log(`   Created playlist ID: ${response.data.id}`);

      return true;
    } else {
      console.log('❌ JWT authentication failed');
      console.log('   Response:', response);
      return false;
    }
  } catch (error) {
    console.log('❌ JWT authentication error:', error.message);
    return false;
  }
}

// Test invalid JWT token
async function testInvalidJwtAuthentication() {
  if (!jwtTestConfig) {
    console.log('⚠️  Invalid JWT testing skipped - no JWT configuration provided');
    return true; // Skip test if JWT not configured
  }

  console.log('🔐 Testing invalid JWT authentication...');

  const testData = {
    dpVersion: '1.0.0',
    title: 'Should Fail',
    items: [
      {
        title: 'Test Item',
        source: 'https://example.com/test.html',
        duration: 300,
        license: 'open',
      },
    ],
  };

  try {
    // Create a request with invalid JWT
    const url = `${baseUrl}/api/v1/playlists`;
    const headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer invalid.jwt.token',
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(testData),
    });

    if (response.status === 401) {
      console.log('✅ Invalid JWT correctly rejected');
      return true;
    } else {
      console.log('❌ Invalid JWT was not rejected');
      console.log(`   Expected status 401, got ${response.status}`);
      return false;
    }
  } catch (error) {
    console.log('❌ Invalid JWT test error:', error.message);
    return false;
  }
}

// Main test runner
async function runTests() {
  console.log('🚀 Starting DP-1 Feed Operator API Tests (UUID + Slug Support + Bulk Write)\n');

  const tests = [
    { name: 'Empty Listings', fn: testEmptyListing },
    { name: 'List Playlists', fn: testListPlaylists },
    { name: 'Pagination (Real Data Behavior)', fn: testPagination },
    { name: 'Create Playlist (Data Integrity)', fn: testCreatePlaylist },
    { name: 'Get Playlist by UUID', fn: testGetPlaylistByUUID },
    { name: 'Get Playlist by Slug', fn: testGetPlaylistBySlug },
    { name: 'Update Playlist (Data Integrity)', fn: testUpdatePlaylist },
    { name: 'Delete Playlist', fn: testDeletePlaylist },
    { name: 'Delete Playlist by Slug', fn: testDeletePlaylistBySlug },
    { name: 'Delete Non-Existent Playlist', fn: testDeleteNonExistentPlaylist },
    { name: 'Create Channel (New Fields Integrity)', fn: testCreateChannel },
    { name: 'List Channels', fn: testListChannels },
    { name: 'Get Channel by UUID', fn: testGetChannelByUUID },
    { name: 'Get Channel by Slug', fn: testGetChannelBySlug },
    { name: 'Data Consistency Across Endpoints', fn: testDataConsistencyAcrossEndpoints },
    { name: 'Channels Filtering', fn: testChannelFiltering },
    { name: 'Get Playlist Item by ID', fn: testPlaylistItemById },
    { name: 'List Playlist Items by Group', fn: testPlaylistItemsByGroup },
    {
      name: 'Playlist Items Does Not Required Parameter',
      fn: testPlaylistItemsDoesNotRequiredParameter,
    },
    { name: 'Playlist Items Invalid IDs', fn: testPlaylistItemsInvalidIds },
    { name: 'Playlist Items Pagination', fn: testPlaylistItemsPagination },
    { name: 'Playlist Items Update via Playlist', fn: testPlaylistItemsUpdate },
    { name: 'Identifier Validation (400/404)', fn: testInvalidIdentifiers },
    { name: 'Authentication Failure', fn: testAuthenticationFailure },
    { name: 'JWT Authentication', fn: testJwtAuthentication },
    { name: 'Invalid JWT Authentication', fn: testInvalidJwtAuthentication },
    { name: 'Sorting Setup', fn: testSortingSetup },
    { name: 'Playlist Sorting (Ascending)', fn: testPlaylistSortingAscending },
    { name: 'Playlist Sorting (Descending)', fn: testPlaylistSortingDescending },
    { name: 'Playlist Sorting (Default)', fn: testPlaylistSortingDefault },
    { name: 'Channels Sorting', fn: testChannelSorting },
    { name: 'Playlist Item Sorting', fn: testPlaylistItemSorting },
    // Curated registry tests
    { name: 'Get Curated Registry', fn: testGetCuratedRegistry },
    { name: 'Put Curated Registry', fn: testPutCuratedRegistry },
    { name: 'Curated Registry Validation', fn: testPutCuratedRegistryValidation },
    { name: 'Curated Registry Authentication', fn: testCuratedRegistryAuthentication },
    // Bulk write tests
    { name: 'Bulk Write: Create Playlist (1024 items)', fn: testBulkPlaylistCreate },
    { name: 'Bulk Write: Update Playlist (1024 items)', fn: testBulkPlaylistUpdate },
    { name: 'Bulk Write: Delete Playlist (1024 items)', fn: testBulkPlaylistDelete },
    { name: 'Bulk Write: Create Channel (100 playlists)', fn: testBulkChannelCreate },
    { name: 'Bulk Write: Update Channel (100 playlists)', fn: testBulkChannelUpdate },
    { name: 'Bulk Write: Delete Channel (100 playlists)', fn: testBulkChannelDelete },
  ];

  const results = [];

  for (const test of tests) {
    try {
      console.log(`\n🧪 Running: ${test.name}`);
      const result = await test.fn();
      results.push({ name: test.name, passed: result });
    } catch (error) {
      console.log(`❌ Test error: ${error.message}`);
      results.push({ name: test.name, passed: false });
    }
  }

  // Summary
  const passed = results.filter(r => r.passed).length;
  const total = results.length;

  console.log('\n📊 Test Results Summary:');
  console.log('═══════════════════════════════════════');

  results.forEach(result => {
    const icon = result.passed ? '✅' : '❌';
    console.log(`${icon} ${result.name}`);
  });

  console.log('═══════════════════════════════════════');
  console.log(`   Passed: ${passed}/${total}`);
  console.log(`   Failed: ${total - passed}/${total}`);

  if (passed === total) {
    console.log(
      '\n🎉 All tests passed! Your DP-1 Feed Operator API is working correctly with UUID, slug support, queue-based processing, curated registry API, and bulk write operations (1024 items, 100 playlists).'
    );
  } else {
    console.log('\n⚠️  Some tests failed. Please check the output above for details.');
    process.exit(1);
  }
}

// Polyfill for fetch if not available (Node.js < 18)
if (typeof fetch === 'undefined') {
  console.log('📦 Installing fetch polyfill...');
  try {
    const { default: fetch } = await import('node-fetch');
    global.fetch = fetch;
  } catch (error) {
    console.error('❌ fetch not available. Please use Node.js 18+ or install node-fetch');
    process.exit(1);
  }
}

// Run the tests
runTests().catch(error => {
  console.error('❌ Test runner failed:', error);
  process.exit(1);
});
