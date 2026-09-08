#!/usr/bin/env python3
"""Real dist/TTY presentation and Read/Grep allowlist regression; scripted SSE."""
from __future__ import annotations
import argparse
import json
import os
import re
import runpy
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

common = runpy.run_path(str(Path(__file__).with_name('tmux-e2e.py')))


def codename_styles(pane: str, name: str) -> list[tuple[bool, tuple[int, ...] | None]]:
    """Read terminal SGR state at each visible name, including tmux-normalized codes."""
    italic, color = False, None
    styles = []
    for token in re.finditer(r'\x1b\[([0-9;]*)m|' + re.escape(name), pane):
        if token.group(1) is None:
            styles.append((italic, color))
            continue
        codes = [int(code or 0) for code in token.group(1).split(';')]
        i = 0
        while i < len(codes):
            code = codes[i]
            if code == 0:
                italic, color = False, None
            elif code in (3, 23):
                italic = code == 3
            elif code == 39:
                color = None
            elif code == 38 and codes[i + 1:i + 2] == [2]:
                color = tuple(codes[i + 2:i + 5]); i += 4
            i += 1
    return styles


def run(project: Path, entry: str) -> None:
    root = Path(tempfile.mkdtemp(prefix=f'xiaok-presentation-{entry}-'))
    home, config, work = (root / name for name in ('home', 'config', 'project'))
    for directory in (home, config, work):
        directory.mkdir()
    (work / 'probe.txt').write_text('READ_GREP_EVIDENCE\n')
    release = {key: threading.Event() for key in ('A', 'B')}
    state = {'main': 0, 'A': 0, 'B': 0}
    both_done = threading.Event()
    requests: list[dict] = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            request = json.loads(self.rfile.read(int(self.headers['content-length'])))
            requests.append(request)
            names = [tool['function']['name'] for tool in request.get('tools', [])]
            child = 'spawn_agent' not in names
            key = None
            if child:
                texts = [m.get('content', '') for m in request.get('messages', []) if m['role'] == 'user']
                assignment = next((text for text in reversed(texts) if isinstance(text, str) and text.startswith('ASSIGNMENT_')), '')
                key = 'B' if assignment.startswith('ASSIGNMENT_B') else 'A'
                step = state[key]
                state[key] += 1
                if step == 0:
                    release[key].wait(25)
                    events = common['tool_call_response_events']('read', {'file_path': str(work / 'probe.txt')}, f'{key}_read')
                elif step == 1:
                    events = common['tool_call_response_events']('grep', {'path': str(work), 'pattern': 'READ_GREP_EVIDENCE'}, f'{key}_grep')
                else:
                    events = common['text_response_events'](f'{key}_EVIDENCE_READY')
            else:
                step = state['main']; state['main'] += 1
                if step < 2:
                    key = ('A', 'B')[step]
                    assignment = f'ASSIGNMENT_{key} ' + ('检查队列与取消' if key == 'A' else '检查工具注册与释放')
                    args = {'prompt': assignment, 'description': assignment, 'tools': ['Read', 'Grep']} if entry == 'subagent' else {
                        'task_name': f'review_{key.lower()}', 'message': assignment, 'tools': ['Read', 'Grep'], 'fork_context': False}
                    events = common['tool_call_response_events'](entry, args, f'spawn_{key}')
                elif entry == 'spawn_agent' and step == 2:
                    both_done.wait(25)
                    events = common['tool_call_response_events']('wait_agent', {'targets': ['/root/review_a', '/root/review_b'], 'timeout_ms': 10000}, 'wait_both')
                elif entry == 'spawn_agent' and step in (3, 4):
                    events = common['tool_call_response_events']('close_agent', {'target': f'/root/review_{"a" if step == 3 else "b"}'}, f'close_{step}')
                else:
                    events = common['text_response_events']('PRESENTATION_PASS')
            self.send_response(200)
            self.send_header('content-type', 'text/event-stream')
            self.send_header('connection', 'close')
            self.end_headers()
            try:
                for event in events:
                    self.wfile.write(('data: ' + json.dumps(event) + '\n\n').encode())
                self.wfile.write(b'data: [DONE]\n\n'); self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
            if child and state['A'] >= 3 and state['B'] >= 3:
                both_done.set()

        def log_message(self, *_args: object) -> None:
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    common['write_config'](config, f'http://127.0.0.1:{server.server_address[1]}/v1')
    tty = common['TmuxHarness'](f'xiaok-presentation-{entry}-{os.getpid()}', work, config, home,
        project / 'dist' / 'index.js', common['resolve_tmux_binary'](), env_overrides={'NO_COLOR': ''})
    def wait_for(predicate, timeout=20):
        text = tty.wait_for(predicate, timeout=timeout)
        assert predicate(text), text
        return text

    try:
        tty.start(cols=110, rows=24)
        wait_for(common['has_welcome_screen'], timeout=20)
        tty.send_text('只读检查队列和工具注册'); tty.send_key('Enter')
        first = wait_for(lambda text: '双鱼座' in text and '检查队列与取消' in text and 'SubAgent 协作' in text, timeout=20)
        (root / 'first.txt').write_text(first)
        first_ansi = tty.capture(ansi=True)
        (root / 'first.ansi.txt').write_text(first_ansi)
        pisces_styles = codename_styles(first_ansi, '双鱼座')
        assert pisces_styles and all(italic and color for italic, color in pisces_styles), repr(first_ansi)
        if entry == 'subagent':
            release['A'].set()
        second = wait_for(lambda text: '天秤座' in text and '检查工具注册与释放' in text
            and (entry == 'subagent' or any(line.strip().startswith('SubAgent 双鱼座:') for line in text.splitlines()) and any(line.strip().startswith('SubAgent 天秤座:') for line in text.splitlines())), timeout=20)
        (root / 'second.txt').write_text(second)
        second_ansi = tty.capture(ansi=True)
        (root / 'second.ansi.txt').write_text(second_ansi)
        libra_styles = codename_styles(second_ansi, '天秤座')
        assert libra_styles and all(italic and color for italic, color in libra_styles), repr(second_ansi)
        assert pisces_styles[0][1] == libra_styles[0][1]
        if entry == 'spawn_agent':
            assert not any('双鱼座' in line and '天秤座' in line for line in second.splitlines()), second
            lines = second.splitlines()
            agent_rows = [i for i, line in enumerate(lines) if line.strip().startswith(('SubAgent 双鱼座:', 'SubAgent 天秤座:'))]
            assert len(agent_rows) == 2 and agent_rows[1] == agent_rows[0] + 1, second
            assert 'SubAgent' not in lines[agent_rows[-1] + 1] and lines[agent_rows[-1] + 1].strip(), second
        if entry == 'spawn_agent':
            for cols, rows in ((52, 20), (140, 32), (110, 24)):
                tty.tmux('resize-window', '-t', tty.session, '-x', str(cols), '-y', str(rows))
                resized = wait_for(lambda text: any(line.strip().startswith('SubAgent 双鱼座:') for line in text.splitlines())
                    and any(line.strip().startswith('SubAgent 天秤座:') for line in text.splitlines())
                    and len(text.splitlines()) == rows and '❯' in text.splitlines()[rows - 3]
                    and 'gpt-terminal-e2e' in text.splitlines()[rows - 1])
                (root / f'resize-{cols}-{rows}.txt').write_text(resized)
                assert not any('双鱼座' in line and '天秤座' in line for line in resized.splitlines()), resized
                assert sum(line.strip().startswith('SubAgent ') for line in resized.splitlines()) == 2, resized
                assert sum('❯' in line for line in resized.splitlines()) == 1, resized
        tty.send_text('DRAFT_TO_KEEP')
        draft = wait_for(lambda text: 'DRAFT_TO_KEEP' in text)
        (root / 'draft.txt').write_text(draft)
        release['A'].set(); release['B'].set()
        final = wait_for(lambda text: 'PRESENTATION_PASS' in text and 'DRAFT_TO_KEEP' in text, timeout=25)
        (root / 'final.txt').write_text(final)
        history = tty.tmux('capture-pane', '-p', '-S', '-', '-t', tty.session).stdout
        (root / 'history.txt').write_text(history)
        history_ansi = tty.tmux('capture-pane', '-ep', '-S', '-', '-t', tty.session).stdout
        (root / 'history.ansi.txt').write_text(history_ansi)
        for alias in ('双鱼座', '天秤座'):
            assert f'{alias} · 完成' in history, history
            styles = codename_styles(history_ansi, alias)
            assert styles and all(style == styles[0] and style[0] and style[1] for style in styles), repr(history_ansi)
        assert '╭─ SubAgent 协作' in history and '│ 分工' in history, history
        assert not re.search(r'子\s*Agent', history), history
        assert history.count('2 次工具调用') == 2, history
        assert 'read 1 / grep 1' in history, history
        assert 'A_EVIDENCE_READY' in history and 'B_EVIDENCE_READY' in history
        transcript = [json.loads(line) for p in (config / 'transcripts').glob('*.jsonl') for line in p.read_text().splitlines()]
        progress = [item['event'] for item in transcript if item['type'] == 'subagent_progress']
        ended = [event for event in progress if event['kind'] == 'finished']
        assert len(ended) == 2 and len({event['agentId'] for event in ended}) == 2
        assert all(event['toolsCompleted'] == 2 and event['toolsFailed'] == 0 and event['elapsedMs'] > 0 for event in ended), ended
        for request in requests:
            names = [tool['function']['name'] for tool in request.get('tools', [])]
            if 'spawn_agent' not in names:
                assert 'read' in names and 'grep' in names and 'write' not in names, names
        if entry == 'spawn_agent':
            last_agents = {item['event']['agent']['id']: item['event']['agent'] for item in transcript if item['type'] == 'multi_agent' and item['event']['agent'].get('parentId')}
            assert len(last_agents) == 2 and all(agent['resourcesReleased'] for agent in last_agents.values()), last_agents
        print(f'PASS: {entry}: SubAgent groups, one shared italic accent, assignments, actual Read/Grep, per-agent work/time, draft; evidence={root}', flush=True)
    finally:
        release['A'].set(); release['B'].set(); both_done.set()
        tty.stop(); server.shutdown(); server.server_close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--project-dir', default=os.getcwd())
    args = parser.parse_args()
    for entry in ('subagent', 'spawn_agent'):
        run(Path(args.project_dir).resolve(), entry)
