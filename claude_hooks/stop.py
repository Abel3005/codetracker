#!/usr/bin/env python3
"""
Stop Hook for Claude Code
프롬프트 후 자동 스냅샷 생성 및 interaction 기록
"""

import sys
import json
import os
from pathlib import Path

project_root = os.environ.get('CLAUDE_PROJECT_DIR', '.')
sys.path.insert(0, project_root)

try:
    from codetracker import CodeTrackerClient
except ImportError:
    sys.exit(0)


def main():
    try:
        # stdin에서 훅 데이터 읽기
        hook_data = json.loads(sys.stdin.read())
        timestamp = hook_data.get('timestamp', '')
        
        # CodeTracker 클라이언트 초기화
        client = CodeTrackerClient(project_root)
        
        # 세션 정보 로드
        session_file = Path(project_root) / '.codetracker/cache/current_session.json'
        
        if not session_file.exists():
            # 세션 정보가 없으면 스킵 (프롬프트 전 스냅샷이 없었음)
            sys.exit(0)
        
        with open(session_file, 'r') as f:
            session_data = json.load(f)
        
        # 프롬프트 후 스냅샷 생성 및 interaction 기록
        interaction_id = client.create_post_prompt_snapshot(
            pre_snapshot_id=session_data['pre_snapshot_id'],
            prompt=session_data['prompt'],
            claude_session_id=session_data['claude_session_id'],
            started_at=session_data['started_at'],
            ended_at=timestamp
        )
        
        if interaction_id:
            # 세션 파일 삭제 (다음 프롬프트를 위해)
            session_file.unlink()
    
    except Exception:
        # 에러 무시
        pass
    
    # 항상 성공으로 종료
    sys.exit(0)


if __name__ == '__main__':
    main()