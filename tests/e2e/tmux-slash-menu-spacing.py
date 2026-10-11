#!/usr/bin/env python3
"""Real CLI + local SSE + tmux regression for slash-menu transcript spacing."""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import tempfile


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--project-dir', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--cli-entry', type=Path, help='Override the built CLI entry to verify an installed/development command')
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    project = args.project_dir.resolve()
    cli_entry = args.cli_entry.resolve() if args.cli_entry else project / 'dist/index.js'
    args.output_dir.mkdir(parents=True, exist_ok=True)
    spec = importlib.util.spec_from_file_location('xiaok_terminal_e2e', project / 'tests/e2e/tmux-e2e.py')
    assert spec and spec.loader
    e2e = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(e2e)
    results = []
    for columns, rows in [(80, 24), (48, 12)]:
        with tempfile.TemporaryDirectory(prefix='xiaok-slash-gap-') as folder:
            root = Path(folder)
            fixture = root / 'project'
            fixture.mkdir()
            (root / 'home').mkdir()
            marker = 'SLASH_GAP_LAST'
            body = '\n\n'.join([f'正文第 {i} 段，保留原有输出。' for i in range(20)]) + f'\n\n{marker} 不是权限系统拦错了。'
            server = e2e.FakeOpenAIServer([body], first_token_delay=0.1)
            server.start()
            e2e.write_config(root / 'config', server.base_url)
            tty = e2e.TmuxHarness(
                f'xiaok-slash-gap-{os.getpid()}-{rows}', fixture, root / 'config', root / 'home',
                cli_entry, e2e.resolve_tmux_binary(),
                env_overrides={'XIAOK_DISABLE_GLOBAL_PLUGINS': '1', 'NO_COLOR': ''},
            )
            try:
                tty.start(cols=columns, rows=rows)
                tty.wait_for(e2e.has_input_prompt, timeout=15)
                tty.send_text('只输出已提供的正文，用于菜单排版测试。')
                tty.send_key('Enter')
                tty.wait_for(lambda text: marker in text and e2e.footer_has_empty_prompt(text), timeout=25)
                tty.send_text('/')
                opened = tty.wait_for(lambda text: '/help' in text or '/clear' in text, timeout=10)
                (args.output_dir / f'{columns}x{rows}-opened.txt').write_text(opened)
                lines = opened.splitlines()
                marker_index = next(i for i, line in enumerate(lines) if marker in line)
                menu_index = next(i for i, line in enumerate(lines) if '/clear' in line or '/help' in line)
                gap = menu_index - marker_index - 1
                assert gap >= 1 and all(not line.strip() for line in lines[marker_index + 1:menu_index]), opened
                for _ in range(5):
                    tty.send_key('Down')
                navigated = tty.wait_for(lambda text: '/' in text, timeout=5)
                assert navigated.splitlines().index(next(line for line in navigated.splitlines() if marker in line)) == marker_index, navigated
                tty.send_key('Escape')
                closed = tty.wait_for(lambda text: '/clear' not in text and '/help' not in text, timeout=10)
                assert marker in closed, closed
                assert sum(e2e.is_input_prompt_line(line) for line in closed.splitlines()) == 1, closed
                (args.output_dir / f'{columns}x{rows}-closed.txt').write_text(closed)
                results.append({'columns': columns, 'rows': rows, 'gapRows': gap, 'navigationStable': True, 'dismissed': True})
            finally:
                tty.stop()
                server.close()
    cases = [
        ('bash', {'command': 'cmd /c echo MENU_GAP_SMOKE'}, 'xiaok 想要执行以下操作'),
        ('ask_user', {'question': '请选择复现场景', 'options': [{'label': '选项甲'}, {'label': '选项乙'}]}, '请选择复现场景'),
        ('AskUserQuestion', {'questions': [{'header': 'menu-gap-question', 'question': '请选择复现场景',
                                         'options': [{'label': '选项甲'}, {'label': '选项乙'}]}]}, 'menu-gap-question'),
    ]
    for tool, arguments, header in cases:
        with tempfile.TemporaryDirectory(prefix='xiaok-menu-gap-') as folder:
            root = Path(folder)
            fixture = root / 'project'
            fixture.mkdir()
            (root / 'home').mkdir()
            marker = 'MENU_GAP_LAST'
            body = '\n\n'.join([f'正文第 {i} 段，保留原有输出。' for i in range(20)]) + f'\n\n{marker} 下面需要用户选择。'
            server = e2e.FakeOpenAIServer([
                e2e.text_then_tool_call_events(body, tool, arguments, f'call_menu_gap_{tool}'),
                'MENU_FLOW_FINISHED',
            ], first_token_delay=0.1)
            server.start()
            e2e.write_config(root / 'config', server.base_url)
            tty = e2e.TmuxHarness(
                f'xiaok-menu-gap-{os.getpid()}-{tool}', fixture, root / 'config', root / 'home',
                cli_entry, e2e.resolve_tmux_binary(), auto_mode=False,
                env_overrides={'XIAOK_DISABLE_GLOBAL_PLUGINS': '1', 'NO_COLOR': ''},
            )
            try:
                tty.start()
                tty.wait_for(e2e.has_input_prompt, timeout=15)
                tty.send_text('显示测试菜单并等我选择。')
                tty.send_key('Enter')
                opened = tty.wait_for(lambda text: header in text and marker in text, timeout=20)
                (args.output_dir / f'{tool}-opened.txt').write_text(opened)
                lines = opened.splitlines()
                header_index = next(i for i, line in enumerate(lines) if header in line)
                assert header_index > 0 and not lines[header_index - 1].strip(), opened
                marker_index = next(i for i, line in enumerate(lines) if marker in line)
                assert marker_index < header_index - 1, opened
                tty.send_key('Down')
                tty.wait_for(lambda text: '❯ 2.' in text, timeout=5)
                tty.send_key('Up')
                navigated = tty.wait_for(lambda text: '❯ 1.' in text, timeout=5)
                assert navigated.count(header) == 1, navigated
                assert next(i for i, line in enumerate(navigated.splitlines()) if marker in line) == marker_index, navigated
                tty.send_key('Enter')
                closed = tty.wait_for(lambda text: 'MENU_FLOW_FINISHED' in text and e2e.footer_has_empty_prompt(text), timeout=20)
                assert header not in closed, closed
                (args.output_dir / f'{tool}-closed.txt').write_text(closed)
                results.append({'tool': tool, 'gapRows': header_index - marker_index - 1, 'navigationStable': True, 'resumed': True})
            finally:
                tty.stop()
                server.close()
    (args.output_dir / 'result.json').write_text(json.dumps(results, indent=2))
    print(json.dumps(results))


if __name__ == '__main__':
    main()
