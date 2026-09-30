"""Full catalog through the unified Service; scalar calls, distinct from old batched probe."""
import argparse
import hashlib
import json
from pathlib import Path
import statistics
import time
from .decision_service import DecisionService,DecisionError,Question,LAYA_REVISION

INSTRUCTION=('The Document describes a tool capability. Judge whether that capability directly serves '
'an explicitly requested step in the Query. Judge the whole requested workflow, not only its '
'first step. Answer yes only when the request explicitly needs the capability; answer no when '
'it is unrelated, explicitly forbidden, or only an invented possible need.')

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--model-dir',required=True);ap.add_argument('--device',choices=['cpu','mps','cuda'],required=True)
    ap.add_argument('--fixtures',required=True);ap.add_argument('--out',required=True);args=ap.parse_args()
    out=Path(args.out)
    if out.exists():raise FileExistsError(out)
    data=json.loads(Path(args.fixtures).read_text())
    protocol={'version':'unified-service-scalar-noul-v1','fixtureHash':data['fixtureHash'],'fixtureFileSha256':hashlib.sha256(Path(args.fixtures).read_bytes()).hexdigest(),
      'prompt':INSTRUCTION,'batchSize':1,'threshold':.7,'thresholdStatus':'uncalibrated diagnostic','requestTimeoutSeconds':5,'catalogDeadlineSeconds':60,
      'productionBudget':'800ms not enforced; overruns reported','device':args.device,'modelRevision':LAYA_REVISION}
    out.parent.mkdir(parents=True,exist_ok=True);out.with_suffix('.protocol.json').write_text(json.dumps(protocol,indent=2)+'\n')
    report={'kind':'synthetic_real_service_catalog_not_P0_or_P1','protocol':protocol,'fixtureHash':data['fixtureHash'],'rows':[],'status':'running'}
    def save():out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    try:
        with DecisionService({'provider':'laya','model':LAYA_REVISION,'model_dir':str(Path(args.model_dir).resolve()),'device':args.device}) as service:
            start=time.perf_counter();report['handshake']=service.prepare(timeout=90);report['prepareMs']=(time.perf_counter()-start)*1000
            for case in data['cases']:
                start=time.perf_counter();deadline=time.monotonic()+60;scored=[]
                for tool in data['catalog']:
                    remaining=deadline-time.monotonic()
                    if remaining<=0:raise DecisionError('timeout')
                    state=json.dumps({'Query':case['query'],'Document':tool['name']+': '+tool['description']},ensure_ascii=False)
                    answer=service.evaluate(state,(Question('relevant','noul',INSTRUCTION),),timeout=min(5,remaining))
                    scored.append({'name':tool['name'],'score':answer['answers'][0]['probabilityYes']})
                elapsed=(time.perf_counter()-start)*1000
                scored.sort(key=lambda x:x['score'],reverse=True);selected=[x['name'] for x in scored if x['score']>=.7]
                report['rows'].append({**case,'scored':scored,'selected':selected,'elapsedMs':elapsed,'exactSet':sorted(selected)==sorted(case['expected'])})
                save();print(f"{len(report['rows'])}/{len(data['cases'])} {case['id']} {elapsed:.1f}ms",flush=True)
            report['status']='complete'
            times=[r['elapsedMs'] for r in report['rows']]
            report['summary']={'medianMs':statistics.median(times),'maxMs':max(times),'over800ms':sum(t>800 for t in times)}
    except DecisionError as e:report['status']='failed';report['error']=e.code
    finally:save()
    if report['status']!='complete':raise SystemExit(1)

if __name__=='__main__':main()
