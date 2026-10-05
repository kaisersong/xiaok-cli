// @vitest-environment node
import {it,expect,vi,afterEach} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const ui=vi.hoisted(()=>({pick:vi.fn(),review:vi.fn()}));
vi.mock('electron',()=>({app:{getLocale:()=> 'zh'},dialog:{showOpenDialog:ui.pick,showMessageBox:ui.review}}));
import {authorizeDesktopValidationMaterials} from '../../electron/desktop-validation-materials.js';
afterEach(()=>vi.clearAllMocks());
it('uses main native selection and stops on native review cancellation before OS authorization',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'desktop-validation-'))),file=join(root,'source.ts');writeFileSync(file,'source');
 try{
 const invocation={sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v'},exactCommand={argv:['node','verify.cjs'],cwdRelative:'.'},editedFile={path:file,afterHash:'a'.repeat(64)},expiresAt=Date.now()+60000;
 const client={prepareMaterialAuthorization:vi.fn(async(draft:any)=>({challengeId:'challenge',canonicalReview:{...draft,materials:[{path:file,byteLimit:6,size:6,sha256:'a'.repeat(64)}],engineBinding:{engineId:'engine',incarnation:'epoch'},scopeDigest:'b'.repeat(64)}})),authorizeMaterialChallenge:vi.fn(),prepareValidationInput:vi.fn()};
 const window={isDestroyed:()=>false,once:vi.fn(),removeListener:vi.fn()} as any;
 ui.pick.mockResolvedValue({canceled:false,filePaths:[file]});ui.review.mockResolvedValue({response:0});
 const result=await authorizeDesktopValidationMaterials({requestSource:'user',window,cwd:root,operation:{purpose:'isolated-validation',invocation,exactCommand,editedFile,expiresAt},client,assertCurrent:()=>{}});
 expect(result).toBeNull();expect(client.authorizeMaterialChallenge).not.toHaveBeenCalled();expect(client.prepareMaterialAuthorization).toHaveBeenCalledOnce();
 expect(ui.review.mock.calls[0][1].detail).toContain(file);expect(ui.review.mock.calls[0][1].detail).toContain('a'.repeat(64));
 ui.pick.mockResolvedValue({canceled:true,filePaths:[]});await expect(authorizeDesktopValidationMaterials({requestSource:'user',window,cwd:root,operation:{purpose:'isolated-validation',invocation,exactCommand,editedFile,expiresAt},client,assertCurrent:()=>{}})).resolves.toBeNull();
 expect(client.prepareMaterialAuthorization).toHaveBeenCalledOnce();
 }finally{rmSync(root,{recursive:true,force:true});}
});
it('denies agent entry before opening a file chooser',async()=>{
 await expect(authorizeDesktopValidationMaterials({requestSource:'agent'} as any)).rejects.toThrow(/user/);expect(ui.pick).not.toHaveBeenCalled();
});
it('pins the original request and client methods before the native file dialog yields',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'desktop-material-request-'))),file=join(root,'source.txt');writeFileSync(file,'source');
 try{const invocation={sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v'},exactCommand={argv:['node','verify.cjs'],cwdRelative:'.'},expiresAt=Date.now()+60000,steps:any[]=[];
 const request={requestId:'original',async beforeStep(step:any){steps.push(step);}};
 const prepare=vi.fn(async({requestId,draft}:any)=>({requestId,created:true,state:'mapped',challengeId:'challenge',challengePhase:'prepared',resources:[],canonicalReview:{...draft,materials:[{path:file,byteLimit:6,size:6,sha256:'a'.repeat(64)}],engineBinding:{engineId:'engine',incarnation:'epoch'},scopeDigest:'b'.repeat(64)}}));
 const replacement=vi.fn(async()=>{throw Error('replaced method');});
 const client:any={prepareMaterialAuthorization:vi.fn(),prepareMaterialAuthorizationRequest:prepare,authorizeMaterialChallenge:vi.fn(),prepareValidationInput:vi.fn()};
 const window={isDestroyed:()=>false,once:vi.fn(),removeListener:vi.fn()} as any;
 ui.pick.mockImplementation(async()=>{request.requestId='changed';client.prepareMaterialAuthorizationRequest=replacement;return{canceled:false,filePaths:[file]};});ui.review.mockResolvedValue({response:0});
 expect(await authorizeDesktopValidationMaterials({requestSource:'user',window,cwd:root,operation:{purpose:'isolated-command',invocation,exactCommand,expiresAt},client,request,assertCurrent(){}})).toBeNull();
 expect(prepare).toHaveBeenCalledOnce();expect(replacement).not.toHaveBeenCalled();expect(steps[0]).toMatchObject({requestId:'original',phase:'prepare'});expect(prepare.mock.calls[0][0].requestId).toBe('original');
 }finally{rmSync(root,{recursive:true,force:true});}
});
