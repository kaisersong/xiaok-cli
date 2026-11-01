#!/usr/bin/env python3
"""Real CLI version details and persistent, ordered statusline preferences."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

spec = importlib.util.spec_from_file_location('terminal_e2e', Path(__file__).with_name('tmux-e2e.py'))
e2e = importlib.util.module_from_spec(spec)
spec.loader.exec_module(e2e)


class IsolatedTmux(e2e.TmuxHarness):
    def tmux(self, *args, check=True):
        return super().tmux('-L', self.session, *args, check=check)

    def wait_for(self, predicate, timeout=20, interval=0.05):
        return self.wait_for_checked(predicate, lambda _: None, timeout, interval)


def main(entry=None):
    repo = Path(__file__).resolve().parents[2]
    entry = (entry or repo / 'dist/index.js').resolve()
    root = Path(tempfile.mkdtemp(prefix='xiaok-version-statusline-')).resolve()
    results = []
    for cols, rows in ((80, 24), (48, 16)):
        case = root / f'{cols}x{rows}'
        project, config, home = (case / name for name in ('project', 'config', 'home'))
        project.mkdir(parents=True); home.mkdir()
        environment = {**os.environ, 'XIAOK_CONFIG_DIR': str(config), 'HOME': str(home),
                       'USERPROFILE': str(home), 'XIAOK_TEST_ACCOUNT_HOME': str(home)}
        node = e2e.resolve_command('node.exe' if os.name == 'nt' else 'node', 'node')
        command = [node, '--import', str(repo / 'tests/support/profile-account-child.setup.mjs'), str(entry)]
        version = json.loads(subprocess.check_output([*command, 'version', '--json'], env=environment, text=True))
        assert version['runtime']['entry'] == str(entry), version
        assert 'commit' in version['build'] and 'builtAt' in version['build'], version
        (case / 'version.json').write_text(json.dumps(version, indent=2, ensure_ascii=False))
        server = e2e.FakeOpenAIServer(['STATUSLINE_INPUT_OK'], first_token_delay=0.1)
        server.start(); e2e.write_config(config, server.base_url)
        tty = IsolatedTmux(f'xiaok-version-statusline-{os.getpid()}-{rows}', project, config, home,
                           entry, e2e.resolve_tmux_binary(), env_overrides={
                               'XIAOK_DISABLE_GLOBAL_PLUGINS': '1', 'XIAOK_CONVERSATION_ACTIVITY': '0'})
        pids = []

        def start():
            tty.start(cols=cols, rows=rows)
            pids.append(int(tty.tmux('display-message', '-p', '-t', tty.session, '#{pane_pid}').stdout.strip()))
            (case / 'pane-pids.json').write_text(json.dumps(pids))
            return tty.wait_for(e2e.footer_has_empty_prompt)

        def issue(text, predicate):
            tty.send_text(text); tty.send_key('Enter')
            return tty.wait_for(lambda screen: predicate(screen) and e2e.footer_has_empty_prompt(screen))

        def footer(screen):
            return screen.splitlines()[-1].strip()

        def menu():
            tty.send_text('/statusline'); tty.send_key('Enter')
            return tty.wait_for(lambda s: '自定义状态栏' in s and 'Enter' in s)

        def menu_action(index, predicate):
            menu()
            tty.tmux('send-keys', '-t', tty.session, *(['Down'] * index), 'Enter')
            return tty.wait_for(lambda s: predicate(s) and '自定义状态栏' not in s and e2e.footer_has_empty_prompt(s))

        try:
            start()
            issue('/version', lambda s: '安装目录' in s)
            history = tty.tmux('capture-pane', '-p', '-S', '-2000', '-t', tty.session).stdout
            assert '实际入口' in history and '源码提交' in history and '构建时间' in history, history
            (case / 'slash-version.txt').write_text(history)
            issue('/statusline model,project', lambda s: footer(s) == 'gpt-terminal-e2e · project')
            opened = menu()
            assert '❯ 1. [x] 模型名称' in opened, opened
            (case / 'menu-opened.txt').write_text(opened)
            tty.send_key('Right')
            tty.wait_for(lambda s: 'project · gpt-terminal-e2e' in s)
            tty.send_key('Space'); tty.send_key('Enter')
            tty.wait_for(lambda s: footer(s) == 'project' and '自定义状态栏' not in s and e2e.footer_has_empty_prompt(s))
            preference = config / 'statusline.json'
            assert json.loads(preference.read_text())['fields'] == ['project']
            saved = preference.read_bytes()
            menu(); tty.send_key('Space'); tty.send_key('Escape')
            tty.wait_for(lambda s: '已取消状态栏设置' in s and '自定义状态栏' not in s and e2e.footer_has_empty_prompt(s))
            assert preference.read_bytes() == saved
            menu(); tty.tmux('send-keys', '-t', tty.session, *(['Down'] * 12))
            tty.tmux('resize-window', '-t', tty.session, '-x', '36', '-y', '12')
            short = tty.wait_for(lambda s: '❯ 13. 取消' in s and 'Esc' in s)
            assert short.count('自定义状态栏') <= 1, short
            (case / 'menu-short.txt').write_text(short)
            tty.send_key('Escape')
            tty.tmux('resize-window', '-t', tty.session, '-x', str(cols), '-y', str(rows))
            tty.wait_for(lambda s: '自定义状态栏' not in s and e2e.footer_has_empty_prompt(s))
            # A failed menu save must leave the active footer and previous bytes intact.
            saved_file = case / 'preference-before-failure.json'
            preference.rename(saved_file); preference.mkdir()
            menu(); tty.send_key('Space'); tty.send_key('Enter')
            failed = tty.wait_for(lambda s: '保存失败' in s and e2e.footer_has_empty_prompt(s))
            assert footer(failed) == 'project', failed
            assert saved_file.read_bytes() == saved
            preference.rmdir(); saved_file.rename(preference)
            wanted = f'gpt-terminal-e2e · v{version["version"]} · project'
            screen = issue('/statusline model,version,project', lambda s: footer(s) == wanted)
            before = preference.read_bytes()
            assert json.loads(before)['fields'] == ['model', 'version', 'project']
            screen = issue('/statusline invalid-field', lambda s: '未知字段' in s)
            assert preference.read_bytes() == before
            assert footer(screen) == wanted, screen
            tty.stop()
            assert footer(start()) == wanted
            screen = menu_action(10, lambda s: not footer(s))
            assert json.loads(preference.read_text())['fields'] == []
            tty.stop()
            assert not footer(start())
            screen = menu_action(9, lambda s: 'gpt-terminal-e2e' in footer(s) and '0%' in footer(s))
            assert 'project' in footer(screen), screen
            screen = issue('Followup input remains usable', lambda s: 'STATUSLINE_INPUT_OK' in s)
            assert len(server.requests) == 1, 'slash commands must not call a model'
            assert 'Followup input remains usable' in json.dumps(server.requests[0]['messages'])
            (case / 'final.txt').write_text(screen)
            results.append({'cols':cols, 'rows':rows, 'version':True, 'orderedFields':True,
                            'persistedAcrossRestart':True, 'offAndReset':True, 'invalidRetainsPreference':True,
                            'menuToggleAndReorder':True, 'menuCancel':True, 'shortMenu':True,
                            'menuSaveFailureRetainsState':True, 'nextInput':True, 'modelRequests':len(server.requests)})
        except Exception:
            (case / 'failure.txt').write_text(tty.capture())
            raise
        finally:
            tty.stop(); server.close()
            subprocess.run([*command, 'daemon', 'stop'], env=environment, check=True, capture_output=True, timeout=10)
            status = subprocess.check_output([*command, 'daemon', 'status'], env=environment, text=True, timeout=10)
            assert 'xiaok daemon: stopped' in status, status
            for pid in pids:
                for _ in range(50):
                    try: os.kill(pid, 0)
                    except ProcessLookupError: break
                    time.sleep(0.1)
                else: raise AssertionError(f'Fixture pane still running: {pid}')
    result = {'passed':True, 'cases':results, 'remainingCliProcesses':0, 'evidence':str(root)}
    (root / 'results.json').write_text(json.dumps(result, indent=2, ensure_ascii=False))
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cli-entry', type=Path)
    main(parser.parse_args().cli_entry)
