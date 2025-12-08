# CodeTracker
## AI 코딩을 위한 자동 버전 관리 시스템

**Claude Code와 완벽하게 통합되어 모든 AI 작업을 자동으로 추적합니다.**

---

## ✨ 주요 기능

### 🤖 완전 자동 추적
- ✅ Claude Code 프롬프트 입력 시 자동 스냅샷
- ✅ AI 작업 전후 코드 변경 자동 비교
- ✅ 수동 명령 불필요 - 그냥 코딩하세요!

### 📊 강력한 분석
- ✅ AI 작업 통계 및 리포트
- ✅ 프롬프트별 영향 분석
- ✅ 파일별 변경 이력
- ✅ 팀 협업 지원

---

---

## 🚀 빠른 시작 (5분)

### 프로젝트 설정

```bash
cd your-project
python install_claude_code_hooks.py
python codetracker.py init --server http://localhost:5000
python codetracker.py register
python codetracker_client_v3.py project-create --project-name "MyApp"
```

### Claude Code 시작!

```bash
claude
# 이제 모든 프롬프트가 자동으로 추적됩니다!
```

---

## 📊 실제 사용 예시

### 프롬프트 1: "Add login function"

```
[자동 실행]
✅ Pre-prompt 스냅샷: auth.py (50줄)

[Claude 작업]
📝 auth.py 수정: +30줄

[자동 실행]
✅ Post-prompt 스냅샷: auth.py (80줄)
✅ Interaction 기록:
   - 변경: 1개 파일
   - 추가: 30줄
   - 시간: 12.5초
```

### 프롬프트 2: "Add tests"

```
[자동 실행]
✅ Pre-prompt 스냅샷

[Claude 작업]
📝 test_auth.py 생성: +45줄

[자동 실행]
✅ Post-prompt 스냅샷
✅ Interaction 기록: +45줄, 18초
```

### 통계 확인

```bash
$ python codetracker_client_v3.py status

📊 CodeTracker v3.0 (Claude Code 통합)
════════════════════════════════════
👤 사용자: john
📂 프로젝트: 1개
📸 스냅샷: 12개
🤖 AI 상호작용: 6개
📊 평균 소요: 15.3초
📁 평균 변경: 1.8개 파일

💾 저장 공간:
  압축률: 3.0x
  절약: 0.8 MB
```

---

## 📦 패키지 내용

### 핵심 파일
- `codetracker.py`
- `install_claude_code_hooks.py` - 훅 설치 도구

### Claude Code 훅
- `claude_hooks/user_prompt_submit.py` - 프롬프트 전 훅
- `claude_hooks/stop.py` - 프롬프트 후 훅
- `claude_hooks/settings.json.template` - 설정 템플릿


### 배포
- `Dockerfile` - 컨테이너 이미지
- `docker-compose.yml` - 서비스 구성
- `requirements.txt` - 클라이언트 의존성

---

## 🔐 보안

### 데이터 보호
- ✅ API 키 인증
- ✅ 사용자별 데이터 격리
- ✅ 비밀번호 해싱 (pbkdf2:sha256)
- ✅ 파일 권한 관리 (chmod 600)

### 프로덕션 배포
- ✅ HTTPS 필수
- ✅ Nginx 리버스 프록시
- ✅ 정기 백업
- ✅ 접근 로그

---

## 🌟 로드맵

### v3.1 (1-2개월)
- [ ] Web UI 대시보드
- [ ] 실시간 파일 워칭
- [ ] VS Code 확장
- [ ] LLM 기반 AI 활용 역량 분석

### v3.2 (3-4개월)
- [ ] 팀 협업 기능
- [ ] 코드 리뷰 통합
- [ ] PostgreSQL 지원

---

## 📄 라이선스

MIT License

---

## 📂 프로젝트 구조

설치 후:

```
your-project/
├── .codetracker/           # CodeTracker 데이터
│   ├── config.json         # 설정
│   ├── credentials.json    # API 키 (git ignore!)
│   └── cache/
│       ├── last_snapshot.json
│       └── current_session.json
│
├── .claude/                # Claude Code 훅
│   ├── settings.json       # 훅 설정
│   └── hooks/
│       ├── user_prompt_submit.py  # 프롬프트 전
│       └── stop.py                # 프롬프트 후
│
├── codetracker.py  # 클라이언트
└── your source files...
```

---

## ❓ 문제 해결

### 훅이 실행되지 않음

1. **설정 확인**
```bash
cat .claude/settings.json
# hooks 섹션이 있는지 확인
```

2. **권한 확인** (Unix)
```bash
chmod +x .claude/hooks/*.py
```

3. **Python 경로 확인**
```bash
which python3
# 훅 스크립트의 shebang과 일치해야 함
```

4. **수동 테스트**
```bash
echo '{"prompt":"test","session_id":"123","timestamp":"2024-01-01T00:00:00Z"}' | \
  python3 .claude/hooks/user_prompt_submit.py
```

### 스냅샷이 생성되지 않음

1. **로그인 확인**
```bash
cat .codetracker/credentials.json
# api_key와 current_project_id가 있는지 확인
```

2. **서버 연결 확인**
```bash
curl http://localhost:5000/api/health
# {"status":"ok","version":"3.0"}
```

3. **변경 감지 확인**
```json
// .codetracker/config.json
{
  "auto_snapshot": {
    "only_on_changes": false  // 변경 없어도 기록
  }
}
```

---

## 🎉 완료!

이제 Claude Code를 평소처럼 사용하세요.
모든 AI 작업이 자동으로 추적됩니다!

### 다음 단계

- 📊 [분석 도구 사용하기](ANALYSIS.md)
- 🔧 [서버 배포하기](SERVER_DEPLOYMENT.md)
- 📚 [API 문서](ARCHITECTURE.md)

---

## 📞 도움이 필요하신가요?

- 문서: `README.md`, `CLAUDE_CODE_INTEGRATION.md`
- 이슈: GitHub Issues
- mail: contact@thinktrace.net

**Happy Coding with AI! 🤖✨**