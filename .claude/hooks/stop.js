#!/usr/bin/env node
/**
 * Stop Hook for Claude Code
 * Creates automatic snapshot after prompt processing completes
 *
 * This hook:
 * 1. Loads pre-prompt session data
 * 2. Scans files to detect changes made by Claude
 * 3. Creates post-prompt snapshot
 * 4. Records interaction metadata (duration, files modified)
 * 5. Cleans up session files
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Path configuration
const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const trackerDir = path.join(projectRoot, '.codetracker');
const configFile = path.join(trackerDir, 'config.json');
const credentialsFile = path.join(trackerDir, 'credentials.json');
const cacheDir = path.join(trackerDir, 'cache');
const lastSnapshotFile = path.join(cacheDir, 'last_snapshot.json');
const sessionFile = path.join(cacheDir, 'current_session.json');

/**
 * Load JSON file safely
 */
function loadJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return null;
  }
}

/**
 * Save JSON file
 */
function saveJSON(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Check if file should be tracked based on config rules
 * @param {string} filePath - Absolute path to file
 * @param {object} config - Configuration object
 * @returns {boolean} True if file should be tracked
 */
function shouldTrackFile(filePath, config) {
  const relativePath = path.relative(projectRoot, filePath);
  const basename = path.basename(filePath);

  // Check ignore patterns (supports wildcards)
  for (const pattern of config.ignore_patterns) {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    if (regex.test(relativePath) || regex.test(basename)) {
      return false;
    }
  }

  // Check file extension whitelist
  const ext = path.extname(filePath);
  return config.track_extensions.includes(ext);
}

/**
 * Recursively scan and collect all tracked files with hashes
 * @param {object} config - Configuration object
 * @returns {object} Map of relative paths to file info (hash, content, size)
 */
function getTrackedFiles(config) {
  const trackedFiles = {};
  const maxSize = config.max_file_size || 1024 * 1024; // Default 1MB

  function scanDirectory(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Recursively scan subdirectories
          scanDirectory(fullPath);
        } else if (entry.isFile() && shouldTrackFile(fullPath, config)) {
          try {
            const stats = fs.statSync(fullPath);

            // Skip files exceeding max size
            if (stats.size > maxSize) continue;

            const content = fs.readFileSync(fullPath);
            const hash = crypto.createHash('sha256').update(content).digest('hex');
            const relativePath = path.relative(projectRoot, fullPath);

            trackedFiles[relativePath] = {
              hash,
              content: content.toString('utf8'),
              size: stats.size
            };
          } catch (e) {
            // Skip files with read errors (permissions, etc.)
          }
        }
      }
    } catch (e) {
      // Skip directories with read errors (permissions, etc.)
    }
  }

  scanDirectory(projectRoot);
  return trackedFiles;
}

/**
 * Calculate file changes between snapshots
 * @param {object} currentFiles - Current file state
 * @param {object} previousFiles - Previous snapshot state (can be null for first snapshot)
 * @returns {Array} Array of change objects (added/modified/deleted)
 */
function calculateDiff(currentFiles, previousFiles) {
  const changes = [];

  // First snapshot: all files are new
  if (!previousFiles) {
    for (const [filePath, info] of Object.entries(currentFiles)) {
      changes.push({
        path: filePath,
        type: 'added',
        hash: info.hash,
        content: info.content,
        size: info.size,
        lines_added: info.content.split('\n').length
      });
    }
    return changes;
  }

  // Detect added and modified files
  for (const [filePath, info] of Object.entries(currentFiles)) {
    const previousFile = previousFiles[filePath];

    if (!previousFile) {
      // New file
      changes.push({
        path: filePath,
        type: 'added',
        hash: info.hash,
        content: info.content,
        size: info.size,
        lines_added: info.content.split('\n').length
      });
    } else if (previousFile.hash !== info.hash) {
      // Modified file (hash changed)
      changes.push({
        path: filePath,
        type: 'modified',
        hash: info.hash,
        content: info.content,
        size: info.size,
        previous_hash: previousFile.hash,
        lines_added: info.content.split('\n').length
      });
    }
    // Unchanged files are skipped
  }

  // Detect deleted files
  for (const filePath of Object.keys(previousFiles)) {
    if (!currentFiles[filePath]) {
      changes.push({
        path: filePath,
        type: 'deleted',
        previous_hash: previousFiles[filePath].hash,
        lines_removed: 0
      });
    }
  }

  return changes;
}

/**
 * Create post-prompt snapshot and record interaction
 * @param {object} sessionData - Session data from pre-prompt hook
 * @param {string} timestamp - ISO timestamp when hook triggered
 * @returns {string|null} Interaction ID if successful, null otherwise
 */
async function createPostPromptSnapshot(sessionData, timestamp) {
  const config = loadJSON(configFile);
  const credentials = loadJSON(credentialsFile);

  // Validate configuration and credentials
  if (!config || !credentials || !credentials.api_key || !credentials.current_project_id) {
    return null;
  }

  // Scan files and calculate changes from last snapshot
  const currentFiles = getTrackedFiles(config);
  const previousSnapshot = loadJSON(lastSnapshotFile);
  const changes = calculateDiff(currentFiles, previousSnapshot);

  // Optionally skip if no changes detected
  const autoConfig = config.auto_snapshot || {};
  if (changes.length === 0 && autoConfig.only_on_changes) {
    return null;
  }

  try {
    const serverUrl = config.server_url || 'http://localhost:5000';

    // Create post-prompt snapshot
    const snapshotResponse = await fetch(`${serverUrl}/api/snapshots`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': credentials.api_key
      },
      body: JSON.stringify({
        project_id: credentials.current_project_id,
        message: `[AUTO-POST] ${sessionData.prompt.substring(0, 100)}`,
        changes,
        parent_snapshot_id: sessionData.pre_snapshot_id,
        claude_session_id: sessionData.claude_session_id
      })
    });

    if (!snapshotResponse.ok) {
      return null;
    }

    const snapshotData = await snapshotResponse.json();
    const postSnapshotId = snapshotData.snapshot_id;

    // Calculate interaction duration
    let duration = 0;
    if (sessionData.started_at && timestamp) {
      try {
        const start = new Date(sessionData.started_at);
        const end = new Date(timestamp);
        duration = (end - start) / 1000; // Convert to seconds
      } catch (e) {
        // Ignore timestamp parsing errors
      }
    }

    // Record interaction metadata
    const interactionResponse = await fetch(`${serverUrl}/api/interactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': credentials.api_key
      },
      body: JSON.stringify({
        project_id: credentials.current_project_id,
        prompt_text: sessionData.prompt,
        claude_session_id: sessionData.claude_session_id,
        pre_snapshot_id: sessionData.pre_snapshot_id,
        post_snapshot_id: postSnapshotId,
        files_modified: changes.length,
        duration_seconds: duration
      })
    });

    if (!interactionResponse.ok) {
      return null;
    }

    // Save snapshot state for next diff calculation
    const snapshotFileData = {};
    for (const [filePath, info] of Object.entries(currentFiles)) {
      snapshotFileData[filePath] = {
        hash: info.hash,
        size: info.size
      };
    }
    saveJSON(lastSnapshotFile, snapshotFileData);

    const interactionData = await interactionResponse.json();
    return interactionData.interaction_id;
  } catch (e) {
    // Silently fail on network errors
    return null;
  }
}

/**
 * Main entry point - reads hook data from stdin and processes post-prompt snapshot
 */
async function main() {
  try {
    // Read hook data from stdin (JSON format)
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
    }

    const hookData = JSON.parse(input);
    const timestamp = hookData.timestamp || new Date().toISOString();

    // Load session data saved by pre-prompt hook
    const sessionData = loadJSON(sessionFile);

    if (!sessionData) {
      // No session data - pre-prompt snapshot wasn't created, nothing to do
      process.exit(0);
    }

    // Create post-prompt snapshot and record interaction
    const interactionId = await createPostPromptSnapshot(sessionData, timestamp);

    // Clean up session file for next interaction
    if (interactionId) {
      try {
        fs.unlinkSync(sessionFile);
      } catch (e) {
        // Ignore deletion errors
      }
    }
  } catch (e) {
    // Fail silently - never block Claude from running
  }

  // Always exit with success code
  process.exit(0);
}

main();
