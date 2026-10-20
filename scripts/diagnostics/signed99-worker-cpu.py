#!/usr/bin/env python3
"""Opt-in hosted diagnostic; raw Vitest1 is accepted only by the exact diagnostic validator."""
import argparse,hashlib,importlib.util,json,os,selectors,signal,stat,subprocess,sys,tempfile,time
from pathlib import Path
PINS={'tests/runtime/verification/intent-publication-dependencies.test.ts': 'bb88dd650452b5e8dfec26c65d1621f2c6a710899d7f8d7d48eaa8baf4e804d4', 'tests/support/verified-operation-fixture.ts': 'ef333a58f08ac67a0a1dcba0b97c9fa558eeb4a95216271d589d23377a606655', 'tests/support/installed-controller-fixture.ts': '7107f957ab4b074f835de542c56b52ec396fc823984a9b5c4de20635f76f1126', 'tests/support/loop-publication-receiver.ts': '38e974d3402fcf22315f170ddc90424f54c04bf8832476ecedec43a4104731ad', 'tests/support/intent-application-fixture.ts': 'd2f0efb75955b228a3e398610fe68083a7dee11bd4510bc34fb8511473b86525', 'tests/support/original-fixture-controller-metadata.ts': '6b1928e638b7b22f4228c9c8899bf187e87750bf6e745fd1aaa1b2a82157b1a2', 'vitest.config.ts': 'e93705c9148b184570f53dc8543aed2340f3340d9224a51945279270368ab0f6', 'package.json': '146fd5d117f3cb5dee3438df7110e027cdedcce8cb2b64d82f81f3b78a194300', 'package-lock.json': '2b2d5805585b41b25d004416048acc8ee007b79e2689b5cb48b1f7b5776edf6e', 'src/runtime/verification/controller-ipc.ts': 'c480a48da38cb0535300e1c2a7cd00522cbc2d28bb68dcd27a05ed0ef43e077b', 'src/runtime/verification/controller-client.ts': '96396c576d4416ff8bf763f119aca258a032a5a57bd1ba8f3ae3628213f6db33', 'src/runtime/verification/controller-public-daemon.ts': '65e1f0633cce48d389f11de21aaeb82bdf9b1ad0edd63a527171d90f35261aee'}
TITLE='near-limit original contract retains its whole stage population through actual signed set RPC'
PROFILE=Path('/tmp/solpi-intent-population.cpuprofile')
OTHER_PROFILES=[Path('/tmp/solpi-intent-population-failure.cpuprofile'),Path('/tmp/solpi-intent-final-set.cpuprofile')]
RAW_LIMIT=8*1024**2;REPORT_LIMIT=4*1024**2;PROFILE_LIMIT=128*1024**2
DIAGNOSTIC_WALL_SECONDS=38*60
sha=lambda b:hashlib.sha256(b).hexdigest()
def exclusive(path,data):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'wb') as f:f.write(data)
def read_regular(path,limit):
    before=os.lstat(path)
    if not stat.S_ISREG(before.st_mode) or before.st_uid!=os.getuid() or before.st_nlink!=1 or not 0<before.st_size<=limit:raise RuntimeError('owned_regular_bounded_file_required')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as f:
        opened=os.fstat(f.fileno())
        if (before.st_dev,before.st_ino,before.st_size)!=(opened.st_dev,opened.st_ino,opened.st_size):raise RuntimeError('file_replaced')
        data=f.read(limit+1);after=os.fstat(f.fileno())
    last=os.lstat(path)
    fields=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_nlink)
    if len(data)>limit or fields(before)!=fields(after) or fields(before)!=fields(last):raise RuntimeError('file_changed_during_capture')
    return data,before

def group_gone(pgid):
    try:os.killpg(pgid,0)
    except ProcessLookupError:return True
    except PermissionError:return False
    return False

def source_hashes(repo):
    raw=subprocess.check_output(['git','-C',str(repo),'ls-tree','-rz','--name-only','HEAD','--','src','tests/support','tests/runtime/verification/intent-publication-dependencies.test.ts','vitest.config.ts','package.json','package-lock.json'])
    return {name.decode():sha((repo/os.fsdecode(name)).read_bytes()) for name in raw.split(b'\0') if name}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--output',required=True);args=ap.parse_args();repo=Path.cwd().resolve();output=Path(args.output)
    output.mkdir(mode=0o700,exist_ok=False);work=output/'private';evidence=output/'evidence';work.mkdir(mode=0o700);evidence.mkdir(mode=0o700)
    proc={'actualWait':False,'leaderReaped':False,'stdioClosed':False,'groupGone':False,'profileOwnedAndStable':False,'originalProfileAbsentBefore':False,'criticalSourcePinsMatch':False,'trackedInputsUnchanged':False,'interrupted':False,'diagnosticBudgetExceeded':False,'cleanupSignalsSent':[],'rawOverflow':False,'rawVitestExit':None,'signed99WholePass':False}
    validation={'diagnosticQualified':False,'artifactPrivacySafe':False,'problems':['producer_not_completed'],'signed99WholePass':False};p=None;pgid=None
    try:
        for path in [PROFILE,*OTHER_PROFILES]:
            try:os.lstat(path)
            except FileNotFoundError:continue
            raise RuntimeError('fixed_profile_preexists_refuse_without_deleting')
        proc['originalProfileAbsentBefore']=True
        if any(sha((repo/path).read_bytes())!=expected for path,expected in PINS.items()):raise RuntimeError('critical_462b_source_pin_mismatch')
        proc['criticalSourcePinsMatch']=True;before=source_hashes(repo);proc['sourceInputCount']=len(before);proc['sourceSetSHA256']=sha(json.dumps(before,sort_keys=True).encode());head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip();started_ns=time.time_ns()
        argv=['node','node_modules/vitest/vitest.mjs','run','--config','vitest.config.ts','tests/runtime/verification/intent-publication-dependencies.test.ts','--maxWorkers=1','--reporter=default','--reporter=json','--outputFile='+str(work/'vitest.json'),'-t','^'+TITLE+'$']
        # Allowlist ordinary runtime environment, never provider/action credentials.
        env={k:os.environ[k] for k in ['PATH','HOME','USER','LOGNAME','LANG','LC_ALL'] if k in os.environ}
        tmp=Path(tempfile.mkdtemp(prefix='xs99-',dir='/tmp')).resolve()
        env.update({'CI':'true','FORCE_COLOR':'0','TERM':'dumb','TMPDIR':str(tmp),'SOLPI_INTENT_POPULATION':'1','SOLPI_INTENT_PROFILE':'1'})
        proc.update({'HEAD':head,'argv':argv,'diagnosticWallSeconds':DIAGNOSTIC_WALL_SECONDS,'testDeadlineMsUnchanged':3600000,'originalRoundTripMsUnchanged':300000,'ipcDefaultMsUnchanged':15000})
        def interrupted(_sig,_frame):proc['interrupted']=True
        oldhandlers={s:signal.signal(s,interrupted) for s in [signal.SIGINT,signal.SIGTERM]}
        try:
            p=subprocess.Popen(argv,cwd=repo,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True,bufsize=0);pgid=p.pid;proc.update({'pid':p.pid,'pgid':pgid})
            selector=selectors.DefaultSelector();os.set_blocking(p.stdout.fileno(),False);selector.register(p.stdout,selectors.EVENT_READ)
            deadline=time.monotonic()+DIAGNOSTIC_WALL_SECONDS;leader_exit_at=None;sent_term_at=None;written=0;pipe_eof=False
            with (work/'raw.log').open('xb') as log:
                while True:
                    now=time.monotonic();rc=p.poll()
                    if rc is not None and leader_exit_at is None:leader_exit_at=now
                    if now>=deadline:proc['diagnosticBudgetExceeded']=True
                    need_stop=proc['interrupted'] or proc['diagnosticBudgetExceeded'] or leader_exit_at is not None and now-leader_exit_at>=10 and (not pipe_eof or not group_gone(pgid))
                    if need_stop and sent_term_at is None:
                        proc['cleanupSignalsSent'].append('SIGTERM');sent_term_at=now
                        try:os.killpg(pgid,signal.SIGTERM)
                        except ProcessLookupError:pass
                    if sent_term_at is not None and now-sent_term_at>=15 and 'SIGKILL' not in proc['cleanupSignalsSent']:
                        proc['cleanupSignalsSent'].append('SIGKILL')
                        try:os.killpg(pgid,signal.SIGKILL)
                        except ProcessLookupError:pass
                    for key,_ in selector.select(0.2):
                        chunk=os.read(key.fileobj.fileno(),65536)
                        if not chunk:selector.unregister(key.fileobj);pipe_eof=True;continue
                        # Preserve bounded raw privately; do not echo unscreened logs to Actions.
                        left=max(0,RAW_LIMIT-written);log.write(chunk[:left]);written+=min(left,len(chunk))
                        if len(chunk)>left:proc['rawOverflow']=True
                    if rc is not None and pipe_eof and group_gone(pgid):break
                    if sent_term_at is not None and now-sent_term_at>=30:break
            selector.close();p.stdout.close();proc['stdioClosed']=pipe_eof
            proc['rawVitestExit']=p.wait(timeout=5);proc['actualWait']=True;proc['leaderReaped']=p.returncode is not None
            until=time.monotonic()+5
            while not group_gone(pgid) and time.monotonic()<until:time.sleep(0.1)
            proc['groupGone']=group_gone(pgid)
        finally:
            for sig,handler in oldhandlers.items():signal.signal(sig,handler)
        if not proc['groupGone'] or not proc['actualWait'] or not proc['stdioClosed']:raise RuntimeError('process_not_physically_joined')
        after=source_hashes(repo);proc['trackedInputsUnchanged']=before==after
        if subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()!=head:raise RuntimeError('HEAD_changed')
        if any(path.exists() or path.is_symlink() for path in OTHER_PROFILES):raise RuntimeError('unexpected_secondary_profile')
        profile,pstat=read_regular(PROFILE,PROFILE_LIMIT)
        if pstat.st_ctime_ns<started_ns:raise RuntimeError('profile_not_created_in_owned_job_window')
        proc['profileOwnedAndStable']=True
        raw,_=read_regular(work/'raw.log',RAW_LIMIT);report,_=read_regular(work/'vitest.json',REPORT_LIMIT)
        # Default reporter ANSI controls only; source/log content otherwise retained.
        import re
        raw=re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]',b'',raw)
        spec=importlib.util.spec_from_file_location('signed99_diagnostic_validator',Path(__file__).with_name('signed99-worker-cpu-validator.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        validation=module.validate(raw,report,profile,proc,repo)
        if validation['artifactPrivacySafe']:
            exclusive(evidence/'raw.log',raw);exclusive(evidence/'vitest.json',report);exclusive(evidence/'profile.cpuprofile',profile)
            proc['profileSHA256']=sha(profile)
    except Exception as error:
        validation={'diagnosticQualified':False,'artifactPrivacySafe':False,'problems':[type(error).__name__+':'+str(error) if isinstance(error,RuntimeError) else type(error).__name__],'signed99WholePass':False}
    finally:
        # Every path after a successful Popen must join only that owned process group.
        if p is not None and not proc['groupGone']:
            for sig,delay in [(signal.SIGTERM,3),(signal.SIGKILL,5)]:
                if group_gone(pgid):break
                try:os.killpg(pgid,sig);proc['cleanupSignalsSent'].append(signal.Signals(sig).name)
                except ProcessLookupError:pass
                try:p.wait(timeout=delay)
                except subprocess.TimeoutExpired:continue
            try:proc['rawVitestExit']=p.wait(timeout=2);proc['actualWait']=True;proc['leaderReaped']=True
            except subprocess.TimeoutExpired:pass
            proc['groupGone']=group_gone(pgid)
            validation['diagnosticQualified']=False;validation['artifactPrivacySafe']=False
        if p is not None and p.stdout is not None and not p.stdout.closed:p.stdout.close()
        proc['ownedStdoutFdClosed']=p is None or p.stdout is None or p.stdout.closed
        exclusive(evidence/'process.json',(json.dumps(proc,indent=2)+'\n').encode())
        exclusive(evidence/'validation.json',(json.dumps(validation,indent=2)+'\n').encode())
        safe=validation.get('artifactPrivacySafe') is True
        if safe and not all(proc.get(k) is True for k in ['actualWait','leaderReaped','stdioClosed','groupGone']):safe=False
        output_file=os.environ.get('GITHUB_OUTPUT')
        if output_file:
            with open(output_file,'a') as f:f.write('artifact_safe='+str(safe).lower()+'\n')
        print(json.dumps({'kind':'THREE_PUBLICATION_WORKER_CPU_DIAGNOSTIC_ONLY','diagnosticQualified':validation.get('diagnosticQualified',False),'problems':validation.get('problems',[]),'rawVitestExit':proc['rawVitestExit'],'groupGone':proc['groupGone'],'signed99WholePass':False}),flush=True)
    return 0 if validation.get('diagnosticQualified') is True else 2
if __name__=='__main__':sys.exit(main())
