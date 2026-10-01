import copy
import json
import multiprocessing
import threading
import time
import unittest
from unittest.mock import patch
from scripts.evals.decision_provider.decision_service import (DecisionService, DecisionError, Question, Option,
    validate_request, encode_questions, decode_answers, parse_json, fetch_jev)

QUESTIONS = (Question('yes', 'noul', 'Is a refund requested?'),
    Question('route', 'choice', 'Select a route.', (Option('refund','Return money'),Option('none','No operation'))),
    Question('strength', 'score', 'Refund intent, low to high.', (Option('low','No intent'),Option('high','Explicit intent')), 'ascending'))
RAW = {'model':'jev-1.13.0', 'answers':{
 'q0':{'type':'noul','noul':.9},
 'q1':{'type':'choice','choice':'o0','probabilities':{'o1':.2,'o0':.8}},
 'q2':{'type':'score','score':.7,'legend':{'0':'No intent','1':'Explicit intent'},'probabilities':{'0':.3,'1':.7}}},
 'usage':{'input_tokens':12,'output_tokens':3}}

# A controlled external peer exercises real Service IPC/lifecycle; it does not reimplement validation.
def peer(conn, config):
    conn.send_bytes(json.dumps({'type':'ready','provider':'jev','modelRevision':'jev-1.13.0','runtime':{},'capabilities':['noul','choice','score']}).encode())
    try:
        while True:
            req=json.loads(conn.recv_bytes())
            if req['state']=='hang': time.sleep(60)
            if req['state']=='oversized': conn.send_bytes(b'x'*(1024*1024+1));continue
            if req['state']=='bad-id': req['id']='unrelated'
            conn.send_bytes(json.dumps({'type':'result','id':req['id'],'body':RAW}).encode())
    except (EOFError,BrokenPipeError): pass

class CodecTests(unittest.TestCase):
    def test_all_primitives_and_fixed_mapping(self):
        req=validate_request('Refund',QUESTIONS)
        encoded=encode_questions(req['questions'])
        self.assertEqual(list(encoded),['q0','q1','q2'])
        self.assertEqual(encoded['q1']['criteria'],{'o0':'Return money','o1':'No operation'})
        out=decode_answers(RAW,req['questions'],'jev','jev-1.13.0')
        self.assertEqual(out['answers'][0],{'id':'yes','type':'noul','probabilityYes':.9})
        self.assertEqual(out['answers'][1]['probabilities'],[{'id':'refund','p':.8},{'id':'none','p':.2}])
        self.assertEqual(out['answers'][2]['score'],.7)
        self.assertIsNone(out['calibrationId'])
    def test_unsupported_and_input_boundaries(self):
        for qs in [[Question('x','rank','Rank')], [Question('x','noul','?')]*2,
                   [Question('s','score','?',(Option('a','A'),Option('b','B')))],
                   [Question('c','choice','?',(Option('a','A'),Option('a','B')))]]:
            with self.subTest(qs=qs),self.assertRaises(DecisionError):validate_request('s',qs)
        with self.assertRaises(DecisionError):validate_request('x'*16001,QUESTIONS)
    def test_bad_outputs_rejected_atomically(self):
        mutations=[lambda d:d['answers'].pop('q0'),lambda d:d['answers'].update(extra={}),
            lambda d:d['answers']['q0'].update(noul=float('nan')),
            lambda d:d['answers']['q0'].update(noul=True),
            lambda d:d['answers']['q0'].update(type='score'),
            lambda d:d.update(model='jev-latest'),
            lambda d:d['answers']['q1']['probabilities'].update(o0=.9),
            lambda d:d['answers']['q1'].update(choice='o1'),
            lambda d:d['answers']['q2'].update(score=.1),
            lambda d:d['answers']['q2']['legend'].update({'0':'Wrong'})]
        for mutate in mutations:
            d=copy.deepcopy(RAW);mutate(d)
            with self.subTest(d=d),self.assertRaises(DecisionError):decode_answers(d,validate_request('s',QUESTIONS)['questions'],'jev','jev-1.13.0')
    def test_strict_json(self):
        for body in [b'{"x":1,"x":2}',b'{"x":NaN}',b'[]',b'\xff']:
            with self.assertRaises(DecisionError):parse_json(body)
    def test_laya_rounding_tolerance_is_bounded(self):
        qs=(Question('x','choice','Choose',(Option('a','A'),Option('b','B'),Option('c','C'))),)
        raw={'model':'laya-rl-agent','answers':{'q0':{'type':'choice','choice':'o0','probabilities':{'o0':.3333,'o1':.3333,'o2':.3333}}}}
        decode_answers(raw,validate_request('s',qs)['questions'],'laya','fixed')
        raw['answers']['q0']['probabilities']['o0']=.34
        with self.assertRaises(DecisionError):decode_answers(raw,validate_request('s',qs)['questions'],'laya','fixed')
    def test_jev_transport_does_not_follow_redirect_and_redacts(self):
        import urllib.error
        with patch('urllib.request.build_opener') as build:
            build.return_value.open.side_effect=urllib.error.HTTPError('https://api.typesafe.ai',302,'secret',{},None)
            with self.assertRaises(DecisionError) as err:fetch_jev({'state':'private','questions':{}},'jev-1.13.0','secret',1)
            self.assertEqual(str(err.exception),'remote_error')
            handler=build.call_args.args[0]
            self.assertIsNone(handler.redirect_request(None,None,302,'',{},'https://evil.test'))
            request=build.return_value.open.call_args.args[0]
            self.assertEqual(request.full_url,'https://api.typesafe.ai/v1/systemone')

class LifecycleTests(unittest.TestCase):
    def make(self):return DecisionService({'provider':'jev','model':'jev-1.13.0'},_worker_target=peer)
    def test_nonready_remote_authorization_and_close(self):
        with self.make() as s:
            with self.assertRaisesRegex(DecisionError,'unavailable'):s.evaluate('x',QUESTIONS)
            s.prepare()
            with self.assertRaisesRegex(DecisionError,'remote_not_authorized'):s.evaluate('x',QUESTIONS)
            self.assertEqual(s.evaluate('x',QUESTIONS,allow_remote=True)['answers'][0]['probabilityYes'],.9)
        with self.assertRaisesRegex(DecisionError,'closed'):s.prepare()
    def test_timeout_reaps_and_requires_explicit_prepare(self):
        with self.make() as s:
            s.prepare();pid=s.pid
            with self.assertRaisesRegex(DecisionError,'timeout'):s.evaluate('hang',QUESTIONS,allow_remote=True,timeout=.1)
            self.assertNotIn(pid,[p.pid for p in multiprocessing.active_children()])
            with self.assertRaisesRegex(DecisionError,'unavailable'):s.evaluate('x',QUESTIONS,allow_remote=True)
            s.prepare();self.assertEqual(s.evaluate('x',QUESTIONS,allow_remote=True)['usage']['inputTokens'],12)
    def test_cancel_reaps(self):
        with self.make() as s:
            s.prepare();pid=s.pid;cancel=threading.Event();timer=threading.Timer(.05,cancel.set);timer.start()
            try:
                with self.assertRaisesRegex(DecisionError,'cancelled'):s.evaluate('hang',QUESTIONS,allow_remote=True,cancel=cancel)
            finally:timer.cancel()
            self.assertNotIn(pid,[p.pid for p in multiprocessing.active_children()])
    def test_concurrent_busy_and_close_prevents_delivery(self):
        s=self.make();s.prepare();errors=[]
        def run():
            try:s.evaluate('hang',QUESTIONS,allow_remote=True)
            except DecisionError as e:errors.append(str(e))
        thread=threading.Thread(target=run);thread.start()
        deadline=time.monotonic()+1
        while not s.busy and time.monotonic()<deadline:time.sleep(.005)
        with self.assertRaisesRegex(DecisionError,'busy'):s.evaluate('x',QUESTIONS,allow_remote=True)
        s.close();thread.join(2);self.assertFalse(thread.is_alive());self.assertEqual(errors,['closed'])
    def test_bad_frames_reap(self):
        for state in ['bad-id','oversized']:
            with self.make() as s:
                s.prepare();pid=s.pid
                with self.assertRaises(DecisionError):s.evaluate(state,QUESTIONS,allow_remote=True)
                self.assertNotIn(pid,[p.pid for p in multiprocessing.active_children()])

def never_ready(conn,config):time.sleep(60)

def no_read(conn,config):
    conn.send_bytes(json.dumps({'type':'ready','provider':'jev','modelRevision':'jev-1.13.0','runtime':{},'capabilities':['noul']}).encode())
    time.sleep(60)

class AdversarialTests(unittest.TestCase):
    def test_untrusted_copy_methods_never_execute(self):
        marker=[]
        class Evil:
            def __deepcopy__(self,memo):marker.append(True);return {}
        with self.assertRaises(DecisionError):validate_request('s',[Evil()])
        with self.assertRaises(DecisionError):DecisionService(Evil())
        self.assertEqual(marker,[])
    def test_prepare_timeout_and_cancel(self):
        with DecisionService({'provider':'jev','model':'jev-1.13.0'},_worker_target=never_ready) as s:
            with self.assertRaisesRegex(DecisionError,'timeout'):s.prepare(timeout=.1)
            self.assertIsNone(s.pid)
            cancelled=threading.Event();cancelled.set()
            with self.assertRaisesRegex(DecisionError,'cancelled'):s.prepare(cancel=cancelled)
    def test_nonreading_peer_deadline_reaps_io_thread(self):
        with DecisionService({'provider':'jev','model':'jev-1.13.0'},_worker_target=no_read) as s:
            s.prepare();started=time.monotonic()
            with self.assertRaisesRegex(DecisionError,'timeout'):
                s.evaluate('x'*16000,tuple(Question('q'+str(i),'noul','y'*1000) for i in range(32)),allow_remote=True,timeout=.1)
            self.assertLess(time.monotonic()-started,3)
            self.assertIsNone(s.pid)
            self.assertFalse(any(t.name=='decision-provider-io' for t in threading.enumerate()))
    def test_windows_import_is_safe_but_runtime_is_unavailable(self):
        with patch('scripts.evals.decision_provider.decision_service.os.name','nt'):
            with self.assertRaisesRegex(DecisionError,'unsupported'):DecisionService({'provider':'jev','model':'jev-1.13.0'})
    def test_asset_manifest_rejects_extra_modified_and_symlink(self):
        import tempfile,hashlib
        from pathlib import Path
        from scripts.evals.decision_provider.decision_service import verify_assets
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);asset=root/'model.safetensors';asset.write_bytes(b'fixed')
            manifest={'modelRevision':'fixed','assets':{'model.safetensors':{'bytes':5,'sha256':hashlib.sha256(b'fixed').hexdigest()}}}
            config={'model_dir':directory,'model':'fixed'}
            with patch('scripts.evals.decision_provider.decision_service.asset_manifest',return_value=manifest):
                verify_assets(config)
                (root/'unexpected.py').write_text('bad')
                with self.assertRaisesRegex(DecisionError,'asset_mismatch'):verify_assets(config)
                (root/'unexpected.py').unlink();asset.write_bytes(b'other')
                with self.assertRaisesRegex(DecisionError,'asset_mismatch'):verify_assets(config)
                asset.unlink();asset.symlink_to(root/'missing')
                with self.assertRaisesRegex(DecisionError,'asset_mismatch'):verify_assets(config)

class FixtureBackend:
    def __init__(self,config):self.runtime={'fixture':'trusted-test-only'}
    def evaluate(self,state,questions):
        if state=='nan':
            raw=copy.deepcopy(RAW);raw['answers']['q0']['noul']=float('nan');return raw
        if state.startswith(('descendant:','orphan:')):
            import subprocess,sys
            from pathlib import Path
            child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)'])
            Path(state.split(':',1)[1]).write_text(str(child.pid))
            if state.startswith('orphan:'):
                import os
                os._exit(0)
            time.sleep(60)
        return RAW

def fixture_worker(conn,config):
    from scripts.evals.decision_provider.decision_service import worker
    worker(conn,config,backend_factory=FixtureBackend)

class RealWorkerTests(unittest.TestCase):
    def test_real_worker_loop_and_nan_close(self):
        with DecisionService({'provider':'jev','model':'jev-1.13.0'},_worker_target=fixture_worker) as s:
            s.prepare();self.assertEqual(s.evaluate('ok',QUESTIONS,allow_remote=True)['answers'][0]['probabilityYes'],.9)
            pid=s.pid
            with self.assertRaisesRegex(DecisionError,'invalid_response'):s.evaluate('nan',QUESTIONS,allow_remote=True)
            self.assertIsNone(s.pid)
            self.assertNotIn(pid,[p.pid for p in multiprocessing.active_children()])
    def test_process_group_descendant_cancel(self):
        import os,tempfile,subprocess
        from pathlib import Path
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'pid'
            with DecisionService({'provider':'jev','model':'jev-1.13.0'},_worker_target=fixture_worker) as s:
                s.prepare();cancel=threading.Event()
                def cancel_after_child_starts():
                    deadline=time.monotonic()+3
                    while not path.exists() and time.monotonic()<deadline:time.sleep(.01)
                    cancel.set()
                thread=threading.Thread(target=cancel_after_child_starts);thread.start()
                with self.assertRaisesRegex(DecisionError,'cancelled'):s.evaluate('descendant:'+str(path),QUESTIONS,allow_remote=True,cancel=cancel)
                thread.join();self.assertTrue(path.exists());pid=int(path.read_text())
                deadline=time.monotonic()+2
                while time.monotonic()<deadline:
                    status=subprocess.run(['ps','-o','stat=','-p',str(pid)],capture_output=True,text=True).stdout.strip()
                    if not status or status.startswith('Z'):break
                    time.sleep(.02)
                self.assertTrue(not status or status.startswith('Z'),status)
    def test_prepare_deadline_includes_cleanup(self):
        with DecisionService({'provider':'jev','model':'jev-1.13.0'},_worker_target=peer) as s:
            original=s._stop
            def slow_cleanup():original();time.sleep(.03)
            with patch.object(s,'_stop',side_effect=slow_cleanup):
                with self.assertRaisesRegex(DecisionError,'timeout'):s.prepare(timeout=.01)
            self.assertIsNone(s.pid)
    def test_failed_cleanup_poisoned_and_other_cleanup_attempted(self):
        from unittest.mock import Mock
        s=DecisionService({'provider':'jev','model':'jev-1.13.0'},_worker_target=peer)
        process=Mock();process.pid=None;process.close.side_effect=OSError('failure')
        connection=Mock();s._process=process;s._conn=connection
        with self.assertRaisesRegex(DecisionError,'cleanup_failed'):s._stop()
        connection.close.assert_called_once()
        with self.assertRaisesRegex(DecisionError,'cleanup_failed'):s.prepare()
        with self.assertRaisesRegex(DecisionError,'cleanup_failed'):s.evaluate('x',QUESTIONS)
        s._process=None;s.close()
    def test_fixed_jev_version(self):
        with self.assertRaisesRegex(DecisionError,'invalid_input'):DecisionService({'provider':'jev','model':'jev-9.9.9'})
    def test_asset_toctou_rejected_after_copy(self):
        import tempfile,hashlib
        from pathlib import Path
        from scripts.evals.decision_provider.decision_service import stage_assets,verify_assets
        with tempfile.TemporaryDirectory() as source,tempfile.TemporaryDirectory() as dest:
            asset=Path(source)/'model.safetensors';asset.write_bytes(b'fixed')
            manifest={'modelRevision':'fixed','assets':{'model.safetensors':{'bytes':5,'sha256':hashlib.sha256(b'fixed').hexdigest()}}}
            config={'model_dir':source,'model':'fixed','_staging':dest}
            def replace_after_check(c):
                result=verify_assets(c);asset.write_bytes(b'other');return result
            with patch('scripts.evals.decision_provider.decision_service.asset_manifest',return_value=manifest),patch('scripts.evals.decision_provider.decision_service.verify_assets',side_effect=replace_after_check):
                with self.assertRaisesRegex(DecisionError,'asset_mismatch'):stage_assets(config)
    def test_dependencies_fail_before_importing_model(self):
        from scripts.evals.decision_provider.decision_service import LayaBackend
        manifest={'runtimes':{'cpu':{'transformers':'required-version'}}}
        with patch('scripts.evals.decision_provider.decision_service.stage_assets',return_value=({'device':'cpu'},manifest)),patch('importlib.metadata.version',return_value='0.3.20'):
            with self.assertRaisesRegex(DecisionError,'runtime_mismatch'):LayaBackend({'device':'cpu'})

class FinalBoundaryTests(unittest.TestCase):
    def test_deadline_starts_before_operation_acquisition(self):
        with DecisionService({'provider':'jev','model':'jev-1.13.0'},_worker_target=peer) as s:
            s.prepare();acquire=s._acquire
            def delayed():acquire();time.sleep(.03)
            with patch.object(s,'_acquire',side_effect=delayed):
                with self.assertRaisesRegex(DecisionError,'timeout'):s.evaluate('x',QUESTIONS,allow_remote=True,timeout=.01)
    def test_io_start_failure_cleanup_and_poisoned_join_failure(self):
        import tempfile
        from pathlib import Path
        from unittest.mock import Mock
        with DecisionService({'provider':'jev','model':'jev-1.13.0'},_worker_target=peer) as s:
            s.prepare()
            with patch('threading.Thread.start',side_effect=RuntimeError('no thread')):
                with self.assertRaisesRegex(DecisionError,'worker_error'):s.evaluate('x',QUESTIONS,allow_remote=True)
            self.assertIsNone(s.pid);self.assertIsNone(s._io)
            s._staging=tempfile.mkdtemp();staging=Path(s._staging)
            bad=Mock();bad.ident=1;bad.join.side_effect=RuntimeError('join failure');s._io=bad
            with self.assertRaisesRegex(DecisionError,'cleanup_failed'):s._stop()
            self.assertFalse(staging.exists())
            with self.assertRaisesRegex(DecisionError,'cleanup_failed'):s.prepare()
            s._io=None
    def test_orphan_group_after_leader_exit(self):
        import tempfile,subprocess,os,signal
        from pathlib import Path
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'pid'
            with DecisionService({'provider':'jev','model':'jev-1.13.0'},_worker_target=fixture_worker) as s:
                s.prepare()
                with self.assertRaises(DecisionError):s.evaluate('orphan:'+str(path),QUESTIONS,allow_remote=True)
                self.assertTrue(path.exists());pid=int(path.read_text())
                try:
                    deadline=time.monotonic()+2
                    while time.monotonic()<deadline:
                        status=subprocess.run(['ps','-o','stat=','-p',str(pid)],capture_output=True,text=True).stdout.strip()
                        if not status or status.startswith('Z'):break
                        time.sleep(.02)
                    self.assertTrue(not status or status.startswith('Z'),status)
                finally:
                    try:os.kill(pid,signal.SIGKILL)
                    except ProcessLookupError:pass
    def test_precision_contract_all_fields(self):
        from types import SimpleNamespace
        from scripts.evals.decision_provider.decision_service import LayaBackend
        b=object.__new__(LayaBackend);b.device='mps'
        parameter=SimpleNamespace(dtype='torch.float32',device=SimpleNamespace(type='mps'))
        b.agent=SimpleNamespace(model=SimpleNamespace(parameters=lambda:iter([parameter])),device=SimpleNamespace(type='mps'),dtype='torch.float16',amp_enabled=True,mps_amp_min_rows=5)
        b.precision_contract={'device':'mps','parameterDevice':'mps','parameterDtype':'torch.float32','configuredDtype':'torch.float16','ampEnabled':True,'mpsAmpMinRows':5}
        b._assert_precision()
        for obj,field,value in [(parameter,'dtype','torch.float16'),(parameter.device,'type','cpu'),(b.agent,'mps_amp_min_rows',6),(b.agent,'amp_enabled',False),(b.agent,'dtype','torch.float32')]:
            old=getattr(obj,field);setattr(obj,field,value)
            with self.assertRaisesRegex(DecisionError,'runtime_mismatch'):b._assert_precision()
            setattr(obj,field,old)
    def test_question_fields_snapshotted_once(self):
        counts={};original=Question.__getattribute__
        def read(obj,key):
            if key in ('id','type','instructions','options','direction'):counts[key]=counts.get(key,0)+1
            return original(obj,key)
        with patch.object(Question,'__getattribute__',read):validate_request('state',(Question('q','noul','Question?'),))
        self.assertEqual(counts,dict.fromkeys(('id','type','instructions','options','direction'),1))

class CleanupOwnershipTests(unittest.TestCase):
    def test_dead_process_close_failure_still_removes_staging(self):
        import tempfile
        from pathlib import Path
        from unittest.mock import Mock
        s=DecisionService({'provider':'jev','model':'jev-1.13.0'},_worker_target=peer)
        p=Mock();p.pid=123;p.is_alive.return_value=False;p.close.side_effect=OSError('close failed')
        s._process=p;s._worker_dead=False;s._staging=tempfile.mkdtemp();directory=Path(s._staging)
        with self.assertRaisesRegex(DecisionError,'cleanup_failed'):s._stop()
        self.assertFalse(directory.exists());self.assertTrue(s._worker_dead)
        p.join.assert_called();s._process=None;s.close()
    def test_cleanup_steps_continue_and_old_group_is_never_signalled_twice(self):
        from unittest.mock import Mock
        s=DecisionService({'provider':'jev','model':'jev-1.13.0'},_worker_target=peer)
        p=Mock();p.pid=123;p.is_alive.side_effect=[True,True,False];p.terminate.side_effect=OSError('failed');p.join.side_effect=OSError('join failed')
        s._process=p;s._pgid=123;s._worker_dead=False
        conn=Mock();conn.close.side_effect=OSError('connection close failed');s._conn=conn
        with patch('scripts.evals.decision_provider.decision_service.os.killpg') as killpg:
            with self.assertRaisesRegex(DecisionError,'cleanup_failed'):s._stop()
            self.assertEqual(killpg.call_count,2);p.kill.assert_called_once();p.close.assert_called_once()
            self.assertIsNone(s._pgid)
            s._conn=None;s.close()
            self.assertEqual(killpg.call_count,2)
    def test_direction_and_cancel_objects_do_not_execute_methods(self):
        marker=[]
        class Evil:
            def __eq__(self,other):marker.append('eq');return True
            def is_set(self):marker.append('cancel');return False
        question=Question('q','score','?',(Option('a','A'),Option('b','B')),Evil())
        with self.assertRaises(DecisionError):validate_request('s',(question,))
        with DecisionService({'provider':'jev','model':'jev-1.13.0'},_worker_target=peer) as s:
            with self.assertRaises(DecisionError):s.prepare(cancel=Evil())
        self.assertEqual(marker,[])

class LivenessFailureTests(unittest.TestCase):
    def test_each_liveness_error_keeps_cleanup_and_monotonic_death_fact(self):
        from unittest.mock import Mock
        from pathlib import Path
        import tempfile
        for sequence in ([OSError('first'),True,False],[True,OSError('second'),False],[True,False,OSError('last')]):
            with self.subTest(sequence=sequence):
                s=DecisionService({'provider':'jev','model':'jev-1.13.0'},_worker_target=peer)
                p=Mock();p.pid=123;p.is_alive.side_effect=sequence;s._process=p;s._worker_dead=False
                s._staging=tempfile.mkdtemp();directory=Path(s._staging)
                with self.assertRaisesRegex(DecisionError,'cleanup_failed'):s._stop()
                p.terminate.assert_called_once();p.close.assert_called_once()
                if sequence[1] is not False:p.kill.assert_called_once()
                self.assertTrue(s._worker_dead);self.assertFalse(directory.exists());s.close()
    def test_unknown_liveness_still_attempts_kill_and_stays_poisoned(self):
        from unittest.mock import Mock
        import tempfile
        from pathlib import Path
        s=DecisionService({'provider':'jev','model':'jev-1.13.0'},_worker_target=peer)
        p=Mock();p.pid=123;p.is_alive.side_effect=OSError('unknown');s._process=p;s._worker_dead=False
        s._staging=tempfile.mkdtemp();directory=Path(s._staging)
        with self.assertRaisesRegex(DecisionError,'cleanup_failed'):s._stop()
        p.terminate.assert_called_once();p.kill.assert_called_once();self.assertFalse(s._worker_dead)
        self.assertTrue(directory.exists())
        with self.assertRaisesRegex(DecisionError,'cleanup_failed'):s.prepare()
        s._process=None;s.close();self.assertFalse(directory.exists())

if __name__=='__main__':unittest.main()
