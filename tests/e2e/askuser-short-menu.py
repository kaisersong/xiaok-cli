#!/usr/bin/env python3
"""Real CLI + local SSE: short AskUser menu keeps selection and hint visible."""
import importlib.util
import json
import shutil
import tempfile
import time
from pathlib import Path


def run(project: Path) -> None:
    spec = importlib.util.spec_from_file_location('askuser_helpers', Path(__file__).with_name('tmux-e2e.py'))
    helpers = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helpers)
    root = Path(tempfile.mkdtemp(prefix='xiaok-askuser-short-menu-'))
    work, config, home = root / 'project', root / 'config', root / 'home'
    work.mkdir(); home.mkdir()
    socket = f'xiaok-askuser-menu-{int(time.time() * 1000)}'

    class IsolatedTmux(helpers.TmuxHarness):
        def tmux(self, *args, **kwargs):
            return super().tmux('-L', socket, *args, **kwargs)

    options = [
        {'label': '中餐炒菜'}, {'label': '面食粉类'}, {'label': '轻食沙拉'},
        {'label': '快餐便当'}, {'label': '火锅烧烤'}, {'label': '其他'},
    ]
    question = '想吃什么类型的？'
    server = helpers.FakeOpenAIServer([
        '\n'.join(f'PREFILL_{i}' for i in range(30)),
        helpers.tool_call_response_events('AskUserQuestion', {'questions': [{'question': question, 'options': options}]}, 'ask_menu'),
        'ASKUSER_CONFIRMED', 'FOLLOWUP_OK',
    ], first_token_delay=0.05)
    tty = IsolatedTmux('askuser-menu', work, config, home, project / 'dist/index.js',
                       helpers.resolve_tmux_binary(), env_overrides={'XIAOK_DISABLE_GLOBAL_PLUGINS': '1'})
    try:
        server.start(); helpers.write_config(config, server.base_url, 'gpt-4o')
        tty.start(cols=36, rows=16)
        tty.wait_for(helpers.has_ready_input_prompt, timeout=15)
        tty.send_text('prefill'); tty.send_key('Enter')
        tty.wait_for(lambda text: 'PREFILL_29' in text and helpers.has_ready_input_prompt(text), timeout=15)
        tty.send_text('ask menu'); tty.send_key('Enter')
        screen = tty.wait_for(lambda text: '1-6 select' in text, timeout=15)
        assert screen.count(question) == 1 and screen.count('1-6 select') == 1, screen
        for _ in range(10): tty.send_key('Down')
        screen = tty.wait_for(lambda text: '❯ 5. 火锅烧烤' in text, timeout=5)
        assert screen.count(question) == 1 and screen.count('1-6 select') == 1, screen
        print('PASS: 36x16 real CLI keeps question, selected later option, and one navigation hint')
        tty.send_key('Enter')
        screen = tty.wait_for(lambda text: 'ASKUSER_CONFIRMED' in text and helpers.has_ready_input_prompt(text), timeout=15)
        assert '1-6 select' not in screen, screen
        result = next(message for message in server.requests[-1]['messages'] if message.get('tool_call_id') == 'ask_menu')
        assert json.loads(result['content'])['answers'][question] == '火锅烧烤', result
        tty.send_text('followup'); tty.send_key('Enter')
        screen = tty.wait_for(lambda text: 'FOLLOWUP_OK' in text and helpers.has_ready_input_prompt(text), timeout=15)
        assert 'FOLLOWUP_OK' in screen and '1-6 select' not in screen, screen
        print('PASS: confirmation reaches the model; menu clears and the next turn remains usable')
    finally:
        tty.stop(); tty.tmux('kill-server', check=False); server.close(); shutil.rmtree(root)
        print('CLEANUP: closed 1 owned CLI child, local SSE server and isolated tmux server')


if __name__ == '__main__':
    run(Path(__file__).resolve().parents[2])
