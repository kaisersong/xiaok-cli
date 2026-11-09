import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstat, realpath, mkdir, mkdtemp, readFile, writeFile, rename, rm, open, link, unlink } from 'node:fs/promises';
import { join, resolve, isAbsolute, delimiter } from 'node:path';
import { inspectDeepSeekRecipeEnvironment, freezeDeepSeekRecipeCounter, countDeepSeekSerializedRequest } from '../../src/runtime/sol-pi/deepseek-capacity-profile.js';

const WHEEL='deepseek_recipe-0.1.1-cp310-abi3-macosx_11_0_arm64.whl';
export const ASSISTANT_ANALYSIS_RESOURCE_ASSETS=Object.freeze([
  Object.freeze({name:WHEEL,url:'https://files.pythonhosted.org/packages/ea/e9/8b9dedbcd3aaabac393cd08c99a1c0f0670ea6493ac727fc2857bb4f88dd/deepseek_recipe-0.1.1-cp310-abi3-macosx_11_0_arm64.whl',sha256:'cadb53a202960fc5d381f52a9c30afb0e44d7eaaa22197e851c09789bf65b83e'}),
  Object.freeze({name:'tokenizer.json',url:'https://raw.githubusercontent.com/deepseek-ai/deepseek-recipe/8cadfede7063c896b944e7bae05daa3549ae97ea/static/tokenizers/v41/tokenizer.json',sha256:'81f64d1248a68ce3663e07ab3ee48b851e5df0e32d27cb98e4c9a268151e8d99'}),
]);
const PACKAGE_FILES={
  '__init__.py':'e52ab6b2dff1f2e33ef24ce346191b9a046de5c25b08a8c0f873293fe640cd5d',
  '_native.abi3.so':'a41596ca12503efa1b0a25b16d9d52293378528b3aec4f060c3814f488fdcd43',
  '_native.pyi':'e29ea74305570acb0b5c4bfea920989d85d7795c4e80c53550a99ea6a4fd3bea',
  'py.typed':'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  '.dylibs/libopencv_core.4.12.0.dylib':'ab3d89114b979a4c83143b8dfd16e81b6ef29806a76d6b7081eec5fb17120671',
  '.dylibs/libopencv_imgcodecs.4.12.0.dylib':'d74cd4e46208a52b7c3f6b725cdc7fdb7dc1f2adbb6ebce865c3fd13cc82b02d',
  '.dylibs/libopencv_imgproc.4.12.0.dylib':'df6052c72683a58455845031b0b6ed4c5a59ec457f30f14dc65bb764883aeab1',
};
// No pip/setup/import of downloaded code. All archive entries are validated before
// writing; only these seven pinned package members are ever extracted.
const EXTRACT=`import sys,zipfile,pathlib,hashlib,stat,json
expected=json.loads(sys.argv[3])
with zipfile.ZipFile(sys.argv[1]) as z:
 entries=z.infolist(); names=[i.filename for i in entries]
 assert len(names)==len(set(names)) and len(entries)<128
 assert sum(i.file_size for i in entries)<128*1024*1024
 package={}
 for i in entries:
  p=pathlib.PurePosixPath(i.filename)
  assert not p.is_absolute() and '..' not in p.parts and '\\\\' not in i.filename
  assert not stat.S_ISLNK(i.external_attr>>16) and not (i.flag_bits&1)
  if i.filename.startswith('deepseek_recipe/') and not i.is_dir():
   name=i.filename[len('deepseek_recipe/'):]; assert name in expected
   data=z.read(i);assert hashlib.sha256(data).hexdigest()==expected[name]
   package[name]=data
 assert set(package)==set(expected)
 root=pathlib.Path(sys.argv[2])/'deepseek_recipe'
 for name,data in package.items():
  p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
`;
export interface AssistantAnalysisResourceInput {dataRoot:string;pythonCommand:string;signal?:AbortSignal}
export class AssistantAnalysisResourcesUnavailable extends Error {
  readonly code='ASSISTANT_ANALYSIS_RESOURCES_UNAVAILABLE';
  constructor(){super('ASSISTANT_ANALYSIS_RESOURCES_UNAVAILABLE');this.name='AssistantAnalysisResourcesUnavailable';}
}
function fail():never{throw new AssistantAnalysisResourcesUnavailable();}
export function assistantAnalysisResourcesSupportedPlatform(platform:string=process.platform,arch:string=process.arch){return platform==='darwin'&&arch==='arm64';}
async function regularDirectory(path:string){const stat=await lstat(path);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid?.()||(stat.mode&0o022))fail();}
async function regularFile(path:string){const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>64*1024*1024)fail();return stat;}
async function paths(input:AssistantAnalysisResourceInput,create:boolean){
  if(!assistantAnalysisResourcesSupportedPlatform())fail();input.signal?.throwIfAborted();
  if(!isAbsolute(input.dataRoot)||!input.pythonCommand)fail();
  const root=await realpath(input.dataRoot);const rootStat=await lstat(input.dataRoot);if(!rootStat.isDirectory()||rootStat.isSymbolicLink())fail();
  const managed=join(root,'assistant-analysis-provider');
  if(create)await mkdir(managed,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  await regularDirectory(managed);
  let pythonExecutable:string|undefined;
  const candidates=isAbsolute(input.pythonCommand)?[input.pythonCommand]:/^[a-zA-Z0-9._-]{1,80}$/.test(input.pythonCommand)
    ?(process.env.PATH??'').split(delimiter).filter(isAbsolute).map(directory=>join(directory,input.pythonCommand)):[];
  for(const candidate of candidates){try{pythonExecutable=await realpath(candidate);await regularFile(pythonExecutable);break;}catch{pythonExecutable=undefined;}}
  if(!pythonExecutable)fail();
  return {managed,leaf:join(managed,'recipe-0.1.1'),pythonExecutable};
}
function environment(leaf:string,pythonExecutable:string){return {pythonExecutable,sitePackages:join(leaf,'site-packages'),tokenizerPath:join(leaf,'tokenizer.json'),wheelPath:join(leaf,WHEEL)};}
async function verify(leaf:string,pythonExecutable:string,requireSaved:boolean){
  await regularDirectory(leaf);
  for(const asset of ASSISTANT_ANALYSIS_RESOURCE_ASSETS){const file=join(leaf,asset.name);await regularFile(file);if(createHash('sha256').update(await readFile(file)).digest('hex')!==asset.sha256)fail();}
  const env=environment(leaf,pythonExecutable),manifest=inspectDeepSeekRecipeEnvironment(env);
  if(requireSaved){const file=join(leaf,'manifest.json');const stat=await regularFile(file);if(stat.size>2*1024*1024)fail();if(JSON.stringify(JSON.parse(await readFile(file,'utf8')))!==JSON.stringify(manifest))fail();}
  const counter=freezeDeepSeekRecipeCounter({...env,environmentManifest:manifest});
  const calibration=countDeepSeekSerializedRequest(counter,JSON.stringify({model:'deepseek-flash',messages:[{role:'user',content:'Reply OK.'}],thinking:{type:'disabled'},max_tokens:1,stream:false}));
  if(calibration!==7)fail();
  return {dataRoot:leaf,pythonExecutable,counterManifestSha256:manifest.sha256,manifest};
}
/** Publish only a complete, synced manifest at its final leaf path. Hard-link
 * publication is atomic and refuses to replace a concurrently created target. */
async function publishManifest(leaf:string,manifest:Awaited<ReturnType<typeof verify>>['manifest'],signal?:AbortSignal){
  signal?.throwIfAborted();
  const temporary=join(leaf,`.manifest-${randomUUID()}.tmp`);
  const handle=await open(temporary,'wx',0o600);
  try{
    try{await handle.writeFile(JSON.stringify(manifest));await handle.sync();}finally{await handle.close();}
    signal?.throwIfAborted();
    await link(temporary,join(leaf,'manifest.json'));
  }finally{await unlink(temporary);}
}
async function download(asset:typeof ASSISTANT_ANALYSIS_RESOURCE_ASSETS[number],directory:string,signal?:AbortSignal){
  const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(60_000)]):AbortSignal.timeout(60_000);
  const response=await fetch(asset.url,{redirect:'error',signal:combined});if(!response.ok||!response.body)fail();
  const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;const hash=createHash('sha256');
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>64*1024*1024)fail();hash.update(value);parts.push(value);}
    if(hash.digest('hex')!==asset.sha256)fail();await writeFile(join(directory,asset.name),Buffer.concat(parts),{flag:'wx',mode:0o600});
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
async function extract(pythonExecutable:string,stage:string,signal?:AbortSignal){
  signal?.throwIfAborted();
  await new Promise<void>((resolveWork,reject)=>{
    const child=spawn(pythonExecutable,['-I','-S','-B','-c',EXTRACT,join(stage,WHEEL),join(stage,'site-packages'),JSON.stringify(PACKAGE_FILES)],{env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',LC_ALL:'C.UTF-8'},cwd:stage,stdio:['ignore','pipe','pipe']});
    let bad=false,bytes=0;
    const stop=()=>{bad=true;child.kill('SIGKILL');};
    const timer=setTimeout(stop,30_000);signal?.addEventListener('abort',stop,{once:true});
    const output=(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>65536)stop();};child.stdout.on('data',output);child.stderr.on('data',output);
    child.on('error',()=>{bad=true;if(!child.pid){clearTimeout(timer);signal?.removeEventListener('abort',stop);reject(new AssistantAnalysisResourcesUnavailable());}});
    child.on('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);if(bad||code!==0||signal?.aborted)reject(new AssistantAnalysisResourcesUnavailable());else resolveWork();});
    if(signal?.aborted)stop();
  });
}
const pending=new Map<string,Promise<Awaited<ReturnType<typeof verify>>>>();
/** Explicit configure only. No global pip, SDK call, config write or silent repair. */
export async function prepareAssistantAnalysisResources(input:AssistantAnalysisResourceInput){
  if(input.signal?.aborted)throw new AssistantAnalysisResourcesUnavailable();
  const key=JSON.stringify([resolve(input.dataRoot),input.pythonCommand]);
  if(pending.has(key)){const result=await pending.get(key)!;if(input.signal?.aborted)throw new AssistantAnalysisResourcesUnavailable();return result;}
  const work=(async()=>{
    let stage:string|undefined,installed=false;
    try{
      const p=await paths(input,true);
      const exists=await lstat(p.leaf).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
      if(exists){
        await regularDirectory(p.leaf);
        const saved=await lstat(join(p.leaf,'manifest.json')).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
        const result=await verify(p.leaf,p.pythonExecutable,saved);
        input.signal?.throwIfAborted();
        // Explicit prepare alone may finish a rename-before-manifest crash.
        // Existing (even invalid/symlink) manifests always take strict verification.
        if(!saved)await publishManifest(p.leaf,result.manifest,input.signal);
        return result;
      }
      stage=await mkdtemp(join(p.managed,'.prepare-'));
      for(const asset of ASSISTANT_ANALYSIS_RESOURCE_ASSETS)await download(asset,stage,input.signal);
      await extract(p.pythonExecutable,stage,input.signal);input.signal?.throwIfAborted();
      await rename(stage,p.leaf);stage=undefined;installed=true;
      try{const result=await verify(p.leaf,p.pythonExecutable,false);await publishManifest(p.leaf,result.manifest,input.signal);input.signal?.throwIfAborted();return result;}
      catch(error){if(installed)await rm(p.leaf,{recursive:true,force:true});throw error;}
    }catch{throw new AssistantAnalysisResourcesUnavailable();}
    finally{if(stage)await rm(stage,{recursive:true,force:true});}
  })();pending.set(key,work);
  try{return await work;}finally{pending.delete(key);}
}
/** Startup restore: validation only, never network or filesystem creation. */
export async function restoreAssistantAnalysisResources(input:AssistantAnalysisResourceInput){
  try{const p=await paths(input,false);return await verify(p.leaf,p.pythonExecutable,true);}catch{throw new AssistantAnalysisResourcesUnavailable();}
}
