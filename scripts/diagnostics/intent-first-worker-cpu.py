"""R16: one unchanged first case. R13 process/profile routines reused below.
Failed-case raw attribution never converts test/command/workflow failure to PASS.
"""
from pathlib import Path
import json, os, signal, subprocess, sys, time, stat, hashlib, math, re, runpy
from collections import Counter
sys.dont_write_bytecode = True
helper = runpy.run_path(str(Path(__file__).with_name('intent-first-worker-freeze.py')))
root = helper['output_root']()
plan = {
    'worktree': str(Path.cwd().resolve()),
    'testFile': 'tests/runtime/verification/intent-publication-dependencies.test.ts',
    'fullTitle': 'actual original Intent dependency observation derives empty first-stage and whole parent inventory from native receipts',
    'expectedIdentitySlotsInOrder': [{'fullName': 'actual original Intent dependency observation derives empty first-stage and whole parent '
                  'inventory from native receipts',
      'occurrence': 1},
     {'fullName': 'late expiration of an earlier dependency cannot be spliced into an otherwise-current '
                  'parent set',
      'occurrence': 1},
     {'fullName': 'foreign subject and caller-selected inventory cannot redefine original native '
                  'dependencies',
      'occurrence': 1},
     {'fullName': 'final whole-set check rejects a dependency application entering pending during the last '
                  'receiver query',
      'occurrence': 1},
     {'fullName': 'actual signed controller routes full original payload pages and last complete dependency '
                  'observation through fixed reader',
      'occurrence': 1},
     {'fullName': 'no qualified callback occurs after the final qualified authority clock in the dependency '
                  'result',
      'occurrence': 1},
     {'fullName': 'final authority clock expire still fences the result without a wrapper callback',
      'occurrence': 1},
     {'fullName': 'final authority clock close still fences the result without a wrapper callback',
      'occurrence': 1},
     {'fullName': 'near-limit original contract retains its whole stage population through actual signed '
                  'set RPC',
      'occurrence': 1},
     {'fullName': 'whole graph read refuses actual sibling noncanonical drift even for empty dependencies',
      'occurrence': 1},
     {'fullName': 'whole graph read refuses actual sibling subject drift even for empty dependencies',
      'occurrence': 1},
     {'fullName': 'whole graph read refuses actual sibling mandatory drift even for empty dependencies',
      'occurrence': 1},
     {'fullName': 'whole graph read refuses actual sibling registration drift even for empty dependencies',
      'occurrence': 1},
     {'fullName': 'actual invocation-only append retains complete parent graph: valid', 'occurrence': 1},
     {'fullName': 'actual invocation-only append retains complete parent graph: missing-parent',
      'occurrence': 1},
     {'fullName': 'actual invocation-only append retains complete parent graph: missing-sibling-edge',
      'occurrence': 1},
     {'fullName': 'actual invocation-only append retains complete parent graph: extra-edge',
      'occurrence': 1},
     {'fullName': 'actual invocation-only append retains complete parent graph: parent-noncanonical',
      'occurrence': 1},
     {'fullName': 'completion observation includes its own actual publication and every original dependency '
                  'without publishing the parent implicitly',
      'occurrence': 1},
     {'fullName': 'completion observation final clock expire rejects the entire self and dependency set',
      'occurrence': 1},
     {'fullName': 'completion observation final clock close rejects the entire self and dependency set',
      'occurrence': 1},
     {'fullName': 'parent completion final set rejects old native-approved child publication references '
                  'after a same-proof child republishes',
      'occurrence': 1},
     {'fullName': 'the original final dependency set carries actual receiver identity for parent capture',
      'occurrence': 1}],
}
sha = helper['sha']
profile_dir = root / 'profiles'
def worker_family(child,index):
    name=f'{index}-worker-family';p=None
    try:
        env={k:v for k,v in os.environ.items() if not k.startswith(('LD_','DYLD_'))};env['LC_ALL']='C'
        with (root/(name+'.stdout')).open('xb') as out,(root/(name+'.stderr')).open('xb') as err:
            p=subprocess.Popen(['/bin/ps','-axo','pid=,ppid=,pgid='],stdin=subprocess.DEVNULL,stdout=out,stderr=err,env=env)
            (root/(name+'-pid.json')).write_text(json.dumps({'pid':p.pid,'targetPGID':child.pid,'argv':['/bin/ps','-axo','pid=,ppid=,pgid=']}))
            try:p.wait(timeout=2)
            except subprocess.TimeoutExpired:
                if p.returncode is None:p.kill()
                p.wait(timeout=2)
                raise RuntimeError('worker_family_observer_timeout')
        if p.returncode!=0 or (root/(name+'.stderr')).stat().st_size!=0:raise RuntimeError('worker_family_observer_failed')
        path=root/(name+'.stdout')
        if path.stat().st_size>1024**2:raise RuntimeError('worker_family_observer_bound')
        text=[line.split() for line in path.read_text().splitlines()]
        if not text or not all(len(r)==3 and all(x.isdecimal() for x in r) and int(r[0])>0 and int(r[1])>=0 and int(r[2])>0 for r in text):raise RuntimeError('worker_family_shape')
        rows=[tuple(map(int,r)) for r in text]
        if len({r[0] for r in rows})!=len(rows):raise RuntimeError('worker_family_duplicate_pid')
        if not any(r[0]==child.pid and r[2]==child.pid for r in rows):raise RuntimeError('leader_missing_from_family')
        same=[r for r in rows if r[2]==child.pid];parents={pid:ppid for pid,ppid,pgid in same};desc=[]
        for pid,ppid,pgid in same:
            at=pid;seen=set()
            while at in parents and at not in seen and at!=child.pid:
                seen.add(at);at=parents[at]
            if pid!=child.pid and at==child.pid:desc.append(pid)
        return {'status':'OBSERVED','mainPid':child.pid,'rows':[{'pid':a,'ppid':b,'pgid':c} for a,b,c in same],
                'descendantPids':sorted(desc),'observerPid':p.pid,'observerExit':0,'waited':True,'reaped':True,'stdoutSHA256':sha(path)}
    except BaseException as error:
        if p is not None and p.returncode is None:
            p.kill()
            try:p.wait(timeout=2)
            except BaseException:pass
        return {'status':'UNKNOWN','error':repr(error),'observerPid':p.pid if p else None,'reaped':p is not None and p.returncode is not None}
read_profile = helper['read_profile']
def profile_oracle(family,child):
    result={'status':'NOT_QUALIFIED','files':[],'actualWorkerProfile':False}
    try:
        if family.get('status')!='OBSERVED' or not family.get('descendantPids'):raise RuntimeError('worker_family_not_proven')
        paths=sorted(profile_dir.iterdir())
        if not 1<=len(paths)<=16:raise RuntimeError('profile_file_count')
        total=0
        for path in paths:
            match=re.fullmatch(r'CPU\.\d{8}\.\d{6}\.(\d+)\.(\d+)\.(\d+)\.cpuprofile',path.name)
            if not match or path.resolve()!=path:raise RuntimeError('profile_name_path')
            pid=int(match[1]);value,digest,size=read_profile(path);total+=size
            if total>128*1024**2:raise RuntimeError('profile_total_bound')
            nodes=value['nodes'];samples=value['samples'];deltas=value['timeDeltas']
            if any(type(value[k]) not in (int,float) or not math.isfinite(value[k]) for k in ('startTime','endTime')):raise RuntimeError('profile_time_shape')
            if not nodes or not samples or len(samples)!=len(deltas) or value['endTime']<=value['startTime']:raise RuntimeError('profile_incomplete')
            byid={n['id']:n for n in nodes}
            if len(byid)!=len(nodes) or not all(type(s) is int and s in byid for s in samples):raise RuntimeError('profile_sample_ids')
            if not all(type(t) in (int,float) and math.isfinite(t) and t>=0 for t in deltas):raise RuntimeError('profile_time_deltas')
            parent={}
            for n in nodes:
                for sub in n.get('children',[]):
                    if sub not in byid or sub in parent:raise RuntimeError('profile_tree')
                    parent[sub]=n['id']
            counts=Counter(samples);worker=[];production=[];test=[]
            for sample in counts:
                at=sample;seen=set()
                while True:
                    if at in seen:raise RuntimeError('profile_cycle')
                    seen.add(at);frame=byid[at]['callFrame'];url=frame.get('url','');fn=frame.get('functionName','')
                    if '/vitest/dist/worker' in url or '/vitest/dist/workers/forks' in url:worker.append(at)
                    if plan['worktree']+'/src/runtime/verification/' in url and fn:production.append(at)
                    if plan['testFile'] in url:test.append(at)
                    if at not in parent:break
                    at=parent[at]
            qualifies=pid!=child.pid and pid in family['descendantPids'] and bool(worker) and bool(production) and bool(test)
            row={'path':str(path),'pid':pid,'bytes':size,'sha256':digest,'samples':len(samples),'timeDeltaSumUs':sum(deltas),
                 'startTime':value['startTime'],'endTime':value['endTime'],'observedOwnDescendant':pid in family['descendantPids'],
                 'isMainCLI':pid==child.pid,'qualifiesWorker':qualifies,'sampledWorkerFrames':sorted(set(worker)),
                 'sampledProductionFrames':sorted(set(production)),'sampledTestFrames':sorted(set(test)),
                 'topSelf':[{'count':count,'nodeId':node,'callFrame':byid[node]['callFrame']} for node,count in counts.most_common(30)]}
            result['files'].append(row)
        if sum(r['qualifiesWorker'] for r in result['files'])!=1:raise RuntimeError('actual_worker_cpu_samples_missing_or_ambiguous')
        result['actualWorkerProfile']=True;result['status']='VALID_UNIQUE_WORKER_RAW_CPU'
    except BaseException as error:result['error']=repr(error)
    return result

def report_oracle(command_exit):
    return helper['report_oracle'](root, plan, command_exit)


def closure(child):
    # Strict one terminal table read, distinct from the sole ~5s family snapshot.
    gone = None
    env = {k: v for k, v in os.environ.items() if not k.startswith(('DYLD_', 'LD_'))}
    env['LC_ALL'] = 'C'
    with (root / '0-group-observer.stdout').open('xb') as out, (root / '0-group-observer.stderr').open('xb') as err:
        observer = subprocess.Popen(['/bin/ps', '-axo', 'pid=,pgid='], stdin=subprocess.DEVNULL,
                                    stdout=out, stderr=err, env=env)
        try:
            try:
                observer.wait(timeout=2)
            except subprocess.TimeoutExpired:
                observer.kill()
                observer.wait(timeout=2)
                raise RuntimeError('closure_observer_timeout')
        finally:
            if observer.returncode is None:
                observer.kill()
                observer.wait(timeout=2)
    helper['save'](root, '0-group-observer-pid.json', {'pid': observer.pid, 'exit': observer.returncode,
                   'waited': True, 'reaped': True, 'targetPGID': child.pid})
    out = root / '0-group-observer.stdout'
    if observer.returncode == 0 and out.stat().st_size <= 1024**2 and (root / '0-group-observer.stderr').stat().st_size == 0:
        rows = [line.split() for line in out.read_text().splitlines()]
        if rows and all(len(r) == 2 and all(x.isdecimal() and int(x) > 0 for x in r) for r in rows) and len({r[0] for r in rows}) == len(rows):
            gone = not any(int(r[1]) == child.pid for r in rows)
    return gone


def main():
    errors = []
    child = None
    family = {'status': 'NOT_OBSERVED'}
    result = {'status': 'FAIL', 'classification': 'UNKNOWN_RAW_ONLY', 'groupGone': None,
              'waited': False, 'reaped': False, 'timedOut': False,
              'wholePassClaim': False, 'closeWitnessClaim': False, 'causalOrROIClaim': False}
    def record(name, value):
        try:
            helper['save'](root, name, value)
        except Exception as error:
            errors.append('receipt:' + name + ':' + repr(error))
    def cancelled(signum, frame):
        raise InterruptedError('driver_cancelled_signal:' + str(signum))
    signal.signal(signal.SIGTERM, cancelled)
    try:
        before = helper['input_problems'](root, 'BEFORE')
        record('INPUT-BEFORE.json', {'problems': before})
        if before or errors:
            raise RuntimeError('input_before_or_receipt_failed')
        profile_dir.mkdir(mode=0o700)
        if profile_dir.resolve() != profile_dir or list(profile_dir.iterdir()):
            raise RuntimeError('profile_directory_not_fresh')
        node = next(row['path'] for row in helper['executables']() if Path(row['path']).name == 'node')
        argv = [node, '--cpu-prof', '--cpu-prof-dir=' + str(profile_dir), '--cpu-prof-interval=10000',
                str(Path.cwd() / 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.config.ts',
                plan['testFile'], '--maxWorkers=1', '--reporter=verbose', '--reporter=json',
                '--outputFile=' + str(root / '0.vitest.json'), '-t', '^' + plan['fullTitle'] + '$']
        # Preserve original R13 sanitization. Do not log the inherited environment.
        env = {k: v for k, v in os.environ.items() if not k.startswith(
            ('SOLPI_', 'SOL_PI_', 'VITEST_', 'DYLD_', 'LD_', 'DOCKER_')) and k not in
            ('NODE_OPTIONS', 'NODE_PATH', 'XIAOK_RUN_DOCKER_DEV_TESTS')}
        result['argv'] = argv
        record('COMMAND.json', {'argv': argv, 'cwd': str(Path.cwd()), 'caseTimeoutMs': 45000,
               'rpcTimeoutMs': 300000, 'childGuardSeconds': 150,
               'environmentFacts': {'TMPDIR': env.get('TMPDIR'), 'NODE_OPTIONS': 'removed',
                 'NODE_PATH': 'removed', 'populationAndProfileOptins': 'removed', 'samplingIntervalUs': 10000}})
        if errors:
            raise RuntimeError('command_receipt_failed')
        started = time.monotonic()
        with (root / '0.stdout').open('xb') as out, (root / '0.stderr').open('xb') as err:
            child = subprocess.Popen(argv, cwd=plan['worktree'], stdin=subprocess.DEVNULL,
                                     stdout=out, stderr=err, start_new_session=True, env=env)
            result['pid'] = child.pid
            record('0-pid.json', {'pid': child.pid, 'pgid': child.pid, 'argv': argv})
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                family = worker_family(child, 0)
                remaining = 150 - (time.monotonic() - started)
                if remaining <= 0:
                    raise subprocess.TimeoutExpired(argv, 150)
                child.wait(timeout=remaining)
            result['elapsedSeconds'] = time.monotonic() - started
    except subprocess.TimeoutExpired as error:
        result['timedOut'] = True
        errors.append(repr(error))
    except BaseException as error:
        errors.append(repr(error))
    finally:
        # Receipt errors cannot bypass physical join. Never signal after leader reap.
        if child is not None:
            if child.returncode is None:
                for sig in (signal.SIGTERM, signal.SIGKILL):
                    if child.returncode is not None:
                        break
                    try:
                        os.killpg(child.pid, sig)
                    except ProcessLookupError:
                        pass
                    except Exception as error:
                        errors.append('signal:' + repr(error))
                    try:
                        child.wait(timeout=5)
                    except subprocess.TimeoutExpired as error:
                        errors.append('join:' + repr(error))
            result.update(exit=child.returncode, waited=child.returncode is not None, reaped=child.returncode is not None)
            if child.returncode is not None:
                try:
                    result['groupGone'] = closure(child)
                except Exception as error:
                    errors.append('closure:' + repr(error))
        try:
            result['inputProblemsAfter'] = helper['input_problems'](root)
        except Exception as error:
            result['inputProblemsAfter'] = [repr(error)]
    result['workerFamily'] = family
    result['oracle'] = report_oracle(result.get('exit'))
    stable_closed = (child is not None and result['waited'] and result['reaped'] and result['groupGone'] is True
                     and not result['inputProblemsAfter'] and not result['timedOut'] and not errors)
    # Retain safe stable-byte hashes even for UNKNOWN; data validation alone is
    # not permission to attribute CPU when report/closure/input checks failed.
    raw_profile = profile_oracle(family, child) if child is not None else {'status': 'NOT_QUALIFIED', 'files': []}
    result['rawProfileValidation'] = raw_profile
    result['profile'] = raw_profile if stable_closed else {'status': 'NOT_QUALIFIED', 'files': []}
    if stable_closed and result['profile']['status'] == 'VALID_UNIQUE_WORKER_RAW_CPU':
        if result['oracle']['status'] == 'PASS_SELECTED_CASE_ONLY' and result['exit'] == 0:
            result.update(status='PASS', classification='PASS_WORKER_CPU_DIAGNOSTIC_ONLY')
        elif result['oracle']['status'] == 'EXACT_SELECTED_CASE_FAILED' and result['exit'] > 0:
            result['classification'] = 'ATTRIBUTABLE_RAW_FAILED_CASE_DIAGNOSTIC'
            result['timeoutSublabel'] = 'ORIGINAL_45000MS_DEADLINE' if result['oracle']['originalDeadlineTimeout'] else None
    result['errors'] = errors
    record('RESULT.json', result)
    # A receipt failure remains failure even if the in-memory diagnostic was valid.
    return 0 if result['status'] == 'PASS' and not errors else 1


if __name__ == '__main__':
    sys.exit(main())
