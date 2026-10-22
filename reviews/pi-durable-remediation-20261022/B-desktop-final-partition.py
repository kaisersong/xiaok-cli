#!/usr/bin/env python3
"""Build a file-disjoint evidence summary; does not execute tests or delete files."""
import argparse
import collections
import hashlib
import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DEFAULT_EVIDENCE = REPO / '.xiaok/evals/pi-durable/remediation-20261022'
STATUS = {'passed': 'passed', 'failed': 'failed', 'skipped': 'skipped',
          'pending': 'skipped', 'todo': 'skipped'}
C9_FILES = {
    'tests/main/desktop-multi-agent-activity-factory.bdd.test.ts',
    'tests/main/desktop-multi-agent-activity-service.bdd.test.ts',
    'tests/main/desktop-multi-agent-activity-boundaries.bdd.test.ts',
    'tests/main/desktop-multi-agent-activity-admission.bdd.test.ts',
    'tests/main/desktop-multi-agent-mailbox.bdd.test.ts',
}
HOST_FILES = {
    'tests/main/loop-business-projection.test.ts',
    'tests/main/loop-business-projection-independent.test.ts',
    'tests/main/loop-output-consumers.test.ts',
    'tests/main/loop-published-artifacts.test.ts',
}
LOOP_FILE = 'tests/main/loop-verification-execution-controller.test.ts'


def load(path):
    return json.loads(path.read_text())


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def publication_text(text):
    # Archive-only serialization: all checks above use original evidence values.
    rendered = text.replace(str(REPO), '<worktree>').replace(str(Path.home()), '<local-user>')
    assert '/Users/' not in rendered, 'Unmapped user path in publication output'
    return rendered


def counts(statuses):
    c = collections.Counter(statuses)
    return {k: c[k] for k in ('passed', 'failed', 'skipped')}


def total(rows):
    return {k: sum(row['counts'][k] for row in rows)
            for k in ('passed', 'failed', 'skipped')}


def file_status(c):
    return 'failed' if c['failed'] else ('passed' if c['passed'] else 'skipped')


def successful_verbose(evidence, label):
    meta_path, log_path = evidence / (label + '.json'), evidence / (label + '.log')
    meta = load(meta_path)
    assert meta['exitCode'] == 0 and meta['reaped'] is True, label
    assert not any(x.startswith(('--testNamePattern', '-t=', '--exclude'))
                   or x == '-t' for x in meta['argv']), label
    text = re.sub(r'\x1b\[[0-9;]*m', '', log_path.read_text())
    by_file = collections.defaultdict(list)
    for line in text.splitlines():
        m = re.match(r'^\s*([\u2713\u00d7\u2193]) (tests/\S+) > ', line)
        if m:
            by_file[m[2]].append({'\u2713': 'passed', '\u00d7': 'failed',
                                  '\u2193': 'skipped'}[m[1]])
    summary = re.findall(r'^\s*Tests\s+(.+)$', text, re.MULTILINE)
    assert len(summary) == 1 and by_file, label
    wanted = {k: 0 for k in ('passed', 'failed', 'skipped')}
    for n, state in re.findall(r'(\d+) (passed|failed|skipped)', summary[0]):
        wanted[state] = int(n)
    rows = {p: {'path': p, 'counts': counts(s), 'resultLabel': label}
            for p, s in by_file.items()}
    assert total(rows.values()) == wanted and wanted['failed'] == 0, label
    return rows, {'label': label, 'runner': meta, 'rawLogSHA256': sha(log_path),
                  'runnerJSONSHA256': sha(meta_path), 'completeFileCount': len(rows),
                  'caseCounts': wanted}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--evidence-dir', type=Path, default=DEFAULT_EVIDENCE)
    ap.add_argument('--c9-label', required=True)
    ap.add_argument('--c9-min-label', required=True)
    ap.add_argument('--c9-manifest', type=Path, required=True)
    ap.add_argument('--output-stem', type=Path,
                    default=Path(__file__).with_suffix(''))
    args = ap.parse_args()
    e = args.evidence_dir.resolve()
    partition = load(e / 'B-desktop-full-v1-partition.json')
    raw_path = e / 'B-desktop-full-v1-results.json'
    raw, base_meta = load(raw_path), load(e / 'B-desktop-full-v1.json')
    assert base_meta['exitCode'] == 1 and base_meta['reaped'] is True
    rows, original_failures = {}, []
    for f in raw['testResults']:
        # Preserve the original JSON elsewhere; no passed assertion names here.
        path = str(Path(f['name']).relative_to(Path(base_meta['cwd'])))
        c = counts(STATUS[a['status']] for a in f['assertionResults'])
        # Suite/collection/afterAll failures must never become zero-case skips.
        assert f['assertionResults'], ('empty file population', path, f)
        assert f['status'] in ('passed', 'failed'), (path, f['status'])
        assert f['status'] != 'failed' or c['failed'] > 0, ('suite-only failure', path, f)
        rows[path] = {'path': path, 'counts': c, 'resultLabel': 'B-desktop-full-v1'}
        for a in f['assertionResults']:
            if a['status'] == 'failed':
                original_failures.append({'path': path, 'fullName': a['fullName'],
                                          'failureMessages': a['failureMessages']})
    assert len(rows) == 823 and set(rows) == set(partition['localFiles'])
    assert total(rows.values()) == {'passed': 10144, 'failed': 4, 'skipped': 8}
    assert len(original_failures) == 4
    sources = load(args.c9_manifest)['files']
    for f in sources:
        assert sha(REPO / f['path']) == f['sha256'], f['path']
    production = load(e / 'root-final-production-freeze.json')['files']
    host_audit = load(e / 'B10-host-ast-audit.json')
    production += [{'path': host_audit['file'], 'sha256': host_audit['newSHA256']}]
    for f in production:
        assert sha(REPO / f['path']) == f['sha256'], f['path']
    for path, expected in load(e / 'B-D6-results.json')['sourceSHA256'].items():
        assert sha(REPO / path) == expected, path
    for path, expected in load(e / 'B-loop-final-node24-analysis.json')['sourceInputs'].items():
        assert sha(REPO / path) == expected, path
    replacements, proofs, replaced = [], [], set()

    def replace(label, selected):
        available, proof = successful_verbose(e, label)
        assert selected <= set(available), (label, selected - set(available))
        if label == args.c9_label:
            assert set(available) == C9_FILES
        proofs.append(proof)
        for path in sorted(selected):
            assert path in rows and path not in replaced
            old, new = rows[path], available[path]
            replacements.append({'path': path, 'oldLabel': old['resultLabel'],
                                 'oldCounts': old['counts'], 'newLabel': label,
                                 'newCounts': new['counts']})
            rows[path] = new
            replaced.add(path)

    replace('B-D6-family-green', {'tests/main/desktop-post-seal-process.bdd.test.ts'})
    replace('root-activity-five-node24', {'tests/main/conversation-activity-store.test.ts'})
    replace('B-loop-payload-green', HOST_FILES)
    replace(args.c9_label, C9_FILES)
    c9_min, min_proof = successful_verbose(e, args.c9_min_label)
    assert set(c9_min) == C9_FILES  # Original native/API qualification skips remain.
    proofs.append(min_proof)
    forensic_proofs = []
    for label in (args.c9_label, args.c9_min_label):
        path = e / (label + '.forensics-cleanup.json')
        check = load(path)
        meta = load(e / (label + '.json'))
        assert check['ownedPid'] == meta['pid'] and check['ownedPgid'] == meta['pgid']
        assert check['reaped'] is True and check['groupMembers'] == []
        assert check['globalErrors'] == [] and check['signalsSent'] == [] and check['onlyExactRoots'] is True
        prefix = 'XIAOK_ACTIVITY_RETAINED_ROOT '
        raw_records = [json.loads(line[len(prefix):])
                       for line in (e / (label + '.log')).read_text().splitlines()
                       if line.startswith(prefix)]
        # Both genuine lease timing cases retain a journal in each version.
        # Empty/borrowed cleanup results cannot vouch for this run.
        assert len(raw_records) >= 2 and len(check['records']) >= 2
        canonical = lambda value: json.dumps(value, sort_keys=True, separators=(',', ':'))
        assert collections.Counter(map(canonical, raw_records)) == collections.Counter(
            canonical(item['record']) for item in check['records'])
        for item in check['records']:
            record = item['record']
            assert record['runToken'] == meta['activityForensicsRunToken']
            assert record['workerPpid'] == meta['pid']
            assert record['stat'] == item['verifiedStat']
        assert all(item['deleted'] is True for item in check['records'])
        forensic_proofs.append({'label': label, 'cleanupJSONSHA256': sha(path),
                                'verifiedDeletedRoots': len(check['records'])})
    loop, loop_proof = successful_verbose(e, 'B-loop-final-node24')
    assert set(loop) == {LOOP_FILE} and loop[LOOP_FILE]['counts'] == counts(['passed'] * 8)
    assert LOOP_FILE not in rows
    rows.update(loop)
    proofs.append(loop_proof)
    assert len(rows) == 824 and total(rows.values())['failed'] == 0
    qualified = set(partition['qualifiedFiles'])
    assert len(qualified) == 4 and not (qualified & set(rows))
    assert set(rows) | qualified == (set(partition['localFiles']) | qualified | {LOOP_FILE})
    drift = []
    for path, start in partition['sourceHashesAtStart'].items():
        current = sha(REPO / path) if (REPO / path).is_file() else None
        if current != start:
            drift.append({'path': path, 'fullRunStartSHA256': start,
                          'observedCurrentSHA256': current})
    expected_drift = {
        host_audit['file'], 'desktop/tests/fixtures/desktop-post-seal-owner.ts',
        'desktop/tests/fixtures/desktop-post-seal-passive-trace.ts',
        'desktop/tests/fixtures/multi-agent-activity-failure.ts',
        *('desktop/' + p for p in replaced), 'desktop/' + LOOP_FILE,
    }
    assert {item['path'] for item in drift} <= expected_drift
    for path, row in rows.items():
        row['sourceCoverageBasis'] = ('freshWholeFile' if path in replaced
                                     or path == LOOP_FILE else 'fullRunBehaviorReuse')
    out = {
        'status': 'LOCAL_PARTITION_COMPLETE_REMOTE_QUALIFICATION_PENDING',
        'generatorSHA256': sha(Path(__file__)),
        'publicationTransform': 'Final serialization replaces worktree/home paths only; original input values, raw SHA256 and evidence checks are unchanged',
        'filePopulation': {'current': 828, 'localActual': 824, 'remotePending': 4},
        'localCounts': total(rows.values()),
        'localFileCounts': counts(file_status(row['counts']) for row in rows.values()),
        'baseline': {'label': 'B-desktop-full-v1', 'files': 823,
                     'counts': {'passed': 10144, 'failed': 4, 'skipped': 8},
                     'rawLogSHA256': sha(e / 'B-desktop-full-v1.log'),
                     'fullJSONSHA256': sha(raw_path)},
        'qualifiedPending': {'files': sorted(qualified), 'originalCases': 128,
                             'originalSkipCount': 1, 'actualFinalExecutionClaimed': False},
        'originalFailuresPreserved': original_failures,
        'wholeFileReplacements': replacements, 'runEvidence': proofs,
        'c9ForensicsAfterActualReap': forensic_proofs,
        'minimumNodeC9ActualCounts': total(c9_min.values()),
        'currentProductionMatchesFrozenEight': production,
        'c9FinalSourceManifestSHA256': sha(args.c9_manifest),
        'c9FinalSourceFiles': sources,
        'observedCurrentDriftFromFullStart': drift,
        'sourceCoverage': {
            'notClaimed': '823 files executed on one final frozen source or a file start proves Vite cache refreshed',
            'actualHostScopeProof': 'B10-host-ast-audit.json: runtime imports and all other runtime functions/statements byte-identical; only trusted readUserTemplateOutput snapshot changes',
            'hostScopeProofSHA256': sha(e / 'B10-host-ast-audit.json'),
            'changedHostBehavior': 'Four complete sibling files65 plus actual signed8 Node24; siblings65 also Node22.22',
            'rootRuntimeClosure': 'A-root-desktop-8-final.json fresh8/331 replaces corresponding root partition; not added to Desktop totals',
            'minimumSignedLoop8': 'Actual Node22.22 CI matrix still pending; local Node24 result is not both versions',
            'currentHashes': 'Measured when generating summary, not retroactive run-start input attestations'},
        'files': [rows[p] for p in sorted(rows)],
    }
    args.output_stem.parent.mkdir(parents=True, exist_ok=True)
    args.output_stem.with_suffix('.json').write_text(publication_text(json.dumps(out, indent=2) + '\n'))
    c = out['localCounts']
    md = ['# Desktop final evidence partition', '',
          f"Local: 824 complete files, {c['passed']} passed / {c['failed']} failed / {c['skipped']} skipped cases.", '',
          'Population: 828 = 823 original local selection + 1 signed Loop file + 4 strict-recipe files pending actual qualified execution.', '',
          'The four pending files originally contain128 cases, including1 original skip. They are not claimed green or counted as local skips.', '',
          '| Whole-file replacement | Old P/F/S | Final P/F/S | Actual run |',
          '| --- | --- | --- | --- |']
    for item in replacements:
        fmt = lambda x: '/'.join(str(x[k]) for k in ('passed', 'failed', 'skipped'))
        md.append(f"| {item['path']} | {fmt(item['oldCounts'])} | {fmt(item['newCounts'])} | {item['newLabel']} |")
    md += ['', 'Loop8 is added once. Complete-file replacements remove the old whole-file counts first; no targeted result is added twice.', '',
           'Original four failures, all raw/JSON hashes, per-file counts, actual Node22.22 C9 skips, drift and source coverage limits are in the adjacent JSON.', '',
           'This is a combined evidence partition, not a claim that the original823 executed on one final source freeze. Other host runtime code is byte-identical by the recorded AST audit; its changed trusted-read path has fresh complete sibling65 and signed8 coverage. Root8 dependency closure is accounted by A separately.', '',
           'Lowest Node22.22 signed Loop8 still requires actual CI; this summary does not infer it from local Node24. Remote recipe128 remains pending.', '']
    args.output_stem.with_suffix('.md').write_text(publication_text('\n'.join(md)))
    print(json.dumps({'files': len(rows), 'cases': c, 'pendingQualifiedFiles': 4}))


if __name__ == '__main__':
    main()
