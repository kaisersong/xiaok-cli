"""Manual Windows-only, exact sibling source + offline wheels + original Python wholes."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import stat
import struct
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
PINS = json.loads((HERE / 'plugin-offline-wheels-inputs.json').read_text(encoding='utf-8'))
MAX_LOG = 8 * 1024 * 1024
FAILURE_REASONS = ('command_log_overflow', 'command_tree_not_joined', 'command_tree_wait_unknown', 'invalid_frozen_path', 'original_python_whole_failed', 'plugin_head_mismatch', 'product_sources_changed_from_base', 'pytest_install_mutated_runtime_versions', 'required_command_failed', 'required_windows_cpython314_x64_absent', 'tracked_input_hash_mismatch', 'tracked_leaf_not_regular_or_expected_link', 'tracked_population_mismatch')


def save(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=True) + '\n', encoding='utf-8')


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args], text=True).strip()


def inventory(root):
    if git(root, 'rev-parse', 'HEAD') != PINS['pluginHead']:
        raise RuntimeError('plugin_head_mismatch')
    actual_paths = set(subprocess.check_output(
        ['git', '-C', str(root), 'ls-files', '-z']).decode().rstrip('\0').split('\0'))
    if actual_paths != {r['path'] for r in PINS['files']}:
        raise RuntimeError('tracked_population_mismatch')
    rows = []
    for row in PINS['files']:
        rel = Path(row['path'])
        if rel.is_absolute() or '..' in rel.parts:
            raise RuntimeError('invalid_frozen_path')
        path = root / rel
        info = path.lstat()
        # A tracked symlink may be a Git materialized text leaf on Windows.
        # Its Git blob is the link target; never follow the link for this hash.
        if stat.S_ISLNK(info.st_mode) and row['mode'] == '120000':
            body = os.readlink(path).encode('utf-8')
        elif stat.S_ISREG(info.st_mode):
            body = path.read_bytes()
        else:
            raise RuntimeError('tracked_leaf_not_regular_or_expected_link')
        if len(body) != row['size'] or hashlib.sha256(body).hexdigest() != row['sha256']:
            raise RuntimeError('tracked_input_hash_mismatch')
        rows.append(row)
    return rows


def main():
    args = argparse.ArgumentParser()
    args.add_argument('--plugin', type=Path, required=True)
    args.add_argument('--output', type=Path, required=True)
    opts = args.parse_args()
    root = opts.plugin.resolve(strict=True)
    out = opts.output.resolve()
    out.mkdir(exist_ok=False)
    evidence = out / 'evidence'
    evidence.mkdir()
    work = out / 'work'
    work.mkdir()
    result = {'schema': 1, 'status': 'UNKNOWN', 'commands': [], 'tests': [],
              'pluginHead': PINS['pluginHead'], 'productBase': PINS['productBase'],
              'sourceBeforeVerified': False, 'sourceAfterVerified': False,
              'offlineQualifiedBeforePytestInstall': False, 'runtimeVersionsUnchanged': False,
              'processContract': 'Windows Start-Process -Wait process-tree wait; no POSIX PGID claim'}
    child_env = os.environ.copy()
    # A fresh hosted job carries no application credentials. Never dump this env.
    child_env.update({'PIP_CONFIG_FILE': os.devnull, 'PIP_DISABLE_PIP_VERSION_CHECK': '1',
                      'PIP_NO_INPUT': '1', 'PYTHONDONTWRITEBYTECODE': '1',
                      'PYTHONUTF8': '1'})
    runtime = {'system': platform.system(), 'platform': platform.platform(),
               'machine': platform.machine(), 'uname': list(platform.uname()),
               'python': sys.version, 'implementation': platform.python_implementation(),
               'pointerBits': struct.calcsize('P') * 8, 'executable': sys.executable}
    save(evidence / 'platform.json', runtime)

    def run(tag, argv, required=True):
        request = work / (tag + '.request.json')
        stdout, stderr = work / (tag + '.stdout.log'), work / (tag + '.stderr.log')
        save(request, {'executable': str(argv[0]),
                       'argumentLine': subprocess.list2cmdline([str(a) for a in argv[1:]]),
                       'cwd': str(root), 'stdout': str(stdout), 'stderr': str(stderr)})
        start = time.monotonic()
        p = subprocess.Popen(['pwsh', '-NoLogo', '-NoProfile', '-NonInteractive', '-File',
                              str(HERE / 'plugin-offline-command.ps1'), '-Request', str(request)],
                             cwd=root, env=child_env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        record = {'tag': tag, 'argv': [str(a) for a in argv], 'supervisorPid': p.pid,
                  'actualWait': False, 'reaped': False, 'stdioClosed': False}
        result['commands'].append(record)
        output, err = p.communicate()
        record.update({'supervisorExit': p.returncode, 'actualWait': True, 'reaped': True,
                       'stdioClosed': True, 'seconds': time.monotonic() - start})
        if p.returncode != 0 or len(output) > 65536 or len(err) > 65536:
            raise RuntimeError('command_tree_wait_unknown')
        terminal = json.loads(output.decode('utf-8-sig'))
        record['terminal'] = terminal
        if terminal.get('treeWaitReturned') is not True or terminal.get('hasExited') is not True:
            raise RuntimeError('command_tree_not_joined')
        for path in [stdout, stderr]:
            if path.stat().st_size > MAX_LOG:
                raise RuntimeError('command_log_overflow')
            shutil.copyfile(path, evidence / path.name)
        save(evidence / (tag + '.process.json'), record)
        if required and terminal['exitCode'] != 0:
            raise RuntimeError('required_command_failed')
        return terminal['exitCode'], stdout

    try:
        if not (sys.platform == 'win32' and runtime['implementation'] == 'CPython'
                and sys.version_info[:2] == (3, 14) and runtime['pointerBits'] == 64
                and runtime['machine'].lower() in ('amd64', 'x86_64')):
            raise RuntimeError('required_windows_cpython314_x64_absent')
        cli = HERE.parents[1]
        result['cliHead'] = git(cli, 'rev-parse', 'HEAD')
        # The new diagnostic commit may add files, but must not change product sources.
        if subprocess.call(['git', '-C', str(cli), 'diff', '--quiet', PINS['productBase'],
                            'HEAD', '--', 'src', 'desktop/src', 'desktop/electron']) != 0:
            raise RuntimeError('product_sources_changed_from_base')
        before = inventory(root)
        save(evidence / 'source-before.json', before)
        save(evidence / 'wheel-sha256.json', [r for r in before if r['path'].endswith('.whl')])
        result['sourceBeforeVerified'] = True
        venv = work / 'venv'
        run('venv', [sys.executable, '-m', 'venv', str(venv)])
        py = venv / 'Scripts/python.exe'
        pip = [str(py), '-m', 'pip', '--disable-pip-version-check', '--no-input']
        run('offline-install', pip + ['install', '--no-index', '--only-binary=:all:',
                                      '--find-links', str(root / PINS['wheels']),
                                      '-r', str(root / PINS['requirements'])])
        run('offline-check', pip + ['check'])
        run('offline-import', [str(py), '-c',
                              'import mcp,pydantic,jsonschema,bs4; print("wheel_imports_ok")'])
        dist_code = ('import importlib.metadata as m,json; '
                     'print(json.dumps({d.metadata["Name"].lower().replace("_","-"):d.version '
                     'for d in m.distributions()},sort_keys=True))')
        _, version_file = run('offline-versions', [str(py), '-c', dist_code])
        runtime_versions = json.loads(version_file.read_text(encoding='utf-8'))
        result['offlineQualifiedBeforePytestInstall'] = True
        result['offlineRuntimeVersions'] = runtime_versions
        result['actualFourDirectVersions'] = {k: runtime_versions[k] for k in
                                               ['mcp', 'pydantic', 'jsonschema', 'beautifulsoup4']}
        # Deliberately online test-only dependency setup, after offline proof.
        run('pytest-install', pip + ['install', '--index-url', 'https://pypi.org/simple',
                                    '--only-binary=:all:', 'pytest==' + PINS['pytest']])
        _, after_file = run('test-versions', [str(py), '-c', dist_code])
        after_versions = json.loads(after_file.read_text(encoding='utf-8'))
        if any(after_versions.get(k) != v for k, v in runtime_versions.items()):
            raise RuntimeError('pytest_install_mutated_runtime_versions')
        result['runtimeVersionsUnchanged'] = True
        run('test-dependency-check', pip + ['check'])
        failures = False
        for index, directory in enumerate(PINS['tests']):
            tag = 'whole-' + str(index + 1)
            report = evidence / (tag + '.junit.xml')
            code, _ = run(tag, [str(py), '-m', 'pytest', directory, '-q',
                                '--junitxml=' + str(report)], required=False)
            xml = ET.parse(report).getroot()
            slots = [{'class': c.get('classname'), 'name': c.get('name'),
                      'seconds': c.get('time'),
                      'status': 'failed' if c.find('failure') is not None else
                                'error' if c.find('error') is not None else
                                'skipped' if c.find('skipped') is not None else 'passed'}
                     for c in xml.iter('testcase')]
            good = code == 0 and bool(slots) and all(s['status'] == 'passed' for s in slots)
            result['tests'].append({'directory': directory, 'exitCode': code,
                                    'slots': slots, 'qualified': good})
            failures = failures or not good
        if failures:
            raise RuntimeError('original_python_whole_failed')
        result['status'] = 'PASS'
    except Exception as exc:
        result['status'] = 'FAIL'
        # Only our fixed RuntimeError literals are intentionally used above.
        result['failureType'] = type(exc).__name__
        result['failureReason'] = str(exc) if type(exc) is RuntimeError and str(exc) in FAILURE_REASONS else 'unknown'
        print('plugin_offline_candidate_failed', type(exc).__name__, file=sys.stderr)
    finally:
        try:
            after = inventory(root)
            save(evidence / 'source-after.json', after)
            result['sourceAfterVerified'] = True
        except Exception:
            result['status'] = 'FAIL'
            result['sourceAfterVerified'] = False
        save(evidence / 'result.json', result)
    return 0 if result['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
