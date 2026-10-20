#!/usr/bin/env python3
"""Validate diagnostic evidence only. Does not execute product code or grant qualification."""
import collections,json,re
from pathlib import Path
from urllib.parse import urlparse,unquote
TITLE='near-limit original contract retains its whole stage population through actual signed set RPC'
SENTINEL='explicit_profile_stopped_after_three_actual_publications'
TEST='tests/runtime/verification/intent-publication-dependencies.test.ts'
# Frozen from final-462b-signed99-r1326/EXPECTED-SLOTS.json; no runtime discovery.
# Oracle SHA256: 930645ad25edde18ab37f98be00606759e59939692614d14ca17bf376df35e83
EXPECTED_SLOTS = (
    ('tests/runtime/verification/intent-publication-dependencies.test.ts', 'actual original Intent dependency observation derives empty first-stage and whole parent inventory from native receipts', 1),
    ('tests/runtime/verification/intent-publication-dependencies.test.ts', 'late expiration of an earlier dependency cannot be spliced into an otherwise-current parent set', 1),
    ('tests/runtime/verification/intent-publication-dependencies.test.ts', 'foreign subject and caller-selected inventory cannot redefine original native dependencies', 1),
    ('tests/runtime/verification/intent-publication-dependencies.test.ts', 'final whole-set check rejects a dependency application entering pending during the last receiver query', 1),
    ('tests/runtime/verification/intent-publication-dependencies.test.ts', 'actual signed controller routes full original payload pages and last complete dependency observation through fixed reader', 1),
    ('tests/runtime/verification/intent-publication-dependencies.test.ts', 'no qualified callback occurs after the final qualified authority clock in the dependency result', 1),
    ('tests/runtime/verification/intent-publication-dependencies.test.ts', 'final authority clock expire still fences the result without a wrapper callback', 1),
    ('tests/runtime/verification/intent-publication-dependencies.test.ts', 'final authority clock close still fences the result without a wrapper callback', 1),
    ('tests/runtime/verification/intent-publication-dependencies.test.ts', 'near-limit original contract retains its whole stage population through actual signed set RPC', 1),
    ('tests/runtime/verification/intent-publication-dependencies.test.ts', 'whole graph read refuses actual sibling noncanonical drift even for empty dependencies', 1),
    ('tests/runtime/verification/intent-publication-dependencies.test.ts', 'whole graph read refuses actual sibling subject drift even for empty dependencies', 1),
    ('tests/runtime/verification/intent-publication-dependencies.test.ts', 'whole graph read refuses actual sibling mandatory drift even for empty dependencies', 1),
    ('tests/runtime/verification/intent-publication-dependencies.test.ts', 'whole graph read refuses actual sibling registration drift even for empty dependencies', 1),
    ('tests/runtime/verification/intent-publication-dependencies.test.ts', 'actual invocation-only append retains complete parent graph: valid', 1),
    ('tests/runtime/verification/intent-publication-dependencies.test.ts', 'actual invocation-only append retains complete parent graph: missing-parent', 1),
    ('tests/runtime/verification/intent-publication-dependencies.test.ts', 'actual invocation-only append retains complete parent graph: missing-sibling-edge', 1),
    ('tests/runtime/verification/intent-publication-dependencies.test.ts', 'actual invocation-only append retains complete parent graph: extra-edge', 1),
    ('tests/runtime/verification/intent-publication-dependencies.test.ts', 'actual invocation-only append retains complete parent graph: parent-noncanonical', 1),
    ('tests/runtime/verification/intent-publication-dependencies.test.ts', 'completion observation includes its own actual publication and every original dependency without publishing the parent implicitly', 1),
    ('tests/runtime/verification/intent-publication-dependencies.test.ts', 'completion observation final clock expire rejects the entire self and dependency set', 1),
    ('tests/runtime/verification/intent-publication-dependencies.test.ts', 'completion observation final clock close rejects the entire self and dependency set', 1),
    ('tests/runtime/verification/intent-publication-dependencies.test.ts', 'parent completion final set rejects old native-approved child publication references after a same-proof child republishes', 1),
    ('tests/runtime/verification/intent-publication-dependencies.test.ts', 'the original final dependency set carries actual receiver identity for parent capture', 1),
)
# These checks protect the artifact surface; no runtime/test/transport budget is changed.
FORBIDDEN=re.compile(r'-----BEGIN [A-Z0-9 ]*(?:PRIVATE KEY|CERTIFICATE)|\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9_-]{16,})|\bBearer\s+[A-Za-z0-9._~+/-]{12,}',re.I)
RUNTIME_ERROR=re.compile(r'Unhandled\s+(?:Errors?|Rejections?)|Uncaught\s+Exception|\bErrors\s+[1-9]\d*\s+errors?\b|Worker exited unexpectedly|FATAL ERROR|ERR_WORKER_OUT_OF_MEMORY',re.I)
def check_public_bytes(data):
    return FORBIDDEN.search(data.decode('utf-8',errors='replace')) is None

def validate(raw,report_bytes,profile_bytes,process,repo):
    problems=[];repo=Path(repo).resolve()
    privacy=all(check_public_bytes(v) for v in [raw,report_bytes,profile_bytes])
    if not privacy:problems.append('artifact_secret_pattern_refused')
    text=raw.decode('utf-8',errors='replace')
    if RUNTIME_ERROR.search(text):problems.append('unhandled_or_runner_error')
    metrics=[];phases=[];starts=[]
    for line in text.splitlines():
        line=line.strip()
        m=re.fullmatch(r'population-publication-ms (\d+) (\d+)',line)
        if m:metrics.append((int(m[1]),int(m[2])))
        m=re.fullmatch(r'population-stage-phase (\d+) ([a-z-]+) elapsedMs=(\d+)',line)
        if m:phases.append((int(m[1]),m[2],int(m[3])))
        m=re.fullmatch(r'population-profile-start native-subjects=(\d+)',line)
        if m:starts.append(int(m[1]))
    if [v[0] for v in metrics]!=[0,1,2] or any(v[1]<=0 for v in metrics) or any(a[1]>b[1] for a,b in zip(metrics,metrics[1:])):problems.append('not_exactly_three_actual_publication_metrics')
    expected=['application','invocation','materials-prepare','materials-authorize','materials-stage','verification-prepare','verification-dispatch','publication']
    if [(s,p) for s,p,_ in phases]!=[(s,p) for s in range(3) for p in expected]:problems.append('stage_sequence_not_original_three')
    if len(starts)!=1 or starts[0]<=81:problems.append('profile_start_subject_population_missing')
    if 'population-final-set-start' in text:problems.append('unexpected_final_set_phase')
    try:
        report=json.loads(report_bytes)
        suites=report.get('testResults',[])
        if len(suites)!=1 or Path(suites[0].get('name','')).resolve()!=repo/TEST:problems.append('wrong_selected_file')
        assertions=[a for f in suites for a in f.get('assertionResults',[])]
        if len(assertions)!=23 or collections.Counter(a.get('status') for a in assertions)!=collections.Counter({'skipped':22,'failed':1}):problems.append('not_exact_23_assertions_22_filtered_1_failed')
        occurrences=collections.Counter();actual_slots=[]
        for suite in suites:
            suite_file=Path(suite.get('name','')).resolve()
            try:file=suite_file.relative_to(repo).as_posix()
            except ValueError:file=str(suite_file)
            for assertion in suite.get('assertionResults',[]):
                title=assertion.get('fullName')
                if not isinstance(title,str):raise ValueError('assertion_fullName_required')
                occurrences[(file,title)]+=1
                actual_slots.append((file,title,occurrences[(file,title)]))
        if collections.Counter(actual_slots)!=collections.Counter(EXPECTED_SLOTS):problems.append('frozen_23_file_title_occurrence_mismatch')
        if any(type(report.get(key)) is not int or report[key]!=expected for key,expected in [('numTotalTests',23),('numPendingTests',22),('numFailedTests',1),('numPassedTests',0),('numTodoTests',0)]):problems.append('not_exact_vitest_23_total_22_pending_1_failed_0_passed_0_todo')
        selected=[a for a in assertions if a.get('status')!='skipped']
        if len(selected)!=1 or selected[0].get('fullName')!=TITLE or selected[0].get('status')!='failed':problems.append('not_unique_expected_selected_failure')
        else:
            messages=selected[0].get('failureMessages',[])
            if len(messages)!=1 or messages[0].splitlines()[0].strip()!='Error: '+SENTINEL:problems.append('unexpected_failure_sentinel')
        if report.get('numFailedTests')!=1 or report.get('numPassedTests')!=0 or report.get('success') is not False:problems.append('unexpected_vitest_result_counts')
        if report.get('numRuntimeErrorTestSuites',0) not in (None,0):problems.append('runtime_error_suite')
        for name in ['unhandledErrors','errors']:
            if report.get(name):problems.append('report_extra_runtime_errors')
        for f in suites:
            if f.get('message'):problems.append('unexpected_suite_error_message')
    except (ValueError,TypeError,KeyError,IndexError):problems.append('invalid_or_missing_vitest_json')
    hotspots=[]
    try:
        profile=json.loads(profile_bytes);nodes=profile['nodes'];samples=profile['samples'];deltas=profile['timeDeltas'];byid={n['id']:n for n in nodes}
        if not samples or len(samples)!=len(deltas) or any(i not in byid for i in samples) or not profile['endTime']>profile['startTime']:problems.append('invalid_cpu_profile_samples')
        hits=collections.Counter(samples)
        for node in nodes:
            frame=node.get('callFrame',{});url=frame.get('url','');name=frame.get('functionName','')
            if not isinstance(url,str) or not isinstance(name,str):raise ValueError('frame')
            # Never upload a source/data URL, request URL, or URL credentials.
            if url.startswith(('data:','blob:','http:','https:')):privacy=False;problems.append('non_source_profile_url_refused');continue
            if url.startswith('file:'):
                parsed=urlparse(url)
                if parsed.netloc not in ('','localhost') or parsed.username or parsed.password:privacy=False;problems.append('profile_url_authority_refused');continue
                path=Path(unquote(parsed.path))
            elif url.startswith('/') :path=Path(url)
            elif not url or url.startswith('node:'):continue
            else:privacy=False;problems.append('unknown_profile_url_refused');continue
            try:relative=path.resolve().relative_to(repo)
            except ValueError:privacy=False;problems.append('profile_file_outside_checkout_refused');continue
            if relative.as_posix().startswith('src/runtime/') and name and hits[node['id']]:
                hotspots.append({'function':name,'source':relative.as_posix(),'line0':frame.get('lineNumber'),'selfSamples':hits[node['id']]})
        if not hotspots:problems.append('no_sampled_runtime_source_function')
    except (ValueError,TypeError,KeyError,IndexError):problems.append('invalid_cpu_profile_json')
    if process.get('samplingIntervalUsRequested')!=10000 or process.get('samplingIntervalObserved')is not True:problems.append('sampling_interval_not_observed')
    if process.get('rawVitestExit')!=1:problems.append('unexpected_raw_exit')
    if not all(process.get(k) is True for k in ['actualWait','leaderReaped','stdioClosed','groupGone','originalProfileAbsentBefore','profileOwnedAndStable','criticalSourcePinsMatch','trackedInputsUnchanged']):problems.append('physical_or_input_qualification_missing')
    if process.get('interrupted') or process.get('diagnosticBudgetExceeded') or process.get('cleanupSignalsSent') or process.get('rawOverflow'):problems.append('interrupted_budget_or_forced_cleanup')
    return {'kind':'THREE_PUBLICATION_WORKER_CPU_DIAGNOSTIC_ONLY','diagnosticQualified':not problems,'artifactPrivacySafe':privacy,'problems':sorted(set(problems)),'actualPublicationMetrics':[{'stage':s,'elapsedMs':ms} for s,ms in metrics],'sampledRuntimeHotspots':sorted(hotspots,key=lambda v:v['selfSamples'],reverse=True)[:30],'signed99WholePass':False,'finalSignedRpcExecuted':False,'rawVitestExit':process.get('rawVitestExit'),'filteredCasesAreNotNaturalSkips':True}
