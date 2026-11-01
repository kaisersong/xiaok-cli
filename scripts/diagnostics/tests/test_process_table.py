"""Saved numeric process-table replay only; never an OS/native close witness."""
from pathlib import Path
import hashlib
import json
import os
import runpy
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
TOOLS = HERE.parent
FIXTURES = HERE / 'fixtures'
ARCHIVE = {
    'linux-family.txt': ('3aaf51f2d05c3bbb1c9792a228baccd59fd2f77067e605a3f595307bed85f5e8', 171),
    'linux-terminal.txt': ('5858b53bb3e48d97a73baf259c09c85901b29c4f00ac7670a91f539f9b98c506', 168),
}


class FakePS:
    """Unit stub: writes saved bytes; does not launch or inspect any process."""
    pid = 999999
    returncode = 0

    def __init__(self, data, stdout):
        stdout.write(data)
        stdout.flush()

    def wait(self, timeout):
        return self.returncode

    def kill(self):
        raise AssertionError('unexpected unit-stub kill')


class ObserverReplayTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='process-table-unit-')
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name).resolve()
        root.chmod(0o700)
        with patch.dict(os.environ, {'R16_OUT': str(root)}), patch(
                'subprocess.Popen', side_effect=AssertionError('module load launched process')):
            self.driver = runpy.run_path(str(TOOLS / 'intent-first-worker-cpu.py'))
        self.root = root

    def replay(self, columns, data, callback):
        def fake_popen(argv, **kwargs):
            self.assertEqual(argv, ['/bin/ps', '-axo', columns])
            self.assertIn('stdin', kwargs)
            return FakePS(data, kwargs['stdout'])
        with patch.object(self.driver['subprocess'], 'Popen', side_effect=fake_popen) as launch:
            value = callback()
        launch.assert_called_once()
        return value

    def family(self, data, pid=2429):
        return self.replay('pid=,ppid=,pgid=', data,
                           lambda: self.driver['worker_family'](SimpleNamespace(pid=pid), 0))

    def terminal(self, data, pid=2429):
        return self.replay('pid=,pgid=', data,
                           lambda: self.driver['closure'](SimpleNamespace(pid=pid)))

    def test_linux_family_with_pgid_zero_rows(self):
        data = (FIXTURES / 'linux-family.txt').read_bytes()
        result = self.family(data)
        self.assertEqual(result['status'], 'OBSERVED')
        self.assertEqual(result['descendantPids'], [2463, 2469])
        self.assertEqual([r['pid'] for r in result['rows']], [2429, 2463, 2469])
        self.assertEqual(result['stdoutSHA256'], hashlib.sha256(data).hexdigest())

    def test_linux_terminal_with_pgid_zero_rows(self):
        self.assertIs(self.terminal((FIXTURES / 'linux-terminal.txt').read_bytes()), True)

    def test_live_target_group_is_not_absent(self):
        data = (FIXTURES / 'linux-terminal.txt').read_bytes() + b'900001 2429\n'
        self.assertIs(self.terminal(data), False)

    def test_unknown_family_line_is_not_discarded(self):
        data = (FIXTURES / 'linux-family.txt').read_bytes() + b'unknown row\n'
        self.assertEqual(self.family(data)['status'], 'UNKNOWN')

    def test_unknown_terminal_line_stays_unknown(self):
        data = (FIXTURES / 'linux-terminal.txt').read_bytes() + b'unknown row\n'
        self.assertIsNone(self.terminal(data))

    def test_missing_leader_stays_unknown(self):
        self.assertEqual(self.family(b'2 0 0\n31 1 31\n')['status'], 'UNKNOWN')

    def test_positive_group_family_behavior_retained(self):
        result = self.family(b'101 1 101\n102 101 101\n103 101 999\n', pid=101)
        self.assertEqual(result['status'], 'OBSERVED')
        self.assertEqual(result['descendantPids'], [102])

    def test_positive_group_terminal_behavior_retained(self):
        self.assertIs(self.terminal(b'101 1\n102 101\n', pid=101), False)
        for invalid in [0, -1, True]:
            with self.subTest(target=invalid), patch.object(
                    self.driver['subprocess'], 'Popen', side_effect=AssertionError('invalid target launched ps')):
                self.assertIsNone(self.driver['closure'](SimpleNamespace(pid=invalid)))


class ProcessTableParserTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with patch('subprocess.Popen', side_effect=AssertionError('helper load launched process')):
            cls.helper = runpy.run_path(str(TOOLS / 'intent-first-worker-freeze.py'))

    def parse(self, data, width):
        return self.helper['parse_process_table'](data, width)

    def test_complete_saved_rows_retained(self):
        provenance = json.loads((FIXTURES / 'provenance.json').read_text())
        self.assertEqual(provenance['originalRun'], 40031447989)
        self.assertEqual(provenance['originalArtifact'], 12534618693)
        self.assertEqual(provenance['originalHEAD'], '453d51b910e152c8ca7dc9713eda370479444190')
        for name, width in [('linux-family.txt', 3), ('linux-terminal.txt', 2)]:
            with self.subTest(name=name):
                raw = (FIXTURES / name).read_bytes()
                digest, count = ARCHIVE[name]
                self.assertEqual(provenance['files'][name]['sha256'], digest)
                self.assertEqual(provenance['files'][name]['rowCount'], count)
                self.assertEqual(hashlib.sha256(raw).hexdigest(), digest)
                rows = self.parse(raw.decode(), width)
                self.assertEqual(len(rows), count)
                self.assertEqual(sum(row[-1] == 0 for row in rows), 130)

    def test_zero_pgid_is_retained(self):
        self.assertEqual(self.parse('2 0 0\n3 2 0\n', 3), [(2, 0, 0), (3, 2, 0)])
        self.assertEqual(self.parse('2 0\n3 0\n', 2), [(2, 0), (3, 0)])

    def test_malformed_rows_fail_closed(self):
        bad = ['', '  ', '1 2\n', '1 2 3 4\n', '1 2 word\n',
               '0 0 0\n', '-1 0 0\n', '+1 0 0\n', '1 -1 0\n', '1 0 -1\n',
               '1 0 0\nunknown\n', '١ 0 0\n']
        for data in bad:
            with self.subTest(data=data), self.assertRaises(ValueError):
                self.parse(data, 3)
        for data in ['', '1 2 3\n', '0 0\n', '1 -1\n', '1 +1\n', '1 0\nunknown\n']:
            with self.subTest(twoColumn=data), self.assertRaises(ValueError):
                self.parse(data, 2)

    def test_duplicate_pid_rejected(self):
        for text in ['1 0 0\n1 2 0\n', '1 0 0\n01 2 0\n']:
            with self.subTest(text=text), self.assertRaises(ValueError):
                self.parse(text, 3)

    def test_unsupported_column_width_rejected(self):
        for width in [0, 1, 4, 3.0, True]:
            with self.subTest(width=width), self.assertRaises(ValueError):
                self.parse('1 0 0\n', width)


if __name__ == '__main__':
    expected = 13
    suite = unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__])
    discovered = suite.countTestCases()
    if discovered != expected:
        raise SystemExit(f'offline parser replay count mismatch: {discovered} != {expected}')
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    print(f'OFFLINE_PARSER_REPLAY expected={expected} discovered={discovered} executed={result.testsRun}')
    raise SystemExit(0 if result.wasSuccessful() and result.testsRun == expected and not result.skipped else 1)
