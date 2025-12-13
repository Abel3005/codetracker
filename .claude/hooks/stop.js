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
 * Convert gitignore-style pattern to regex string
 * Supports: *, **, ?, and path separators
 * @param {string} pattern - Gitignore pattern
 * @returns {string} Regex pattern string
 */
function patternToRegex(pattern) {
  let result = '';
  let i = 0;

  while (i < pattern.length) {
    const ch = pattern[i];

    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        // Handle **
        if (pattern[i + 2] === '/') {
          // **/ matches zero or more directories
          result += '(?:.*/)?';
          i += 3;
          continue;
        } else if (i + 2 === pattern.length) {
          // ** at end matches everything
          result += '.*';
          i += 2;
          continue;
        }
        // ** in middle
        result += '.*';
        i += 2;
      } else {
        // * matches anything except /
        result += '[^/]*';
        i++;
      }
    } else if (ch === '?') {
      // ? matches single character except /
      result += '[^/]';
      i++;
    } else if ('[.+^${}()|\\]'.includes(ch)) {
      // Escape regex special characters
      result += '\\' + ch;
      i++;
    } else {
      result += ch;
      i++;
    }
  }

  return result;
}

/**
 * Match a single gitignore pattern against a path
 * @param {string} pattern - Gitignore pattern
 * @param {string} relativePath - Relative path from project root
 * @param {string} basename - Base name of file/directory
 * @returns {boolean} True if pattern matches
 */
function matchPattern(pattern, relativePath, basename) {
  // Normalize path separators to forward slash for cross-platform compatibility
  const normalizedPath = relativePath.replace(/\\/g, '/');

  // Handle directory patterns (ending with /)
  if (pattern.endsWith('/')) {
    const dirPattern = pattern.slice(0, -1);
    const regex = patternToRegex(dirPattern);
    const pathRegex = new RegExp('^' + regex + '(/.*)?$');
    return pathRegex.test(normalizedPath);
  }

  // Pattern with no slash: match against basename or any path component
  if (!pattern.includes('/')) {
    const regex = patternToRegex(pattern);
    const nameRegex = new RegExp('^' + regex + '$');

    // Check basename
    if (nameRegex.test(basename)) {
      return true;
    }

    // Check each path component (for patterns like "node_modules")
    const parts = normalizedPath.split('/');
    for (let i = 0; i < parts.length; i++) {
      if (nameRegex.test(parts[i])) {
        // If this component matches, check if it's a directory pattern
        // by seeing if there's more path after it
        return true;
      }
    }

    return false;
  }

  // Pattern with slash: match against full relative path
  const regex = patternToRegex(pattern);
  const pathRegex = new RegExp('^' + regex + '$');
  return pathRegex.test(normalizedPath);
}

/**
 * Check if path should be ignored based on config rules
 * Implements gitignore-style pattern matching
 * @param {string} filePath - Absolute path to file or directory
 * @param {object} config - Configuration object
 * @returns {boolean} True if path should be ignored
 */
function shouldIgnorePath(filePath, config) {
  const relativePath = path.relative(projectRoot, filePath);
  const basename = path.basename(filePath);

  // Check ignore patterns (gitignore-style)
  for (const pattern of config.ignore_patterns) {
    if (matchPattern(pattern, relativePath, basename)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if file should be tracked based on config rules
 * @param {string} filePath - Absolute path to file
 * @param {object} config - Configuration object
 * @returns {boolean} True if file should be tracked
 */
function shouldTrackFile(filePath, config) {
  // First check if path should be ignored
  if (shouldIgnorePath(filePath, config)) {
    return false;
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
          // Skip ignored directories
          if (shouldIgnorePath(fullPath, config)) {
            continue;
          }
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
 * Server calculates diff statistics (lines_added/removed) using difflib
 * Client only detects which files changed via hash comparison
 *
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
        file_path: filePath,
        type: 'added',
        hash: info.hash,
        content: info.content,
        size: info.size
        // Server calculates lines_added
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
        file_path: filePath,
        type: 'A',
        hash: info.hash,
        content: info.content,
        // Server calculates lines_added
      });
    } else if (previousFile.hash !== info.hash) {
      // Modified file (hash changed)
      changes.push({
        file_path: filePath,
        type: 'M',
        hash: info.hash,
        content: info.content,
        previous_hash: previousFile.hash
        // Server calculates lines_added/removed using difflib
      });
    }
    // Unchanged files (same hash) are skipped - not sent to server
  }

  // Detect deleted files
  for (const filePath of Object.keys(previousFiles)) {
    if (!currentFiles[filePath]) {
      changes.push({
        file_path: filePath,
        type: 'D',
        previous_hash: previousFiles[filePath].hash
        // Server calculates lines_removed from stored content
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
  if (!config || !credentials || !credentials.api_key || !credentials.current_project_hash) {
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
    const snapshotResponse = await fetch(`${serverUrl}/api/interactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': credentials.api_key
      },
      body: JSON.stringify({
        project_hash: credentials.current_project_hash,
        message: `[AUTO-POST] ${sessionData.prompt}`,
        changes,
        parent_snapshot_id: sessionData.pre_snapshot_id,
        claude_session_id: sessionData.claude_session_id,
        started_at: sessionData.started_at,
        ended_at: timestamp
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

    // Save snapshot state for next diff calculation
    // Store hash and size for change detection (content not needed locally)
    const snapshotFileData = {};
    for (const [filePath, info] of Object.entries(currentFiles)) {
      snapshotFileData[filePath] = {
        hash: info.hash,
        size: info.size
      };
    }
    saveJSON(lastSnapshotFile, snapshotFileData);

    return postSnapshotId
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
    const post_snapshot_id = await createPostPromptSnapshot(sessionData, timestamp);

    // Clean up session file for next interaction
    if (post_snapshot_id) {
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
