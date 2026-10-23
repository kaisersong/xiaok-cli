#!/usr/bin/env python3
"""Real CLI/provider/timer: three memory failures leave the editor untouched."""
import argparse
import importlib.util
import io
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import time


def run(entry):
    spec = importlib.util.spec_from_file_location('helpers', Path(__file__).with_name('tmux-e2e.py'))
    h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
    # The general harness records stderr separately. Share the real TTY here,
    # otherwise the exact footer corruption would be hidden.
    original_launch = h.build_cli_launch_command
    def launch_with_stderr(project_dir, config_dir, *args, **kwargs):
        command = original_launch(project_dir, config_dir, *args, **kwargs)
        stderr_suffix = f"2>{h.shell_quote_posix(str(config_dir / 'cli-stderr.log'))}"
        assert os.name != 'nt' and command.endswith(stderr_suffix), 'this TTY fixture requires POSIX launch'
        return command.removesuffix(stderr_suffix) + '2>&1'
    h.build_cli_launch_command = launch_with_stderr
    root = Path(tempfile.mkdtemp(prefix='xiaok-memory-footer-'))
    work, home, config = root / 'project', root / 'home', root / 'config'
    work.mkdir(); home.mkdir()

    class MemoryServer(h.FakeOpenAIServer):
        memory_calls = 0

        def _handler_class(self):
            outer = self
            parent = super()._handler_class()

            class Handler(parent):
                def do_POST(self):
                    raw = self.rfile.read(int(self.headers.get('content-length', '0')))
                    body = json.loads(raw)
                    if self.path.endswith('/embeddings'):
                        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers()
                        self.wfile.write(json.dumps({'data': [{'embedding': [0.1] * 8} for _ in body['input']]}).encode())
                        return
                    if any(m.get('role') == 'system' and '只输出JSON结果' in str(m.get('content')) for m in body.get('messages', [])):
                        self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
                        self.wfile.write(b'data: {"choices":[{"index":0,"delta":{"content":"{"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n')
                        self.wfile.flush(); outer.memory_calls += 1
                        return
                    self.rfile = io.BytesIO(raw)
                    super().do_POST()
            return Handler

    server = MemoryServer(['BACKGROUND_TEST_READY', 'NEXT_TURN_EXACT'], first_token_delay=.05)
    socket = f'xiaok-memory-footer-{os.getpid()}'

    class IsolatedTmux(h.TmuxHarness):
        def tmux(self, *args, **kwargs): return super().tmux('-L', socket, *args, **kwargs)

    tty = IsolatedTmux('memory', work, config, home, entry, h.resolve_tmux_binary(),
        env_overrides={'XIAOK_DISABLE_GLOBAL_PLUGINS': '1', 'NO_COLOR': ''})
    owned = []

    def wait_for(predicate):
        screen = tty.wait_for(predicate, timeout=20)
        assert predicate(screen), f'Inspect {root}'
        return screen

    try:
        server.start(); h.write_config(config, server.base_url, 'gpt-4o')
        settings = json.loads((config / 'config.json').read_text())
        # Current config preserves advanced memory settings; legacy v1 migration does not.
        settings.pop('defaultModel', None)
        settings.update({'schemaVersion': 2, 'defaultProvider': 'synthetic', 'defaultModelId': 'synthetic',
            'providers': {'synthetic': {'type': 'custom', 'protocol': 'openai_legacy', 'apiKey': 'test-key', 'baseUrl': server.base_url}},
            'models': {'synthetic': {'provider': 'synthetic', 'model': 'gpt-4o'}}})
        settings.update({'automations': {'enabled': False}, 'intentBoundary': {'enabled': False},
            'memory': {'type': 'layered', 'embedding': {'provider': 'api', 'apiUrl': server.base_url, 'model': 'synthetic', 'dimensions': 8},
                'compaction': {'autoCompact': True, 'compactIntervalMs': 1000, 'l0MinMessages': 1}}})
        (config / 'config.json').write_text(json.dumps(settings))
        tty.start(cols=100, rows=24)
        owned.append(int(tty.tmux('display-message', '-p', '-t', tty.session, '#{pane_pid}').stdout))
        wait_for(h.has_ready_input_prompt)
        tty.send_text('Synthetic background memory source'); tty.send_key('Enter')
        wait_for(lambda s: 'BACKGROUND_TEST_READY' in s and h.has_ready_input_prompt(s))
        tty.send_text('DRAFT_中文'); before = wait_for(lambda s: 'DRAFT_中文' in s)
        before_row = next(i for i, line in enumerate(before.splitlines()) if 'DRAFT_中文' in line)
        before_cursor = tty.tmux('display-message', '-p', '-t', tty.session, '#{cursor_y},#{cursor_x}').stdout
        baseline = server.memory_calls
        # Seed a pending historical raw message; keep timer, provider and store real.
        db = sqlite3.connect(config / 'memory.db')
        db.execute('INSERT INTO memory_l0_raw(id,session_id,role,content,segmented_content) VALUES(?,?,?,?,?)',
            ('synthetic-pending', 'synthetic-session', 'user', 'Pending synthetic original', 'Pending synthetic original'))
        db.commit(); db.close()
        deadline = time.monotonic() + 15
        while server.memory_calls < baseline + 3 and time.monotonic() < deadline: time.sleep(.05)
        assert server.memory_calls >= baseline + 3, 'real memory timer did not make three provider calls'
        time.sleep(.1)
        screen = tty.capture(); (root / 'after-failures.txt').write_text(screen)
        (root / 'before-failures.txt').write_text(before)
        assert '[memory]' not in screen and 'auto-compaction failed' not in screen, 'background errors painted over the editor'
        assert screen.count('DRAFT_中文') == 1
        assert next(i for i, line in enumerate(screen.splitlines()) if 'DRAFT_中文' in line) == before_row
        assert tty.tmux('display-message', '-p', '-t', tty.session, '#{cursor_y},#{cursor_x}').stdout == before_cursor
        log = (config / 'logs' / 'xiaok.log').read_text()
        assert log.count('memory_output_incomplete') >= 3, 'failures were hidden instead of persisted'
        tty.send_text('X'); wait_for(lambda s: 'DRAFT_中文X' in s)
        tty.send_key('BSpace'); wait_for(lambda s: 'DRAFT_中文X' not in s and 'DRAFT_中文' in s)
        tty.send_key('Enter'); wait_for(lambda s: 'NEXT_TURN_EXACT' in s and h.has_ready_input_prompt(s))
        saved = json.loads(next((config / 'sessions').glob('*.json')).read_text())
        content = [m['content'] for m in saved['messages'] if m['role'] == 'user'][-1]
        assert content[-1]['text'] == 'DRAFT_中文'
        provider = [m['content'] for m in server.requests[-1]['messages'] if m['role'] == 'user'][-1]
        assert provider == (''.join(b['text'] for b in content) if isinstance(provider, str) else content)
        tty.send_text('/exit'); tty.send_key('Enter'); time.sleep(.5)
        (root / 'result.json').write_text(json.dumps({'passed': True, 'memoryCalls': server.memory_calls,
            'sameDraftRow': True, 'sameCursor': True, 'exactNextInput': True, 'fileDiagnostic': True, 'entry': str(entry)}, indent=2))
        print('PASS: three real memory truncations; no terminal diagnostic; draft/cursor intact; next input exact')
    finally:
        tty.stop(); server.close(); remaining = list(owned); deadline = time.monotonic() + 5
        while remaining and time.monotonic() < deadline:
            alive = []
            for pid in remaining:
                try: os.kill(pid, 0); alive.append(pid)
                except ProcessLookupError: pass
            remaining = alive
            if remaining: time.sleep(.05)
        (root / 'owned-pids.json').write_text(json.dumps({'pids': owned, 'remaining': remaining}))
        print(f'CLEANUP: owned CLI processes remaining={len(remaining)}; local SSE closed')
        print('EVIDENCE', root); assert not remaining


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--cli-entry', type=Path)
    args = parser.parse_args()
    run((args.cli_entry or Path(__file__).resolve().parents[2] / 'dist/index.js').resolve())
