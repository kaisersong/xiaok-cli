export const DECISION_MODEL_PYTHON = `import sys,json,hashlib,importlib.util,importlib.metadata,threading,os
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
model_path=Path(sys.argv[1]);expected=sys.argv[2];token=os.environ.pop('XIAOK_DECISION_HTTP_TOKEN');kind=sys.argv[4];package=json.loads(sys.argv[5])
# A fresh lookup prefix excludes pre-existing bytecode from audited source imports.
# -B keeps this nonce directory unwritten.
sys.pycache_prefix=str(model_path.parent/'.runtime'/('pycache-'+token))
def fail(reason):
 print('XIAOK_ERROR '+reason,flush=True);sys.exit(1)
def offline(event,args):
 if event=='socket.connect' and isinstance(args[1],tuple) and args[1][0] not in ('127.0.0.1','localhost','::1'):raise RuntimeError('offline_runtime')
sys.addaudithook(offline)
versions={}
requirements=[('mlx','0.32.'),('mlx-lm','0.32.'),('mlx-vlm','0.7.')] if kind=='clef-mlx' else [('laya','0.3.28'),('torch',None),('transformers',None)]
for name,series in requirements:
 try:version=importlib.metadata.version(name)
 except importlib.metadata.PackageNotFoundError:fail('runtime_missing')
 if series and (version!=series if name=='laya' else not version.startswith(series)):fail('runtime_version')
 versions[name]=version
try:
 if kind=='clef-mlx':
  source=model_path/'clef_mlx.py'
  if source.is_symlink() or hashlib.sha256(source.read_bytes()).hexdigest()!=expected:fail('hash_mismatch')
  spec=importlib.util.spec_from_file_location('xiaok_clef_mlx',source)
  module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
  model=module.load(model_path,backend='vlm')
  device='metal';precision='mixed-4bit-bf16';quantization='affine-4bit-group64';engine='mlx-vlm'
  def predict(request):return model.systemone(request,max_length=8192,truncate=False)
 else:
  if package.get('version')!='0.3.28' or package.get('wheelSha256')!=expected:fail('runtime_version')
  dist=importlib.metadata.distribution('laya');source_root=Path(dist.locate_file('laya'))
  for relative,want in package['files'].items():
   source=source_root/relative
   if source.is_symlink() or hashlib.sha256(source.read_bytes()).hexdigest()!=want:fail('hash_mismatch')
  import torch
  import laya.agent as agent_module
  from transformers import PreTrainedTokenizerFast
  # Apply the audited library's compatibility conversion in memory. Keep the
  # frozen tokenizer manifest intact; the library normally rewrites its file.
  def local_tokenizer(directory,cfg):
   directory=Path(directory)
   cfg=json.loads((directory/'tokenizer_config.json').read_text())
   if cfg.get('tokenizer_class') in (None,'TokenizersBackend'):cfg['tokenizer_class']='PreTrainedTokenizerFast';cfg.pop('backend',None);cfg.pop('is_local',None)
   if isinstance(cfg.get('extra_special_tokens'),list):cfg['extra_special_tokens']={'extra_%d'%i:t for i,t in enumerate(cfg['extra_special_tokens'])}
   cfg.pop('tokenizer_class',None)
   return PreTrainedTokenizerFast(tokenizer_file=str(directory/'tokenizer.json'),**cfg)
  agent_module._fix_tokenizer_config=lambda path:None
  agent_module._load_tokenizer=local_tokenizer
  model=agent_module.Agent(str(model_path),device='mps' if torch.backends.mps.is_available() else 'cpu',backend='eager')
  device=str(model.device);precision=str(next(model.model.parameters()).dtype).replace('torch.','');quantization='none';engine='torch-eager'
  def predict(request):
   result=model.system_one(request['state'],request['questions'],max_len=8192)
   if result.get('usage',{}).get('truncated') or result.get('usage',{}).get('options'):raise ValueError('context_budget')
   return result
 health=predict({'model':'xiaok-runtime-health','state':'Synthetic runtime health check.','questions':{'health':{'type':'noul','instructions':'Does this state contain text?'}}})
 if not isinstance(health.get('answers',{}).get('health',{}).get('noul'),(float,int)):fail('runtime_failed')
except Exception:fail('runtime_failed')
info={'implementation':'xiaok-local-text-v2','engine':engine,'device':device,'parameterPrecision':precision,'quantization':quantization,'versions':versions}
def observation():
 result=dict(info);result['peakRssBytes']=None;result['peakGpuAllocatedBytes']=None
 try:
  import resource
  result['peakRssBytes']=int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)*(1 if sys.platform=='darwin' else 1024)
 except Exception:pass
 if kind=='clef-mlx':
  try:
   import mlx.core as mx
   result['peakGpuAllocatedBytes']=int(mx.get_peak_memory())
  except Exception:pass
 return result
lock=threading.Lock()
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def send(self,status,data):
  body=json.dumps(data).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
 def do_GET(self):
  if self.path!='/health' or self.headers.get('X-Xiaok-Decision-Token')!=token:return self.send(403,{})
  return self.send(200,{'ready':True,'runtime':observation()})
 def do_POST(self):
  self.connection.settimeout(30)
  if self.path!='/v1/systemone' or self.headers.get('X-Xiaok-Decision-Token')!=token:return self.send(403,{})
  try:
   n=int(self.headers.get('Content-Length','0'))
   if n<1 or n>16000:return self.send(413,{})
   request=json.loads(self.rfile.read(n))
   if not isinstance(request,dict) or set(request)-{'model','state','questions'} or 'state' not in request or 'questions' not in request:return self.send(422,{})
   with lock:result=predict(request)
   result['runtime']=observation()
   return self.send(200,result)
  except Exception:return self.send(503,{})
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.daemon_threads=True
def watch_parent():
 try:sys.stdin.buffer.read()
 finally:os._exit(0)
threading.Thread(target=watch_parent,daemon=True).start()
print('XIAOK_READY '+json.dumps({'port':server.server_port}),flush=True)
server.serve_forever()
`;
