"""Launch-path regressions for the actual tmux E2E harness, with no OS authority."""
import importlib.util
import shlex
import subprocess
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

harness_path = Path(__file__).resolve().with_name('tmux-e2e.py')
spec = importlib.util.spec_from_file_location('tmux_launch_preloader_harness', harness_path)
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)


class LaunchPreloaderTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='xiaok launch paths ')
        self.root = Path(self.temporary.name).resolve()
        self.business = self.root / 'business working directory'
        self.business.mkdir()
        self.config = self.root / 'config directory'
        self.account = self.root / 'account directory'
        self.node = self.root / 'node executable'
        self.entries = {}
        for kind in ('source', 'installed-package'):
            entry = self.root / kind / 'dist' / 'index.js'
            entry.parent.mkdir(parents=True)
            entry.write_text('// actual entry location fixture\n')
            self.entries[kind] = entry
        self.expected = harness_path.parent.parent / 'support' / 'profile-account-child.setup.mjs'
        self.assertTrue(self.expected.is_file())

    def tearDown(self):
        self.temporary.cleanup()

    def command(self, branch, kind):
        # Replace only this harness binding; pathlib and the system os module
        # retain the actual host. This tests the Windows formatter, not Windows.
        with patch.object(harness, 'os', types.SimpleNamespace(name=branch)), patch.object(harness, 'resolve_command', return_value=str(self.node)):
            return harness.build_cli_launch_command(
                self.business, self.config, self.entries[kind], self.account,
                auto_mode=True, extra_args=['--resume', 'session source'],
                env_overrides={'NO_COLOR': '', 'XIAOK_DISABLE_GLOBAL_PLUGINS': '1'},
            )

    def check_normal(self, branch, kind):
        command = self.command(branch, kind)
        if branch == 'posix':
            words = shlex.split(command)
            self.assertEqual(words[:3], ['cd', str(self.business), '&&'])
            self.assertEqual(words[words.index('--import') + 1], str(self.expected))
            self.assertIn(str(self.entries[kind]), words)
            self.assertIn('HOME=' + str(self.account), words)
            self.assertIn('XIAOK_CONFIG_DIR=' + str(self.config), words)
            self.assertIn('XIAOK_TEST_ACCOUNT_HOME=' + str(self.account), words)
            self.assertIn('NO_COLOR=', words)
            self.assertIn('XIAOK_DISABLE_GLOBAL_PLUGINS=1', words)
            self.assertIn('--auto', words)
            self.assertIn('session source', words)
        else:
            self.assertIn('cd /d "' + str(self.business) + '"', command)
            self.assertIn('--import "' + str(self.expected) + '"', command)
            self.assertIn('"' + str(self.entries[kind]) + '" --auto', command)
            self.assertIn('set "HOME=' + str(self.account) + '"', command)
            self.assertIn('set "XIAOK_CONFIG_DIR=' + str(self.config) + '"', command)
            self.assertIn('set "XIAOK_TEST_ACCOUNT_HOME=' + str(self.account) + '"', command)
            self.assertIn('set "NO_COLOR="', command)
            self.assertIn('set "XIAOK_DISABLE_GLOBAL_PLUGINS=1"', command)
            self.assertIn(subprocess.list2cmdline(['--resume', 'session source']), command)
        self.assertNotIn(str(self.business / 'tests' / 'support'), command)
        self.assertNotIn(str(self.entries[kind].parent.parent / 'tests' / 'support'), command)

    def check_missing(self, branch):
        fake_harness = self.root / 'missing source' / 'tests' / 'e2e' / 'tmux-e2e.py'
        fake_harness.parent.mkdir(parents=True)
        fake_harness.write_text('// harness location only\n')
        with patch.object(harness, '__file__', str(fake_harness)):
            with self.assertRaisesRegex(FileNotFoundError, 'profile preloader missing'):
                self.command(branch, 'installed-package')


for branch in ('posix', 'nt'):
    for kind in ('source', 'installed-package'):
        def normal(self, branch=branch, kind=kind):
            self.check_normal(branch, kind)
        setattr(LaunchPreloaderTests, 'test_' + branch + '_' + kind.replace('-', '_'), normal)
    def missing(self, branch=branch):
        self.check_missing(branch)
    setattr(LaunchPreloaderTests, 'test_' + branch + '_missing_source_preloader', missing)


class FixtureRootTests(unittest.TestCase):
    def check_fixture(self, kind):
        with tempfile.TemporaryDirectory(prefix='xiaok owned alias root ') as temporary:
            root = Path(temporary).resolve()
            plain = root / 'plain root'
            plain.mkdir()
            alias = root / 'alias root'
            alias.symlink_to(plain, target_is_directory=True)
            class SetupObserved(Exception):
                pass
            def observe_config(config, *_args):
                self.assertEqual(config, config.resolve(), 'owned fixture root must be canonical before derived paths')
                self.assertEqual(config.parent, plain)
                raise SetupObserved()
            if kind == 'full':
                entry = harness.run_terminal_e2e
                function_module = harness
                arguments = [harness_path.parents[2]]
            else:
                numeric_path = harness_path.with_name('question-number-e2e.py')
                numeric_spec = importlib.util.spec_from_file_location('numeric_alias_actual', numeric_path)
                function_module = importlib.util.module_from_spec(numeric_spec)
                numeric_spec.loader.exec_module(function_module)
                entry = function_module.main
                arguments = []
            server_module = harness if kind == 'full' else function_module.e2e
            fake_server = types.SimpleNamespace(start=lambda: None, base_url='http://127.0.0.1:1')
            with patch.object(function_module.tempfile, 'mkdtemp', return_value=str(alias)), patch.object(server_module, 'FakeOpenAIServer', return_value=fake_server), patch.object(server_module, 'write_config', side_effect=observe_config):
                with self.assertRaises(SetupObserved):
                    entry(*arguments)

    def test_full_fixture_canonicalizes_its_actual_owned_alias(self):
        self.check_fixture('full')

    def test_installed_entry_numeric_fixture_canonicalizes_its_actual_owned_alias(self):
        self.check_fixture('numeric')

if __name__ == '__main__':
    unittest.main()
