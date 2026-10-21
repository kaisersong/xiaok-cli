import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import * as fs from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {generateKeyPairSync,createHash} from 'node:crypto';
const fixture=vi.hoisted(()=>({root:'',uid:0,failTarget:false,failReaderBarrier:false,stateAcl:false,replaceTemporary:false,lifetime:undefined as any,constructed:0,owners:new Map<string,{uid:number;gid:number}>(),fds:new Map<number,string>()}));
vi.mock('node:fs',async()=>{
 const real=await vi.importActual<typeof import('node:fs')>('node:fs'),base='/Library/Application Support/xiaok-verification';
 const mapped=(p:any)=>typeof p==='string'&&p.startsWith(base)?fixture.root+p.slice(base.length):p;
 const stat=(s:any,p:string)=>Object.assign(Object.create(Object.getPrototypeOf(s)),s,fixture.owners.get(p)??{uid:0,gid:0});
 return {...real,
  openSync:(p:any,...args:any[])=>{const fd=(real.openSync as any)(mapped(p),...args);fixture.fds.set(fd,p);return fd;},
  lstatSync:(p:any)=>stat(real.lstatSync(mapped(p)),p),fstatSync:(fd:number)=>stat(real.fstatSync(fd),fixture.fds.get(fd)??''),
  readFileSync:(p:any,...args:any[])=>(real.readFileSync as any)(mapped(p),...args),
  chownSync:(p:string,uid:number,gid:number)=>{if(fixture.replaceTemporary&&p.includes('egress-state/')&&p.endsWith('.tmp')){real.unlinkSync(mapped(p));real.symlinkSync(join(fixture.root,'unrelated'),mapped(p));}fixture.owners.set(p,{uid,gid});},
  fchownSync:(fd:number,uid:number,gid:number)=>fixture.owners.set(fixture.fds.get(fd)!,{uid,gid}),
  chmodSync:(p:string,mode:number)=>real.chmodSync(mapped(p),mode),
  linkSync:(a:string,b:string)=>{real.linkSync(mapped(a),mapped(b));const owner=fixture.owners.get(a);if(owner)fixture.owners.set(b,owner);},
  renameSync:(a:string,b:string)=>{real.renameSync(mapped(a),mapped(b));const owner=fixture.owners.get(a);if(owner)fixture.owners.set(b,owner);},
  unlinkSync:(p:string)=>real.unlinkSync(mapped(p)),
  fsyncSync:(fd:number)=>{if(fixture.failReaderBarrier&&fixture.uid===402)throw Error('fixture_reader_barrier');if(fixture.failTarget&&(fixture.fds.get(fd)??'').includes('targets')){fixture.failTarget=false;throw Error('fixture_fsync');}real.fsyncSync(fd);},
 };
});
vi.mock('../../../src/runtime/verification/installed-identity.js',()=>({assertRootProtectedFile(){},assertRootProtectedExecutable(){}}));
vi.mock('node:child_process',async()=>({...await vi.importActual<typeof import('node:child_process')>('node:child_process'),spawnSync:()=>({status:0,stdout:fixture.stateAcl?'drwx------+ 2 service service\n 0: user:other allow read\n':'drwx------ 2 service service\n'})}));
vi.mock('../../../src/runtime/verification/deployment-package.js',()=>({parseDeploymentPackageInventory:()=>({packageHash:'a'.repeat(64)}),verifyDeploymentPackage(){}}));
vi.mock('../../../src/runtime/verification/installed-composite-lifetime.js',()=>({createInstalledCompositeLifetime:()=>fixture.lifetime,assertInstalledCompositeLifetime:(value:any)=>{if(!value.actualFixture||fixture.uid!==402)throw Error('fixture_lifetime');}}));
vi.mock('../../../src/runtime/sol-pi/composite-egress-service.js',()=>({createCompositeEgressService:()=>{fixture.constructed++;throw Error('fixture_service_must_not_start');}}));
import {provisionInstalledEgress,readInstalledEgressConfiguration} from '../../../src/runtime/verification/deployment-egress-configuration.js';
import {startInstalledCompositeEgress} from '../../../src/runtime/sol-pi/installed-composite-services.js';
const base='/Library/Application Support/xiaok-verification',hash='a'.repeat(64);
const input=()=>({version:1,targets:[{destination:'https://example.com',model:'model',protocol:'generic-openai',headers:{},credentialId:'primary'}],credentials:{primary:{authorization:'Bearer fixture-only'}}});
let lifetime:any;
beforeEach(()=>{
 fixture.root=fs.mkdtempSync(join(tmpdir(),'egress-provision-'));fixture.uid=0;fixture.failTarget=false;fixture.failReaderBarrier=false;fixture.stateAcl=false;fixture.replaceTemporary=false;fixture.constructed=0;fixture.owners.clear();fixture.fds.clear();
 for(const name of ['egress-state','provisioning','releases'])fs.mkdirSync(join(fixture.root,name),{mode:0o700});
 fixture.owners.set(join(base,'egress-state'),{uid:402,gid:402});
 const key=()=>generateKeyPairSync('ed25519').publicKey.export({format:'pem',type:'spki'}).toString();const controller=key(),receiver=key();
 const manifest={version:2,authorityId:'controller',packageHash:hash,serviceUid:400,allowedUserIds:[501],publicKeyPem:controller};
 const keyId=(pem:string)=>createHash('sha256').update(require('node:crypto').createPublicKey(pem).export({format:'der',type:'spki'})).digest('hex');
 const registration=(kind:string,uid:number)=>{const publicKeyPem=key();return{version:1,kind,authorityId:kind,instanceEpoch:1,keyId:keyId(publicKeyPem),publicKeyPem,serviceUid:uid,packageHash:hash,controllerAuthorityId:'controller'};};
 const egress=registration('egress',402),participant=registration('participant',403);
 for(const [name,value]of Object.entries({'deployment.json':manifest,'receiver.json':{version:1,receiverId:'receiver',receiverInstanceEpoch:1,keyId:keyId(receiver),serviceUid:401,publicKeyPem:receiver},'egress.json':egress,'participant.json':participant,[`releases/${hash}.json`]:{}}))fs.writeFileSync(join(fixture.root,name),JSON.stringify(value),{mode:0o644});
 fs.writeFileSync(join(fixture.root,'provisioning/egress-input.json'),JSON.stringify(input()),{mode:0o600});
 lifetime={actualFixture:true,base,state:join(base,'egress-state'),definition:egress,manifest,pair:{egress,participant},close(){},assertCurrent(){if(fixture.uid!==402)throw Error('fixture_identity');}};fixture.lifetime=lifetime;
 const posix=process as unknown as{getuid():number;geteuid():number};vi.spyOn(posix,'getuid').mockImplementation(()=>fixture.uid);vi.spyOn(posix,'geteuid').mockImplementation(()=>fixture.uid);
});
afterEach(()=>{vi.restoreAllMocks();fs.rmSync(fixture.root,{recursive:true,force:true});});
it('actual FS fixture publishes exact config and service reader consumes only committed bytes',()=>{
 provisionInstalledEgress(hash);fixture.uid=402;const result=readInstalledEgressConfiguration(lifetime);
 expect(result.targets[0].headers.authorization).toBe('Bearer fixture-only');result.assertCurrent();
 expect(fs.statSync(join(fixture.root,'egress-provision.json')).mode&0o777).toBe(0o440);
 expect(fs.statSync(join(fixture.root,'egress-state/provider-credentials.json')).mode&0o777).toBe(0o600);
});
it('actual write failure preserves prepared intent and exact retry does not replace different credentials',()=>{
 fixture.failTarget=true;expect(()=>provisionInstalledEgress(hash)).toThrow('fixture_fsync');
 fixture.uid=402;expect(()=>readInstalledEgressConfiguration(lifetime)).toThrow();fixture.uid=0;
 const other=input();other.credentials.primary.authorization='Bearer different';fs.writeFileSync(join(fixture.root,'provisioning/egress-input.json'),JSON.stringify(other),{mode:0o600});
 expect(()=>provisionInstalledEgress(hash)).toThrow();
 fs.writeFileSync(join(fixture.root,'provisioning/egress-input.json'),JSON.stringify(input()),{mode:0o600});provisionInstalledEgress(hash);
 fixture.uid=402;expect(readInstalledEgressConfiguration(lifetime).targets[0].headers.authorization).toBe('Bearer fixture-only');
});
it('rejects ordinary writer before reading deployment or credentials',()=>{fixture.uid=501;expect(()=>provisionInstalledEgress(hash)).toThrow('root_required');});
it('does not follow a service-directory temporary replacement while applying privileged ownership and mode',()=>{
 const unrelated=join(fixture.root,'unrelated');fs.writeFileSync(unrelated,'untouched');fs.chmodSync(unrelated,0o666);fixture.replaceTemporary=true;
 try{provisionInstalledEgress(hash);}catch{/* Refusal is safe only if unrelated files are untouched. */}
 expect(fs.statSync(unrelated).mode&0o777).toBe(0o666);expect(fs.readFileSync(unrelated,'utf8')).toBe('untouched');
});
it('does not write credentials into a service state directory with an additional read ACL',()=>{
 fixture.stateAcl=true;expect(()=>provisionInstalledEgress(hash)).toThrow('egress_provision_state');
 expect(fs.existsSync(join(fixture.root,'egress-state/provider-credentials.json'))).toBe(false);
});
it('does not expose invalid credential input in the exception printed by the local command',()=>{
 fs.writeFileSync(join(fixture.root,'provisioning/egress-input.json'),'SECRET_LOCAL_CREDENTIAL_NEVER_LOG');
 let message='';try{provisionInstalledEgress(hash);}catch(error){message=String(error);}
 expect(message).not.toContain('SECRET_LOCAL');expect(message).toContain('egress_configuration_json');
});
it('refuses service admission when the reader cannot establish the final durability barrier',()=>{
 provisionInstalledEgress(hash);fixture.uid=402;fixture.failReaderBarrier=true;
 expect(()=>readInstalledEgressConfiguration(lifetime)).toThrow('fixture_reader_barrier');
 fixture.failReaderBarrier=false;expect(readInstalledEgressConfiguration(lifetime).targets).toHaveLength(1);
});
it('rejects unsafe input mode and a later credential change under an already captured configuration',()=>{
 const source=join(fixture.root,'provisioning/egress-input.json');fs.chmodSync(source,0o644);
 expect(()=>provisionInstalledEgress(hash)).toThrow('configuration_file');
 expect(fs.existsSync(join(fixture.root,'egress-provision.json'))).toBe(false);
 fs.chmodSync(source,0o600);provisionInstalledEgress(hash);fixture.uid=402;
 const config=readInstalledEgressConfiguration(lifetime);fs.writeFileSync(join(fixture.root,'egress-state/provider-credentials.json'),'{}\n');
 expect(()=>config.assertCurrent()).toThrow('configuration_changed');
});
it('actual installed service rejects prepared intent despite both target and credential files existing',async()=>{
 provisionInstalledEgress(hash);
 const path=join(fixture.root,'egress-provision.json'),intent=JSON.parse(fs.readFileSync(path,'utf8'));intent.state='prepared';fs.chmodSync(path,0o600);fs.writeFileSync(path,JSON.stringify(intent)+'\n');fs.chmodSync(path,0o440);
 fixture.uid=402;await expect(startInstalledCompositeEgress()).rejects.toThrow();expect(fixture.constructed).toBe(0);
});
