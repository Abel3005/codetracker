# CodeTracker Server API Specification

## Overview

This document specifies the REST API for the CodeTracker server. The server is responsible for:
- Storing snapshots and file versions
- **Computing diff statistics** (lines added/removed) using server-side algorithms
- Managing user authentication and projects
- Tracking AI interaction history

## Architecture: Hybrid Optimized Approach

### Design Philosophy

**Client-Side (Optimized for Network):**
- Scan all tracked files and calculate SHA256 hashes
- Compare hashes with `last_snapshot.json` (local cache) to detect changes
- **Send ONLY changed files** to server (added/modified/deleted)
- No diff algorithm required (only Node.js built-in modules: crypto, fs, path)

**Server-Side (Optimized for Accuracy):**
- Receive only changed files from client
- Lookup previous file content by `previous_hash`
- Calculate diff statistics using Python `difflib` (Git-like algorithm)
- Store deduplicated file content by hash

### Why This Approach?

| Benefit | Description |
|---------|-------------|
| **Network Efficiency** | Only changed files transmitted (99%+ reduction for typical projects) |
| **No Client Dependencies** | Hooks use only Node.js built-in modules |
| **Accurate Diff** | Server uses proven algorithms (Python difflib, standard library) |
| **Maintainability** | Algorithm changes don't require client updates |
| **Scalability** | Handles large projects (10,000+ files) efficiently |

### Change Detection Mechanism

The client tracks changes using a local cache file (similar to Git's index):

**`.codetracker/cache/last_snapshot.json`**
```json
{
  "src/main.js": {
    "hash": "abc123...",
    "content": "file content...",
    "size": 1234
  },
  "src/utils.js": {
    "hash": "def456...",
    "content": "file content...",
    "size": 567
  }
}
```

**How it works:**

1. **Scan Phase**: Client scans all tracked files and calculates SHA256 hashes
2. **Compare Phase**: Client compares current hashes with `last_snapshot.json`
3. **Detect Phase**: Files with different hashes are marked as "changed"
4. **Send Phase**: Only changed files are sent to server
5. **Update Phase**: After successful server response, `last_snapshot.json` is updated

### Data Flow

```
[Client Hook]                           [Server]

1. Scan all files (e.g., 1000 files)
   └─ Calculate SHA256 for each file

2. Load last_snapshot.json
   └─ Contains hashes from previous snapshot

3. Compare hashes
   ├─ main.js: hash changed  ✓
   ├─ utils.js: hash same    ✗ (skip)
   ├─ new.js: not in cache   ✓
   └─ old.js: deleted        ✓
   → Detected 3 changed files

4. Send ONLY 3 changed files  ⚡        5. Receive 3 changed files
   - main.js (modified)                 6. For modified files:
   - new.js (added)                        - Lookup old content by previous_hash
   - old.js (deleted, no content)          - Run difflib.unified_diff()
                                           - Calculate lines_added/removed
                                        7. For added files:
                                           - Count total lines as lines_added
                                        8. For deleted files:
                                           - Lookup old content by previous_hash
                                           - Count total lines as lines_removed
                                        9. Deduplicate file storage by hash
                                        10. Save to database
                                        11. Return response with calculated stats

12. Update last_snapshot.json
    └─ Store new hashes for next comparison
```

### Network Traffic Comparison

**Example: 1000 files (avg 10KB), 5 files changed per snapshot**

| Approach | Files Sent | Data Size | Reduction |
|----------|------------|-----------|-----------|
| Naive (send all files) | 1000 files | 10 MB | - |
| **Optimized (changed only)** | 5 files | 50 KB | **99.5%** ⚡ |

---

## Authentication

All authenticated endpoints require the `X-API-Key` header:

```http
X-API-Key: <user_api_key>
```

---

## API Endpoints

### 1. User Registration

**Endpoint:** `POST /api/auth/register`

**Description:** Create a new user account

**Request Body:**
```json
{
  "username": "string (3-50 chars, alphanumeric + underscore)",
  "email": "string (valid email)",
  "password": "string (min 8 chars)"
}
```

**Response (201 Created):**
```json
{
  "user_id": "uuid",
  "username": "johndoe",
  "email": "john@example.com",
  "api_key": "generated_api_key_here",
  "created_at": "2024-01-15T10:30:00Z"
}
```

**Errors:**
- `400` - Invalid input (username taken, weak password, invalid email)
- `500` - Server error

---

### 2. User Login

**Endpoint:** `POST /api/auth/login`

**Description:** Authenticate and retrieve API key

**Request Body:**
```json
{
  "username": "string (or email)",
  "password": "string"
}
```

**Response (200 OK):**
```json
{
  "user_id": "uuid",
  "username": "johndoe",
  "email": "john@example.com",
  "api_key": "your_api_key",
  "projects": [
    {
      "project_id": "uuid",
      "project_hash": "sha256_hash",
      "name": "my-project",
      "created_at": "2024-01-15T10:30:00Z"
    }
  ]
}
```

**Errors:**
- `401` - Invalid credentials
- `500` - Server error

---

### 3. Create Project

**Endpoint:** `POST /api/projects`

**Authentication:** Required

**Description:** Create a new project for tracking

**Request Body:**
```json
{
  "name": "string (1-100 chars)",
  "description": "string (optional, max 500 chars)"
}
```

**Response (201 Created):**
```json
{
  "project_id": "uuid",
  "project_hash": "sha256_hash_of_project_id",
  "name": "my-awesome-project",
  "description": "A project description",
  "created_at": "2024-01-15T10:30:00Z"
}
```

**Errors:**
- `401` - Unauthorized (invalid API key)
- `400` - Invalid input (duplicate name, invalid characters)
- `500` - Server error

---

### 4. Create Snapshot (Server-Side Diff Calculation)

**Endpoint:** `POST /api/snapshots`

**Authentication:** Required

**Description:** Create a snapshot with file changes. Client sends ONLY changed files detected via hash comparison with `last_snapshot.json`. Server calculates diff statistics.

**Important:** Client performs hash comparison locally and sends only files with changed hashes.

**Request Body:**
```json
{
  "project_hash": "sha256_hash",
  "message": "string (snapshot description)",
  "changes": [
    {
      "file_path": "relative/path/to/file.js",
      "type": "added | modified | deleted",
      "hash": "sha256_hash_of_new_content",
      "content": "string (full file content for added/modified)",
      "size": 1234,

      // For modified files only:
      "previous_hash": "sha256_hash_of_old_content"

      // For deleted files:
      // - No 'content' field (file deleted)
      // - 'previous_hash' required for server to lookup old content
      // - No 'hash' field
    }
  ],

  // Optional fields:
  "parent_snapshot_id": "uuid (for linked snapshots)",
  "claude_session_id": "string (AI session tracking)"
}
```

**Client Logic Example:**

```javascript
// 1. Scan current files
const currentFiles = {
  "src/main.js": { hash: "new123...", content: "...", size: 1500 },
  "src/utils.js": { hash: "def456...", content: "...", size: 500 }
};

// 2. Load previous snapshot
const previousSnapshot = {
  "src/main.js": { hash: "old456...", content: "...", size: 1200 },
  "src/utils.js": { hash: "def456...", content: "...", size: 500 }
};

// 3. Detect changes by comparing hashes
const changes = [];

// main.js: hash changed (old456 → new123)
if (currentFiles["src/main.js"].hash !== previousSnapshot["src/main.js"].hash) {
  changes.push({
    file_path: "src/main.js",
    type: "modified",
    hash: "new123...",
    content: currentFiles["src/main.js"].content,  // Send content
    size: 1500,
    previous_hash: "old456..."  // Server uses this to find old content
  });
}

// utils.js: hash same (def456 === def456) → NOT included in changes

// 4. Send only 'changes' array to server (1 file instead of 2)
```

**Example Requests:**

**Added File:**
```json
{
  "file_path": "src/new_feature.js",
  "type": "added",
  "hash": "abc123...",
  "content": "function hello() {\n  return 'world';\n}",
  "size": 42
}
```

**Modified File:**
```json
{
  "file_path": "src/existing.js",
  "type": "modified",
  "hash": "def456...",
  "content": "// Updated content\nfunction hello() {\n  return 'updated';\n}",
  "size": 65,
  "previous_hash": "abc123..."
}
```

**Deleted File:**
```json
{
  "file_path": "src/old_file.js",
  "type": "deleted",
  "previous_hash": "xyz789..."
  // No 'content' or 'hash' field for deleted files
}
```

**Complete Request Example:**
```json
{
  "project_hash": "proj_abc123...",
  "message": "[AUTO-PRE] Implement user authentication",
  "changes": [
    {
      "file_path": "src/auth.js",
      "type": "added",
      "hash": "file_hash_1",
      "content": "export function login() { ... }",
      "size": 1234
    },
    {
      "file_path": "src/main.js",
      "type": "modified",
      "hash": "file_hash_2",
      "content": "import { login } from './auth';\n...",
      "size": 2048,
      "previous_hash": "file_hash_old"
    },
    {
      "file_path": "src/deprecated.js",
      "type": "deleted",
      "previous_hash": "file_hash_3"
    }
  ],
  "parent_snapshot_id": "uuid_of_parent",
  "claude_session_id": "session_123"
}
```

**Response (201 Created):**
```json
{
  "snapshot_id": "uuid",
  "project_hash": "sha256_hash",
  "message": "[AUTO-PRE] Implement user authentication",
  "created_at": "2024-01-15T10:35:00Z",
  "changes": [
    {
      "file_path": "src/auth.js",
      "type": "added",
      "hash": "abc123...",
      "size": 1234,
      "lines_added": 45,        // ← Calculated by server
      "lines_removed": 0
    },
    {
      "file_path": "src/main.js",
      "type": "modified",
      "hash": "def456...",
      "previous_hash": "abc789...",
      "size": 2048,
      "lines_added": 12,        // ← Calculated by server (difflib)
      "lines_removed": 5        // ← Calculated by server (difflib)
    },
    {
      "file_path": "src/deprecated.js",
      "type": "deleted",
      "previous_hash": "old123...",
      "lines_added": 0,
      "lines_removed": 78       // ← Calculated by server (from stored content)
    }
  ],
  "statistics": {
    "total_files_changed": 3,
    "total_lines_added": 57,
    "total_lines_removed": 83
  }
}
```

**Server-Side Processing Steps:**

1. **File Deduplication:** Server stores file content by hash only once
   ```python
   if not db.file_exists(hash):
       db.store_file_content(hash, content)
   ```

2. **Diff Calculation for Modified Files:**
   ```python
   if change['type'] == 'modified':
       # Lookup old content using previous_hash
       old_content = db.get_file_content(change['previous_hash'])
       new_content = change['content']

       # Use Python difflib (standard library, Git-like algorithm)
       diff_stats = calculate_diff_stats(old_content, new_content)

       change['lines_added'] = diff_stats['added']
       change['lines_removed'] = diff_stats['removed']
   ```

3. **Diff Calculation for Added Files:**
   ```python
   if change['type'] == 'added':
       change['lines_added'] = len(change['content'].splitlines())
       change['lines_removed'] = 0
   ```

4. **Diff Calculation for Deleted Files:**
   ```python
   if change['type'] == 'deleted':
       # Lookup old content using previous_hash
       old_content = db.get_file_content(change['previous_hash'])
       change['lines_added'] = 0
       change['lines_removed'] = len(old_content.splitlines())
   ```

**Errors:**
- `401` - Unauthorized
- `404` - Project not found or previous_hash not found in file store
- `400` - Invalid input (missing required fields, invalid hash format)
- `413` - Payload too large (individual file exceeds server limit)
- `500` - Server error

---

### 5. Record Interaction

**Endpoint:** `POST /api/interactions`

**Authentication:** Required

**Description:** Record an AI coding interaction with metadata

**Request Body:**
```json
{
  "project_hash": "sha256_hash",
  "prompt_text": "string (the user's prompt to Claude)",
  "claude_session_id": "string (session identifier)",
  "pre_snapshot_id": "uuid (snapshot before interaction)",
  "post_snapshot_id": "uuid (snapshot after interaction)",
  "files_modified": 5,
  "duration_seconds": 45.3
}
```

**Response (201 Created):**
```json
{
  "interaction_id": "uuid",
  "project_hash": "sha256_hash",
  "prompt_text": "Add user authentication",
  "claude_session_id": "session_123",
  "pre_snapshot_id": "uuid",
  "post_snapshot_id": "uuid",
  "files_modified": 5,
  "duration_seconds": 45.3,
  "created_at": "2024-01-15T10:36:00Z"
}
```

**Errors:**
- `401` - Unauthorized
- `404` - Project or snapshot not found
- `400` - Invalid input
- `500` - Server error

---

### 6. Get User Statistics

**Endpoint:** `GET /api/stats/user`

**Authentication:** Required

**Description:** Retrieve aggregated statistics for the authenticated user

**Response (200 OK):**
```json
{
  "user_id": "uuid",
  "username": "johndoe",
  "statistics": {
    "total_projects": 3,
    "total_snapshots": 245,
    "total_interactions": 198,
    "total_lines_added": 12543,
    "total_lines_removed": 8932,
    "total_files_tracked": 87,
    "first_snapshot_date": "2024-01-01T10:00:00Z",
    "last_snapshot_date": "2024-01-15T10:36:00Z"
  },
  "projects": [
    {
      "project_hash": "sha256_hash",
      "name": "my-project",
      "snapshots_count": 100,
      "interactions_count": 85,
      "lines_added": 5000,
      "lines_removed": 3000
    }
  ]
}
```

**Errors:**
- `401` - Unauthorized
- `500` - Server error

---

### 7. Get Project Snapshots

**Endpoint:** `GET /api/projects/{project_hash}/snapshots`

**Authentication:** Required

**Query Parameters:**
- `limit` (optional, default: 50, max: 200) - Number of snapshots to return
- `offset` (optional, default: 0) - Pagination offset
- `order` (optional, default: 'desc') - 'asc' or 'desc' by created_at

**Response (200 OK):**
```json
{
  "project_hash": "sha256_hash",
  "total_count": 245,
  "snapshots": [
    {
      "snapshot_id": "uuid",
      "message": "[AUTO-POST] Implement feature X",
      "created_at": "2024-01-15T10:36:00Z",
      "parent_snapshot_id": "uuid or null",
      "claude_session_id": "session_123",
      "statistics": {
        "files_changed": 5,
        "lines_added": 87,
        "lines_removed": 23
      }
    }
  ]
}
```

---

### 8. Get Snapshot Details

**Endpoint:** `GET /api/snapshots/{snapshot_id}`

**Authentication:** Required

**Response (200 OK):**
```json
{
  "snapshot_id": "uuid",
  "project_hash": "sha256_hash",
  "message": "[AUTO-PRE] Fix authentication bug",
  "created_at": "2024-01-15T10:35:00Z",
  "parent_snapshot_id": "uuid or null",
  "changes": [
    {
      "file_path": "src/auth.js",
      "type": "modified",
      "hash": "current_hash",
      "previous_hash": "old_hash",
      "size": 2048,
      "lines_added": 12,
      "lines_removed": 5
    }
  ]
}
```

---

### 9. Get File Content by Hash

**Endpoint:** `GET /api/files/{hash}`

**Authentication:** Required

**Description:** Retrieve file content by its SHA256 hash (for viewing diffs, file history)

**Response (200 OK):**
```json
{
  "hash": "sha256_hash",
  "content": "file content as string",
  "size": 1234,
  "stored_at": "2024-01-15T10:35:00Z"
}
```

**Errors:**
- `401` - Unauthorized
- `404` - File hash not found
- `500` - Server error

---

## Server Implementation Notes

### Diff Algorithm (Python Example)

```python
import difflib

def calculate_diff_stats(old_content, new_content):
    """
    Calculate line-based diff statistics using Python's difflib.
    This matches Git's diff behavior.

    Args:
        old_content: Previous file content (string)
        new_content: Current file content (string)

    Returns:
        dict: {'added': int, 'removed': int}
    """
    old_lines = old_content.splitlines(keepends=True)
    new_lines = new_content.splitlines(keepends=True)

    # Generate unified diff (same as git diff)
    diff = difflib.unified_diff(old_lines, new_lines, lineterm='')

    added = 0
    removed = 0

    for line in diff:
        # Lines starting with '+' (but not '+++') are additions
        if line.startswith('+') and not line.startswith('+++'):
            added += 1
        # Lines starting with '-' (but not '---') are deletions
        elif line.startswith('-') and not line.startswith('---'):
            removed += 1

    return {'added': added, 'removed': removed}
```

### Database Schema (Conceptual)

**files table:**
```sql
CREATE TABLE files (
    hash VARCHAR(64) PRIMARY KEY,  -- SHA256 hash
    content TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_hash (hash)
);
```

**snapshots table:**
```sql
CREATE TABLE snapshots (
    snapshot_id UUID PRIMARY KEY,
    project_hash VARCHAR(64) NOT NULL,
    message TEXT,
    parent_snapshot_id UUID,
    claude_session_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_project (project_hash),
    INDEX idx_created (created_at)
);
```

**snapshot_changes table:**
```sql
CREATE TABLE snapshot_changes (
    id SERIAL PRIMARY KEY,
    snapshot_id UUID REFERENCES snapshots(snapshot_id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    change_type VARCHAR(10) CHECK (change_type IN ('added', 'modified', 'deleted')),
    hash VARCHAR(64),  -- Current hash (NULL for deleted files)
    previous_hash VARCHAR(64),  -- Previous hash (NULL for added files)
    size INTEGER,
    lines_added INTEGER NOT NULL DEFAULT 0,
    lines_removed INTEGER NOT NULL DEFAULT 0,
    INDEX idx_snapshot (snapshot_id),
    INDEX idx_hash (hash),
    INDEX idx_previous_hash (previous_hash)
);
```

---

## Client Implementation Notes

### Change Detection Flow

**Step 1: Initial Scan (First Run)**
```javascript
// No last_snapshot.json exists
const previousSnapshot = loadJSON(lastSnapshotFile);  // null
const currentFiles = getTrackedFiles(config);

// All files are "added"
const changes = Object.entries(currentFiles).map(([path, info]) => ({
  type: 'added',
  file_path: path,
  hash: info.hash,
  content: info.content,
  size: info.size
}));

// After server success, save snapshot
saveJSON(lastSnapshotFile, currentFiles);
```

**Step 2: Subsequent Scans (Change Detection)**
```javascript
// Load previous snapshot
const previousSnapshot = loadJSON(lastSnapshotFile);
// {
//   "src/main.js": { hash: "old_hash", content: "...", size: 1000 },
//   "src/utils.js": { hash: "utils_hash", content: "...", size: 500 }
// }

// Scan current files
const currentFiles = getTrackedFiles(config);
// {
//   "src/main.js": { hash: "new_hash", content: "...", size: 1200 },  // Changed!
//   "src/utils.js": { hash: "utils_hash", content: "...", size: 500 },  // Same
//   "src/feature.js": { hash: "feature_hash", content: "...", size: 300 }  // New!
// }

// Detect changes by hash comparison
const changes = [];

// Check for added/modified files
for (const [path, info] of Object.entries(currentFiles)) {
  const prev = previousSnapshot[path];

  if (!prev) {
    // File not in previous snapshot → added
    changes.push({
      type: 'added',
      file_path: path,
      hash: info.hash,
      content: info.content,
      size: info.size
    });
  } else if (prev.hash !== info.hash) {
    // Hash changed → modified
    changes.push({
      type: 'modified',
      file_path: path,
      hash: info.hash,
      content: info.content,
      size: info.size,
      previous_hash: prev.hash  // Server uses this
    });
  }
  // If hash is same → skip (not included in changes)
}

// Check for deleted files
for (const path of Object.keys(previousSnapshot)) {
  if (!currentFiles[path]) {
    changes.push({
      type: 'deleted',
      file_path: path,
      previous_hash: previousSnapshot[path].hash
    });
  }
}

// Result: only 2 files sent (main.js modified, feature.js added)
// utils.js not sent because hash is same
```

### Simplified Client Hook Structure

```javascript
// .claude/hooks/user_prompt_submit.js

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
        // No lines_added - server calculates
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
        type: 'added',
        hash: info.hash,
        content: info.content,
        size: info.size
        // No lines_added - server calculates
      });
    } else if (previousFile.hash !== info.hash) {
      // Modified file (hash changed)
      changes.push({
        file_path: filePath,
        type: 'modified',
        hash: info.hash,
        content: info.content,
        size: info.size,
        previous_hash: previousFile.hash
        // No lines_added/removed - server calculates
      });
    }
    // Unchanged files (same hash) are skipped
  }

  // Detect deleted files
  for (const filePath of Object.keys(previousFiles)) {
    if (!currentFiles[filePath]) {
      changes.push({
        file_path: filePath,
        type: 'deleted',
        previous_hash: previousFiles[filePath].hash
        // No content, no lines_removed - server calculates
      });
    }
  }

  return changes;
}
```

---

## Error Handling

All error responses follow this format:

```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": {
    "field": "specific error details"
  }
}
```

**Common Error Codes:**
- `INVALID_INPUT` - Request validation failed
- `UNAUTHORIZED` - Invalid or missing API key
- `NOT_FOUND` - Resource not found
- `DUPLICATE_ENTRY` - Resource already exists
- `HASH_NOT_FOUND` - Referenced file hash doesn't exist in database
- `SERVER_ERROR` - Internal server error

---

## Rate Limiting

API endpoints are rate-limited per API key:

- **Authentication:** 10 requests/minute
- **Snapshots:** 60 requests/minute
- **Statistics:** 30 requests/minute

Rate limit headers:
```http
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1705320000
```

---

## Performance Considerations

### Client Performance

**File Scanning:**
- Uses Node.js `fs.readdirSync` (synchronous, efficient for small-medium projects)
- Hash calculation: SHA256 via built-in `crypto` module
- Typical scan time: 100ms for 1000 files

**Network Traffic:**
- First snapshot: All tracked files sent (one-time cost)
- Subsequent snapshots: Only changed files (typically 1-10 files)
- Average reduction: 99%+ for typical development workflow

### Server Performance

**Diff Calculation:**
- Python `difflib.unified_diff`: O(n+m) where n,m = line counts
- Typical file: ~100 lines → ~5ms per file
- Batch processing: 100 files → ~500ms

**Storage Optimization:**
- File deduplication by hash
- Same file content stored once across all snapshots
- Database size: ~1MB per 100 snapshots (typical project)

---

## Versioning

API version is included in the URL path:

- Current: `/api/...` (implicit v1)
- Future: `/api/v2/...`

This specification describes **version 1**.
