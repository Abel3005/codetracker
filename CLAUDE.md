# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CodeTracker is an automatic version control system designed specifically for AI-assisted coding workflows. It integrates with Claude Code through hooks to automatically capture snapshots before and after each AI interaction, tracking code changes, prompts, and development statistics.

## Core Architecture

### Two-Component System

1. **Claude Code Hooks** (`.claude/hooks/`)
   - `user_prompt_submit.js`: Fires before each Claude prompt, creates pre-prompt snapshot
   - `stop.js`: Fires after Claude finishes, creates post-prompt snapshot and records interaction
   - Written in Node.js for cross-platform compatibility (Windows/macOS/Linux)
   - Configured in `.claude/settings.json` to run automatically
   - All file scanning, change detection, and server communication handled in the hooks

2. **Configuration Files** (`.codetracker/`)
   - `config.json`: Project settings (ignore patterns, track extensions, server URL)
   - `credentials.json`: User authentication (API key, project ID)
   - `cache/`: Temporary files for snapshot state and session tracking
   - Distributed to users via web download after registration

### Data Flow

```
User enters prompt
  → UserPromptSubmit hook
    → create_pre_prompt_snapshot()
      → Scan files, detect changes vs last snapshot
        → Send to server, get snapshot_id
          → Save session info to .codetracker/cache/current_session.json

Claude Code processes prompt and modifies files

User stops Claude (Ctrl+C or completion)
  → Stop hook
    → Load session info
      → create_post_prompt_snapshot()
        → Scan files again, detect new changes
          → Send to server
            → Record interaction with duration and statistics
              → Clean up session file
```

## Installation

### Prerequisites

- Node.js 18.0.0 or higher

### Setup Process

1. **Register on CodeTracker website**
   - Create account
   - Create new project
   - Download configuration package (zip file)

2. **Extract files to project root**
   ```bash
   cd your-project
   unzip codetracker-setup.zip
   ```

3. **Set permissions (Unix/macOS/Linux only)**
   ```bash
   chmod +x .claude/hooks/user_prompt_submit.js
   chmod +x .claude/hooks/stop.js
   ```

4. **Update .gitignore**
   ```gitignore
   .codetracker/credentials.json
   .codetracker/cache/
   ```

5. **Start using Claude Code**
   ```bash
   claude
   ```

See `INSTALLATION_GUIDE.md` for detailed instructions.

## Configuration Files

### `.codetracker/config.json`

Controls client behavior:
- `ignore_patterns`: Files/directories to skip (e.g., `.git`, `node_modules`, `*.pyc`)
- `track_extensions`: File types to monitor (e.g., `.py`, `.js`, `.md`)
- `max_file_size`: Files larger than this (default 1MB) are ignored
- `auto_snapshot.enabled`: Enable/disable automatic snapshots
- `auto_snapshot.min_interval_seconds`: Minimum time between snapshots
- `auto_snapshot.skip_patterns`: Prompt patterns to ignore (e.g., `^help`, `^what is`)
- `auto_snapshot.only_on_changes`: Skip snapshots when no files changed

### `.codetracker/credentials.json`

Stores authentication (chmod 600 on Unix):
- `api_key`: Server authentication token
- `username`, `email`: User info
- `current_project_id`: Active project for snapshots

### `.codetracker/cache/`

- `last_snapshot.json`: File hashes from last snapshot (for diff calculation)
- `current_session.json`: Temporary file linking pre/post snapshots during active Claude session

## Key Implementation Details

### Change Detection Algorithm

The client maintains a hash-based snapshot system:
1. Scan all tracked files, compute SHA256 hashes
2. Compare with `last_snapshot.json` to find added/modified/deleted files
3. Send only changed file contents to server (not full project each time)
4. Server deduplicates file versions by hash, saving storage

### Hook Integration Points

Hooks receive JSON via stdin with fields:
- `prompt`: User's prompt text (UserPromptSubmit only)
- `session_id`: Claude session identifier
- `timestamp`: ISO 8601 timestamp

Hooks must:
- Exit with code 0 (success) even on errors to avoid blocking Claude
- Handle missing dependencies gracefully (fail silently if config files not found)
- Complete quickly to avoid user-perceivable delays
- Use Node.js built-in modules only (fs, path, crypto) - no external dependencies

### Error Handling Philosophy

The system is designed to NEVER interfere with normal Claude Code usage:
- All exceptions in hooks are caught and suppressed
- Missing credentials/config causes silent no-op
- Network errors to server are ignored
- Hook failures don't prevent Claude from working

## Server API Endpoints

The client expects these REST endpoints:

- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/projects` - Create project
- `POST /api/snapshots` - Create snapshot with file changes
- `POST /api/interactions` - Record AI interaction metadata
- `GET /api/stats/user` - User statistics

All authenticated requests require `X-API-Key` header.

## Testing Hook Installation

```bash
# Verify hooks are installed
cat .claude/settings.json

# Test user_prompt_submit hook manually
echo '{"prompt":"test","session_id":"123","timestamp":"2024-01-01T00:00:00Z"}' | \
  node .claude/hooks/user_prompt_submit.js

# Check if snapshot was created
cat .codetracker/cache/current_session.json

# Test stop hook
echo '{"timestamp":"2024-01-01T00:00:10Z"}' | \
  node .claude/hooks/stop.js

# Session file should be deleted
ls .codetracker/cache/
```

## Common Issues

### Hooks not executing
- Check Node.js is installed: `node --version` (requires v18+)
- Check `.claude/settings.json` has correct hook configuration
- Verify hook files have execute permissions: `chmod +x .claude/hooks/*.js`
- Ensure Node.js path in hooks matches system: hooks use `#!/usr/bin/env node` shebang
- On Windows, may need full path: `C:\Program Files\nodejs\node.exe .claude\hooks\user_prompt_submit.js`

### No snapshots created
- Verify logged in: `cat .codetracker/credentials.json` should have `api_key`
- Verify project created: credentials should have `current_project_id`
- Check server connectivity: `curl http://localhost:5000/api/health`
- Review `auto_snapshot.only_on_changes` setting if no file modifications occurred

### Server connection failures
- Hooks silently ignore server errors by design
- Check `CODETRACKER_SERVER` environment variable or `server_url` in config.json
- Verify server is running and accessible
