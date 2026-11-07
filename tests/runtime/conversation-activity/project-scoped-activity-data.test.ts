import {beforeAll,afterAll,it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {parseScopedProjectActivityPage} from '../../../src/runtime/conversation-activity/project-scoped-activity-data.js';
import {parseProjectActivityPage,PROJECT_ACTIVITY_BODY_LIMIT} from '../../../src/runtime/conversation-activity/project-delivery-data.js';
let root:string,body:any;
const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)};
const expected=()=>({...scope,projectId:'p',sourceDataEpoch:body.page.sourceDataEpoch,after:0});
beforeAll(()=>{
 root=mkdtempSync(join(tmpdir(),'scoped-page-original-producer-'));
 const script=String.raw`const{createHub}=await import(process.argv[1]),{createProjectInputAuthority}=await import(process.argv[2]),{writeFileSync}=await import('node:fs'),{join}=await import('node:path');
 const root=process.argv[3],authority=createProjectInputAuthority({profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)}),hub=createHub({silent:true,dataDir:{backend:'sqlite',filePath:join(root,'state.sqlite')},brokerClient:{async getRoomSnapshot(){return{ok:true,room:{status:'active'},members:[{status:'active',subject:{kind:'agent',logicalAgentId:'po'}}]};},async acquireRoomMembershipLease(){return{ok:true};}}});
 try{await hub.createProject({id:'p',name:'P',goal:'actual scoped read',poAgent:'po',primaryRoomId:'room',autoAssignPo:false},{requestSource:'user',projectInputAuthority:authority.creator('scoped-create')});const result=hub.readScopedProjectActivity('p',{after:0,limit:200},authority.reader());if(!result.ok)throw Error(JSON.stringify(result));writeFileSync(join(root,'body.json'),JSON.stringify(result));}finally{hub.closePersistence();}`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',script,...['hub.js','project-input-authority.js'].map(name=>pathToFileURL(resolve('..','kswarm','src','core',name)).href),root],{encoding:'utf8',timeout:10000});
 console.log(JSON.stringify({test:'scoped-page-original-B-producer',pid:child.pid,status:child.status,signal:child.signal,reaped:true}));if(child.error)throw child.error;if(child.status!==0)throw Error(child.stderr||child.stdout);body=JSON.parse(readFileSync(join(root,'body.json'),'utf8'));
});
afterAll(()=>{if(root)rmSync(root,{recursive:true,force:true});});
it('parses the actual original B scoped envelope as data without issuing a source witness',()=>{
 const result=parseScopedProjectActivityPage(body,expected());expect(result.protocol).toBe('scoped_project_activity_v1');expect(result.scope).toEqual(scope);expect(result.page.snapshot.id).toBe('p');expect(result.bindingDigest).toBe(body.bindingDigest);
});
it.each(['project','profile','workspace','digest','future','extra','scope_extra'])('refuses a conflicting %s scoped envelope',kind=>{
 const raw=structuredClone(body);if(kind==='project')raw.projectId='q';if(kind==='profile')raw.scope.profileId='c'.repeat(64);if(kind==='workspace')raw.scope.workspaceId='d'.repeat(64);if(kind==='digest')raw.bindingDigest='unverified';if(kind==='future')raw.protocol='scoped_project_activity_v999';if(kind==='extra')raw.executionGranted=true;if(kind==='scope_extra')raw.scope.executionGranted=true;
 expect(()=>parseScopedProjectActivityPage(raw,expected())).toThrow();
});
it('refuses getters and proxies in both the scope envelope and the expected fixed audience without invoking them',()=>{
 let calls=0;const raw=structuredClone(body);Object.defineProperty(raw.scope,'profileId',{enumerable:true,get(){calls++;return scope.profileId;}});
 expect(()=>parseScopedProjectActivityPage(raw,expected())).toThrow();expect(()=>parseScopedProjectActivityPage(new Proxy(body,{ownKeys(){calls++;return[];}}),expected())).toThrow();
 const audience=expected();Object.defineProperty(audience,'profileId',{enumerable:true,get(){calls++;return scope.profileId;}});expect(()=>parseScopedProjectActivityPage(body,audience)).toThrow();expect(calls).toBe(0);
});
it('retains the original pure page validation and unknown delivery semantics',()=>{
 const raw=structuredClone(body);raw.page.delivery={status:'unavailable',reasonCode:'SNAPSHOT_INCOMPLETE'};expect(parseScopedProjectActivityPage(raw,expected()).page.delivery.status).toBe('unavailable');raw.page.snapshot.id='q';expect(()=>parseScopedProjectActivityPage(raw,expected())).toThrow();
});
it('bounds the original encoded envelope before an unknown delivery payload is reduced to unavailable',()=>{
 const raw=structuredClone(body);raw.page.delivery={payload:''};const base=Buffer.byteLength(JSON.stringify(raw.page));raw.page.delivery.payload='x'.repeat(PROJECT_ACTIVITY_BODY_LIMIT-base-10);
 expect(()=>parseProjectActivityPage(raw.page,expected())).not.toThrow();expect(Buffer.byteLength(JSON.stringify(raw))).toBeGreaterThan(PROJECT_ACTIVITY_BODY_LIMIT);
 expect(()=>parseScopedProjectActivityPage(raw,expected())).toThrow();
});
it.each(['ok','protocol','projectId','bindingDigest','profileId','workspaceId'])('rejects an object in the %s scalar without invoking nested type-detection getters',field=>{
 let calls=0;const raw=structuredClone(body),value={get then(){calls++;return undefined;}};
 if(field==='profileId'||field==='workspaceId')raw.scope[field]=value;else raw[field]=value;
 expect(()=>parseScopedProjectActivityPage(raw,expected())).toThrow();expect(calls).toBe(0);
});
