#!/usr/bin/env python3
"""Real owned tmux pane exits exercise the shared observer, without a model."""
import importlib.util
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
import uuid
from types import SimpleNamespace
from unittest import mock

spec = importlib.util.spec_from_file_location('tty_exit_helpers', Path(__file__).with_name('tmux-e2e.py'))
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)


class OwnedPaneCleanupError(RuntimeError):
    def __init__(self, errors):
        self.errors = tuple(errors)
        super().__init__('owned pane cleanup errors')


class ExitWaitTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='xiaok-pane-exit-test-')).resolve()
        self.identity = self.root.stat()
        self.socket = 'xiaok-exit-' + uuid.uuid4().hex
        self.tty = None
        self.pid = None
        self.addCleanup(self.close_owned)

    def close_owned(self):
        errors = []
        stopped = self.tty is None
        gone = self.tty is None and self.pid is None
        identity_matches = False
        if self.tty:
            try:
                self.tty.stop()
                stopped = True
            except BaseException as error: errors.append(error)
            if self.pid is None:
                errors.append(AssertionError('owned pane PID unobserved; root retained'))
        if self.pid:
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline:
                try: os.kill(self.pid, 0)
                except ProcessLookupError:
                    gone = True
                    break
                except BaseException as error:
                    errors.append(error)
                    break
                time.sleep(0.01)
            if not gone and not errors:
                errors.append(AssertionError(f'owned pane PID survived: {self.pid}'))
        try:
            stat = self.root.stat()
            identity_matches = (stat.st_dev, stat.st_ino, stat.st_uid) == (
                self.identity.st_dev, self.identity.st_ino, self.identity.st_uid)
            if not identity_matches: raise AssertionError('owned pane test root identity changed')
        except BaseException as error: errors.append(error)
        try:
            print('PANE_TEST_CLEANUP ' + json.dumps({'pid': self.pid, 'socket': self.socket,
                  'root': str(self.root), 'processGone': gone, 'identityMatches': identity_matches}), flush=True)
        except BaseException as error: errors.append(error)
        # Diagnostic output failure must neither skip a safe cleanup nor permit
        # deletion after an unknown process/root observation.
        if stopped and gone and identity_matches:
            try: shutil.rmtree(self.root)
            except BaseException as error: errors.append(error)
        if errors:
            if len(errors) == 1: raise errors[0]
            raise OwnedPaneCleanupError(errors) from errors[0]

    def start_pane(self, body):
        socket = self.socket
        class OwnedTmux(helpers.TmuxHarness):
            def tmux(self, *args, **kwargs):
                return super().tmux('-L', socket, *args, **kwargs)
        self.tty = OwnedTmux('exit', self.root, self.root, self.root, self.root/'unused',
                             helpers.resolve_tmux_binary())
        gate = self.root/'gate'
        script = self.root/'pane.py'
        script.write_text('import os,signal,time\nfrom pathlib import Path\n'
                          f'gate=Path({str(gate)!r})\n'
                          'while not gate.exists(): time.sleep(0.005)\n' + body + '\n')
        self.tty.tmux('new-session', '-d', '-s', 'exit',
                      'exec ' + shlex.join([sys.executable, str(script)]))
        self.tty.tmux('set-option', '-t', 'exit', 'remain-on-exit', 'on')
        self.pid = int(self.tty.tmux('display-message', '-p', '-t', 'exit', '#{pane_pid}').stdout)
        gate.touch()
        return self.tty

    def test_actual_delayed_zero_exit(self):
        tty = self.start_pane('time.sleep(2)\nraise SystemExit(0)')
        receipt = tty.wait_for_exit(timeout=10)
        self.assertEqual((receipt['paneDead'], receipt['exitCode'], receipt['signal']), ('1', '0', ''))
        self.assertTrue(receipt['actualExitKnown'])
        self.assertGreaterEqual(receipt['elapsedSeconds'], 1.8)

    def test_actual_nonzero_exit_is_rejected(self):
        tty = self.start_pane('raise SystemExit(7)')
        with self.assertRaisesRegex(RuntimeError, 'did not exit successfully'):
            tty.wait_for_exit()

    def test_actual_signal_exit_is_rejected(self):
        tty = self.start_pane('os.kill(os.getpid(),signal.SIGTERM)')
        with self.assertRaisesRegex(RuntimeError, 'did not exit successfully'):
            tty.wait_for_exit()

    def test_actual_live_pane_remains_failure(self):
        tty = self.start_pane('time.sleep(30)')
        with self.assertRaises(TimeoutError): tty.wait_for_exit(timeout=0.15)
        self.assertEqual(tty.tmux('display-message','-p','-t','exit','#{pane_dead}').stdout.strip(), '0')

    def test_missing_pane_is_not_success(self):
        tty = self.start_pane('time.sleep(30)')
        tty.stop()
        with self.assertRaises(RuntimeError): tty.wait_for_exit(timeout=0.15)

    def test_unknown_receipt_is_rejected(self):
        class Unknown:
            session = 'never-allocated'
            def tmux(self, *args, **kwargs): return subprocess.CompletedProcess([],0,'garbage\n','')
        with self.assertRaisesRegex(RuntimeError, 'unknown pane exit receipt'):
            helpers.TmuxHarness.wait_for_exit(Unknown(), timeout=0.1)

    def test_late_zero_receipt_cannot_pass_deadline(self):
        class Late:
            session = 'never-allocated'
            def tmux(self, *args, **kwargs):
                time.sleep(0.025)
                return subprocess.CompletedProcess([],0,'1\t0\t\n','')
        with self.assertRaises(TimeoutError):
            helpers.TmuxHarness.wait_for_exit(Late(), timeout=0.01)

    def test_query_uses_remaining_budget(self):
        calls = []
        class Query:
            session = 'never-allocated'
            def tmux(self, *args, **kwargs):
                calls.append(kwargs['timeout'])
                raise subprocess.TimeoutExpired('owned query', kwargs['timeout'])
        with self.assertRaises(subprocess.TimeoutExpired):
            helpers.TmuxHarness.wait_for_exit(Query(), timeout=0.05)
        self.assertEqual(len(calls), 1)
        self.assertGreater(calls[0], 0)
        self.assertLessEqual(calls[0], 0.05)

    def test_permission_cleanup_preserves_all_original_errors(self):
        permission_spec = importlib.util.spec_from_file_location('permission_cleanup',
            Path(__file__).with_name('permission-hook-fallback.py'))
        permission = importlib.util.module_from_spec(permission_spec)
        permission_spec.loader.exec_module(permission)
        body_error, diagnostic_error = RuntimeError('body'), RuntimeError('diagnostic')
        stop_error, server_error, output_error = RuntimeError('stop'), RuntimeError('server'), BrokenPipeError('output')
        calls = []
        class Tty:
            def __init__(self, *args, **kwargs): pass
            def start(self, **kwargs): raise body_error
            def stop(self):
                calls.append('stop')
                raise stop_error
        class Server:
            base_url = 'http://owned.invalid'
            def __init__(self, *args, **kwargs): pass
            def start(self): pass
            def close(self):
                calls.append('server')
                raise server_error
        def config(path, *args):
            path.mkdir(parents=True)
            (path/'config.json').write_text('{}')
        fake = SimpleNamespace(TmuxHarness=Tty, FakeOpenAIServer=Server,
            resolve_tmux_binary=lambda:'owned-tmux', tool_call_response_events=lambda *args:[], write_config=config)
        fake_spec = SimpleNamespace(loader=SimpleNamespace(exec_module=lambda module:None))
        run_root = self.root/'permission'
        run_root.mkdir()
        with mock.patch.object(permission.importlib.util,'spec_from_file_location',return_value=fake_spec), \
             mock.patch.object(permission.importlib.util,'module_from_spec',return_value=fake), \
             mock.patch.object(permission.tempfile,'mkdtemp',return_value=str(run_root)), \
             mock.patch.object(permission,'record_failure',side_effect=diagnostic_error), \
             mock.patch('builtins.print',side_effect=output_error):
            with self.assertRaises(permission.TtyCleanupError) as caught:
                permission.run(self.root,self.root/'unused')
        expected = (body_error,diagnostic_error,output_error,stop_error,server_error,output_error,output_error)
        self.assertEqual(len(caught.exception.errors),len(expected))
        for actual, original in zip(caught.exception.errors,expected): self.assertIs(actual,original)
        self.assertIs(caught.exception.__cause__,body_error)
        self.assertEqual(calls,['stop','server'])

    def test_unknown_cleanup_receipt_retains_root_and_full_error_tree(self):
        root = self.root/'unknown'
        root.mkdir()
        stop_error, stat_error, output_error = RuntimeError('stop'), OSError('stat'), BrokenPipeError('output')
        other = ExitWaitTest('test_unknown_receipt_is_rejected')
        other.root, other.identity, other.socket, other.pid = root, root.stat(), 'never-allocated', None
        def stop(): raise stop_error
        other.tty = SimpleNamespace(stop=stop)
        original_stat = Path.stat
        def observe(path, *args, **kwargs):
            if path == root: raise stat_error
            return original_stat(path,*args,**kwargs)
        with mock.patch.object(Path,'stat',observe), mock.patch('builtins.print',side_effect=output_error):
            with self.assertRaises(OwnedPaneCleanupError) as caught: other.close_owned()
        self.assertEqual(len(caught.exception.errors),4)
        unknown_pid = caught.exception.errors[1]
        self.assertIs(type(unknown_pid),AssertionError)
        self.assertEqual(str(unknown_pid),'owned pane PID unobserved; root retained')
        self.assertIsNone(unknown_pid.__cause__)
        self.assertIsNone(unknown_pid.__context__)
        self.assertFalse(hasattr(unknown_pid,'errors'))
        for actual,original in zip((caught.exception.errors[0],*caught.exception.errors[2:]),
                                   (stop_error,stat_error,output_error)):
            self.assertIs(actual,original)
        self.assertIs(caught.exception.__cause__,stop_error)
        self.assertTrue(root.exists())

    def test_unobserved_pid_never_counts_as_exit(self):
        root = self.root/'unobserved'
        root.mkdir()
        other = ExitWaitTest('test_unknown_receipt_is_rejected')
        other.root, other.identity, other.socket, other.pid = root, root.stat(), 'never-allocated', None
        stopped = []
        other.tty = SimpleNamespace(stop=lambda: stopped.append(True))
        with self.assertRaisesRegex(AssertionError, 'PID unobserved'):
            other.close_owned()
        self.assertEqual(stopped,[True])
        self.assertTrue(root.exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
