#!/usr/bin/env python3
"""One manual CI observation, never a normal test entry or performance baseline.

No arguments. The workflow must explicitly select its diagnostic-only dispatch.
This owner never changes product source, dependencies, budgets, or authority.
"""
from pathlib import Path
import hashlib
import json
import os
import platform
import re
import secrets
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time

REPO = Path(__file__).resolve().parents[2]
SUPPORT = Path(__file__).resolve().parent
TEST = 'desktop/tests/main/loop-verification-execution-controller.test.ts'
ORIGINAL_SHA = '83582426fda875e785ddf75b03ebdb2a7a1b528e1c861c5008fa8052912ef4e6'
FILTER = '^executes and recovers the original Loop verification through the signed controller: output-consumer$'
OUTPUT = REPO / '.xiaok' / 'evals' / 'loop-rpc-diagnostic'
PROTOCOL = {
    'COMPLETION_METHODS': 'src/runtime/verification/completion-transport.ts',
    'ARCHIVE_METHODS': 'src/runtime/verification/archive-transport.ts',
    'APPLICATION_METHODS': 'src/runtime/verification/application-transport.ts',
    'METADATA_CAPACITY_METHODS': 'src/runtime/verification/metadata-capacity-protocol.ts',
    'methods': 'src/runtime/verification/controller-public-daemon.ts',
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def fail(message):
    raise RuntimeError(message)


def identity(path):
    path = Path(path)
    value = path.lstat()
    if path.is_symlink() or path.resolve() != path or not stat.S_ISDIR(value.st_mode):
        fail('owned_directory_not_canonical')
    return {'canonical': str(path), 'uid': value.st_uid, 'dev': value.st_dev,
            'ino': value.st_ino, 'birthtimeMs': value.st_birthtime * 1000}


def proc_rows(timeout=5):
    result = subprocess.run(['ps', '-axo', 'pid=,ppid=,pgid=,uid=,lstart='],
                            text=True, capture_output=True, check=True, timeout=timeout)
    rows = []
    for line in result.stdout.splitlines():
        fields = line.split()
        if len(fields) >= 9:
            rows.append({'pid': int(fields[0]), 'ppid': int(fields[1]),
                         'pgid': int(fields[2]), 'uid': int(fields[3]),
                         'start': ' '.join(fields[4:9])})
    return rows


def manual_gate():
    # These prevent accidental execution; they are not product qualification.
    if len(sys.argv) != 1 or os.environ.get('GITHUB_ACTIONS') != 'true':
        fail('only_explicit_manual_CI_job_may_execute')
    if os.environ.get('GITHUB_EVENT_NAME') != 'workflow_dispatch':
        fail('not_workflow_dispatch')
    event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
    selected = event.get('inputs', {}).get('loop_rpc_diagnostic')
    if selected is not True and selected != 'true':
        fail('diagnostic_input_not_exact_true')
    if os.environ.get('GITHUB_RUN_ATTEMPT') != '1':
        fail('diagnostic_rerun_not_authorized')
    if sys.platform != 'darwin' or platform.mac_ver()[0].split('.')[0] != '14':
        fail('diagnostic_requires_actual_macOS14')
    if sys.version_info[:2] != (3, 13):
        fail('diagnostic_requires_actual_python313')


def freeze_methods():
    """Read complete, closed literal arrays, including their declared spreads.

    This is a strict grammar, not a method-name regexp over arbitrary source.
    Any changed/nonliteral syntax refuses assembly instead of omitting a name.
    """
    arrays, provenance = {}, []
    for name, relative in PROTOCOL.items():
        source = (REPO / relative).read_text()
        matches = list(re.finditer(r'\bconst\s+' + re.escape(name)
                                  + r'\s*=\s*\[([^\]]*)\]\s*as const', source))
        if len(matches) != 1:
            fail('protocol_literal_array_not_unique:' + name)
        match = matches[0]
        tokens = [token.strip() for token in match.group(1).split(',') if token.strip()]
        values = []
        for token in tokens:
            if token.startswith('...'):
                dependency = token[3:]
                if name != 'methods' or dependency not in arrays:
                    fail('unrecognized_protocol_spread')
                values.extend(arrays[dependency])
                continue
            literal = re.fullmatch(r"(['\"])([A-Za-z][A-Za-z0-9.-]*)\1", token)
            if not literal:
                fail('nonliteral_protocol_method')
            value = literal.group(2)
            values.append(value)
            provenance.append({'method': value, 'path': relative,
                               'array': name, 'arrayLine': source.count('\n', 0, match.start()) + 1})
        arrays[name] = values
    values = arrays['methods']
    if len(values) != len(set(values)) or not any('-' in v for v in arrays['COMPLETION_METHODS']):
        fail('protocol_population_not_closed')
    return sorted(values), provenance


def assemble(nonce, methods):
    source = (REPO / TEST).read_bytes()
    if digest(source) != ORIGINAL_SHA:
        fail('original_test_changed')
    description = json.loads((SUPPORT / 'loop-rpc-diagnostic-transformations.json').read_text())
    if description['originalTestSHA256'] != ORIGINAL_SHA:
        fail('transform_source_binding_changed')
    observer = (SUPPORT / 'loop-rpc-diagnostic-observer.ts.txt').read_text()
    for marker, value in [('__NONCE_JSON__', json.dumps(nonce)),
                          ('__METHODS_JSON__', json.dumps(methods))]:
        if observer.count(marker) != 1:
            fail('observer_placeholder_not_unique')
        observer = observer.replace(marker, value)
    current, transforms = source.decode(), []
    for entry in description['transforms']:
        before, after = entry['original'], entry['instrumented'].replace('__OBSERVER__', observer)
        if current.count(before) != 1:
            fail('transform_match_not_unique')
        current = current.replace(before, after)
        transforms.append({'original': before, 'instrumented': after})
    reverse = current
    for entry in reversed(transforms):
        if reverse.count(entry['instrumented']) != 1:
            fail('reverse_match_not_unique')
        reverse = reverse.replace(entry['instrumented'], entry['original'])
    if reverse.encode() != source:
        fail('reverse_original_bytes_mismatch')
    return current, transforms


def input_snapshot():
    roots = [REPO / 'src', REPO / 'desktop/electron', REPO / 'desktop/shared',
             REPO / 'desktop/renderer/src/shared', SUPPORT]
    files = {REPO / name for name in [TEST, 'package.json', 'package-lock.json',
             'desktop/package.json', 'desktop/package-lock.json', 'desktop/vitest.config.ts',
             'desktop/tests/setup.ts', 'desktop/tests/setup-host-env.ts',
             'desktop/tests/profile-account.setup.mjs']}
    for root in roots:
        files.update(path for path in root.rglob('*') if path.suffix in
                     {'.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'})
    files.add(SUPPORT / 'loop-rpc-diagnostic-observer.ts.txt')
    files.add(Path(__file__).resolve())
    for relative in ['desktop/node_modules/vitest/package.json',
                     'desktop/node_modules/@vitest/runner/package.json',
                     'desktop/node_modules/@vitest/runner/dist/chunk-hooks.js',
                     'node_modules/typescript/package.json', 'node_modules/typescript/lib/typescript.js',
                     'desktop/node_modules/vitest/vitest.mjs',
                     'desktop/node_modules/vitest/dist/chunks/index.B521nVV-.js',
                     'desktop/node_modules/vitest/dist/chunks/index.CwejwG0H.js',
                     'desktop/node_modules/vitest/dist/chunks/rpc.-pEldfrD.js']:
        files.add(REPO / relative)
    result = []
    for path in sorted(files):
        if path.is_symlink() or not path.is_file():
            fail('input_not_regular:' + str(path.relative_to(REPO)))
        data = path.read_bytes()
        result.append({'path': str(path.relative_to(REPO)), 'bytes': len(data), 'sha256': digest(data)})
    return result


STATIC_AUDIT = r"""
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const [repo,original,copy,output]=process.argv.slice(1);
const ts=(await import(pathToFileURL(repo+'/node_modules/typescript/lib/typescript.js'))).default;
function inspect(path){
 const source=fs.readFileSync(path,'utf8'),sf=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 const result={parseErrors:sf.parseDiagnostics.map(d=>d.code),expects:[],times:[],budgets:[],scenarios:[]};
 function visit(n){
  if(ts.isCallExpression(n)){
   if(ts.isIdentifier(n.expression)&&n.expression.text==='expect')result.expects.push(n.getText(sf));
   if(n.expression.getText(sf)==='f.setTime')result.times.push(n.getText(sf));
   if(n.expression.getText(sf)==='it.for([mode])')result.budgets.push(n.getText(sf));
  }
  if(ts.isVariableDeclaration(n)&&n.name.getText(sf)==='scenarios')result.scenarios.push(n.initializer.getText(sf));
  ts.forEachChild(n,visit);
 }
 visit(sf);return result;
}
const before=inspect(original),after=inspect(copy);
const report={node:process.version,platform:process.platform,arch:process.arch,execPath:process.execPath,
 before,after,identical:JSON.stringify(before)===JSON.stringify(after)};
fs.writeFileSync(output,JSON.stringify(report,null,2)+String.fromCharCode(10));
if(!report.identical||before.parseErrors.length||before.expects.length!==59||before.times.length!==5
 ||before.budgets.length!==1||before.scenarios.length!==1)process.exitCode=1;
"""


class Owner:
    def __init__(self, output, nonce):
        self.output, self.nonce = output, nonce
        self.errors, self.children, self.cancel = [], [], []
        self.state = {'schemaVersion': 1, 'diagnosticOnly': True, 'runNonce': nonce,
                      'ownerPID': os.getpid(), 'ownerUID': os.getuid(),
                      'children': self.children, 'errors': self.errors}

    def save(self):
        try:
            (self.output / 'owner.json').write_text(json.dumps(self.state, indent=2) + '\n')
        except BaseException as error:
            self.errors.append('metadata_io:' + type(error).__name__)

    def child(self, argv, label, budget):
        """One shutdown clock, including error paths and process observations.

        A direct, still-unreaped Popen child is the sole signal authority.
        Neither observation failure nor an exhausted grace restarts shutdown.
        """
        if self.cancel:
            fail('cancel_before_child')
        started = time.monotonic()
        hard_end = started + budget + 10
        shutdown_end, kill_due = None, None
        attempted = set()
        process, leader = None, None
        row = {'label': label, 'argv': argv, 'startedEpochMs': time.time() * 1000,
               'budgetSeconds': budget, 'signals': [], 'reaped': False}
        self.children.append(row)
        self.save()

        def begin_shutdown(reason):
            nonlocal shutdown_end, kill_due
            if shutdown_end is None:
                now = time.monotonic()
                shutdown_end = min(hard_end, now + 10)
                kill_due = min(shutdown_end, now + 5)
                row.update(forcedReason=reason, shutdownEndMonotonic=shutdown_end,
                           killDueMonotonic=kill_due)

        def remaining():
            return max(0, min(hard_end, shutdown_end if shutdown_end is not None
                              else hard_end) - time.monotonic())

        def observe():
            left = remaining()
            if left <= 0:
                fail('observation_budget_exhausted')
            return proc_rows(timeout=min(5, left))

        def send_owned(sig):
            # Mark the attempt before any operation that can fail. No error
            # handler may repeat an attempted signal or reset either deadline.
            attempted.add(sig)
            if remaining() <= 0 or process.poll() is not None:
                return
            if os.getpgid(process.pid) != process.pid:
                fail('refuse_changed_group')
            if leader:
                current = next((r for r in observe() if r['pid'] == process.pid), None)
                if current != leader:
                    fail('refuse_changed_leader')
            # ps itself consumes this same clock. Recheck after observation.
            if remaining() <= 0 or process.poll() is not None:
                return
            if sig == signal.SIGTERM and time.monotonic() >= kill_due:
                return
            os.killpg(process.pid, sig)
            row['signals'].append({'signal': sig.name,
                                   'elapsedSeconds': time.monotonic() - started})
            self.save()

        try:
            # Child owns its inherited descriptors; closing this parent FD does
            # not truncate output and avoids asynchronous parent stream errors.
            with (self.output / (label + '.log')).open('xb', buffering=0) as log:
                process = subprocess.Popen(argv, cwd=REPO / 'desktop', stdout=log,
                                           stderr=subprocess.STDOUT, start_new_session=True)
            row.update(pid=process.pid, pgid=process.pid)
            self.save()
            leader = next((r for r in observe() if r['pid'] == process.pid), None)
            row['leader'] = leader
            if leader is None:
                self.errors.append(label + ':leader_identity_unobserved')
                begin_shutdown('leader_identity_unobserved')
            elif (leader['pgid'] != process.pid or leader['uid'] != os.getuid()
                  or leader['ppid'] != os.getpid()):
                fail('child_identity_mismatch')
        except BaseException as error:
            self.errors.append(label + ':' + type(error).__name__)
            begin_shutdown('owner_error')

        if process is not None:
            while True:
                try:
                    if process.poll() is not None:
                        row['reaped'] = True  # Popen.poll reaps the direct child.
                        break
                    now = time.monotonic()
                    if shutdown_end is None and (self.cancel or now >= started + budget
                                                 or self.errors):
                        begin_shutdown('owner_cancel' if self.cancel else
                                       'owner_error' if self.errors else 'outer_budget')
                    if remaining() <= 0:
                        self.errors.append(label + ':child_reap_unknown')
                        break
                    if shutdown_end is not None:
                        if now >= kill_due:
                            if signal.SIGKILL not in attempted:
                                send_owned(signal.SIGKILL)
                        elif signal.SIGTERM not in attempted:
                            send_owned(signal.SIGTERM)
                except BaseException as error:
                    self.errors.append(label + ':shutdown:' + type(error).__name__)
                    begin_shutdown('owner_error')
                left = remaining()
                if left <= 0:
                    self.errors.append(label + ':child_reap_unknown')
                    break
                # Polling and exceptions share the same absolute boundary.
                boundary = kill_due if shutdown_end is not None and time.monotonic() < kill_due else (
                    shutdown_end if shutdown_end is not None else started + budget)
                delay = min(0.05, left, max(0, boundary - time.monotonic()))
                if delay > 0:
                    time.sleep(delay)
            try:
                row['exitCode'] = process.poll()
                row['reaped'] = row['exitCode'] is not None
            except BaseException as error:
                row['exitCode'], row['reaped'] = None, False
                self.errors.append(label + ':poll:' + type(error).__name__)
            try:
                row['groupResidual'] = [r for r in observe() if r['pgid'] == process.pid]
            except BaseException as error:
                row['groupResidual'] = [{'unknown': type(error).__name__}]
            if not row['reaped'] or row['groupResidual']:
                self.errors.append(label + ':physical_exit_unknown')
        else:
            row['groupResidual'] = [{'notStarted': True}]
        row['signalAttempts'] = [sig.name for sig in sorted(attempted, key=int)]
        row['finishedEpochMs'] = time.time() * 1000
        row['elapsedSeconds'] = time.monotonic() - started
        self.save()
        return row


def main():
    manual_gate()
    # A fresh output directory is the per-run no-retry marker. Never overwrite
    # a previous attempt, recursively chmod a parent, or adopt another directory.
    current = REPO
    for component in ['.xiaok', 'evals']:
        current = current / component
        current.mkdir(exist_ok=True)
        identity(current)
    OUTPUT.mkdir(mode=0o700)
    nonce = secrets.token_hex(16)
    owner = Owner(OUTPUT, nonce)
    started_epoch = time.time() * 1000
    temporary, temporary_identity, inputs, head = None, None, None, None
    previous = {s: signal.signal(s, lambda value, frame: owner.cancel.append(value))
                for s in [signal.SIGTERM, signal.SIGINT]}
    try:
        owner.state['outputIdentity'] = identity(OUTPUT)
        head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=REPO, text=True, timeout=5).strip()
        if head != os.environ.get('GITHUB_SHA'):
            fail('actual_checkout_not_dispatch_head')
        owner.state.update(head=head, caseFilter=FILTER, originalCaseBudgetMs=300000,
                           productReadBudgetMs=10000, python=sys.version, machine=platform.mac_ver()[0])
        for path in ['desktop/node_modules/vitest/package.json', 'desktop/node_modules/@vitest/runner/package.json']:
            if json.loads((REPO / path).read_text())['version'] != '3.2.4':
                fail('actual_vitest_version_changed')
        node = Path(shutil.which('node') or '').resolve()
        if not node.is_file():
            fail('actual_node_missing')
        owner.state['nodeBinary'] = {'canonical': str(node), 'sha256': digest(node.read_bytes())}
        methods, method_sources = freeze_methods()
        copy, transforms = assemble(nonce, methods)
        inputs = input_snapshot()
        temporary = Path(tempfile.mkdtemp(prefix='loop-rpc-', dir=OUTPUT)).resolve()
        temporary_identity = identity(temporary)
        owner.state['temporaryIdentity'] = temporary_identity
        source_path = temporary / 'instrumented-source.ts'
        config_path = temporary / 'vitest.rpc.config.mts'
        source_path.write_text(copy)
        (OUTPUT / 'instrumented-source.ts.txt').write_text(copy)
        (OUTPUT / 'transforms.json').write_text(json.dumps(transforms, indent=2) + '\n')
        (OUTPUT / 'methods.json').write_text(json.dumps({'methods': methods, 'literalSources': method_sources}, indent=2) + '\n')
        config = """import original from %s;
import {mergeConfig} from %s;
import {readFileSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
const target=%s,source=%s,expected=%s,copyHash=%s;
const merged=mergeConfig(original,{cacheDir:%s,plugins:[{name:'exact-original-loop-rpc-copy',enforce:'pre',load(id){if(id.split('?')[0]!==target)return;const actual=realpathSync(id.split('?')[0]);if(actual!==target)throw Error('diagnostic_id_changed');if(createHash('sha256').update(readFileSync(target)).digest('hex')!==expected)throw Error('diagnostic_original_changed');const copy=readFileSync(source);if(createHash('sha256').update(copy).digest('hex')!==copyHash)throw Error('diagnostic_copy_changed');return copy.toString('utf8');}}]});
merged.test.include=['tests/main/loop-verification-execution-controller.test.ts'];
export default merged;
""" % tuple(json.dumps(str(v)) for v in [REPO / 'desktop/vitest.config.ts',
              REPO / 'desktop/node_modules/vitest/dist/config.js', REPO / TEST,
              source_path, ORIGINAL_SHA, digest(copy.encode()), temporary / 'vite-cache'])
        config_path.write_text(config)
        (OUTPUT / 'vitest.rpc.config.mts.txt').write_text(config)
        manifest = {'head': head, 'runNonce': nonce, 'originalTestSHA256': ORIGINAL_SHA,
                    'copySHA256': digest(copy.encode()), 'configSHA256': digest(config.encode()),
                    'inputs': inputs, 'methods': methods, 'temporaryIdentity': temporary_identity}
        (OUTPUT / 'input-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        owner.save()
        if owner.errors:
            fail('metadata_failed_before_children')
        audit_path = OUTPUT / 'static-audit.json'
        audit_child = owner.child([str(node), '--input-type=module', '-e', STATIC_AUDIT,
                                  str(REPO), str(REPO / TEST), str(source_path), str(audit_path)], 'preflight', 20)
        if audit_child.get('exitCode') != 0 or owner.errors:
            fail('static_audit_failed')
        audit = json.loads(audit_path.read_text())
        if audit['node'] != 'v22.22.0' or audit['platform'] != 'darwin' or not audit['identical']:
            fail('actual_runtime_or_source_audit_mismatch')
        owner.state['actualRuntime'] = {k: audit[k] for k in ['node', 'platform', 'arch', 'execPath']}
        if owner.cancel or input_snapshot() != inputs:
            fail('cancel_or_input_drift_before_test')
        child = owner.child([str(node), str(REPO / 'desktop/node_modules/vitest/vitest.mjs'),
                             'run', 'tests/main/loop-verification-execution-controller.test.ts',
                             '--config', str(config_path), '--maxWorkers=1', '--reporter=verbose',
                             '-t', FILTER], 'original-output', 420)
        owner.state['originalExitCode'] = child.get('exitCode')
        raw = (OUTPUT / 'original-output.log').read_bytes()
        owner.state['rawLogSHA256'] = digest(raw)
        records = []
        for line in raw.decode(errors='replace').splitlines():
            marker = 'LOOP_RPC_DIAGNOSTIC '
            if marker in line:
                records.append(json.loads(line.split(marker, 1)[1]))
        if len(records) != 1:
            fail('one_trace_required')
        record = records[0]
        (OUTPUT / 'trace.json').write_text(json.dumps(record, indent=2) + '\n')
        if record.get('schemaVersion') != 1 or record.get('mode') != 'output-consumer' or record.get('runNonce') != nonce:
            fail('trace_identity_mismatch')
        if record.get('invalid') is not False or record.get('truncated') is not False or any(
                type(record.get(k)) is not int or record[k] != 0
                for k in ['observerErrors', 'pendingCount', 'listenerCount']):
            fail('trace_quality_unknown')
        events = record.get('events')
        if not isinstance(events, list) or not 1 <= len(events) <= 4096:
            fail('trace_events_missing')
        begins = {e['seq']: e for e in events if e.get('event') == 'begin'}
        ends = [e for e in events if e.get('event') in ['fulfill', 'reject', 'throw']]
        if len(begins) * 2 != len([e for e in events if e.get('event') in ['begin', 'fulfill', 'reject', 'throw']]):
            fail('rpc_pair_population_mismatch')
        if {e['seq'] for e in ends} != set(begins) or len(ends) != len(begins):
            fail('rpc_pair_identity_mismatch')
        if not begins or any(e.get('method') not in methods or e.get('ambiguous') for e in begins.values()):
            fail('method_identity_unknown')
        for end in ends:
            begin = begins[end['seq']]
            if begin.get('side') not in ['client', 'server'] or any(
                    begin.get(key) != end.get(key) for key in ['side', 'method']):
                fail('rpc_pair_binding_mismatch')
            if not isinstance(begin.get('wallMs'), (float, int)) or not isinstance(
                    end.get('wallMs'), (float, int)) or end['wallMs'] < begin['wallMs']:
                fail('rpc_pair_time_unknown')
        clean = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', raw.decode(errors='replace'))
        if not re.search(r'Test Files\s+1 (?:passed|failed) \(1\)', clean) or not re.search(r'Tests\s+1 (?:passed|failed) \| 7 skipped \(8\)', clean):
            fail('original_population_not_proved')
        # Journals are removed only after a complete trusted resource record and
        # all children/worker absence. A failed business case remains failed.
        rows = proc_rows()
        if any(not c.get('reaped') or c.get('groupResidual') for c in owner.children):
            fail('owner_group_unknown_retain')
        worker = record.get('workerPID')
        if type(worker) is not int or worker <= 0 or any(r['pid'] == worker for r in rows):
            fail('worker_absence_not_proved')
        if record.get('workerPPID') != child.get('pid'):
            fail('worker_not_owned_direct_child')
        roots = record.get('roots')
        if not isinstance(roots, list) or len(roots) != 1:
            fail('one_actual_fixture_root_required')
        owner.state['fixtureRoots'] = roots
        root = roots[0]
        path = Path(root['canonicalRoot'])
        observed = identity(path)
        expected = {k: root[v] for k, v in [('canonical', 'canonicalRoot'), ('uid', 'uid'),
                    ('dev', 'dev'), ('ino', 'ino'), ('birthtimeMs', 'birthtimeMs')]}
        if observed != expected or root['workerPID'] != worker or root['workerPPID'] != child['pid'] or root['runNonce'] != nonce:
            fail('fixture_stat_or_run_identity_changed')
        if observed['uid'] != os.getuid() or path.parent != Path(tempfile.gettempdir()).resolve() or not path.name.startswith('ia-'):
            fail('fixture_parent_or_owner_mismatch')
        if not started_epoch <= root['birthtimeMs'] <= child['finishedEpochMs']:
            fail('fixture_birthtime_outside_run')
        if owner.errors:
            fail('owner_error_retain_fixture')
        shutil.rmtree(path)
        owner.state['fixtureDeleted'] = not path.exists()
        owner.state['evidenceComplete'] = True
    except BaseException as error:
        owner.errors.append('diagnostic:' + type(error).__name__ + ':' + str(error)[:160])
        owner.state['evidenceComplete'] = False
    finally:
        for sig, old in previous.items():
            signal.signal(sig, old)
        try:
            if inputs is not None and (input_snapshot() != inputs or subprocess.check_output(
                    ['git', 'rev-parse', 'HEAD'], cwd=REPO, text=True, timeout=5).strip() != head):
                fail('input_or_head_drift')
        except BaseException as error:
            owner.errors.append('end_input_check:' + type(error).__name__)
        if temporary is not None:
            try:
                if any(not c.get('reaped') or c.get('groupResidual') for c in owner.children):
                    fail('temporary_retained_for_unknown_children')
                if identity(temporary) != temporary_identity:
                    fail('temporary_identity_changed')
                archive = OUTPUT / 'temporary-archive'
                archive.mkdir(mode=0o700)
                listing = []
                for base, directories, files in os.walk(temporary, followlinks=False):
                    for name in directories + files:
                        if (Path(base) / name).is_symlink():
                            fail('temporary_symlink_retained')
                    for name in files:
                        source = Path(base) / name
                        if not source.is_file():
                            fail('temporary_nonregular_retained')
                        data = source.read_bytes()
                        key = str(len(listing)).zfill(5) + '.bin'
                        (archive / key).write_bytes(data)
                        listing.append({'relativePath': str(source.relative_to(temporary)),
                                        'sha256': digest(data), 'bytes': len(data), 'artifact': key})
                (OUTPUT / 'temporary-files.json').write_text(json.dumps(listing, indent=2) + '\n')
                shutil.rmtree(temporary)
                owner.state['temporaryDeleted'] = not temporary.exists()
            except BaseException as error:
                owner.errors.append('temporary_retained:' + type(error).__name__)
        owner.state['cancelSignalsReceived'] = owner.cancel
        owner.state['finishedEpochMs'] = time.time() * 1000
        original = owner.state.get('originalExitCode')
        valid = (owner.state.get('evidenceComplete') is True and not owner.errors and not owner.cancel
                 and not any(c.get('signals') for c in owner.children)
                 and owner.state.get('fixtureDeleted') and owner.state.get('temporaryDeleted'))
        owner.state['qualityComplete'] = bool(valid)
        owner.state['diagnosticExitCode'] = 0 if valid and original == 0 else (original if isinstance(original, int) and original > 0 else 1)
        owner.save()
    # Any metadata failure remains nonzero even if it happened during the save.
    return owner.state['diagnosticExitCode'] if not owner.errors else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print('LOOP_DIAGNOSTIC_REFUSED ' + type(error).__name__ + ':' + str(error)[:160], file=sys.stderr)
        sys.exit(1)
