#!/usr/bin/env python3
"""
CodeTracker Client v3.0
Claude Code 통합: 자동 스냅샷 생성
"""

import os
import sys
import json
import hashlib
from datetime import datetime
from pathlib import Path
import argparse
from typing import List, Dict, Optional
import fnmatch

try:
    import requests
except ImportError:
    print("❌ requests 라이브러리가 필요합니다.")
    print("   pip install requests --break-system-packages")
    sys.exit(1)


class CodeTrackerClient:
    """Claude Code 통합 클라이언트"""
    
    def __init__(self, root_path: str = ".", server_url: str = None):
        self.root_path = Path(root_path).resolve()
        self.tracker_dir = self.root_path / ".codetracker"
        self.config_file = self.tracker_dir / "config.json"
        self.credentials_file = self.tracker_dir / "credentials.json"
        self.cache_dir = self.tracker_dir / "cache"
        self.last_snapshot_file = self.cache_dir / "last_snapshot.json"
        self.session_file = self.cache_dir / "current_session.json"
        
        if server_url:
            self.server_url = server_url
        else:
            self.server_url = os.environ.get('CODETRACKER_SERVER', 'http://localhost:5000')
        
        self.api_key = None
        self.current_project_id = None
        self.session = requests.Session()
        self.session.timeout = 10  # 훅에서 빠른 응답 필요
    
    def init(self, server_url: str = None):
        """프로젝트 초기화"""
        if self.tracker_dir.exists():
            print(f"⚠️  CodeTracker가 이미 초기화되어 있습니다")
            return False
        
        self.tracker_dir.mkdir(parents=True)
        self.cache_dir.mkdir()
        
        if server_url:
            self.server_url = server_url
        
        default_config = {
            "version": "3.0",
            "server_url": self.server_url,
            "ignore_patterns": [
                "*.pyc", "__pycache__", ".git", ".codetracker", ".claude",
                "node_modules", ".env", "*.log", ".DS_Store",
                "*.class", "*.o", "build/", "dist/", "*.exe"
            ],
            "track_extensions": [
                ".py", ".js", ".java", ".cpp", ".c", ".h",
                ".cs", ".go", ".rs", ".rb", ".php", ".ts",
                ".jsx", ".tsx", ".vue", ".swift", ".kt", ".md"
            ],
            "max_file_size": 1024 * 1024,  # 1MB
            "auto_snapshot": {
                "enabled": True,
                "min_interval_seconds": 30,
                "skip_patterns": ["^help", "^what is", "^explain"],
                "only_on_changes": True
            }
        }
        
        with open(self.config_file, 'w', encoding='utf-8') as f:
            json.dump(default_config, f, indent=2, ensure_ascii=False)
        
        print(f"✅ CodeTracker 클라이언트 초기화 완료")
        print(f"🌐 서버 URL: {self.server_url}")
        print(f"🤖 Claude Code 자동 스냅샷: 활성화")
        return True
    
    def _load_config(self) -> Dict:
        if not self.config_file.exists():
            raise FileNotFoundError("CodeTracker가 초기화되지 않았습니다.")
        
        with open(self.config_file, 'r', encoding='utf-8') as f:
            config = json.load(f)
        
        self.server_url = config.get('server_url', self.server_url)
        return config
    
    def _load_credentials(self) -> Dict:
        if not self.credentials_file.exists():
            return {}
        
        with open(self.credentials_file, 'r', encoding='utf-8') as f:
            creds = json.load(f)
        
        self.api_key = creds.get('api_key')
        self.current_project_id = creds.get('current_project_id')
        
        if self.api_key:
            self.session.headers.update({'X-API-Key': self.api_key})
        
        return creds
    
    def _save_credentials(self, api_key: str, username: str, email: str = ""):
        creds = {
            'api_key': api_key,
            'username': username,
            'email': email,
            'current_project_id': self.current_project_id
        }
        
        with open(self.credentials_file, 'w', encoding='utf-8') as f:
            json.dump(creds, f, indent=2)
        
        if sys.platform != 'win32':
            os.chmod(self.credentials_file, 0o600)
        
        self.api_key = api_key
        self.session.headers.update({'X-API-Key': api_key})
    
    def register(self, username: str, email: str, password: str, organization: str = ""):
        """사용자 등록"""
        self._load_config()
        
        try:
            response = self.session.post(
                f"{self.server_url}/api/auth/register",
                json={'username': username, 'email': email, 'password': password, 'organization': organization}
            )
            response.raise_for_status()
            
            data = response.json()
            self._save_credentials(data['api_key'], username, email)
            
            print(f"✅ 사용자 등록 완료: {username}")
            return True
        
        except requests.exceptions.RequestException as e:
            print(f"❌ 등록 실패: {e}")
            return False
    
    def login(self, username: str, password: str):
        """사용자 로그인"""
        self._load_config()
        
        try:
            response = self.session.post(
                f"{self.server_url}/api/auth/login",
                json={'username': username, 'password': password}
            )
            response.raise_for_status()
            
            data = response.json()
            self._save_credentials(data['api_key'], username, data.get('email', ''))
            
            print(f"✅ 로그인 성공: {username}")
            return True
        
        except requests.exceptions.RequestException as e:
            print(f"❌ 로그인 실패: {e}")
            return False
    
    def create_project(self, project_name: str, description: str = ""):
        """프로젝트 생성"""
        self._load_config()
        self._load_credentials()
        
        if not self.api_key:
            print("❌ 먼저 로그인하세요")
            return False
        
        try:
            response = self.session.post(
                f"{self.server_url}/api/projects",
                json={'project_name': project_name, 'project_path': str(self.root_path), 'description': description}
            )
            response.raise_for_status()
            
            data = response.json()
            self.current_project_id = data['project_id']
            
            creds = self._load_credentials()
            creds['current_project_id'] = self.current_project_id
            with open(self.credentials_file, 'w', encoding='utf-8') as f:
                json.dump(creds, f, indent=2)
            
            print(f"✅ 프로젝트 생성 완료: {project_name}")
            return True
        
        except requests.exceptions.RequestException as e:
            print(f"❌ 프로젝트 생성 실패: {e}")
            return False
    
    def _should_track_file(self, file_path: Path, config: Dict) -> bool:
        """파일을 추적해야 하는지 확인"""
        rel_path = str(file_path.relative_to(self.root_path))
        
        for pattern in config['ignore_patterns']:
            if fnmatch.fnmatch(rel_path, pattern) or fnmatch.fnmatch(file_path.name, pattern):
                return False
        
        if file_path.suffix in config['track_extensions']:
            return True
        
        return False
    
    def _get_tracked_files(self) -> Dict[str, Dict]:
        """추적할 파일 목록 및 정보 가져오기"""
        config = self._load_config()
        max_size = config.get('max_file_size', 1024 * 1024)
        
        tracked_files = {}
        
        for file_path in self.root_path.rglob('*'):
            if file_path.is_file() and self._should_track_file(file_path, config):
                try:
                    stat = file_path.stat()
                    if stat.st_size > max_size:
                        continue
                    
                    rel_path = str(file_path.relative_to(self.root_path))
                    content = file_path.read_bytes()
                    file_hash = hashlib.sha256(content).hexdigest()
                    
                    tracked_files[rel_path] = {
                        'hash': file_hash,
                        'content': content,
                        'size': stat.st_size
                    }
                except:
                    pass
        
        return tracked_files
    
    def _load_last_snapshot(self) -> Optional[Dict]:
        """마지막 스냅샷 정보 로드"""
        if not self.last_snapshot_file.exists():
            return None
        
        try:
            with open(self.last_snapshot_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            return None
    
    def _save_last_snapshot(self, files: Dict[str, Dict]):
        """현재 스냅샷 정보 저장"""
        snapshot_data = {
            path: {'hash': info['hash'], 'size': info['size']}
            for path, info in files.items()
        }
        
        with open(self.last_snapshot_file, 'w', encoding='utf-8') as f:
            json.dump(snapshot_data, f, indent=2)
    
    def _calculate_diff(self, current_files: Dict, previous_files: Optional[Dict]) -> List[Dict]:
        """변경 사항 감지"""
        if not previous_files:
            return [
                {
                    'path': path,
                    'type': 'added',
                    'hash': info['hash'],
                    'content': info['content'].decode('utf-8', errors='ignore'),
                    'size': info['size'],
                    'lines_added': info['content'].decode('utf-8', errors='ignore').count('\n') + 1
                }
                for path, info in current_files.items()
            ]
        
        changes = []
        
        for path, info in current_files.items():
            if path not in previous_files:
                changes.append({
                    'path': path,
                    'type': 'added',
                    'hash': info['hash'],
                    'content': info['content'].decode('utf-8', errors='ignore'),
                    'size': info['size'],
                    'lines_added': info['content'].decode('utf-8', errors='ignore').count('\n') + 1
                })
            elif previous_files[path]['hash'] != info['hash']:
                content_str = info['content'].decode('utf-8', errors='ignore')
                changes.append({
                    'path': path,
                    'type': 'modified',
                    'hash': info['hash'],
                    'content': content_str,
                    'size': info['size'],
                    'previous_hash': previous_files[path]['hash'],
                    'lines_added': len(content_str.split('\n')),
                })
        
        for path in previous_files:
            if path not in current_files:
                changes.append({
                    'path': path,
                    'type': 'deleted',
                    'previous_hash': previous_files[path]['hash'],
                    'lines_removed': 0
                })
        
        return changes
    
    def create_pre_prompt_snapshot(self, prompt: str, claude_session_id: str = "", 
                                   timestamp: str = "") -> Optional[int]:
        """🆕 프롬프트 전 스냅샷 생성 (Claude Code 훅용)"""
        config = self._load_config()
        self._load_credentials()
        
        if not self.api_key or not self.current_project_id:
            return None
        
        # auto_snapshot 설정 확인
        auto_config = config.get('auto_snapshot', {})
        if not auto_config.get('enabled', True):
            return None
        
        # 스킵 패턴 확인
        skip_patterns = auto_config.get('skip_patterns', [])
        for pattern in skip_patterns:
            if prompt.lower().startswith(pattern.lower().replace('^', '')):
                return None
        
        current_files = self._get_tracked_files()
        previous_snapshot = self._load_last_snapshot()
        changes = self._calculate_diff(current_files, previous_snapshot)
        
        # 변경이 없으면 스킵 (선택적)
        if not changes and auto_config.get('only_on_changes', False):
            return None
        
        try:
            # 스냅샷 생성
            response = self.session.post(
                f"{self.server_url}/api/snapshots",
                json={
                    'project_id': self.current_project_id,
                    'message': f"[AUTO-PRE] {prompt[:100]}",
                    'changes': changes,
                    'claude_session_id': claude_session_id
                }
            )
            response.raise_for_status()
            
            data = response.json()
            snapshot_id = data['snapshot_id']
            
            # 마지막 스냅샷 저장
            self._save_last_snapshot(current_files)
            
            return snapshot_id
        
        except:
            return None
    
    def create_post_prompt_snapshot(self, pre_snapshot_id: int, prompt: str,
                                    claude_session_id: str = "",
                                    started_at: str = "", ended_at: str = "") -> Optional[int]:
        """🆕 프롬프트 후 스냅샷 생성 및 interaction 기록"""
        config = self._load_config()
        self._load_credentials()
        
        if not self.api_key or not self.current_project_id:
            return None
        
        current_files = self._get_tracked_files()
        previous_snapshot = self._load_last_snapshot()
        changes = self._calculate_diff(current_files, previous_snapshot)
        
        # 변경이 없으면 interaction만 기록
        if not changes:
            auto_config = config.get('auto_snapshot', {})
            if auto_config.get('only_on_changes', True):
                return None
        
        try:
            # Post-prompt 스냅샷 생성
            response = self.session.post(
                f"{self.server_url}/api/snapshots",
                json={
                    'project_id': self.current_project_id,
                    'message': f"[AUTO-POST] {prompt[:100]}",
                    'changes': changes,
                    'parent_snapshot_id': pre_snapshot_id,
                    'claude_session_id': claude_session_id
                }
            )
            response.raise_for_status()
            
            data = response.json()
            post_snapshot_id = data['snapshot_id']
            
            # Interaction 기록
            duration = 0
            if started_at and ended_at:
                try:
                    start = datetime.fromisoformat(started_at.replace('Z', '+00:00'))
                    end = datetime.fromisoformat(ended_at.replace('Z', '+00:00'))
                    duration = (end - start).total_seconds()
                except:
                    pass
            
            interaction_response = self.session.post(
                f"{self.server_url}/api/interactions",
                json={
                    'project_id': self.current_project_id,
                    'prompt_text': prompt,
                    'claude_session_id': claude_session_id,
                    'pre_snapshot_id': pre_snapshot_id,
                    'post_snapshot_id': post_snapshot_id,
                    'files_modified': len(changes),
                    'duration_seconds': duration
                }
            )
            interaction_response.raise_for_status()
            
            # 마지막 스냅샷 저장
            self._save_last_snapshot(current_files)
            
            return interaction_response.json().get('interaction_id')
        
        except:
            return None
    
    def status(self):
        """현재 상태 및 통계 표시"""
        self._load_config()
        creds = self._load_credentials()
        
        if not self.api_key:
            print("❌ 먼저 로그인하세요")
            return
        
        try:
            response = self.session.get(f"{self.server_url}/api/stats/user")
            response.raise_for_status()
            
            stats = response.json()
            storage = stats.get('storage', {})
            
            print(f"\n📊 CodeTracker v3.0 상태 (Claude Code 통합)")
            print(f"{'=' * 60}")
            print(f"👤 사용자: {creds.get('username', 'Unknown')}")
            print(f"🌐 서버: {self.server_url}")
            print(f"📁 로컬 경로: {self.root_path}")
            print(f"\n통계:")
            print(f"  📂 프로젝트: {stats['total_projects']}개")
            print(f"  📸 스냅샷: {stats['total_snapshots']}개")
            print(f"  🤖 AI 상호작용: {stats.get('total_interactions', 0)}개")
            print(f"  💬 AI 프롬프트: {stats['total_prompts']}개")
            print(f"  ✅ 수용된 응답: {stats['accepted_responses']}개")
            print(f"  📊 수용률: {stats['acceptance_rate']:.1f}%")
            
            print(f"\n💾 저장 공간:")
            print(f"  파일 버전 수: {storage.get('unique_versions', 0)}개")
            print(f"  원본 크기: {storage.get('total_size_mb', 0)} MB")
            print(f"  압축 후: {storage.get('compressed_size_mb', 0)} MB")
            print(f"  압축률: {storage.get('compression_ratio', 1):.1f}x")
            
            if stats['ai_tool_usage']:
                print(f"\nAI 도구 사용:")
                for tool_stat in stats['ai_tool_usage']:
                    print(f"  - {tool_stat['ai_tool']}: {tool_stat['count']}회")
        
        except requests.exceptions.RequestException as e:
            print(f"❌ 상태 조회 실패: {e}")


def main():
    parser = argparse.ArgumentParser(description='CodeTracker Client v3.0 (Claude Code Integration)')
    
    parser.add_argument('command', 
                       choices=['init', 'register', 'login', 'project-create', 'status'],
                       help='실행할 명령')
    parser.add_argument('--server', help='서버 URL')
    parser.add_argument('--path', default='.', help='프로젝트 경로')
    
    parser.add_argument('-u', '--username', help='사용자명')
    parser.add_argument('-e', '--email', help='이메일')
    parser.add_argument('-p', '--password', help='비밀번호')
    parser.add_argument('--org', help='조직명')
    
    parser.add_argument('--project-name', help='프로젝트 이름')
    parser.add_argument('--description', help='프로젝트 설명')
    
    args = parser.parse_args()
    
    client = CodeTrackerClient(args.path, args.server)
    
    try:
        if args.command == 'init':
            client.init(args.server)
        
        elif args.command == 'register':
            username = args.username or input("사용자명: ")
            email = args.email or input("이메일: ")
            password = args.password or input("비밀번호: ")
            org = args.org or input("조직명 (선택): ")
            client.register(username, email, password, org)
        
        elif args.command == 'login':
            username = args.username or input("사용자명: ")
            password = args.password or input("비밀번호: ")
            client.login(username, password)
        
        elif args.command == 'project-create':
            project_name = args.project_name or input("프로젝트 이름: ")
            description = args.description or ""
            client.create_project(project_name, description)
        
        elif args.command == 'status':
            client.status()
    
    except Exception as e:
        print(f"❌ 오류 발생: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()