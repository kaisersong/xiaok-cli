#!/usr/bin/env python3
"""Isolated, synthetic Laya feasibility probe. Does not implement the product service."""
from __future__ import annotations
import argparse, hashlib, importlib.metadata, json, math, os, platform, resource, statistics, time
from pathlib import Path

REVISION = 'e4e9ddf21a7b1903b7acffd8814ad4307bf63a67'
INSTRUCTION = ('The Document describes a tool capability. Judge whether that capability directly serves '
    'an explicitly requested step in the Query. Judge the whole requested workflow, not only its '
    'first step. Answer yes only when the request explicitly needs the capability; answer no when '
    'it is unrelated, explicitly forbidden, or only an invented possible need.')
QUESTION = {'relevant': {'type': 'noul', 'instructions': INSTRUCTION}}

def digest(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1024 * 1024), b''): h.update(b)
    return h.hexdigest()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', required=True)
    ap.add_argument('--fixtures', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--device', choices=['mps', 'cuda', 'cpu'], required=True)
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--prepare-only', action='store_true')
    args = ap.parse_args()
    fixtures = json.loads(Path(args.fixtures).read_text())
    out = Path(args.out)
    if out.exists(): raise FileExistsError(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    protocol = {'version': 'laya-catalog-noul-v1', 'fixtureHash': fixtures['fixtureHash'],
        'fixtureFileSha256': digest(args.fixtures), 'scriptSha256': digest(__file__),
        'modelRevision': REVISION, 'instruction': INSTRUCTION,
        'questions': QUESTION, 'state': 'JSON object: Query=query, Document=name + colon + description',
        'batchSize': 5, 'maxLen': 1024, 'headMaxLen': 256,
        'threshold': 0.7, 'thresholdStatus': 'uncalibrated historical diagnostic only',
        'candidateStrategy': 'all 45 in stored order; stable descending score sort',
        'warmup': 'one three-primitive schema probe before catalog; no tuning',
        'failures': 'stop at first error and retain completed rows; no retry',
        'limit': args.limit, 'deviceRequested': args.device,
        'dependencyVersions': {n: importlib.metadata.version(n) for n in
             ['laya', 'torch', 'transformers', 'huggingface_hub', 'safetensors']}}
    protocol_path = out.with_suffix('.protocol.json')
    if protocol_path.exists(): raise FileExistsError(protocol_path)
    protocol_path.write_text(json.dumps(protocol, ensure_ascii=False, indent=2)+'\n')
    if args.prepare_only: return
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    import torch
    from laya import Agent
    torch.manual_seed(0)
    torch.set_num_threads(4)
    assets = {str(p.relative_to(args.model)): {'sha256': digest(p), 'bytes': p.stat().st_size}
        for p in Path(args.model).rglob('*') if p.is_file() and '.cache' not in p.parts}
    report = {'kind': 'synthetic_model_library_probe_not_P0_or_product_service', 'protocol': protocol,
        'createdAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'hardware': {'platform': platform.platform(), 'machine': platform.machine()},
        'modelAssetsBeforeLoad': assets, 'catalogSize': len(fixtures['catalog']),
        'fixtureHash': fixtures['fixtureHash'], 'rows': [], 'status': 'running',
        'networkDuringInference': 'offline library flags; not packet-capture verified',
        'energy': 'unmeasured', 'product800msDeadline': 'not enforced; overruns reported'}
    def save(): out.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    try:
        start = time.perf_counter()
        agent = Agent(args.model, device=args.device, compile=False, fast=False)
        report['loadMs'] = (time.perf_counter()-start)*1000
        if agent.device.type != args.device: raise RuntimeError('device fallback during load')
        # Observe actual forwards, including library-scoped CPU/OOM retries.
        forwards = []
        def observe(module, inputs):
            forwards.append({'device': str(next(module.parameters()).device),
                             'dtype': str(agent.dtype), 'ampEnabled': agent.amp_enabled})
        hook = agent.model.register_forward_pre_hook(observe)
        def no_truncation(states, questions):
            ids = list(questions)
            internal = {k: agent._to_internal(v) for k,v in questions.items()}
            lengths = []
            for st in states:
                small = agent._encode_state(st, ids, internal, max_len=1024, head_max_len=256)
                full = agent._encode_state(st, ids, internal, max_len=8192, head_max_len=2048)
                if small != full: raise ValueError('input truncation detected')
                lengths.extend(len(i['ids']) for i in small)
            return lengths
        smoke_questions = {
            'n': {'type':'noul','instructions':'The ticket explicitly requests a refund.'},
            'c': {'type':'choice','instructions':'Choose the requested operation.',
                  'criteria':{'refund':'Return money','delivery':'Ship goods','none':'Neither'}},
            's': {'type':'score','instructions':'Degree of explicit refund intent, from low to high.',
                  'criteria':['No refund request','Unclear refund intent','Explicit refund request']}}
        smoke_state = 'Please refund my purchase.'
        no_truncation([smoke_state], smoke_questions)
        smoke = agent.predict(smoke_state, smoke_questions, max_len=1024, head_max_len=256)
        for k,q in smoke_questions.items():
            ans = smoke['answers'][k]
            assert ans['type'] == q['type']
            if q['type']=='noul': assert math.isfinite(ans['noul']) and 0<=ans['noul']<=1
            else:
                probs=ans['probabilities']; vals=list(probs.values())
                assert all(math.isfinite(v) and 0<=v<=1 for v in vals)
                assert abs(sum(vals)-1)<=len(vals)*0.00005+1e-6
        report['primitiveSchemaSmoke'] = smoke
        report['primitiveSchemaSmokeScope'] = 'one English input; not quality or service contract acceptance'
        cases = fixtures['cases'][:args.limit] if args.limit else fixtures['cases']
        for case in cases:
            t=time.perf_counter()
            states=[{'Query':case['query'], 'Document':f"{e['name']}: {e['description']}"}
                    for e in fixtures['catalog']]
            lengths=no_truncation(states, QUESTION)
            answers=agent.predict_batch(states, QUESTION, batch_size=5, max_len=1024, head_max_len=256)
            assert len(answers)==len(states)
            scored=[]
            for entry,res in zip(fixtures['catalog'],answers):
                assert set(res['answers'])=={'relevant'}
                ans=res['answers']['relevant']; value=ans['noul']
                assert ans['type']=='noul' and math.isfinite(value) and 0<=value<=1
                scored.append({'name':entry['name'], 'score':value})
            elapsed=(time.perf_counter()-t)*1000
            if any(f['device'].split(':')[0]!=args.device for f in forwards):
                raise RuntimeError('device fallback during inference')
            scored.sort(key=lambda x:x['score'],reverse=True)
            selected=[x['name'] for x in scored if x['score']>=0.7]
            row={**case,'scored':scored,'selected':selected,'exactSet':sorted(selected)==sorted(case['expected']),
                 'elapsedMs':elapsed,'over800ms':elapsed>800,'tokenLengthMax':max(lengths),'raw':answers}
            report['rows'].append(row);save()
            print(f"{len(report['rows'])}/{len(cases)} {case['id']} {elapsed:.1f}ms",flush=True)
        times=[r['elapsedMs'] for r in report['rows']]
        report['summary']={'total':len(times),'elapsedMsMedian':statistics.median(times),
            'elapsedMsP95NearestRank':sorted(times)[math.ceil(.95*len(times))-1],
            'elapsedMsMax':max(times),'over800ms':sum(t>800 for t in times)}
        report['forwardRuntimeConfigurations']=[dict(t) for t in sorted({tuple(sorted(f.items())) for f in forwards})]
        report['forwardCount']=len(forwards)
        report['peakRssBytes']=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*(1 if platform.system()=='Darwin' else 1024)
        report['modelAssetsAfterLoad']={str(p.relative_to(args.model)):digest(p) for p in Path(args.model).rglob('*') if p.is_file() and '.cache' not in p.parts}
        report['status']='complete'; hook.remove();save()
    except BaseException as e:
        report['status']='failed'; report['error']=f'{type(e).__name__}: {e}';save();raise

if __name__=='__main__':main()
