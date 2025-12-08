#!/usr/bin/env python3
"""
CodeTracker - Claude Code 훅 설치 스크립트
"""

import os
import sys
import json
import shutil
from pathlib import Path


def install_hooks(project_path: str = "."):
    """Claude Code 훅 설치"""
    project_root = Path(project_path).resolve()
    claude_dir = project_root / ".claude"
    hooks_dir = claude_dir / "hooks"
    settings_file = claude_dir / "settings.json"
    
    print("🔧 CodeTracker - Claude Code 훅 설치")
    print(f"📁 프로젝트: {project_root}")
    print()
    
    # .claude 디렉터리 생성
    if not claude_dir.exists():
        claude_dir.mkdir(parents=True)
        print("✅ .claude 디렉터리 생성")
    else:
        print("ℹ️  .claude 디렉터리 존재")
    
    # hooks 디렉터리 생성
    if not hooks_dir.exists():
        hooks_dir.mkdir(parents=True)
        print("✅ .claude/hooks 디렉터리 생성")
    else:
        print("ℹ️  .claude/hooks 디렉터리 존재")
    
    # 훅 스크립트 복사
    script_dir = Path(__file__).parent / "claude_hooks"
    
    hook_files = [
        'user_prompt_submit.py',
        'stop.py'
    ]
    
    for hook_file in hook_files:
        src = script_dir / hook_file
        dst = hooks_dir / hook_file
        
        if src.exists():
            shutil.copy2(src, dst)
            # 실행 권한 부여 (Unix)
            if sys.platform != 'win32':
                os.chmod(dst, 0o755)
            print(f"✅ 복사: {dst}")
        else:
            print(f"⚠️  파일 없음: {hook_file}")
    
    # settings.json 생성 또는 업데이트
    hooks_config = {
        "UserPromptSubmit": [{
            "hooks": [{
                "type": "command",
                "command": "python3 .claude/hooks/user_prompt_submit.py"
            }]
        }],
        "Stop": [{
            "hooks": [{
                "type": "command",
                "command": "python3 .claude/hooks/stop.py"
            }]
        }]
    }
    
    if settings_file.exists():
        # 기존 설정 로드
        with open(settings_file, 'r') as f:
            settings = json.load(f)
        
        # 훅 병합
        if 'hooks' not in settings:
            settings['hooks'] = {}
        
        settings['hooks'].update(hooks_config)
        
        with open(settings_file, 'w') as f:
            json.dump(settings, f, indent=2)
        
        print("✅ settings.json 업데이트")
    else:
        # 새 설정 생성
        settings = {"hooks": hooks_config}
        
        with open(settings_file, 'w') as f:
            json.dump(settings, f, indent=2)
        
        print("✅ settings.json 생성")
    
    # codetracker.py 복사
    client_src = script_dir.parent / "codetracker.py"
    client_dst = project_root / "codetracker.py"
    
    if client_src.exists() and not (client_dst.exists()):
        shutil.copy2(client_src, client_dst)
        print("✅ codetracker.py 복사")
    
    print()
    print("🎉 설치 완료!")
    print()
    print("다음 단계:")
    print("1. CodeTracker 초기화:")
    print("   python3 codetracker.py init --server http://localhost:5000")
    print()
    print("2. 사용자 등록 및 로그인:")
    print("   python3 codetracker.py register")
    print("   python3 codetracker.py login")
    print()
    print("3. 프로젝트 생성:")
    print("   python3 codetracker.py project-create --project-name 'MyProject'")
    print()
    print("4. Claude Code 시작:")
    print("   claude")
    print()
    print("이제 Claude Code에서 프롬프트를 입력하면 자동으로 스냅샷이 생성됩니다!")


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='CodeTracker Claude Code 훅 설치')
    parser.add_argument('--path', default='.', help='프로젝트 경로 (기본: 현재 디렉터리)')
    
    args = parser.parse_args()
    
    try:
        install_hooks(args.path)
    except Exception as e:
        print(f"❌ 설치 실패: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()