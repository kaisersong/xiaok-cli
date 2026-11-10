#!/usr/bin/env python3
"""Opt-in hosted diagnostic; raw Vitest1 is accepted only by the exact diagnostic validator."""
import argparse,collections,hashlib,importlib.util,json,os,selectors,signal,stat,subprocess,sys,tempfile,time
from pathlib import Path
PINS={'tests/runtime/verification/intent-publication-dependencies.test.ts': '1609527271e19c2145d78eec78af19dc500253f90680eed0c2d48abb3d3bd06c', 'tests/support/verified-operation-fixture.ts': 'ef333a58f08ac67a0a1dcba0b97c9fa558eeb4a95216271d589d23377a606655', 'tests/support/installed-controller-fixture.ts': '7107f957ab4b074f835de542c56b52ec396fc823984a9b5c4de20635f76f1126', 'tests/support/loop-publication-receiver.ts': '38e974d3402fcf22315f170ddc90424f54c04bf8832476ecedec43a4104731ad', 'tests/support/intent-application-fixture.ts': 'd2f0efb75955b228a3e398610fe68083a7dee11bd4510bc34fb8511473b86525', 'tests/support/original-fixture-controller-metadata.ts': '6b1928e638b7b22f4228c9c8899bf187e87750bf6e745fd1aaa1b2a82157b1a2', 'vitest.config.ts': 'e93705c9148b184570f53dc8543aed2340f3340d9224a51945279270368ab0f6', 'package.json': '146fd5d117f3cb5dee3438df7110e027cdedcce8cb2b64d82f81f3b78a194300', 'package-lock.json': '2b2d5805585b41b25d004416048acc8ee007b79e2689b5cb48b1f7b5776edf6e', 'src/runtime/verification/controller-ipc.ts': 'c480a48da38cb0535300e1c2a7cd00522cbc2d28bb68dcd27a05ed0ef43e077b', 'src/runtime/verification/controller-client.ts': '96396c576d4416ff8bf763f119aca258a032a5a57bd1ba8f3ae3628213f6db33', 'src/runtime/verification/controller-public-daemon.ts': '65e1f0633cce48d389f11de21aaeb82bdf9b1ad0edd63a527171d90f35261aee'}
TITLE='near-limit original contract retains its whole stage population through actual signed set RPC'
RAW_LIMIT=8*1024**2;REPORT_LIMIT=4*1024**2;PROFILE_LIMIT=128*1024**2
DIAGNOSTIC_WALL_SECONDS=38*60
sha=lambda b:hashlib.sha256(b).hexdigest()
def exclusive(path,data):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'wb') as f:f.write(data)
CAPTURE_LIMITS={'profile':PROFILE_LIMIT,'raw':RAW_LIMIT,'report':REPORT_LIMIT}
CAPTURE_REASONS=frozenset({'accepted','capture_kind_or_limit_invalid','lstat_failed','not_regular','uid_mismatch','nlink_not_one','empty_file','size_exceeds_declared_limit','open_failed','fstat_failed','file_replaced','read_failed','post_lstat_failed','file_changed_during_capture'})
CAPTURE_STAGES=frozenset({'input','lstat','open','fstat','read','post_lstat','verify','complete'})
class CaptureRejected(RuntimeError):
    def __init__(self,reason):
        if reason not in CAPTURE_REASONS:raise ValueError('invalid_capture_reason')
        self.reason=reason
        super().__init__(reason)
def read_regular(path,limit,kind,checks):
    def record(stage,reason,s=None):
        row={'kind':kind,'stage':stage,'reason':reason,'mode':s.st_mode if s else None,'uid':s.st_uid if s else None,'nlink':s.st_nlink if s else None,'size':s.st_size if s else None,'declaredLimit':limit}
        checks.append(row)
    def reject(stage,reason,s=None):
        record(stage,reason,s)
        raise CaptureRejected(reason)
    if kind not in CAPTURE_LIMITS or type(limit) is not int or limit!=CAPTURE_LIMITS[kind]:raise CaptureRejected('capture_kind_or_limit_invalid')
    try:before=os.lstat(path)
    except OSError:reject('lstat','lstat_failed')
    if not stat.S_ISREG(before.st_mode):reject('lstat','not_regular',before)
    if before.st_uid!=os.getuid():reject('lstat','uid_mismatch',before)
    if before.st_nlink!=1:reject('lstat','nlink_not_one',before)
    if before.st_size<=0:reject('lstat','empty_file',before)
    if before.st_size>limit:reject('lstat','size_exceeds_declared_limit',before)
    try:fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    except OSError:reject('open','open_failed',before)
    with os.fdopen(fd,'rb') as f:
        try:opened=os.fstat(f.fileno())
        except OSError:reject('fstat','fstat_failed',before)
        if (before.st_dev,before.st_ino,before.st_size)!=(opened.st_dev,opened.st_ino,opened.st_size):reject('fstat','file_replaced',opened)
        try:data=f.read(limit+1);after=os.fstat(f.fileno())
        except OSError:reject('read','read_failed',opened)
    try:last=os.lstat(path)
    except OSError:reject('post_lstat','post_lstat_failed',after)
    fields=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_nlink)
    if len(data)>limit or fields(before)!=fields(after) or fields(before)!=fields(last):reject('verify','file_changed_during_capture',last)
    record('complete','accepted',before)
    return data,before

PROFILE_NAMES=('solpi-intent-population.cpuprofile','solpi-intent-population-failure.cpuprofile','solpi-intent-final-set.cpuprofile')
PROFILE_KINDS=('profile_main','profile_failure','profile_final')
PRODUCER_REASONS=frozenset({'fixed_profile_preexists_refuse_without_deleting','critical_462b_source_pin_mismatch','process_not_physically_joined','HEAD_changed','unexpected_secondary_profile','profile_not_created_in_owned_job_window','profile_directory_invalid','profile_directory_not_empty','profile_directory_changed','source_catalog_changed'})
CASE_ERROR_LITERALS=frozenset({'explicit_profile_stopped_after_three_actual_publications','verification_capacity_exhausted','controller_ipc_timeout_unknown','profile_output_directory_invalid','profile_output_directory_changed'})
class ProducerRejected(RuntimeError):
    def __init__(self,reason):
        if reason not in PRODUCER_REASONS:raise ValueError('invalid_producer_reason')
        self.reason=reason;super().__init__(reason)
def producer_reason(error):
    if type(error)is CaptureRejected and error.reason in CAPTURE_REASONS:return error.reason
    if type(error)is ProducerRejected and error.reason in PRODUCER_REASONS:return error.reason
    return 'producer_exception'
def private_directory(path,expected=None,empty=False):
    try:
        s=os.lstat(path)
        if not stat.S_ISDIR(s.st_mode) or s.st_uid!=os.getuid() or stat.S_IMODE(s.st_mode)!=0o700 or Path(path).resolve()!=Path(path):raise ProducerRejected('profile_directory_invalid')
        if expected is not None and (s.st_dev,s.st_ino)!=(expected.st_dev,expected.st_ino):raise ProducerRejected('profile_directory_changed')
        if empty and os.listdir(path):raise ProducerRejected('profile_directory_not_empty')
        return s
    except OSError:raise ProducerRejected('profile_directory_invalid') from None
def profile_inventory(directory,phase):
    rows=[]
    for kind,name in zip(PROFILE_KINDS,PROFILE_NAMES):
        try:s=os.lstat(directory/name);exists=True;reason='present'
        except FileNotFoundError:s=None;exists=False;reason='absent'
        except OSError:s=None;exists=None;reason='lstat_failed'
        rows.append({'kind':kind,'phase':phase,'exists':exists,'reason':reason,'mode':s.st_mode if s else None,'uid':s.st_uid if s else None,'nlink':s.st_nlink if s else None,'size':s.st_size if s else None})
    return rows
def source_catalog(repo,before):
    catalog={};literals=set();root=repo.resolve()
    for relative,expected in before.items():
        p=root/relative
        if p.is_symlink() or p.resolve()!=p or not p.is_file():continue
        data=p.read_bytes()
        if sha(data)!=expected:raise ProducerRejected('source_catalog_changed')
        catalog[relative]={'absolute':str(p),'lineCount':data.count(b'\n')+1,'sha256':expected}
        for literal in CASE_ERROR_LITERALS:
            token=literal.encode()
            if b"'"+token+b"'"in data or b'"'+token+b'"'in data:literals.add(literal)
    return catalog,frozenset(literals)
OBS_COUNTERS=('numTotalTests','numPendingTests','numFailedTests','numPassedTests','numTodoTests')
OBS_KEYS=frozenset(('rawAvailable','reportAvailable','reportParsed','identityOracleMatch','reportFileMatch','assertionCount','skippedAssertions','failedAssertions','passedAssertions','todoAssertions','selectedCount','selectedOriginalCase','selectedFailureCategory','stackLocations','rawThreePublications','rawUnhandled','samplingMarker','profileOutputModeMarker',*OBS_COUNTERS))
def case_observation(raw,report,catalog,literals,oracle,title):
    v={k:None for k in OBS_COUNTERS};v.update({'rawAvailable':raw is not None,'reportAvailable':report is not None,'reportParsed':False,'identityOracleMatch':False,'reportFileMatch':False,'assertionCount':0,'skippedAssertions':0,'failedAssertions':0,'passedAssertions':0,'todoAssertions':0,'selectedCount':0,'selectedOriginalCase':False,'selectedFailureCategory':'unknown','stackLocations':[],'rawThreePublications':False,'rawUnhandled':False,'samplingMarker':False,'profileOutputModeMarker':False})
    import re
    if raw is not None:
        text=raw.decode('utf-8',errors='replace');clean=re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',text);lines=clean.splitlines()
        metrics=[int(match[1]) for line in lines if (match:=re.fullmatch(r'population-publication-ms (\d+) \d+',line.strip()))]
        v['rawThreePublications']=metrics==[0,1,2];v['rawUnhandled']=bool(re.search(r'Unhandled\s+(?:Errors?|Rejections?)|Uncaught\s+Exception|Worker exited unexpectedly|FATAL ERROR',clean,re.I));v['samplingMarker']=lines.count('population-profile-sampling-interval-us 10000')==1;v['profileOutputModeMarker']=lines.count('population-profile-output-mode owned-private')==1
    if report is None:return v
    try:
        document=json.loads(report)
        if type(document)is not dict:return v
        for k in OBS_COUNTERS:
            n=document.get(k);v[k]=n if type(n)is int and 0<=n<=1000000 else None
        suites=document.get('testResults',[])
        if type(suites)is not list:return v
        flat=[];slots=[];occ={};expected_file=oracle[0][0];known_absolute=catalog.get(expected_file,{}).get('absolute')
        v['reportFileMatch']=len(suites)==1 and type(suites[0])is dict and suites[0].get('name')==known_absolute
        for suite in suites:
            if type(suite)is not dict or type(suite.get('assertionResults'))is not list:return v
            file=expected_file if suite.get('name')==known_absolute else None
            for a in suite['assertionResults']:
                if type(a)is not dict or type(a.get('fullName'))is not str or type(a.get('status'))is not str:return v
                t=a['fullName'];occ[(file,t)]=occ.get((file,t),0)+1;slots.append((file,t,occ[(file,t)]));flat.append(a)
        v['reportParsed']=True;v['assertionCount']=len(flat);v['identityOracleMatch']=collections.Counter(slots)==collections.Counter(oracle)
        for status,key in [('skipped','skippedAssertions'),('failed','failedAssertions'),('passed','passedAssertions'),('todo','todoAssertions')]:v[key]=sum(a['status']==status for a in flat)
        selected=[a for a in flat if a['status']!='skipped'];v['selectedCount']=len(selected);v['selectedOriginalCase']=len(selected)==1 and selected[0]['fullName']==title
        if not v['selectedOriginalCase']:return v
        messages=selected[0].get('failureMessages',[])
        if type(messages)is not list or len(messages)!=1 or type(messages[0])is not str:return v
        message_lines=messages[0].splitlines();first=message_lines[0].strip()if message_lines else ''
        for literal in literals:
            if first in ('Error: '+literal,'TypeError: '+literal,'RangeError: '+literal):v['selectedFailureCategory']=literal;break
        # A reported location, not proof of an actual executing frame. Never output function names/URLs.
        from urllib.parse import urlparse,unquote
        absolute={fact['absolute']:rel for rel,fact in catalog.items()};seen=set()
        for line in message_lines[:256]:
            for match in re.finditer(r'(file://[^\s()]+|/[^\s()]+|(?:src|tests)/[^\s()]+):(\d+):(\d+)(?=[\s)]|$)',line):
                path=match[1]
                if path.startswith('file:'):
                    parsed=urlparse(path)
                    if parsed.netloc not in ('','localhost')or parsed.query or parsed.fragment:continue
                    path=unquote(parsed.path)
                relative=absolute.get(path,path if path in catalog else None)
                if relative is None:continue
                number=int(match[2])
                if not 1<=number<=catalog[relative]['lineCount']or (relative,number)in seen:continue
                seen.add((relative,number));v['stackLocations'].append({'path':relative,'line':number})
                if len(v['stackLocations'])==3:return v
    except (ValueError,TypeError,KeyError,IndexError):pass
    return v

def validate_extra_control(process,catalog):
    if process['profileDirectoryMode']not in ('owned-private','not-created'):raise ValueError('control_profile_mode')
    inventory=process['profileInventory']
    if type(inventory)is not list or len(inventory)>6:raise ValueError('control_inventory')
    for row in inventory:
        if type(row)is not dict or set(row)!={'kind','phase','exists','reason','mode','uid','nlink','size'}:raise ValueError('control_inventory_keys')
        if row['kind']not in PROFILE_KINDS or row['phase']not in ('before','after')or row['reason']not in ('present','absent','lstat_failed')or type(row['exists'])not in (bool,type(None)):raise ValueError('control_inventory_enum')
        if any(row[k]is not None and(type(row[k])is not int or not 0<=row[k]<2**63)for k in ['mode','uid','nlink','size']):raise ValueError('control_inventory_numbers')
    aux=process['auxCaptureProblems']
    if type(aux)is not list or len(aux)>3 or any(type(code)is not str or code not in CONTROL_PROBLEM_CODES for code in aux):raise ValueError('control_aux_codes')
    v=process['caseObservation']
    if v is None:return
    if type(v)is not dict or set(v)!=OBS_KEYS or type(catalog)is not dict:raise ValueError('control_observation_keys')
    bools=['rawAvailable','reportAvailable','reportParsed','identityOracleMatch','reportFileMatch','selectedOriginalCase','rawThreePublications','rawUnhandled','samplingMarker','profileOutputModeMarker']
    if any(type(v[k])is not bool for k in bools):raise ValueError('control_observation_booleans')
    numbers=[*OBS_COUNTERS,'assertionCount','skippedAssertions','failedAssertions','passedAssertions','todoAssertions','selectedCount']
    if any(v[k]is not None and(type(v[k])is not int or not 0<=v[k]<=1000000)for k in numbers):raise ValueError('control_observation_numbers')
    if type(v['selectedFailureCategory'])is not str or v['selectedFailureCategory']not in CASE_ERROR_LITERALS|{'unknown'}:raise ValueError('control_observation_category')
    rows=v['stackLocations']
    if type(rows)is not list or len(rows)>3:raise ValueError('control_observation_stack')
    for row in rows:
        if type(row)is not dict or set(row)!={'path','line'}or type(row['path'])is not str or row['path']not in catalog or type(row['line'])is not int or not 1<=row['line']<=catalog[row['path']]['lineCount']:raise ValueError('control_stack_source_bound')

CONTROL_PROBLEM_CODES=frozenset(('accepted', 'artifact_secret_pattern_refused', 'capture_kind_or_limit_invalid', 'empty_file', 'file_changed_during_capture', 'file_replaced', 'frozen_23_file_title_occurrence_mismatch', 'fstat_failed', 'interrupted_budget_or_forced_cleanup', 'invalid_cpu_profile_json', 'invalid_cpu_profile_samples', 'invalid_or_missing_vitest_json', 'lstat_failed', 'nlink_not_one', 'no_sampled_runtime_source_function', 'non_source_profile_url_refused', 'not_exact_23_assertions_22_filtered_1_failed', 'not_exact_vitest_23_total_22_pending_1_failed_0_passed_0_todo', 'not_exactly_three_actual_publication_metrics', 'not_regular', 'not_unique_expected_selected_failure', 'open_failed', 'physical_or_input_qualification_missing', 'post_lstat_failed', 'producer_exception', 'producer_not_completed', 'profile_file_outside_checkout_refused', 'profile_start_subject_population_missing', 'profile_url_authority_refused', 'read_failed', 'report_extra_runtime_errors', 'runtime_error_suite', 'sampling_interval_not_observed', 'size_exceeds_declared_limit', 'stage_sequence_not_original_three', 'uid_mismatch', 'unclassified_validation_failure', 'unexpected_failure_sentinel', 'unexpected_final_set_phase', 'unexpected_raw_exit', 'unexpected_suite_error_message', 'unexpected_vitest_result_counts', 'unhandled_or_runner_error', 'unknown_profile_url_refused', 'wrong_selected_file'))
CONTROL_PROBLEM_CODES=CONTROL_PROBLEM_CODES|PRODUCER_REASONS|{'case_observation_failed','profile_output_mode_not_observed'}
