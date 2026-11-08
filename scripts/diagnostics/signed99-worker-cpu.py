#!/usr/bin/env python3
"""Fixed signed99 diagnostic entry; capture helpers live beside this script."""
from signed99_worker_cpu_capture import *
CONTROL_BOOLS=('actualWait','leaderReaped','stdioClosed','groupGone','profileOwnedAndStable','originalProfileAbsentBefore','criticalSourcePinsMatch','trackedInputsUnchanged','interrupted','diagnosticBudgetExceeded','rawOverflow','ownedStdoutFdClosed','samplingIntervalObserved','profileDirectoryVerified','profileOutputModeObserved')
CONTROL_INTS=('rawVitestExit','pid','pgid','sourceInputCount','samplingIntervalUsRequested')
CONTROL_PROCESS_KEYS=frozenset(('schemaVersion','kind','signed99WholePass','captureChecks','cleanupSignalsSent','profileInventory','auxCaptureProblems','caseObservation','profileDirectoryMode',*CONTROL_BOOLS,*CONTROL_INTS))
CONTROL_VALIDATION_KEYS=frozenset(('schemaVersion','kind','diagnosticQualified','artifactPrivacySafe','signed99WholePass','problems'))
def validate_control_metadata(process,validation,catalog=None):
    if type(process)is not dict or type(validation)is not dict or set(process)!=CONTROL_PROCESS_KEYS or set(validation)!=CONTROL_VALIDATION_KEYS:raise ValueError('control_schema_keys')
    if process['schemaVersion']!=1 or validation['schemaVersion']!=1 or process['kind']!='SIGNED99_PROCESS_CONTROL' or validation['kind']!='SIGNED99_VALIDATION_CONTROL':raise ValueError('control_schema_identity')
    if process['signed99WholePass']is not False or validation['signed99WholePass']is not False:raise ValueError('control_whole_claim')
    if any(type(process[k])not in (bool,type(None)) for k in CONTROL_BOOLS):raise ValueError('control_schema_boolean')
    if any(process[k]is not None and (type(process[k])is not int or not -2**63<=process[k]<2**63) for k in CONTROL_INTS):raise ValueError('control_schema_integer')
    if type(process['cleanupSignalsSent'])is not list or len(process['cleanupSignalsSent'])>4 or any(v not in ('SIGTERM','SIGKILL') or type(v)is not str for v in process['cleanupSignalsSent']):raise ValueError('control_schema_signals')
    checks=process['captureChecks']
    if type(checks)is not list or len(checks)>3:raise ValueError('control_schema_checks')
    for row in checks:
        if type(row)is not dict or set(row)!={'kind','stage','reason','mode','uid','nlink','size','declaredLimit'}:raise ValueError('control_schema_stat_keys')
        if type(row['kind'])is not str or row['kind']not in CAPTURE_LIMITS or type(row['stage'])is not str or row['stage']not in CAPTURE_STAGES or type(row['reason'])is not str or row['reason']not in CAPTURE_REASONS:raise ValueError('control_schema_stat_enum')
        if type(row['declaredLimit'])is not int or row['declaredLimit']!=CAPTURE_LIMITS[row['kind']]:raise ValueError('control_schema_limit')
        if any(row[k]is not None and (type(row[k])is not int or not 0<=row[k]<2**63) for k in ['mode','uid','nlink','size']):raise ValueError('control_schema_stat_numbers')
    if any(type(validation[k])is not bool for k in ['diagnosticQualified','artifactPrivacySafe']):raise ValueError('control_schema_qualification')
    if type(validation['problems'])is not list or len(validation['problems'])>len(CONTROL_PROBLEM_CODES) or any(type(v)is not str or v not in CONTROL_PROBLEM_CODES for v in validation['problems']):raise ValueError('control_schema_problem_enum')
    validate_extra_control(process,catalog)
    physical=all(process[k]is True for k in ['actualWait','leaderReaped','stdioClosed','groupGone'])
    if validation['diagnosticQualified']and (not physical or process['rawVitestExit']!=1 or process['cleanupSignalsSent'] or process['interrupted']is not False or process['diagnosticBudgetExceeded']is not False or process['rawOverflow']is not False or validation['problems']):raise ValueError('control_false_success')
    return True
def control_metadata(proc,validation,catalog=None):
    # Projection only: no file access, argv/path/env/error/function-name copied.
    if type(proc)is not dict or type(validation)is not dict:raise ValueError('control_inputs')
    process={'schemaVersion':1,'kind':'SIGNED99_PROCESS_CONTROL','signed99WholePass':False}
    for k in CONTROL_BOOLS:process[k]=proc.get(k) if type(proc.get(k))is bool else None
    for k in CONTROL_INTS:process[k]=proc.get(k) if type(proc.get(k))is int else None
    process['captureChecks']=proc.get('captureChecks',[])
    process['cleanupSignalsSent']=proc.get('cleanupSignalsSent',[])
    process['profileInventory']=proc.get('profileInventory',[])
    process['auxCaptureProblems']=proc.get('auxCaptureProblems',[])
    process['caseObservation']=proc.get('caseObservation')
    process['profileDirectoryMode']='owned-private'if proc.get('profileDirectoryMode')=='owned-private'else'not-created'
    problems=validation.get('problems',[])
    if type(problems)is not list:problems=['unclassified_validation_failure']
    problems=sorted({v if type(v)is str and v in CONTROL_PROBLEM_CODES else 'unclassified_validation_failure' for v in problems})
    control={'schemaVersion':1,'kind':'SIGNED99_VALIDATION_CONTROL','diagnosticQualified':validation.get('diagnosticQualified')is True,'artifactPrivacySafe':validation.get('artifactPrivacySafe')is True,'signed99WholePass':False,'problems':problems}
    validate_control_metadata(process,control,catalog)
    return process,control

def invalidate_qualification(validation,reason):
    # Pure fixed-enum revocation: retain old problems, never render an exception.
    code=reason if type(reason)is str and reason in CONTROL_PROBLEM_CODES else 'producer_exception'
    prior=validation.get('problems',[]);problems=list(prior) if type(prior)is list else ['producer_exception']
    if code not in problems:problems.append(code)
    return {**validation,'diagnosticQualified':False,'artifactPrivacySafe':False,'problems':problems}
def final_profile_directory_recheck(profile_dir,directory_identity,proc,validation):
    if directory_identity is None:return validation
    try:
        private_directory(profile_dir,directory_identity)
        proc['profileInventory']=[row for row in proc['profileInventory']if row['phase']=='before']+profile_inventory(profile_dir,'after')
    except Exception as error:
        reason=producer_reason(error)
        proc['auxCaptureProblems'].append(reason)
        proc['profileDirectoryVerified']=False
        return invalidate_qualification(validation,reason)
    return validation
def qualification_outcome(validation,proc):
    # The original upload condition and original return condition, shared by finally and tests.
    safe=validation.get('artifactPrivacySafe') is True
    if safe and not all(proc.get(k) is True for k in ['actualWait','leaderReaped','stdioClosed','groupGone']):safe=False
    return safe,0 if validation.get('diagnosticQualified') is True else 2

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
    output.mkdir(mode=0o700,exist_ok=False);work=output/'private';evidence=output/'evidence';work.mkdir(mode=0o700);evidence.mkdir(mode=0o700);control=output/'control';control.mkdir(mode=0o700)
    proc={'actualWait':False,'leaderReaped':False,'stdioClosed':False,'groupGone':False,'profileOwnedAndStable':False,'originalProfileAbsentBefore':False,'criticalSourcePinsMatch':False,'trackedInputsUnchanged':False,'interrupted':False,'diagnosticBudgetExceeded':False,'cleanupSignalsSent':[],'rawOverflow':False,'rawVitestExit':None,'signed99WholePass':False,'captureChecks':[],'samplingIntervalUsRequested':10000,'samplingIntervalObserved':False,'profileDirectoryVerified':False,'profileOutputModeObserved':False,'profileDirectoryMode':'not-created','profileInventory':[],'auxCaptureProblems':[],'caseObservation':None}
    validation={'diagnosticQualified':False,'artifactPrivacySafe':False,'problems':['producer_not_completed'],'signed99WholePass':False};p=None;pgid=None
    catalog={};literals=frozenset();captured={};capture_failures={};profile_dir=work/'profiles';directory_identity=None
    def capture_once(kind,path,limit):
        if kind in captured:return captured[kind]
        if kind in capture_failures:raise CaptureRejected(capture_failures[kind])
        try:captured[kind]=read_regular(path,limit,kind,proc['captureChecks']);return captured[kind]
        except Exception as error:
            capture_failures[kind]=producer_reason(error)
            raise
    try:
        profile_dir.mkdir(mode=0o700)
        profile_dir=profile_dir.resolve();directory_identity=private_directory(profile_dir,empty=True)
        proc['profileDirectoryMode']='owned-private';proc['profileDirectoryVerified']=True
        PROFILE=profile_dir/PROFILE_NAMES[0];OTHER_PROFILES=[profile_dir/name for name in PROFILE_NAMES[1:]]
        proc['profileInventory']=profile_inventory(profile_dir,'before')
        for path in [PROFILE,*OTHER_PROFILES]:
            try:os.lstat(path)
            except FileNotFoundError:continue
            raise ProducerRejected('fixed_profile_preexists_refuse_without_deleting')
        proc['originalProfileAbsentBefore']=True
        if any(sha((repo/path).read_bytes())!=expected for path,expected in PINS.items()):raise ProducerRejected('critical_462b_source_pin_mismatch')
        proc['criticalSourcePinsMatch']=True;before=source_hashes(repo);proc['sourceInputCount']=len(before);proc['sourceSetSHA256']=sha(json.dumps(before,sort_keys=True).encode());head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip();started_ns=time.time_ns()
        catalog,literals=source_catalog(repo,before)
        spec=importlib.util.spec_from_file_location('signed99_diagnostic_validator',Path(__file__).with_name('signed99-worker-cpu-validator.py'));validator=importlib.util.module_from_spec(spec);spec.loader.exec_module(validator)
        argv=['node','node_modules/vitest/vitest.mjs','run','--config','vitest.config.ts','tests/runtime/verification/intent-publication-dependencies.test.ts','--maxWorkers=1','--reporter=default','--reporter=json','--outputFile='+str(work/'vitest.json'),'-t','^'+TITLE+'$']
        # Allowlist ordinary runtime environment, never provider/action credentials.
        env={k:os.environ[k] for k in ['PATH','HOME','USER','LOGNAME','LANG','LC_ALL'] if k in os.environ}
        tmp=Path(tempfile.mkdtemp(prefix='xs99-',dir='/tmp')).resolve()
        env.update({'CI':'true','FORCE_COLOR':'0','TERM':'dumb','TMPDIR':str(tmp),'SOLPI_INTENT_POPULATION':'1','SOLPI_INTENT_PROFILE':'1','SOLPI_INTENT_PROFILE_DIR':str(profile_dir)})
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
        private_directory(profile_dir,directory_identity)
        proc['profileInventory']+=profile_inventory(profile_dir,'after')
        if not proc['groupGone'] or not proc['actualWait'] or not proc['stdioClosed']:raise ProducerRejected('process_not_physically_joined')
        after=source_hashes(repo);proc['trackedInputsUnchanged']=before==after
        if subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()!=head:raise ProducerRejected('HEAD_changed')
        if any(path.exists() or path.is_symlink() for path in OTHER_PROFILES):raise ProducerRejected('unexpected_secondary_profile')
        profile,pstat=capture_once('profile',PROFILE,PROFILE_LIMIT)
        if pstat.st_ctime_ns<started_ns:raise ProducerRejected('profile_not_created_in_owned_job_window')
        proc['profileOwnedAndStable']=True
        raw,_=capture_once('raw',work/'raw.log',RAW_LIMIT);report,_=capture_once('report',work/'vitest.json',REPORT_LIMIT)
        # Default reporter ANSI controls only; source/log content otherwise retained.
        import re
        raw=re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]',b'',raw)
        module=validator
        proc['samplingIntervalObserved']=raw.decode('utf-8',errors='replace').splitlines().count('population-profile-sampling-interval-us 10000')==1
        proc['profileOutputModeObserved']=raw.decode('utf-8',errors='replace').splitlines().count('population-profile-output-mode owned-private')==1
        validation=module.validate(raw,report,profile,proc,repo)
        if validation['artifactPrivacySafe']:
            exclusive(evidence/'raw.log',raw);exclusive(evidence/'vitest.json',report);exclusive(evidence/'profile.cpuprofile',profile)
            proc['profileSHA256']=sha(profile)
    except Exception as error:
        reason=producer_reason(error)
        validation={'diagnosticQualified':False,'artifactPrivacySafe':False,'problems':[reason],'signed99WholePass':False}
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
        validation=final_profile_directory_recheck(profile_dir,directory_identity,proc,validation)
        if all(proc.get(k)is True for k in ['actualWait','leaderReaped','stdioClosed','groupGone']):
            for kind,name,limit in [('raw','raw.log',RAW_LIMIT),('report','vitest.json',REPORT_LIMIT)]:
                try:capture_once(kind,work/name,limit)
                except Exception as error:
                    code=producer_reason(error)
                    if code not in proc['auxCaptureProblems']:proc['auxCaptureProblems'].append(code)
            try:
                if catalog:
                    proc['caseObservation']=case_observation(captured.get('raw',(None,))[0],captured.get('report',(None,))[0],catalog,literals,validator.EXPECTED_SLOTS,TITLE)
                    proc['samplingIntervalObserved']=proc['caseObservation']['samplingMarker']
                    proc['profileOutputModeObserved']=proc['caseObservation']['profileOutputModeMarker']
            except Exception:
                proc['auxCaptureProblems'].append('case_observation_failed')
        exclusive(evidence/'process.json',(json.dumps(proc,indent=2)+'\n').encode())
        exclusive(evidence/'validation.json',(json.dumps(validation,indent=2)+'\n').encode())
        safe,_=qualification_outcome(validation,proc)
        # Independent metadata channel: strict schema, no capture-file reads, no raw/report/profile upload grant.
        control_process,control_validation=control_metadata(proc,validation,catalog)
        exclusive(control/'process.json',(json.dumps(control_process,indent=2)+'\n').encode())
        exclusive(control/'validation.json',(json.dumps(control_validation,indent=2)+'\n').encode())
        control_safe=validate_control_metadata(control_process,control_validation,catalog)
        output_file=os.environ.get('GITHUB_OUTPUT')
        if output_file:
            with open(output_file,'a') as f:f.write('artifact_safe='+str(safe).lower()+'\n'+'control_metadata_safe='+str(control_safe).lower()+'\n')
        print(json.dumps({'kind':'THREE_PUBLICATION_WORKER_CPU_DIAGNOSTIC_ONLY','diagnosticQualified':validation.get('diagnosticQualified',False),'problems':validation.get('problems',[]),'rawVitestExit':proc['rawVitestExit'],'groupGone':proc['groupGone'],'signed99WholePass':False}),flush=True)
    return qualification_outcome(validation,proc)[1]
if __name__=='__main__':sys.exit(main())
