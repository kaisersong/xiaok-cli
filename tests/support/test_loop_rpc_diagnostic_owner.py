"""Exercise the actual owner with only clock/process leaves replaced.

No process or signal is created. These checks prove the cleanup time bound,
not physical process qualification or a successful Loop scenario.
"""
from contextlib import ExitStack
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import unittest
from unittest.mock import patch


_path = Path(__file__).with_name('loop-rpc-diagnostic.py')
_spec = importlib.util.spec_from_file_location('loop_rpc_owner_under_test', _path)
OWNER = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(OWNER)


class Clock:
    def __init__(self):
        self.value = 0.0
        self.on_advance = lambda: None

    def now(self):
        return self.value

    def advance(self, seconds):
        if seconds < 0:
            raise AssertionError('negative wait')
        self.value += seconds
        self.on_advance()


class UnreapedChild:
    pid = 987654321  # Deliberately not an actual recorded process.

    def __init__(self, clock):
        self.clock = clock

    def poll(self):
        return None

    def wait(self, timeout=None):
        if timeout is None:
            raise AssertionError('unbounded wait on an unreaped child')
        self.clock.advance(timeout)
        raise subprocess.TimeoutExpired('controlled-only', timeout)


class OwnerDeadlineTests(unittest.TestCase):
    def exercise(self, fault=None, cancel_at=None):
        clock = Clock()
        child = UnreapedChild(clock)
        sent = []
        leader = dict(pid=child.pid, ppid=os.getpid(), pgid=child.pid,
                      uid=os.getuid(), start='controlled-only')
        injected = False

        def rows(*args, **kwargs):
            nonlocal injected
            should_fail = (fault == 'initial' or
                           fault == 'after-term' and any(s == signal.SIGTERM for _, s in sent))
            if should_fail and not injected:
                injected = True
                raise OSError('controlled process observation failure')
            return [leader]

        with tempfile.TemporaryDirectory(prefix='loop-rpc-owner-unit-') as temporary:
            root = Path(temporary).resolve()
            original = root.stat()
            owner = OWNER.Owner(root, 'CONTROLLED-NO-PROCESS')

            def cancel():
                if cancel_at is not None and clock.value >= cancel_at and not owner.cancel:
                    owner.cancel.append(signal.SIGINT)

            clock.on_advance = cancel
            with ExitStack() as patches:
                patches.enter_context(patch.object(OWNER.time, 'monotonic', clock.now))
                patches.enter_context(patch.object(OWNER.time, 'sleep', clock.advance))
                patches.enter_context(patch.object(OWNER.subprocess, 'Popen', return_value=child))
                patches.enter_context(patch.object(OWNER, 'proc_rows', rows))
                patches.enter_context(patch.object(OWNER.os, 'getpgid', return_value=child.pid))
                patches.enter_context(patch.object(OWNER.os, 'killpg',
                                                  side_effect=lambda pid, sig: sent.append((clock.now(), sig))))
                result = owner.child(['controlled-only'], 'controlled', 1)
            current = root.stat()
            self.assertFalse(root.is_symlink())
            self.assertEqual((current.st_dev, current.st_ino, current.st_uid),
                             (original.st_dev, original.st_ino, original.st_uid))

        print('OWNER_DEADLINE_PROBE ' + json.dumps({
            'scope': 'controlled clock and process leaves; no actual process or signal',
            'fault': fault, 'cancelAt': cancel_at, 'fakeElapsedSeconds': clock.value,
            'signals': [{'fakeSeconds': at, 'signal': sig.name} for at, sig in sent],
            'originalUnknownRetained': bool(owner.errors) and not result['reaped'],
        }))
        self.assertFalse(result['reaped'])
        self.assertIsNone(result['exitCode'])
        self.assertTrue(owner.errors, 'unknown physical exit must remain failure')
        self.assertTrue(result['groupResidual'])
        self.assertLessEqual(sum(sig == signal.SIGTERM for _, sig in sent), 1)
        self.assertLessEqual(sum(sig == signal.SIGKILL for _, sig in sent), 1)
        self.assertLessEqual(clock.value, 11.1, 'outer1 + original5 + original5; no second grace')
        self.assertTrue(all(at <= 11.1 for at, _ in sent))
        return clock, sent, injected

    def test_expired_kill_grace_does_not_restart_shutdown(self):
        _, sent, _ = self.exercise()
        self.assertEqual([sig for _, sig in sent], [signal.SIGTERM, signal.SIGKILL])

    def test_observation_failure_during_shutdown_keeps_original_deadline(self):
        _, _, injected = self.exercise(fault='after-term')
        self.assertTrue(injected)

    def test_initial_observation_failure_is_bounded_and_unknown(self):
        self.exercise(fault='initial')

    def test_parent_cancellation_does_not_open_another_grace(self):
        clock, _, _ = self.exercise(cancel_at=0.2)
        self.assertLessEqual(clock.value, 10.4, 'cancellation + one5 + one5')


if __name__ == '__main__':
    unittest.main()
