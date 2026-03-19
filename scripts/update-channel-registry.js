#!/usr/bin/env node

/**
 * Update Channel Registry and Optionally Trigger Database Snapshot
 *
 * This script updates the channel registry on the feed server and optionally
 * triggers a GitHub workflow to create a database snapshot.
 *
 * Usage:
 *   node scripts/update-channel-registry.js --artifact <path> --api-key <key> --publisher <name> [--github-token <token>] [--mode <append|replace>] [--dryrun]
 *
 * Examples:
 *   # Append mode (default) - add channel to existing publisher channels
 *   node scripts/update-channel-registry.js \
 *     --artifact dp1-feed-publish-artifact.json \
 *     --api-key YOUR_API_KEY \
 *     --publisher "Feral File" \
 *     --github-token ghp_xxx
 *
 *   # Replace mode - replace all channels for a publisher
 *   node scripts/update-channel-registry.js \
 *     --artifact dp1-feed-publish-artifact.json \
 *     --api-key YOUR_API_KEY \
 *     --publisher "Feral File" \
 *     --github-token ghp_xxx \
 *     --mode replace
 *
 *   # Dry-run mode - skip registry update, just print logs
 *   node scripts/update-channel-registry.js \
 *     --artifact dp1-feed-publish-artifact.json \
 *     --api-key YOUR_API_KEY \
 *     --publisher "Feral File" \
 *     --github-token ghp_xxx \
 *     --dryrun
 */

import fs from 'fs';

const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_REPO_OWNER = 'feral-file';
const GITHUB_REPO_NAME = 'ff-app';
const WORKFLOW_FILE = 'create-db-snapshot.yml';
const WORKFLOW_CHECK_INTERVAL_MS = 10000; // 10 seconds
const WORKFLOW_TIMEOUT_MS = 600000; // 10 minutes
const REGISTRY_VERIFICATION_INTERVAL_MS = 3000; // 3 seconds
const REGISTRY_VERIFICATION_TIMEOUT_MS = 60000; // 60 seconds

/**
 * Parse command line flags
 */
function parseArgs() {
  const args = process.argv.slice(2);

  const getFlag = flag => {
    const index = args.indexOf(flag);
    if (index !== -1 && args[index + 1]) {
      return args[index + 1];
    }
    return null;
  };

  const hasFlag = flag => args.includes(flag);

  const artifactPath = getFlag('--artifact');
  const apiKey = getFlag('--api-key');
  const publisher = getFlag('--publisher');
  const githubToken = getFlag('--github-token');
  const mode = getFlag('--mode') || 'append';
  const dryrun = hasFlag('--dryrun');

  return {
    artifactPath,
    apiKey,
    publisher,
    githubToken,
    mode,
    dryrun,
  };
}

/**
 * Validate required arguments
 */
function validateArgs(args) {
  const errors = [];

  if (!args.artifactPath) {
    errors.push('--artifact is required');
  }
  if (!args.apiKey) {
    errors.push('--api-key is required');
  }
  if (!args.publisher) {
    errors.push('--publisher is required');
  }
  if (!['append', 'replace'].includes(args.mode)) {
    errors.push('--mode must be either "append" or "replace"');
  }

  if (errors.length > 0) {
    console.error('Error: Missing or invalid required arguments:\n');
    errors.forEach(err => console.error(`  - ${err}`));
    console.error('\nUsage:');
    console.error(
      '  node scripts/update-channel-registry.js --artifact <path> --api-key <key> --publisher <name> [--github-token <token>] [--mode <append|replace>] [--dryrun]'
    );
    console.error('\nRequired flags:');
    console.error('  --artifact       Path to dp1-feed-publish-artifact.json');
    console.error('  --api-key        API key for Feed server authentication');
    console.error('  --publisher      Publisher name (e.g., "Feral File")');
    console.error('\nOptional flags:');
    console.error(
      '  --github-token   GitHub personal access token (triggers workflow if provided)'
    );
    console.error('  --mode           Update mode: "append" (default) or "replace"');
    console.error(
      '  --dryrun         Skip registry update, just print logs (passes dryrun=true to workflow)'
    );
    console.error('\nExamples:');
    console.error('  # With GitHub workflow trigger:');
    console.error('  node scripts/update-channel-registry.js \\');
    console.error('    --artifact dp1-feed-publish-artifact.json \\');
    console.error('    --api-key YOUR_API_KEY \\');
    console.error('    --publisher "Feral File" \\');
    console.error('    --github-token ghp_xxx');
    console.error('');
    console.error('  # Without GitHub workflow trigger:');
    console.error('  node scripts/update-channel-registry.js \\');
    console.error('    --artifact dp1-feed-publish-artifact.json \\');
    console.error('    --api-key YOUR_API_KEY \\');
    console.error('    --publisher "Feral File"');
    process.exit(1);
  }
}

/**
 * Read and parse the publish artifact file
 */
function readPublishArtifact(artifactPath) {
  console.log(`📖 Reading publish artifact: ${artifactPath}`);

  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Artifact file not found: ${artifactPath}`);
  }

  try {
    const content = fs.readFileSync(artifactPath, 'utf-8');
    const artifact = JSON.parse(content);

    if (!artifact.channels || !Array.isArray(artifact.channels)) {
      throw new Error('Invalid artifact: missing channels array');
    }

    if (!artifact.canonical_origin) {
      throw new Error('Invalid artifact: missing canonical_origin');
    }

    console.log(`✓ Artifact read successfully`);
    console.log(`  Schema version: ${artifact.schema_version}`);
    console.log(`  Mode: ${artifact.mode}`);
    console.log(`  Channels: ${artifact.channels.length}`);
    console.log(`  Canonical origin: ${artifact.canonical_origin}`);

    return artifact;
  } catch (error) {
    throw new Error(`Failed to read artifact: ${error.message}`);
  }
}

/**
 * Extract channel URLs from artifact
 */
function extractChannelUrls(artifact) {
  console.log('\n📋 Extracting channel URLs from artifact...');

  const channelUrls = [];

  for (const channelItem of artifact.channels) {
    if (channelItem.status === 'success' && channelItem.channel?.url) {
      channelUrls.push(channelItem.channel.url);
      console.log(
        `  ✓ ${channelItem.channel?.title || channelItem.source_folder}: ${channelItem.channel.url}`
      );
    } else {
      console.log(`  ⚠️  Skipping ${channelItem.source_folder}: status=${channelItem.status}`);
    }
  }

  if (channelUrls.length === 0) {
    throw new Error('No successful channels with URLs found in artifact');
  }

  console.log(`\n✓ Extracted ${channelUrls.length} channel URL(s)`);
  return channelUrls;
}

/**
 * Normalize feed host to origin
 */
function normalizeFeedHost(feedHost) {
  try {
    const url = new URL(feedHost);
    return url.origin;
  } catch (error) {
    throw new Error(`Invalid feed host URL: ${feedHost}`);
  }
}

/**
 * Fetch current channel registry from feed server
 * Returns an array of registry items: [{ name, channel_urls }, ...]
 */
async function fetchChannelRegistry(feedHost) {
  const registryUrl = `${feedHost}/api/v1/registry/channels`;

  console.log(`\n🔍 Fetching current channel registry...`);
  console.log(`  URL: ${registryUrl}`);

  try {
    const response = await fetch(registryUrl);

    if (!response.ok) {
      // If 404, registry might not exist yet - return empty array
      if (response.status === 404) {
        console.log(`  ⚠️  Registry not found (404), will create new one`);
        return [];
      }
      throw new Error(`Failed to fetch registry: ${response.status} ${response.statusText}`);
    }

    const registry = await response.json();
    console.log(`  ✓ Registry fetched successfully`);

    if (Array.isArray(registry)) {
      const totalChannels = registry.reduce(
        (sum, item) => sum + (item.channel_urls?.length || 0),
        0
      );
      console.log(`  Current publishers: ${registry.length}`);
      console.log(`  Total channels: ${totalChannels}`);
    }

    return registry;
  } catch (error) {
    if (error.message.includes('fetch failed')) {
      throw new Error(`Network error fetching registry: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Extract UUID from channel URL
 * Expected format: .../api/v1/channels/{uuid}
 */
function extractChannelUuid(url) {
  const match = url.match(/\/api\/v1\/channels\/([a-f0-9-]+)$/i);
  return match ? match[1] : null;
}

/**
 * Build updated registry based on mode
 * Registry format: [{ name: "Publisher Name", channel_urls: [...] }, ...]
 */
function buildUpdatedRegistry(currentRegistry, newChannelUrls, publisher, mode) {
  console.log(`\n🔨 Building updated registry...`);
  console.log(`  Mode: ${mode}`);
  console.log(`  Publisher: ${publisher}`);
  console.log(`  New channels: ${newChannelUrls.length}`);

  // Ensure currentRegistry is an array
  const registryArray = Array.isArray(currentRegistry) ? currentRegistry : [];

  let updatedRegistry = [];

  if (mode === 'replace') {
    // Replace mode: keep all publishers except the one we're updating
    updatedRegistry = registryArray.filter(item => item.name !== publisher);
    console.log(`  Keeping ${updatedRegistry.length} other publisher(s)`);
  } else if (mode === 'append') {
    // Append mode: keep all existing publishers
    updatedRegistry = [...registryArray];
    console.log(`  Keeping all ${updatedRegistry.length} existing publisher(s)`);
  }

  // Find or create the publisher entry
  let publisherEntry = updatedRegistry.find(item => item.name === publisher);

  if (!publisherEntry) {
    // Create new publisher entry
    publisherEntry = {
      name: publisher,
      channel_urls: [],
    };
    updatedRegistry.push(publisherEntry);
    console.log(`  Creating new entry for publisher: ${publisher}`);
  } else {
    console.log(`  Found existing entry for publisher: ${publisher}`);
    console.log(`    Current channels: ${publisherEntry.channel_urls.length}`);
  }

  // Add new channels to the publisher
  let addedCount = 0;
  let replacedCount = 0;
  let skippedCount = 0;

  for (const newUrl of newChannelUrls) {
    const newUuid = extractChannelUuid(newUrl);

    if (!newUuid) {
      console.log(`  ⚠️  Invalid channel URL (no UUID found): ${newUrl}`);
      skippedCount++;
      continue;
    }

    if (mode === 'replace') {
      // In replace mode, we already filtered out the publisher, so just add
      publisherEntry.channel_urls.push(newUrl);
      addedCount++;
    } else if (mode === 'append') {
      // In append mode, check if this UUID already exists (regardless of host)
      const existingIndex = publisherEntry.channel_urls.findIndex(existingUrl => {
        const existingUuid = extractChannelUuid(existingUrl);
        return existingUuid === newUuid;
      });

      if (existingIndex !== -1) {
        const oldUrl = publisherEntry.channel_urls[existingIndex];

        // Check if URLs are identical
        if (oldUrl === newUrl) {
          console.log(`  ⚠️  Channel already exists (same URL): ${newUuid}`);
          skippedCount++;
        } else {
          // Remove the old URL and append the new one
          publisherEntry.channel_urls.splice(existingIndex, 1);
          publisherEntry.channel_urls.push(newUrl);
          console.log(`  🔄 Replaced channel ${newUuid}:`);
          console.log(`     Old: ${oldUrl}`);
          console.log(`     New: ${newUrl}`);
          replacedCount++;
        }
      } else {
        // New channel, append to the end
        publisherEntry.channel_urls.push(newUrl);
        console.log(`  ✓ Added new channel: ${newUuid}`);
        addedCount++;
      }
    }
  }

  if (addedCount > 0) {
    console.log(`  Added ${addedCount} new channel(s)`);
  }
  if (replacedCount > 0) {
    console.log(`  Replaced ${replacedCount} existing channel(s) with updated URLs`);
  }
  if (skippedCount > 0) {
    console.log(`  Skipped ${skippedCount} duplicate(s) or invalid URL(s)`);
  }

  const totalChannels = updatedRegistry.reduce((sum, item) => sum + item.channel_urls.length, 0);
  console.log(
    `  ✓ Updated registry: ${updatedRegistry.length} publisher(s), ${totalChannels} total channel(s)`
  );

  return updatedRegistry;
}

/**
 * Update channel registry on feed server
 * Registry must be an array: [{ name, channel_urls }, ...]
 */
async function updateChannelRegistry(feedHost, apiKey, registryArray, dryrun = false) {
  const registryUrl = `${feedHost}/api/v1/registry/channels`;

  console.log(`\n📤 ${dryrun ? '[DRY RUN] ' : ''}Updating channel registry...`);
  console.log(`  URL: ${registryUrl}`);
  const totalChannels = registryArray.reduce((sum, item) => sum + item.channel_urls.length, 0);
  console.log(`  Publishers: ${registryArray.length}`);
  console.log(`  Total channels: ${totalChannels}`);

  if (dryrun) {
    console.log(`\n  🔍 DRY RUN MODE - Registry update skipped`);
    console.log(`  Registry data that would be sent:`);
    console.log(JSON.stringify(registryArray, null, 2));
    return;
  }

  try {
    const response = await fetch(registryUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(registryArray),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to update registry: ${response.status} ${response.statusText}\n${errorText}`
      );
    }

    const result = await response.json();
    console.log(`  ✓ Registry updated successfully`);
    console.log(`  Items: ${result.items_count || 0}`);
    console.log(`  Total channels: ${result.total_channels || 0}`);

    return result;
  } catch (error) {
    if (error.message.includes('fetch failed')) {
      throw new Error(`Network error updating registry: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Verify registry update has taken effect (not cached)
 * Polls the registry endpoint until the expected data is returned
 */
async function verifyRegistryUpdate(feedHost, expectedRegistry) {
  console.log(`\n🔍 Verifying registry update has taken effect...`);
  console.log(`  Expected publishers: ${expectedRegistry.length}`);
  const expectedTotalChannels = expectedRegistry.reduce(
    (sum, item) => sum + item.channel_urls.length,
    0
  );
  console.log(`  Expected total channels: ${expectedTotalChannels}`);

  const startTime = Date.now();
  let attempts = 0;

  while (true) {
    const elapsed = Date.now() - startTime;
    attempts++;

    if (elapsed > REGISTRY_VERIFICATION_TIMEOUT_MS) {
      console.warn(
        `\n⚠️  Registry verification timeout after ${REGISTRY_VERIFICATION_TIMEOUT_MS / 1000}s`
      );
      console.warn(`  The registry may still be cached. Proceeding anyway...`);
      return false;
    }

    try {
      // Fetch with cache-busting query parameter
      const cacheBuster = Date.now();
      const registryUrl = `${feedHost}/api/v1/registry/channels?_=${cacheBuster}`;

      const response = await fetch(registryUrl, {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
        },
      });

      if (!response.ok) {
        console.log(
          `  Attempt ${attempts}: Registry fetch failed (${response.status}), retrying...`
        );
        await new Promise(resolve => setTimeout(resolve, REGISTRY_VERIFICATION_INTERVAL_MS));
        continue;
      }

      const currentRegistry = await response.json();

      if (!Array.isArray(currentRegistry)) {
        console.log(`  Attempt ${attempts}: Registry format unexpected, retrying...`);
        await new Promise(resolve => setTimeout(resolve, REGISTRY_VERIFICATION_INTERVAL_MS));
        continue;
      }

      // Compare the registry data
      const currentTotalChannels = currentRegistry.reduce(
        (sum, item) => sum + (item.channel_urls?.length || 0),
        0
      );

      // Check if the data matches expectations
      if (
        currentRegistry.length === expectedRegistry.length &&
        currentTotalChannels === expectedTotalChannels
      ) {
        // Deep verification: check that all expected publishers and channels exist
        let allMatch = true;

        for (const expectedItem of expectedRegistry) {
          const currentItem = currentRegistry.find(item => item.name === expectedItem.name);

          if (!currentItem) {
            allMatch = false;
            break;
          }

          if (currentItem.channel_urls.length !== expectedItem.channel_urls.length) {
            allMatch = false;
            break;
          }

          // Check if all URLs match (order-independent)
          const currentUrls = new Set(currentItem.channel_urls);
          for (const url of expectedItem.channel_urls) {
            if (!currentUrls.has(url)) {
              allMatch = false;
              break;
            }
          }

          if (!allMatch) break;
        }

        if (allMatch) {
          console.log(
            `  ✓ Registry update verified! (took ${((Date.now() - startTime) / 1000).toFixed(1)}s)`
          );
          console.log(`    Publishers: ${currentRegistry.length}`);
          console.log(`    Total channels: ${currentTotalChannels}`);
          return true;
        }
      }

      console.log(
        `  Attempt ${attempts}: Registry not yet updated (publishers: ${currentRegistry.length}, channels: ${currentTotalChannels}), retrying...`
      );
      await new Promise(resolve => setTimeout(resolve, REGISTRY_VERIFICATION_INTERVAL_MS));
    } catch (error) {
      console.log(`  Attempt ${attempts}: Error fetching registry: ${error.message}, retrying...`);
      await new Promise(resolve => setTimeout(resolve, REGISTRY_VERIFICATION_INTERVAL_MS));
    }
  }
}

/**
 * Check if GitHub workflow exists
 */
async function checkWorkflowExists(githubToken) {
  const workflowsUrl = `${GITHUB_API_BASE}/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/actions/workflows`;

  try {
    const response = await fetch(workflowsUrl, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${githubToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to list workflows: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const workflows = data.workflows || [];

    // Look for the workflow by filename
    const workflow = workflows.find(w => w.path.endsWith(WORKFLOW_FILE));

    if (!workflow) {
      console.error(`\n❌ Workflow not found: ${WORKFLOW_FILE}`);
      console.error(`\nAvailable workflows in ${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}:`);
      workflows.forEach(w => {
        console.error(`  - ${w.name} (${w.path}) [${w.state}]`);
      });
      throw new Error(`Workflow file "${WORKFLOW_FILE}" not found in repository`);
    }

    console.log(`  ✓ Workflow found: ${workflow.name} (${workflow.state})`);
    return workflow;
  } catch (error) {
    if (error.message.includes('fetch failed')) {
      throw new Error(`Network error checking workflow: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Trigger GitHub workflow
 */
async function triggerGitHubWorkflow(githubToken, feedHost, dryrun = false) {
  const workflowUrl = `${GITHUB_API_BASE}/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
  const channelsSource = `${feedHost}/api/v1/registry/channels`;

  console.log(`\n🚀 Triggering GitHub workflow...`);
  console.log(`  Repository: ${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}`);
  console.log(`  Workflow: ${WORKFLOW_FILE}`);
  console.log(`  Channels source: ${channelsSource}`);
  console.log(`  Dry run: ${dryrun ? 'true' : 'false'}`);

  // First, check if the workflow exists
  await checkWorkflowExists(githubToken);

  try {
    const response = await fetch(workflowUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${githubToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: {
          channels_source: channelsSource,
          dryrun: dryrun ? 'true' : 'false',
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();

      // Provide helpful error messages
      if (response.status === 404) {
        throw new Error(
          `Failed to trigger workflow (404 Not Found).\n` +
            `Possible causes:\n` +
            `  1. Workflow file "${WORKFLOW_FILE}" doesn't exist on branch "main"\n` +
            `  2. Branch "main" doesn't exist (try "master" or another branch)\n` +
            `  3. GitHub token doesn't have "actions" permission\n` +
            `Details: ${errorText}`
        );
      } else if (response.status === 403) {
        throw new Error(
          `Failed to trigger workflow (403 Forbidden).\n` +
            `GitHub token may not have sufficient permissions.\n` +
            `Required scopes: "repo", "workflow"\n` +
            `Details: ${errorText}`
        );
      } else {
        throw new Error(
          `Failed to trigger workflow: ${response.status} ${response.statusText}\n${errorText}`
        );
      }
    }

    console.log(`  ✓ Workflow triggered successfully`);
  } catch (error) {
    if (error.message.includes('fetch failed')) {
      throw new Error(`Network error triggering workflow: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Get recent workflow runs
 */
async function getRecentWorkflowRuns(githubToken, limit = 10) {
  const runsUrl = `${GITHUB_API_BASE}/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=${limit}`;

  try {
    const response = await fetch(runsUrl, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${githubToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get workflow runs: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.workflow_runs || [];
  } catch (error) {
    throw new Error(`Error fetching workflow runs: ${error.message}`);
  }
}

/**
 * Get workflow run status
 */
async function getWorkflowRunStatus(githubToken, runId) {
  const runUrl = `${GITHUB_API_BASE}/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/actions/runs/${runId}`;

  try {
    const response = await fetch(runUrl, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${githubToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get workflow run: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    throw new Error(`Error fetching workflow run status: ${error.message}`);
  }
}

/**
 * Wait for workflow to complete by finding the newly created run
 */
async function waitForWorkflowCompletion(githubToken, existingRunIds) {
  console.log(`\n⏳ Waiting for workflow to start...`);

  const startTime = Date.now();

  // Wait for GitHub to create the workflow run
  console.log(`  Waiting 10 seconds for workflow to be created...`);
  await new Promise(resolve => setTimeout(resolve, 10000));

  let workflowRun = null;
  let attempts = 0;
  const maxAttempts = 18; // Try for 3 minutes to find the new run

  // Find the newly triggered run by comparing with existing runs
  while (!workflowRun && attempts < maxAttempts) {
    attempts++;

    try {
      const runs = await getRecentWorkflowRuns(githubToken, 20);

      // Find a run that wasn't in the existing set
      const newRuns = runs.filter(run => !existingRunIds.has(run.id));

      if (newRuns.length > 0) {
        // Get the most recent new run (runs are sorted by created_at desc)
        workflowRun = newRuns[0];
        console.log(`  ✓ Workflow run found: #${workflowRun.run_number} (${workflowRun.id})`);
        console.log(`  Status: ${workflowRun.status}`);
        console.log(`  Created: ${workflowRun.created_at}`);
        console.log(`  URL: ${workflowRun.html_url}`);
        break;
      }

      if (attempts < maxAttempts) {
        console.log(`  Attempt ${attempts}/${maxAttempts}: Workflow not yet visible, waiting...`);
        if (attempts === 6) {
          console.log(`  💡 Tip: Check if workflow is visible at:`);
          console.log(`     https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/actions`);
        }
        await new Promise(resolve => setTimeout(resolve, WORKFLOW_CHECK_INTERVAL_MS));
      }
    } catch (error) {
      console.warn(`  ⚠️  Error checking for workflow run: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, WORKFLOW_CHECK_INTERVAL_MS));
    }
  }

  if (!workflowRun) {
    console.warn(`  ⚠️  Could not find the triggered workflow run after ${attempts} attempts`);
    console.warn(`  The workflow may still be running. Check manually at:`);
    console.warn(
      `  https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/actions/workflows/${WORKFLOW_FILE}`
    );
    console.warn(`\n  Note: The workflow was successfully triggered.`);
    return null;
  }

  // Now monitor the run until completion
  console.log(`\n⏳ Monitoring workflow progress...`);

  while (true) {
    const elapsed = Date.now() - startTime;

    if (elapsed > WORKFLOW_TIMEOUT_MS) {
      console.log(`\n⚠️  Workflow timeout (${WORKFLOW_TIMEOUT_MS / 1000}s)`);
      console.log(`  Workflow may still be running. Check status at:`);
      console.log(`  ${workflowRun.html_url}`);
      return workflowRun;
    }

    try {
      const run = await getWorkflowRunStatus(githubToken, workflowRun.id);

      if (run.status === 'completed') {
        console.log(`\n✓ Workflow completed!`);
        console.log(`  Conclusion: ${run.conclusion}`);
        console.log(
          `  Duration: ${((new Date(run.updated_at) - new Date(run.created_at)) / 1000).toFixed(1)}s`
        );
        console.log(`  URL: ${run.html_url}`);

        if (run.conclusion === 'success') {
          console.log(`\n✅ Database snapshot created successfully!`);
        } else {
          console.log(`\n⚠️  Workflow completed with conclusion: ${run.conclusion}`);
        }

        return run;
      }

      // Still running
      const elapsedSeconds = Math.floor(elapsed / 1000);
      console.log(
        `  [${elapsedSeconds}s] Status: ${run.status}, checking again in ${WORKFLOW_CHECK_INTERVAL_MS / 1000}s...`
      );

      await new Promise(resolve => setTimeout(resolve, WORKFLOW_CHECK_INTERVAL_MS));
    } catch (error) {
      console.warn(`  ⚠️  Error checking workflow status: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, WORKFLOW_CHECK_INTERVAL_MS));
    }
  }
}

/**
 * Main function
 */
async function main() {
  console.log('🔧 Channel Registry Update Tool\n');

  const args = parseArgs();
  validateArgs(args);

  if (args.dryrun) {
    console.log('🔍 DRY RUN MODE ENABLED - No actual updates will be made\n');
  }

  const startTime = Date.now();

  try {
    // Step 1: Read artifact and extract feed host and channel URLs
    const artifact = readPublishArtifact(args.artifactPath);
    const feedHost = normalizeFeedHost(artifact.canonical_origin);
    const channelUrls = extractChannelUrls(artifact);

    console.log(`\n🌐 Feed host: ${feedHost}`);

    // Step 2: Fetch current registry (in append mode)
    let currentRegistry = null;
    if (args.mode === 'append' || args.mode === 'replace') {
      try {
        currentRegistry = await fetchChannelRegistry(feedHost);
      } catch (error) {
        console.warn(`  ⚠️  Warning: Could not fetch current registry: ${error.message}`);
        console.warn(`  Proceeding with empty registry...`);
      }
    }

    // Step 3: Build updated registry
    const updatedRegistry = buildUpdatedRegistry(
      currentRegistry,
      channelUrls,
      args.publisher,
      args.mode
    );

    // Step 4: Update registry on server (skip if dry-run)
    await updateChannelRegistry(feedHost, args.apiKey, updatedRegistry, args.dryrun);

    // Step 5, 6 & 7: Optionally trigger GitHub workflow if token provided
    if (args.githubToken) {
      console.log(`\n${'='.repeat(80)}`);
      console.log('GitHub Workflow');
      console.log('='.repeat(80));

      // Step 5: Verify registry update has taken effect (skip if dry-run)
      if (!args.dryrun) {
        await verifyRegistryUpdate(feedHost, updatedRegistry);
      } else {
        console.log('\n  🔍 DRY RUN - Skipping registry verification');
      }

      // Step 6: Get existing workflow runs before triggering
      let existingRunIds = new Set();
      try {
        const existingRuns = await getRecentWorkflowRuns(args.githubToken, 20);
        existingRuns.forEach(run => existingRunIds.add(run.id));
        console.log(`\n  Recorded ${existingRunIds.size} existing workflow run(s)`);
      } catch (error) {
        console.warn(`  ⚠️  Could not fetch existing runs: ${error.message}`);
      }

      // Step 7: Trigger GitHub workflow
      await triggerGitHubWorkflow(args.githubToken, feedHost, args.dryrun);

      // Step 8: Wait for workflow completion
      const workflowRun = await waitForWorkflowCompletion(args.githubToken, existingRunIds);

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\n${'='.repeat(80)}`);
      console.log(`✅ Process completed successfully!${args.dryrun ? ' (DRY RUN)' : ''}`);
      console.log(`   Total duration: ${duration}s`);
      console.log('='.repeat(80));

      if (workflowRun && workflowRun.conclusion !== 'success') {
        process.exit(1);
      }
    } else {
      console.log(`\n${'='.repeat(80)}`);
      console.log('GitHub Workflow');
      console.log('='.repeat(80));
      console.log('⚠️  No GitHub token provided - skipping workflow trigger');
      console.log('   To trigger the database snapshot workflow, provide --github-token');

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\n${'='.repeat(80)}`);
      console.log(`✅ Registry update completed successfully!${args.dryrun ? ' (DRY RUN)' : ''}`);
      console.log(`   Total duration: ${duration}s`);
      console.log(`   Note: GitHub workflow was not triggered`);
      console.log('='.repeat(80));
    }
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    if (error.stack && process.env.DEBUG) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run the script
main();
