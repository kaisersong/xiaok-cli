"""Small static Kimi k3 bundles. No yolo/auto, no tool grants, owned PID only."""
from pathlib import Path
import subprocess,hashlib,json,time,signal,os,tempfile,sys
repo=Path(__file__).resolve().parents[2]
root=Path(tempfile.mkdtemp(prefix='assistant-readonly-kimi-'))
(root/'empty-skills').mkdir()
author='Codex GPT-6'
files=['desktop/electron/desktop-readonly-audit.ts','desktop/electron/desktop-services.ts','desktop/electron/desktop-multi-agent-capabilities.ts','desktop/electron/desktop-multi-agent-catalog-bridge.ts','desktop/electron/desktop-multi-agent-runtime.ts','desktop/electron/connectors-service.ts','desktop/tests/main/desktop-readonly-audit.test.ts']
sources={f:(repo/f).read_bytes() for f in files}
manifest={'author':author,'requestedReviewer':'kimi-code/k3','head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),'state':'working_tree_hashes_not_committed','files':{f:hashlib.sha256(b).hexdigest() for f,b in sources.items()}}
def full(f):
 data=(repo/f).read_text().splitlines()
 return '\nFILE '+f+'\n'+'\n'.join(f'{i+1}: {line}' for i,line in enumerate(data))+'\n'
def part(f,start,end,after=0):
 data=(repo/f).read_text().splitlines();a=next(i for i,line in enumerate(data) if start in line);b=next((i for i in range(a+1,len(data)) if end and end in data[i]),len(data)) if end else min(a+after,len(data))
 return '\nFILE '+f+'\n'+'\n'.join(f'{i+1}: {data[i]}' for i in range(a,b))+'\n'
bundle_a=full(files[0])+full('src/ai/tools/native-tool-identity.ts')+part('src/ai/tools/index.ts','  private admitsNativeReadonly','  private executionBoundaryUsed')+part('src/ai/tools/index.ts','  constructor(options: ToolRegistryOptions','  /** Main/CLI bootstrap')+part(files[3],'  private bind(tool:',None,25)+part(files[2],'  createScopedRegistry(', '  private issuePolicy(')
bundle_b=''
for start,end,n in [('export interface DesktopServicesOptions {','  /** Main owns',0),('export function createDesktopServices(options:','  const assistantTaskTerminalListeners',0),('  const builtinDescriptions =','  const staticGatewayNames',0),('  registerKSwarmTools(registry, options.kswarmService',None,0)]:
 if n==0 and start.startswith('  registerKSwarm'):continue
 bundle_b+=part(files[1],start,end,n)
for start,n in [('  if(!readonlyAudit)registerKSwarmTools',6),('  function registerComputerUseWrapper()',4),('  async function qualifyComputerUse()',5),('  const defaultDesktopModelRunner =',50),('  for (const tool of readonlyAudit?',4),('  const nativeReadonlyOnly = registry.isNativeReadonlyOnly;',12),('    readonlyAuditProfile?:DesktopReadonlyAuditProfile;',4),("    const invocationOptions: (ModelInvocationOptions",5),('  if (!nativeReadonlyOnly && runnerOptions.multiAgent',12),('          ...(nativeReadonlyOnly?{nativeReadonlyOnly:true}:{}),',4)]:bundle_b+=part(files[1],start,None,n)
bundle_b+=part(files[4],'  private scope(',None,32)+part(files[5],'  bindTools(target:',None,6)
common='''Independent Kimi k3 STATIC SECURITY REVIEW, author Codex GPT-6. User authorizes this review. NO TOOLS, edits, network probes or test claims. Default permissions only; no grants. Reply <=600 words: APPROVE or BLOCK, concrete P0/P1 with file:line, exact minimal fixes, then P2 observations. A timeout/no final answer is not approval.
Scope: main-only branded readonly audit profile, exclusively dedicated eval dataRoot/workspace/config under tmp with ten frozen source copies. Must preserve default task permission, actual default model runner/foreground/TaskHost, deny bash/skill/MCP/discovery/material/project/Goal/artifact/child expansion, not widen catalog read to cwd. Model/IPC/TaskCreateInput must not select profile. Children are CLOSED, not claimed supported. Same-UID malicious filesystem races are outside this model-tool boundary. Do NOT require external calendar/quality labels or claim UX/pilot pass. Independent static review only, not execution.
Observed tests: final focused 31 tests passed, build/governance passed; no claim this proves safety. Real smoke: one Qwen morning HTTP200 persisted success then usage capture unknown => exit2, no C confirm; default pilot still off. Unknown stops paid expansion. Review omitted siblings as limitations, do not invent their behavior.
'''
bundles=[('scope',bundle_a,common+'Bundle A: inspect profile brand, exact path/content binding, closed native population, default-mode/material/scope guard, original read confinement and scoped binding. The integration is reviewed separately in B.\n'),('integration',bundle_b,common+'Bundle B: integration only. A separate bundle contains full profile factory: WeakMap brand, tmp-only dedicated session dirs, exactly ten fixed files with dev/inode/content hashes checked at each read, closed native registry population, no observation forks, task default/material/Goal/artifact deny. Profile is not a boolean. Inspect propagation and sibling bypasses in supplied code. Do not assume A approved.\n')]
if '--small' in sys.argv:
 short='Independent Kimi k3 static security review, author Codex GPT-6. NO tools/edits/autogrants. Reply <=180 words: APPROVE or BLOCK; only actual P0/P1 with file:line and minimal fix; scope limitations. Do not repeat invariants or claim tests run. Eval-only Main WeakMap profile, ten frozen copied .ts files, default permission, no child controls/shell/skill/MCP/discovery/mutation. Same-UID malicious OS races outside threat model. Pilot remains off.\n'
 a=full(files[0])+full('src/ai/tools/native-tool-identity.ts')
 b=''
 for start,n in [('export interface DesktopServicesOptions {',5),('export function createDesktopServices(options:',8),('  const builtinDescriptions =',7),('  if(!readonlyAudit)registerKSwarmTools',7),('  function registerComputerUseWrapper()',4),('  async function qualifyComputerUse()',5),('  const defaultDesktopModelRunner =',50),('  for (const tool of readonlyAudit?',4),("    const invocationOptions: (ModelInvocationOptions",5)]:b+=part(files[1],start,None,n)
 b+=part(files[5],'  bindTools(target:',None,5)
 c=part(files[2],'  createScopedRegistry(', '  private issuePolicy(')+part(files[3],'  private bind(tool:',None,23)+part(files[4],'  private scope(',None,32)+part(files[1],'  if (!nativeReadonlyOnly && runnerOptions.multiAgent',None,12)+part(files[1],'          ...(nativeReadonlyOnly?{nativeReadonlyOnly:true}:{}),',None,4)
 bundles=[('brand-and-files',a,short+'Inspect profile/paths/default guard/sealed population. Core ToolRegistry.nativeReadonlyOnly already requires WeakMap native identity, denies callbacks/deferred/mutable tool changes. Other integration reviewed separately.\n'),('main-initialization',b,short+'Inspect Main initialization/mode/scope/lane bypasses. Profile helper validates opaque brand and dedicated tmp session roots and exact-file identity; root registry is closed native readonly; remaining scope propagation reviewed separately.\n'),('scoped-siblings',c,short+'Inspect scoped registry/callback/catalog rebind/child bypasses. Source root registry is nativeReadonlyOnly with exactly one guarded native read; profile guard rechecks exact paths/content. Unknown tools must fail. Registry rejects non-native identities, helpers deny observation forks.\n')]
for name,bundle,prompt in bundles:
 (root/f'{name}-bundle.txt').write_text(bundle)
 manifest.setdefault('bundles',{})[name]={'bytes':len(bundle.encode()),'sha256':hashlib.sha256(bundle.encode()).hexdigest()}
 if len(bundle.encode())>22000:raise RuntimeError('bundle_too_large')
(root/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'root':str(root),'bundles':manifest['bundles']}),flush=True)
results=[]
for name,bundle,prompt in bundles:
 with (root/f'{name}-output.jsonl').open('w') as out,(root/f'{name}-stderr.log').open('w') as err:
  args=[str(Path.home()/'.kimi-code/bin/kimi'),'-m','kimi-code/k3','--skills-dir',str(root/'empty-skills'),'--output-format','stream-json','-p',prompt+bundle]
  proc=subprocess.Popen(args,cwd=root,stdout=out,stderr=err,start_new_session=True)
  (root/f'{name}-process.json').write_text(json.dumps({'pid':proc.pid,'pgid':proc.pid,'startedAt':time.time(),'model':'kimi-code/k3','autoGrant':False,'promptSha256':hashlib.sha256((prompt+bundle).encode()).hexdigest()}))
  print(json.dumps({'review':name,'pid':proc.pid,'timeoutSeconds':120 if '--small' in sys.argv else 90}),flush=True)
  deadline=time.monotonic()+(120 if '--small' in sys.argv else 90);timed=False
  while proc.poll() is None and time.monotonic()<deadline:time.sleep(.2)
  if proc.poll() is None:
   timed=True;os.killpg(proc.pid,signal.SIGTERM)
   try:proc.wait(timeout=3)
   except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL)
  code=proc.wait();raw=(root/f'{name}-output.jsonl').read_text();stderr=(root/f'{name}-stderr.log').read_text()
  record={'name':name,'pid':proc.pid,'exitCode':code,'timedOut':timed,'reaped':True,'rawBytes':len(raw.encode()),'reviewConclusion':'unclassified_requires_reading_actual_final_output','autoGrant':False}
  (root/f'{name}-completion.json').write_text(json.dumps(record,indent=2)+'\n');results.append(record);print(json.dumps(record),flush=True)
  substantive=[]
  for line in raw.splitlines():
   try:
    event=json.loads(line)
    if event.get('role')=='assistant' and isinstance(event.get('content'),str):substantive.append(event['content'])
   except:pass
  if timed or code!=0 or '429' in stderr or not substantive or 'BLOCK' in substantive[-1]:break
(root/'completion.json').write_text(json.dumps({'results':results,'manifest':str(root/'manifest.json'),'author':author,'independentReviewerRequested':'kimi-code/k3','approved':False,'note':'No approval until actual final text independently read and source hashes rechecked.'},indent=2)+'\n')
print(root,flush=True)
