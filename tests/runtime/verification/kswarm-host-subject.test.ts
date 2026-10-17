import {expect,it} from 'vitest';
import {parseKSwarmHostSubject,kswarmHostSubjectHash} from '../../../src/runtime/verification/kswarm-host-subject.js';
const project={version:1,projectId:'project-original',taskId:null};
it('captures immutable original project and task descriptors without granting an owner',()=>{
 const original={...project},captured=parseKSwarmHostSubject(original);original.projectId='changed';
 expect(captured).toEqual(project);expect(Object.isFrozen(captured)).toBe(true);
 expect(Object.keys(captured).sort()).toEqual(['projectId','taskId','version']);
 expect(parseKSwarmHostSubject({...project,taskId:'task-original'}).taskId).toBe('task-original');
 expect(parseKSwarmHostSubject(Object.assign(Object.create(null),project))).toEqual(project);
});
it('hashes the whole original descriptor independently of key insertion order',()=>{
 expect(kswarmHostSubjectHash({taskId:null,version:1,projectId:project.projectId})).toBe(kswarmHostSubjectHash(project));
 const all=[project,{...project,taskId:'task'}, {...project,taskId:'task-2'}, {...project,taskId:'task',projectId:'other-project'}];
 expect(new Set(all.map(kswarmHostSubjectHash)).size).toBe(all.length);
});
it('retains whitespace, case and Unicode including old lone surrogate identities',()=>{
 const ids=['é','e\u0301','É',' é','é ','\ud800','\ud801','\ufffd','\\ud800','😀'];
 expect(new Set(ids.map(projectId=>kswarmHostSubjectHash({...project,projectId}))).size).toBe(ids.length);
 for(const projectId of ids)expect(parseKSW(projectId).projectId).toBe(projectId);
 function parseKSW(projectId:string){return parseKSwarmHostSubject({...project,projectId});}
});
it('uses actual UTF-8 byte bounds for both identities',()=>{
 for(const key of ['projectId','taskId']){
  for(const id of ['a'.repeat(160),'中'.repeat(53)+'a','😀'.repeat(40)])expect(parseKSwarmHostSubject({...project,[key]:id})).toMatchObject({[key]:id});
  for(const id of ['a'.repeat(161),'中'.repeat(54),'😀'.repeat(41)])expect(()=>parseKSwarmHostSubject({...project,[key]:id})).toThrow();
 }
});
it.each([null,undefined,[],1,'project',{...project,version:'1'},{...project,version:2},{...project,taskId:undefined},
 {...project,projectId:''},{...project,taskId:''},{...project,projectId:'a\0b'},{...project,taskId:'a\n'},
 {...project,projectId:'a\x7f'},{...project,taskId:{}},{...project,ownerId:'fake'},{...project,runId:'fake'},
 {version:1,projectId:'p'}, {projectId:'p',taskId:null}, {...project,[Symbol('extra')]:true},
 Object.assign(Object.create({inherited:true}),project),new Date(),new String('project')
])('rejects invalid shape or identity',raw=>expect(()=>parseKSwarmHostSubject(raw)).toThrow());
it('rejects getters and hidden fields without executing accessors',()=>{
 let calls=0;
 for(const key of ['version','projectId','taskId','extra']){
  const raw={...project};Object.defineProperty(raw,key,{enumerable:true,get(){calls++;return 'fake';}});
  expect(()=>parseKSwarmHostSubject(raw)).toThrow();
 }
 for(const key of ['version','projectId','taskId','extra']){
  const raw={...project};Object.defineProperty(raw,key,{enumerable:false,value:key==='extra'?'hidden':raw[key as keyof typeof raw]});
  expect(()=>parseKSwarmHostSubject(raw)).toThrow();
 }
 expect(calls).toBe(0);
});
it('rejects normal and revoked proxies before all traps',()=>{
 let calls=0;const trap=()=>{calls++;throw Error('trap');};
 const raw=new Proxy(project,{get:trap,getPrototypeOf:trap,ownKeys:trap,getOwnPropertyDescriptor:trap});
 expect(()=>parseKSwarmHostSubject(raw)).toThrow();expect(()=>kswarmHostSubjectHash(raw)).toThrow();
 const revoked=Proxy.revocable(project,{});revoked.revoke();expect(()=>parseKSwarmHostSubject(revoked.proxy)).toThrow();expect(calls).toBe(0);
});
