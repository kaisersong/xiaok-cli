#!/usr/bin/env python3
"""Verify confirmed question spacing and tool-group boundaries in the real CLI."""
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

    def wait_for(self, predicate, timeout=10, interval=0.05):
        return self.wait_for_checked(predicate, lambda _: None, timeout, interval)


def main(cli_entry=None):
    repo = Path(__file__).resolve().parents[2]
    results = []
    root = Path(tempfile.mkdtemp(prefix='xiaok-question-spacing-')).resolve()
    for tool in ('ask_user', 'AskUserQuestion'):
        for cols, rows in ((80, 24), (48, 16)):
            case = root / f'{tool}-{cols}x{rows}'
            project, config, home = (case / name for name in ('project', 'config', 'home'))
            project.mkdir(parents=True)
            home.mkdir()
            question = 'QUESTION_GAP？'
            options = [{'label': 'OPTION_ALPHA'}, {'label': 'OPTION_BETA'}]
            args = {'question': question, 'options': options}
            if tool == 'AskUserQuestion':
                args = {'questions': [args]}
            server = e2e.FakeOpenAIServer([
                *[e2e.tool_call_response_events('bash', {'command': f'echo BEFORE_GAP_{i}'}, f'before_{i}')
                  for i in range(4)],
                e2e.tool_call_response_events(tool, args, 'spacing_question'),
                e2e.tool_call_response_events('bash', {'command': 'echo AFTER_GAP'}, 'after'),
                'SPACING_COMPLETE',
                'FOLLOWUP_COMPLETE',
            ], first_token_delay=0.05)
            server.start()
            e2e.write_config(config, server.base_url)
            tty = IsolatedTmux(f'xiaok-question-gap-{os.getpid()}-{tool}-{rows}', project, config, home,
                               cli_entry or repo / 'dist/index.js', e2e.resolve_tmux_binary(),
                               env_overrides={'XIAOK_DISABLE_GLOBAL_PLUGINS': '1', 'XIAOK_CONVERSATION_ACTIVITY': '0'})
            pane_pid = None
            try:
                tty.start(cols=cols, rows=rows)
                pane_pid = int(tty.tmux('display-message', '-p', '-t', tty.session, '#{pane_pid}').stdout.strip())
                (case / 'pane.pid').write_text(str(pane_pid))
                tty.wait_for(e2e.footer_has_empty_prompt, timeout=20)
                tty.send_text('Exercise tool and question boundaries')
                tty.send_key('Enter')
                tty.wait_for(lambda s: question in s and '2. OPTION_BETA' in s, timeout=25)
                tty.send_key('Down')
                tty.send_key('Up')
                tty.send_key('2')
                tty.wait_for(lambda s: 'SPACING_COMPLETE' in s and e2e.footer_has_empty_prompt(s), timeout=20)
                history = tty.tmux('capture-pane', '-p', '-S', '-2000', '-t', tty.session).stdout
                (case / 'history.txt').write_text(history)
                lines = history.splitlines()
                index = next(i for i, line in enumerate(lines) if question in line)
                assert not lines[index - 1].strip(), history
                assert '更多命令已折叠' in lines[index - 2], history
                assert 'OPTION_BETA' in lines[index + 1], history
                assert history.count(question) == 1, history
                assert sum('╭─ Ran' in line for line in lines) == 2, history
                assert any('│ echo AFTER_GAP' in line for line in lines[index + 1:]), history
                answers = [m['content'] for request in server.requests for m in request.get('messages', [])
                           if m.get('role') == 'tool' and m.get('tool_call_id') == 'spacing_question']
                expected = 'OPTION_BETA' if tool == 'ask_user' else json.dumps(
                    {'answers': {question: 'OPTION_BETA'}}, ensure_ascii=False, separators=(',', ':'))
                assert answers and all(answer == expected for answer in answers), answers
                tty.send_text('Followup input remains usable')
                tty.send_key('Enter')
                tty.wait_for(lambda s: 'FOLLOWUP_COMPLETE' in s and e2e.footer_has_empty_prompt(s), timeout=20)
                (case / 'followup.txt').write_text(tty.capture())
                (case / 'requests.json').write_text(json.dumps(server.requests, ensure_ascii=False, indent=2))
                assert not server.responses, 'Followup response was not consumed'
                assert any('Followup input remains usable' in json.dumps(request.get('messages', []))
                           for request in server.requests), 'Followup input did not reach the model'
                results.append({'tool': tool, 'cols': cols, 'rows': rows, 'gapRows': 1,
                                'freshRanGroup': True, 'answerAndFollowup': True, 'requests': len(server.requests)})
            except Exception:
                (case / 'failure.txt').write_text(tty.capture())
                raise
            finally:
                tty.stop()
                server.close()
                # The CLI starts a detached reminder daemon for this fixture
                # account. Stop it through its normal control command.
                environment = {**os.environ, 'XIAOK_CONFIG_DIR': str(config), 'HOME': str(home),
                               'USERPROFILE': str(home), 'XIAOK_TEST_ACCOUNT_HOME': str(home)}
                command = [e2e.resolve_command('node', 'node'), '--import',
                           str(repo / 'tests/support/profile-account-child.setup.mjs'),
                           str(cli_entry or repo / 'dist/index.js'), 'daemon']
                subprocess.run([*command, 'stop'], env=environment, check=True, capture_output=True, timeout=10)
                status = subprocess.run([*command, 'status'], env=environment, check=True,
                                        capture_output=True, text=True, timeout=10)
                assert 'xiaok daemon: stopped' in status.stdout, status.stdout
                if pane_pid is not None:
                    for _ in range(50):
                        try:
                            os.kill(pane_pid, 0)
                        except ProcessLookupError:
                            break
                        time.sleep(0.1)
                    else:
                        raise AssertionError(f'Test pane process remains alive: {pane_pid}')
    (root / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(json.dumps({'passed': True, 'cases': results, 'remainingCliProcesses': 0,
                      'evidence': str(root)}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cli-entry', type=Path)
    main(parser.parse_args().cli_entry)
