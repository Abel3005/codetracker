# CodeTracker 설치 가이드 (Node.js)

CodeTracker를 프로젝트에 설치하는 간단한 가이드입니다.

## 사전 요구사항

- **Node.js 18 이상** 설치 필요
  ```bash
  node --version  # v18.0.0 이상인지 확인
  ```

## 설치 단계

### 1. 웹사이트에서 사용자 등록

1. CodeTracker 웹사이트에 접속
2. 계정 생성 및 로그인
3. 새 프로젝트 생성
4. 설정 파일 다운로드 (zip 파일)

다운로드한 파일에는 다음이 포함됩니다:
- `.codetracker/config.json` - 프로젝트 설정
- `.codetracker/credentials.json` - API 키 및 인증 정보
- `.claude/hooks/user_prompt_submit.js` - 프롬프트 전 훅
- `.claude/hooks/stop.js` - 프롬프트 후 훅
- `.claude/settings.json` - Claude Code 훅 설정

### 2. 프로젝트에 파일 복사

다운로드한 zip 파일을 프로젝트 루트에 압축 해제:

```bash
cd your-project
unzip codetracker-setup.zip
```

압축 해제 후 디렉터리 구조:
```
your-project/
├── .codetracker/
│   ├── config.json          # 프로젝트 설정
│   ├── credentials.json     # API 키 (보안 유지!)
│   └── cache/               # 자동 생성됨
├── .claude/
│   ├── settings.json        # 훅 설정
│   └── hooks/
│       ├── user_prompt_submit.js
│       └── stop.js
└── ... (your source files)
```

### 3. 실행 권한 설정 (Unix/macOS/Linux만)

```bash
chmod +x .claude/hooks/user_prompt_submit.js
chmod +x .claude/hooks/stop.js
```

Windows에서는 이 단계를 건너뛰세요.

### 4. 설정 파일 확인

#### `.codetracker/config.json`

서버 URL과 추적 설정이 포함되어 있습니다:

```json
{
  "version": "4.0",
  "server_url": "https://your-codetracker-server.com",
  "ignore_patterns": [
    "*.pyc",
    "__pycache__",
    ".git",
    ".codetracker",
    ".claude",
    "node_modules",
    ".env",
    "*.log"
  ],
  "track_extensions": [
    ".py",
    ".js",
    ".ts",
    ".jsx",
    ".tsx",
    ".java",
    ".cpp",
    ".md"
  ],
  "max_file_size": 1048576,
  "auto_snapshot": {
    "enabled": true,
    "min_interval_seconds": 30,
    "skip_patterns": ["^help", "^what is", "^explain"],
    "only_on_changes": true
  }
}
```

필요시 `ignore_patterns`와 `track_extensions`를 프로젝트에 맞게 수정하세요.

#### `.codetracker/credentials.json`

API 키와 프로젝트 ID가 포함되어 있습니다:

```json
{
  "api_key": "your-api-key-here",
  "username": "your-username",
  "email": "your-email@example.com",
  "current_project_id": 123
}
```

**⚠️ 보안 주의:**
- 이 파일을 절대 Git에 커밋하지 마세요!
- `.gitignore`에 `.codetracker/credentials.json` 추가

#### `.claude/settings.json`

훅 설정이 포함되어 있습니다:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/user_prompt_submit.js"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/stop.js"
          }
        ]
      }
    ]
  }
}
```

### 5. .gitignore 업데이트

프로젝트의 `.gitignore` 파일에 다음을 추가:

```gitignore
# CodeTracker
.codetracker/credentials.json
.codetracker/cache/
```

설정 파일(`config.json`)과 훅 스크립트는 팀과 공유할 수 있지만, **credentials.json은 절대 커밋하지 마세요!**

### 6. 설치 테스트

#### 방법 1: 수동 테스트

**user_prompt_submit.js 테스트:**
```bash
echo '{"prompt":"test prompt","session_id":"test-123","timestamp":"2024-01-01T00:00:00Z"}' | \
  node .claude/hooks/user_prompt_submit.js
```

성공하면 `.codetracker/cache/current_session.json` 파일이 생성됩니다:
```bash
cat .codetracker/cache/current_session.json
```

**stop.js 테스트:**
```bash
echo '{"timestamp":"2024-01-01T00:00:10Z"}' | \
  node .claude/hooks/stop.js
```

성공하면 세션 파일이 삭제됩니다:
```bash
ls .codetracker/cache/  # current_session.json이 없어야 함
```

#### 방법 2: Claude Code로 실제 테스트

```bash
claude
```

Claude Code에서 간단한 프롬프트를 입력:
```
Create a new file called test.txt with "Hello World"
```

웹 대시보드에서 스냅샷과 상호작용이 기록되었는지 확인하세요.

## 문제 해결

### 훅이 실행되지 않음

**문제:** Claude Code를 사용해도 스냅샷이 생성되지 않음

**해결 방법:**

1. **Node.js 버전 확인:**
   ```bash
   node --version
   ```
   v18.0.0 이상이어야 합니다.

2. **실행 권한 확인 (Unix/macOS/Linux):**
   ```bash
   ls -la .claude/hooks/
   ```
   `-rwxr-xr-x`와 같이 실행 권한(x)이 있어야 합니다.

3. **설정 파일 확인:**
   ```bash
   cat .claude/settings.json
   ```
   `hooks` 섹션이 올바르게 설정되어 있는지 확인

4. **Node.js 경로 확인:**
   ```bash
   which node
   ```
   훅 스크립트의 shebang(`#!/usr/bin/env node`)이 올바른지 확인

### 인증 오류

**문제:** `401 Unauthorized` 또는 인증 관련 오류

**해결 방법:**

1. **credentials.json 확인:**
   ```bash
   cat .codetracker/credentials.json
   ```
   `api_key`와 `current_project_id`가 있는지 확인

2. **서버 URL 확인:**
   ```bash
   cat .codetracker/config.json | grep server_url
   ```

3. **서버 연결 테스트:**
   ```bash
   curl -H "X-API-Key: YOUR_API_KEY" \
     https://your-server.com/api/projects
   ```

### 스냅샷이 생성되지 않음

**문제:** 훅은 실행되지만 스냅샷이 기록되지 않음

**해결 방법:**

1. **파일 변경 확인:**
   `config.json`의 `auto_snapshot.only_on_changes`가 `true`이면 파일이 실제로 변경되어야 합니다.

   테스트를 위해 임시로 `false`로 변경:
   ```json
   "auto_snapshot": {
     "only_on_changes": false
   }
   ```

2. **추적 확장자 확인:**
   변경한 파일의 확장자가 `track_extensions`에 포함되어 있는지 확인

3. **무시 패턴 확인:**
   파일이 `ignore_patterns`에 의해 무시되고 있지 않은지 확인

### Windows에서 Node.js 경로 문제

**문제:** Windows에서 `node` 명령을 찾을 수 없음

**해결 방법:**

`.claude/settings.json`에서 Node.js의 절대 경로 사용:
```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "command",
        "command": "C:\\Program Files\\nodejs\\node.exe .claude\\hooks\\user_prompt_submit.js"
      }]
    }]
  }
}
```

Node.js 설치 경로 확인:
```cmd
where node
```

## 설정 커스터마이징

### 특정 파일 타입 추가

`.codetracker/config.json`에서:
```json
{
  "track_extensions": [
    ".py",
    ".js",
    ".rs",      // Rust 추가
    ".go",      // Go 추가
    ".rb"       // Ruby 추가
  ]
}
```

### 특정 디렉터리 무시

```json
{
  "ignore_patterns": [
    "node_modules",
    "dist",
    "build",
    "vendor",              // 추가
    "target",              // 추가
    "coverage"             // 추가
  ]
}
```

### 최대 파일 크기 변경

```json
{
  "max_file_size": 2097152  // 2MB (기본값: 1MB)
}
```

### 자동 스냅샷 비활성화

```json
{
  "auto_snapshot": {
    "enabled": false
  }
}
```

## 다음 단계

설치가 완료되면:

1. **Claude Code 사용 시작:**
   ```bash
   claude
   ```

2. **웹 대시보드 확인:**
   웹사이트에서 스냅샷, 상호작용, 통계 확인

3. **팀원 초대:**
   웹사이트에서 팀원을 프로젝트에 초대

## 도움이 필요하신가요?

- **웹사이트:** https://your-codetracker-site.com
- **문서:** README.md, CLAUDE.md
- **이메일:** contact@thinktrace.net

Happy Coding! 🚀