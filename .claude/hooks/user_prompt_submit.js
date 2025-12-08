#!/usr/bin/env node
/**
 * UserPromptSubmit Hook for Claude Code
 * Creates automatic snapshot before each prompt is processed
 *
 * This hook:
 * 1. Scans all tracked files in the project
 * 2. Calculates changes from last snapshot
 * 3. Sends changes to CodeTracker server
 * 4. Saves session info for post-prompt processing
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
 * Create pre-prompt snapshot and send to server
 * @param {string} prompt - User's prompt text
 * @param {string} sessionId - Claude session ID
 * @param {string} timestamp - ISO timestamp
 * @returns {string|null} Snapshot ID if successful, null otherwise
 */
async function createPrePromptSnapshot(prompt, sessionId, timestamp) {
  const config = loadJSON(configFile);
  const credentials = loadJSON(credentialsFile);

  // Validate configuration and credentials
  if (!config || !credentials || !credentials.api_key || !credentials.current_project_id) {
    return null;
  }

  // Check if auto-snapshot is enabled
  const autoConfig = config.auto_snapshot || {};
  if (autoConfig.enabled === false) {
    return null;
  }

  // Skip prompts matching certain patterns (e.g., "help", "what is")
  const skipPatterns = autoConfig.skip_patterns || [];
  for (const pattern of skipPatterns) {
    const regex = new RegExp(pattern, 'i');
    if (regex.test(prompt)) {
      return null;
    }
  }

  // Scan files and calculate changes
  const currentFiles = getTrackedFiles(config);
  const previousSnapshot = loadJSON(lastSnapshotFile);
  const changes = calculateDiff(currentFiles, previousSnapshot);

  // Note: UserPromptSubmit should NOT skip based on only_on_changes
  // We always want to record the pre-prompt state, even if no user changes yet
  // The only_on_changes check should only apply in the Stop hook

  try {
    const serverUrl = config.server_url || 'http://localhost:5000';

    // Send snapshot to server
    const response = await fetch(`${serverUrl}/api/snapshots`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': credentials.api_key
      },
      body: JSON.stringify({
        project_id: credentials.current_project_id,
        message: `[AUTO-PRE] ${prompt.substring(0, 100)}`,
        changes,
        claude_session_id: sessionId
      })
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const snapshotId = data.snapshot_id;

    // Save snapshot state for next diff calculation
    const snapshotData = {};
    for (const [filePath, info] of Object.entries(currentFiles)) {
      snapshotData[filePath] = {
        hash: info.hash,
        size: info.size
      };
    }
    saveJSON(lastSnapshotFile, snapshotData);

    return snapshotId;
  } catch (e) {
    // Silently fail on network errors
    return null;
  }
}

/**
 * Main entry point - reads hook data from stdin and creates snapshot
 */
async function main() {
  try {
    // Read hook data from stdin (JSON format)
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
    }

    const hookData = JSON.parse(input);
    const prompt = hookData.prompt || '';
    const sessionId = hookData.session_id || '';
    const timestamp = hookData.timestamp || new Date().toISOString();

    // Skip empty prompts
    if (!prompt.trim()) {
      process.exit(0);
    }

    // Create pre-prompt snapshot
    const snapshotId = await createPrePromptSnapshot(prompt, sessionId, timestamp);

    // Save session info for stop hook to use
    if (snapshotId) {
      saveJSON(sessionFile, {
        pre_snapshot_id: snapshotId,
        prompt,
        claude_session_id: sessionId,
        started_at: timestamp
      });
    }
  } catch (e) {
    // Fail silently - never block Claude from running
  }

  // Always exit with success code
  process.exit(0);
}

main();
