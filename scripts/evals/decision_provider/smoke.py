"""Exercise the real isolated Service; all inputs below are synthetic."""
import argparse
from functools import partial
import socket
import json
import multiprocessing
from pathlib import Path
import threading
import time
from .decision_service import DecisionService,DecisionError,Question,Option,LAYA_REVISION,worker

QUESTIONS=(Question('is_refund','noul','Does the state explicitly request a refund?'),
 Question('route','choice','Choose the requested operation.',(Option('9','Return money'),Option('0','Ship goods'),Option('none','No operation'))),
 Question('strength','score','Degree of explicit refund intent, lowest to highest.',
          (Option('9','No refund request'),Option('0','Unclear refund intent'),Option('high','Explicit refund request')),'ascending'))

def offline_worker(conn,config,marker):
    def denied(*args,**kwargs):
        with open(marker,'a') as f:f.write('network_attempt\n')
        raise OSError('network_disabled_by_test')
    socket.socket.connect=denied
    socket.create_connection=denied
    worker(conn,config)

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--model-dir',required=True);ap.add_argument('--device',choices=['cpu','mps','cuda'],required=True);ap.add_argument('--out',required=True);ap.add_argument('--deny-network',action='store_true')
    args=ap.parse_args();out=Path(args.out)
    if out.exists():raise FileExistsError(out)
    marker=out.with_suffix('.network-attempts.txt')
    if marker.exists():raise FileExistsError(marker)
    target=partial(offline_worker,marker=str(marker)) if args.deny_network else worker
    result={'kind':'real_service_synthetic_contract_smoke_not_product_acceptance','device':args.device,'rows':[]}
    started=time.perf_counter()
    try:
        with DecisionService({'provider':'laya','model':LAYA_REVISION,'model_dir':str(Path(args.model_dir).resolve()),'device':args.device},_worker_target=target) as service:
            result['handshake']=service.prepare(timeout=90);result['prepareMs']=(time.perf_counter()-started)*1000
            for state in ['Please refund my purchase.','请退还我这笔订单的钱。','谢谢，问题已经解决。']:
                started=time.perf_counter();answer=service.evaluate(state,QUESTIONS,timeout=10)
                result['rows'].append({'state':state,'elapsedMs':(time.perf_counter()-started)*1000,'result':answer})
            pid=service.pid;cancel=threading.Event();timer=threading.Timer(.02,cancel.set);timer.start()
            try:
                service.evaluate('Please refund my purchase.',tuple(Question('q'+str(i),'noul','Is a refund explicitly requested?') for i in range(32)),timeout=10,cancel=cancel)
                result['cancel']='completed_before_cancel'
            except DecisionError as e:result['cancel']=e.code
            finally:timer.cancel()
            result['cancelledPidReaped']=pid not in [p.pid for p in multiprocessing.active_children()]
            result['statusAfterCancel']=service.state
        result['closedState']=service.state
        result['networkAttempts']=len(marker.read_text().splitlines()) if marker.exists() else (0 if args.deny_network else None)
        result['status']='complete' if result['cancel']=='cancelled' and result['cancelledPidReaped'] and result['networkAttempts'] in (0,None) else 'failed'
    except DecisionError as e:result['status']='failed';result['error']=e.code
    out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k not in ('rows','handshake')},ensure_ascii=False))
    if result['status']!='complete':raise SystemExit(1)

if __name__=='__main__':main()
