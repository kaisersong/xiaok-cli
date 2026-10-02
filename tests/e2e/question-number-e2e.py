#!/usr/bin/env python3
"""Focused real-TTY numeric question regression; local SSE, isolated user config."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import tempfile

spec = importlib.util.spec_from_file_location('terminal_e2e', Path(__file__).with_name('tmux-e2e.py'))
e2e = importlib.util.module_from_spec(spec)
spec.loader.exec_module(e2e)


def main(cli_entry=None):
    repo = Path(__file__).resolve().parents[2]
    root = Path(tempfile.mkdtemp(prefix='xiaok-question-number-e2e-'))
    project, config, home = (root / name for name in ('project', 'config', 'home'))
    project.mkdir(); home.mkdir()
    options = [{'label': '桌面环境'}, {'label': '手机环境'}]
    server = e2e.FakeOpenAIServer([
        e2e.tool_call_response_events('ask_user', {'question': '数字单选回归', 'options': options}, 'number_legacy'),
        '数字单选完成',
        e2e.tool_call_response_events('AskUserQuestion', {'questions': [{'question': '数字兼容工具回归', 'options': options}]}, 'number_native'),
        '数字兼容工具完成',
        e2e.tool_call_response_events('ask_user', {'question': '数字其它回归', 'options': options}, 'number_other'),
        '数字其它完成',
        e2e.tool_call_response_events('ask_user', {'question': '数字多选回归', 'options': options, 'multiSelect': True}, 'number_multi'),
        '数字多选完成',
        '后续轮次完成',
    ], first_token_delay=0.05)
    server.start()
    e2e.write_config(config, server.base_url)
    tty = e2e.TmuxHarness(f'xiaok-question-number-{os.getpid()}', project, config, home,
                          cli_entry or repo / 'dist/index.js', e2e.resolve_tmux_binary(),
                          env_overrides={'XIAOK_DISABLE_GLOBAL_PLUGINS': '1'})
    try:
        tty.start()
        tty.wait_for(e2e.has_ready_input_prompt, timeout=20)
        snapshots = []
        def prompt(text, question):
            tty.send_text(text); tty.send_key('Enter')
            screen = tty.wait_for(lambda s: question in s and '2. 手机环境' in s and '3. Other' in s, timeout=20)
            snapshots.append(screen)
        def completed(text):
            screen = tty.wait_for(lambda s: text in s and e2e.has_ready_input_prompt(s), timeout=20)
            assert '[xiaok] UI 已降级' not in screen
            snapshots.append(screen)
        prompt('numeric legacy', '数字单选回归')
        tty.send_key('2')  # No Enter: must settle and hand input back to chat.
        completed('数字单选完成')
        prompt('numeric native', '数字兼容工具回归')
        tty.send_key('2')
        completed('数字兼容工具完成')
        prompt('numeric other', '数字其它回归')
        tty.send_key('3')
        tty.wait_for(lambda s: 'Enter your answer:' in s, timeout=20)
        tty.send_text('2026 个节点'); tty.send_key('Enter')
        completed('数字其它完成')
        prompt('numeric multi', '数字多选回归')
        tty.send_key('1'); tty.send_key('2'); tty.send_key('Enter')
        completed('数字多选完成')
        tty.send_text('followup input'); tty.send_key('Enter')
        completed('后续轮次完成')
        results = {m['tool_call_id']: m['content'] for request in server.requests
                   for m in request.get('messages', []) if m.get('role') == 'tool'}
        assert results['number_legacy'] == '手机环境', results
        assert json.loads(results['number_native'])['answers']['数字兼容工具回归'] == '手机环境', results
        assert results['number_other'] == '2026 个节点', results
        assert results['number_multi'] == '桌面环境, 手机环境', results
        tty.send_text('/exit'); tty.send_key('Enter')
        print(json.dumps({'passed': True, 'checks': ['ask_user numeric single', 'AskUserQuestion numeric single',
                         'numeric Other and numeric free text', 'numeric multi-select', 'next-turn input'],
                          'toolResults': results, 'requests': len(server.requests)}, ensure_ascii=False))
    except Exception:
        print(tty.capture())
        raise
    finally:
        tty.stop(); server.close(); shutil.rmtree(root)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cli-entry', type=Path, help='Alternate built CLI entry for installed-module verification')
    main(parser.parse_args().cli_entry)
