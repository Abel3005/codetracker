#!/usr/bin/env python3
"""
UserPromptSubmit Hook for Claude Code
프롬프트 전 자동 스냅샷 생성
"""

import sys
import json
import os
from pathlib import Path

# CodeTracker 클라이언트 경로 추가
project_root = os.environ.get('CLAUDE_PROJECT_DIR', '.')
sys.path.insert(0, project_root)

try:
    from codetracker import CodeTrackerClient
except ImportError:
    # 클라이언트가 없으면 조용히 종료
    sys.exit(0)


def main():
    try:
        # stdin에서 훅 데이터 읽기
        hook_data = json.loads(sys.stdin.read())
        
        prompt = hook_data.get('prompt', '')
        session_id = hook_data.get('session_id', '')
        timestamp = hook_data.get('timestamp', '')
        
        # 빈 프롬프트는 스킵
        if not prompt.strip():
            sys.exit(0)
        
        # CodeTracker 클라이언트 초기화
        client = CodeTrackerClient(project_root)
        
        # 프롬프트 전 스냅샷 생성
        snapshot_id = client.create_pre_prompt_snapshot(
            prompt=prompt,
            claude_session_id=session_id,
            timestamp=timestamp
        )
        
        if snapshot_id:
            # 세션 정보 저장 (Stop 훅에서 사용)
            session_file = Path(project_root) / '.codetracker/cache/current_session.json'
            session_file.parent.mkdir(parents=True, exist_ok=True)
            
            with open(session_file, 'w') as f:
                json.dump({
                    'pre_snapshot_id': snapshot_id,
                    'prompt': prompt,
                    'claude_session_id': session_id,
                    'started_at': timestamp
                }, f)
    
    except Exception:
        # 에러가 나도 Claude 작업은 계속 진행
        pass
    
    # 항상 성공으로 종료 (Claude 작업 방해 안 함)
    sys.exit(0)


if __name__ == '__main__':
    main()