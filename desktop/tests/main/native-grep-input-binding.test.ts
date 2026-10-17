import {AgentSessionGraph} from '../../../src/ai/runtime/session-graph.js';
// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildToolList,ToolRegistry} from '../../../src/ai/tools/index.js';
import {getBuiltinToolIdentity} from '../../../src/ai/tools/native-tool-identity.js';
import {grepTool} from '../../../src/ai/tools/grep.js';
const backendFault=vi.hoisted(()=>({mode:null as string|null}));
vi.mock('child_process',async importActual=>{const native=await importActual<typeof import('child_process')>();return {...native,spawnSync(command:any,args:any,options:any){if(backendFault.mode&&(command==='rg'||backendFault.mode==='pure-node'&&command==='grep')&&args?.[0]==='--version')return {pid:0,output:[],stdout:null,stderr:null,status:1,signal:null,error:new Error('intentional unavailable probe')};return (native.spawnSync as any)(command,args,options);}};});
const roots:string[]=[];const registries:ToolRegistry[]=[];const priorConfig=process.env.RIPGREP_CONFIG_PATH;
afterEach(()=>{backendFault.mode=null;vi.restoreAllMocks();for(const v of registries.splice(0))v.dispose();for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true});if(priorConfig===undefined)delete process.env.RIPGREP_CONFIG_PATH;else process.env.RIPGREP_CONFIG_PATH=priorConfig;});
function fixture(pattern='ORIGINAL'){delete process.env.RIPGREP_CONFIG_PATH;const r=mkdtempSync(join(tmpdir(),'grep-input-binding-'));roots.push(r);const file=join(r,'evidence.txt');writeFileSync(file,pattern+'\n');return{r,file};}
function readonly(r:string){const tools=buildToolList(undefined,{cwd:r}).filter(t=>getBuiltinToolIdentity(t)==='readonly');const v=new ToolRegistry({autoMode:true,nativeReadonlyOnly:true},tools);registries.push(v);return v;}
const patterns=['ORIGINAL','-literal','--literal','--glob=literal','--regexp=literal','--no-pre','--ignore-case','-e','-'];
it.each(patterns)('ordinary genuine grep binds query %s as regex data while only reading its temporary file',async pattern=>{
 const{file}=fixture(pattern);expect(await grepTool.execute({path:file,pattern})).toContain(pattern);
});
it.each(patterns)('readonly role preserves genuine native grep for option-shaped query %s',async pattern=>{
 const{r,file}=fixture(pattern);expect(await readonly(r).executeTool('grep',{path:file,pattern})).toContain(pattern);
});
it('ordinary keeps harmless inherited -i config, while readonly ignores it and does not mark a shared caller context',async()=>{
 const{r,file}=fixture();const config=join(r,'rg-config');writeFileSync(config,'--ignore-case\n');process.env.RIPGREP_CONFIG_PATH=config;const shared=Object.freeze({taskId:'shared',session:new AgentSessionGraph({sessionId:'shared',cwd:r,createdAt:0,updatedAt:0,lineage:['shared']}).exportSnapshot(),messages:[],systemPrompt:'',toolDefinitions:[]});const v=readonly(r);
 const [normal,restricted]=await Promise.all([grepTool.execute({path:file,pattern:'original'},shared),v.executeTool('grep',{path:file,pattern:'original'},shared)]);expect(normal).toContain('ORIGINAL');expect(restricted).toContain('无匹配');expect(await grepTool.execute({path:file,pattern:'original'},shared)).toContain('ORIGINAL');expect(shared.taskId).toBe('shared');expect(Object.keys(shared)).toEqual(['taskId','session','messages','systemPrompt','toolDefinitions']);
});
it('readonly-looking context descriptors do not mint a native readonly brand or strip ordinary config',async()=>{
 const{r,file}=fixture();const config=join(r,'rg-config');writeFileSync(config,'--ignore-case\n');process.env.RIPGREP_CONFIG_PATH=config;expect(await grepTool.execute({path:file,pattern:'original'},{nativeReadonlyOnly:true,readOnly:true,annotations:{readOnlyHint:true}} as any)).toContain('ORIGINAL');
});
it('readonly observation fork actual prepare/consume uses a fresh restricted native context',async()=>{
 const{r,file}=fixture();const config=join(r,'rg-config');writeFileSync(config,'--ignore-case\n');process.env.RIPGREP_CONFIG_PATH=config;const v=readonly(r),fork=v.forkForObservation([],['grep']);registries.push(fork);const token=await fork.prepareToolInvocation('grep',{path:file,pattern:'original'});expect(typeof token).toBe('object');expect(await fork.executePreparedTool(token as any)).toContain('无匹配');expect(await grepTool.execute({path:file,pattern:'original'})).toContain('ORIGINAL');
});
it.each(['native-grep','pure-node'])('binds leading-hyphen pattern in actual %s fallback and preserves include-before-path semantics',async backend=>{
 const{r}=fixture();const file=join(r,'wanted.txt');writeFileSync(file,'-literal\n');writeFileSync(join(r,'excluded.md'),'-literal\n');backendFault.mode=backend;
 const output=await grepTool.execute({path:r,pattern:'-literal',glob:'*.txt'});expect(output).toContain('-literal');expect(output).toContain('wanted.txt');expect(output).not.toContain('excluded.md');
});
