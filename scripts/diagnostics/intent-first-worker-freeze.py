"""R16 CI-only input freeze. No test execution, installation, or source writes."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
import math
import re
from collections import Counter

BASE = 'd36eef076b4eacf878775bbfe8cb21240af8fa5c'
TOOLS = (
    '.github/workflows/intent-first-worker-diagnostic.yml',
    'scripts/diagnostics/intent-first-worker-cpu.py',
    'scripts/diagnostics/intent-first-worker-freeze.py',
)


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def save(root, name, value):
    # Never replace a receipt, including a partial/failed run's receipt.
    with (root / name).open('x') as out:
        json.dump(value, out, indent=2, allow_nan=False)
        out.write('\n')


def git(*args):
    return subprocess.check_output(['git', *args], timeout=30)


def tree(ref):
    rows = {}
    for item in git('ls-tree', '-r', '-z', '--full-tree', ref).split(b'\0'):
        if not item:
            continue
        meta, path = item.split(b'\t', 1)
        mode, kind, blob = meta.decode().split()
        rows[os.fsdecode(path)] = {'mode': mode, 'type': kind, 'blob': blob}
    return rows


def source_snapshot():
    head = git('rev-parse', 'HEAD').decode().strip()
    if head != os.environ['R16_HEAD']:
        raise RuntimeError('checkout_head_changed')
    expected, actual = tree(BASE), tree(head)
    outside = [p for p in sorted(set(expected) | set(actual))
               if p not in TOOLS and expected.get(p) != actual.get(p)]
    if outside or any(p in expected or actual.get(p, {}).get('mode') != '100644'
                      or actual[p]['type'] != 'blob' for p in TOOLS):
        raise RuntimeError('not_exact_baseline_plus_three_tools:' + repr(outside))
    if git('status', '--porcelain=v1', '--untracked-files=no').strip():
        raise RuntimeError('tracked_worktree_or_index_dirty')
    if git('rev-parse', '--show-object-format').decode().strip() != 'sha1':
        raise RuntimeError('unexpected_git_object_format')
    rows = []
    for name, identity in sorted(actual.items()):
        path = Path(name)
        info = path.lstat()
        row = {'path': name, **identity, 'workingMode': stat.S_IMODE(info.st_mode)}
        if identity['mode'] == '120000' and stat.S_ISLNK(info.st_mode):
            link = os.readlink(path)
            data = os.fsencode(link)
            blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
            # Versioned symlink identity is its mode/text/blob; e.g. docs points
            # at an absent sibling in fresh CI. Do not traverse source symlinks.
            row.update(link=link, resolved=str(path.resolve()))
        elif identity['mode'] in ('100644', '100755') and stat.S_ISREG(info.st_mode):
            blob_hash = hashlib.sha1(b'blob ' + str(info.st_size).encode() + b'\0')
            digest = hashlib.sha256()
            with path.open('rb') as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b''):
                    blob_hash.update(block)
                    digest.update(block)
            blob = blob_hash.hexdigest()
            if bool(info.st_mode & 0o111) != (identity['mode'] == '100755'):
                raise RuntimeError('source_executable_mode_changed:' + name)
            row.update(bytes=info.st_size, sha256=digest.hexdigest())
        else:
            raise RuntimeError('unsupported_or_changed_source_kind:' + name)
        if blob != identity['blob']:
            raise RuntimeError('working_bytes_not_committed_blob:' + name)
        rows.append(row)
    return {'baseline': BASE, 'head': head, 'tree': git('rev-parse', 'HEAD^{tree}').decode().strip(),
            'exactAddedTools': list(TOOLS), 'entries': rows}


def dependency_snapshot():
    """Fresh complete namespace walk each time, including symlink destinations."""
    pending = [Path('node_modules').absolute()]
    directories, files, links, rows = set(), set(), set(), []
    while pending:
        path = pending.pop()
        info = path.lstat()
        mode = stat.S_IMODE(info.st_mode)
        if stat.S_ISLNK(info.st_mode):
            if path in links:
                continue
            links.add(path)
            target = path.resolve(strict=True)
            rows.append({'kind': 'link', 'path': str(path), 'mode': mode,
                         'text': os.readlink(path), 'resolved': str(target)})
            pending.append(target)
        elif stat.S_ISDIR(info.st_mode):
            if path in directories:
                continue
            directories.add(path)
            children = sorted(path.iterdir(), key=lambda p: p.name)
            rows.append({'kind': 'directory', 'path': str(path), 'mode': mode,
                         'names': [p.name for p in children]})
            pending.extend(children)
        elif stat.S_ISREG(info.st_mode):
            if path in files:
                continue
            files.add(path)
            before = (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
            digest = sha(path)
            after = path.lstat()
            if before != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                raise RuntimeError('dependency_changed_during_read:' + str(path))
            rows.append({'kind': 'file', 'path': str(path), 'mode': mode, 'bytes': info.st_size,
                         'uid': info.st_uid, 'nlink': info.st_nlink, 'sha256': digest})
        else:
            raise RuntimeError('unsupported_dependency_entry:' + str(path))
    return sorted(rows, key=lambda row: (row['path'], row['kind']))


def executables():
    paths = [Path(sys.executable), Path('/bin/ps')]
    for name in ('node', 'git'):
        found = shutil.which(name)
        if not found:
            raise RuntimeError('missing_executable:' + name)
        paths.append(Path(found))
    return [{'path': str(p), 'resolved': str(p.resolve(strict=True)),
             'mode': stat.S_IMODE(p.stat().st_mode), 'sha256': sha(p)} for p in paths]


def input_problems(root, label='POST'):
    expected = json.loads((root / 'INPUT-FREEZE.json').read_text())
    problems = []
    if sha(root / 'EVENT-IDENTITY.json') != expected['eventIdentitySHA256']:
        problems.append('event_identity_receipt_drift')
    for key, observe in (('source', source_snapshot), ('executables', executables),
                         ('dependencies', dependency_snapshot)):
        try:
            actual = observe()
            save(root, label + '-' + key.upper() + '.json', actual)
            if actual != expected[key]:
                problems.append(key + '_drift')
        except Exception as error:
            problems.append(key + '_observation_failed:' + repr(error))
    return problems


def output_root():
    root = Path(os.environ['R16_OUT'])
    info = root.lstat()
    if root.resolve() != root or not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise RuntimeError('output_not_owned_private_directory')
    for frozen in (Path.cwd().resolve(), Path('node_modules').resolve()):
        if root == frozen or frozen in root.parents:
            raise RuntimeError('output_inside_frozen_namespace')
    return root


def main():
    root = output_root()
    if sys.argv[1:] == ['source']:
        save(root, 'SOURCE-BASELINE-PROOF.json', source_snapshot())
        return
    if sys.argv[1:] != ['freeze']:
        raise RuntimeError('unsupported_action')
    source = source_snapshot()
    if source != json.loads((root / 'SOURCE-BASELINE-PROOF.json').read_text()):
        raise RuntimeError('source_changed_during_install')
    # Vite config.js:35927 creates this directory; :35933-35937 removes only its
    # temporary config file. Prepare the empty namespace, never cache contents.
    modules = Path('node_modules')
    if modules.is_symlink() or not modules.is_dir() or modules.stat().st_uid != os.getuid():
        raise RuntimeError('not_job_owned_fresh_node_modules')
    temporary = modules / '.vite-temp'
    created = False
    try:
        temporary.mkdir(mode=0o700)
        created = True
    except FileExistsError:
        pass
    info = temporary.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o022 or list(temporary.iterdir()):
        raise RuntimeError('vite_temp_not_owned_empty_real_directory')
    save(root, 'VITE-TEMP-PREP.json', {'path': str(temporary.absolute()), 'created': created,
         'empty': True, 'warmupRun': False, 'namespaceExclusion': False,
         'reason': 'Vite creates .vite-temp for bundled config then unlinks only the temporary mjs'})
    first = dependency_snapshot()
    save(root, 'DEPENDENCIES-PASS1.json', first)
    second = dependency_snapshot()
    save(root, 'DEPENDENCIES-PASS2.json', second)
    if first != second:
        raise RuntimeError('postinstall_fresh_namespace_passes_disagree')
    native = [row for row in second if row['kind'] == 'file' and row['path'].endswith('/better_sqlite3.node')]
    if len(native) != 1:
        raise RuntimeError('rebuilt_native_identity_ambiguous')
    node = shutil.which('node')
    runtime = json.loads(subprocess.check_output([node, '-p',
        'JSON.stringify({version:process.version,versions:process.versions,platform:process.platform,arch:process.arch,cpu:require("node:os").cpus().map(c=>({model:c.model,speed:c.speed}))})'], timeout=10))
    versions = {name: json.loads(Path('node_modules', name, 'package.json').read_text())['version']
                for name in ('vitest', 'vite', 'better-sqlite3', 'tsx')}
    save(root, 'RUNTIME.json', {'node': runtime, 'dependencies': versions, 'native': native})
    save(root, 'INPUT-FREEZE.json', {'source': source, 'dependencies': second, 'executables': executables(),
                                   'eventIdentitySHA256': sha(root / 'EVENT-IDENTITY.json')})


def read_profile(path):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        a=os.fstat(fd)
        if not stat.S_ISREG(a.st_mode) or a.st_uid!=os.getuid() or a.st_nlink!=1 or not 0<a.st_size<=64*1024**2 or a.st_mode&0o022:raise RuntimeError('profile_identity_or_bound')
        data=bytearray()
        while True:
            block=os.read(fd,min(65536,64*1024**2+1-len(data)))
            if not block:break
            data.extend(block)
            if len(data)>64*1024**2:raise RuntimeError('profile_grew')
        b=os.fstat(fd);c=path.lstat();key=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
        if key(a)!=key(b) or key(a)!=key(c) or len(data)!=a.st_size:raise RuntimeError('profile_changed')
    finally:os.close(fd)
    def pairs(items):
        d={}
        for k,v in items:
            if k in d:raise RuntimeError('profile_duplicate_key')
            d[k]=v
        return d
    return json.loads(data,object_pairs_hook=pairs),hashlib.sha256(data).hexdigest(),len(data)

def report_oracle(root, plan, command_exit):
    result = {'status': 'UNKNOWN_RAW_ONLY', 'report': str(root / '0.vitest.json')}
    try:
        path = root / '0.vitest.json'
        # Same bounded no-follow stable regular-file read as profiles.
        report, digest, _ = read_profile(path)
        suites = report['testResults']
        if len(suites) != 1 or suites[0]['name'] != str(Path(plan['worktree']) / plan['testFile']):
            raise ValueError('not_exact_original_file')
        suite = suites[0]
        rows = suite['assertionResults']
        expected = [(slot['fullName'], slot['occurrence']) for slot in plan['expectedIdentitySlotsInOrder']]
        seen = Counter()
        identities = []
        for row in rows:
            seen[row['fullName']] += 1
            identities.append((row['fullName'], seen[row['fullName']]))
        if identities != expected or len(rows) != 23:
            raise ValueError('original_23_ordered_identity_occurrences_changed')
        selected, others = rows[0], rows[1:]
        if selected['fullName'] != plan['fullTitle'] or any(
            r['status'] not in ('skipped', 'pending') or r.get('failureMessages') for r in others):
            raise ValueError('wrong_selection_or_other_execution')
        duration = selected.get('duration')
        if type(duration) not in (int, float) or not math.isfinite(duration) or duration <= 0:
            raise ValueError('no_selected_case_duration')
        if report['numTotalTests'] != 23 or report['numPendingTests'] != 22 or report['numTodoTests'] != 0:
            raise ValueError('wrong_report_population')
        if report['numTotalTestSuites'] != 1 or report.get('numRuntimeErrorTestSuites', 0) != 0 or suite.get('testExecError') or suite.get('message') or report.get('unhandledErrors'):
            raise ValueError('collection_or_runtime_error')
        if report.get('snapshot', {}).get('failure'):
            raise ValueError('unrelated_snapshot_failure')
        raw = (root / '0.stdout').read_text(errors='replace') + (root / '0.stderr').read_text(errors='replace')
        if re.search(r'Unhandled Errors|Unhandled Rejection|Uncaught Exception|Errors during test collection', raw, re.I):
            raise ValueError('unhandled_or_collection_error')
        messages = selected.get('failureMessages')
        good = selected['status'] == 'passed' and not messages and command_exit == 0
        failed = selected['status'] == 'failed' and isinstance(messages, list) and bool(messages) and all(
            isinstance(m, str) and m.strip() for m in messages) and type(command_exit) is int and command_exit > 0
        if good:
            if (report['numPassedTests'], report['numFailedTests'], report['success'], suite['status'], report['numFailedTestSuites']) != (1, 0, True, 'passed', 0):
                raise ValueError('pass_summary_mismatch')
            result['status'] = 'PASS_SELECTED_CASE_ONLY'
        elif failed:
            if any(re.search(r'Hook timed out|beforeAll|beforeEach|afterAll|afterEach|Failed to load|Failed to resolve', m) for m in messages):
                raise ValueError('setup_hook_or_load_failure')
            if (report['numPassedTests'], report['numFailedTests'], report['success'], suite['status'], report['numFailedTestSuites']) != (0, 1, False, 'failed', 1):
                raise ValueError('failed_summary_mismatch')
            result['status'] = 'EXACT_SELECTED_CASE_FAILED'
            result['failureMessages'] = messages
            result['originalDeadlineTimeout'] = any(re.search(r'Test timed out in 45000ms\.', m) for m in messages)
        else:
            raise ValueError('not_exact_case_pass_or_case_failure')
        result.update(reportSHA256=digest, durationMs=duration, notExecutedBySelection=22,
                      wholePassClaim=False, closeWitnessClaim=False, original99PassClaim=False)
    except Exception as error:
        result['status'] = 'UNKNOWN_RAW_ONLY'
        result['error'] = repr(error)
    return result

if __name__ == '__main__':
    main()
