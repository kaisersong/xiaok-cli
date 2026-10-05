import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
import {createMaterialAuthority} from '../../../src/runtime/verification/material-authority.js';
import {canonicalVerificationJson} from '../../../src/runtime/verification/protocol.js';
it('passes the original frozen continuous deadline into native review without restarting its TTL',async()=>{
 const root=mkdtempSync(join(tmpdir(),'material-native-deadline-')),db=openPrivateVerificationDatabase(root);let now=100,wall=1000;let received:unknown;
 const peer={uid:501,gid:20,auditSessionId:10},signal=new AbortController().signal;
 const authority=createMaterialAuthority({database:db,engineBinding:{engineId:'e',incarnation:'b'},clock:()=>({domainId:'clock',qualificationEpoch:1,lowerBound:now,upperBound:now,evidenceHash:'a'.repeat(64)}),wallNow:()=>wall,inspectFile:async()=>({sha256:'a'.repeat(64),size:3,executable:false}),
  approve:async(...args:any[])=>{received=args[3];const [p,review]=args;return {uid:p.uid,auditSessionId:p.auditSessionId,reviewHash:createHash('sha256').update(canonicalVerificationJson(review)).digest('hex')};},acceptPlan(){},discardPlan(){},stage:async()=>{throw Error('not staged');}});
 try{
  const challenge=await authority.prepare({purpose:'isolated-command',invocation:{sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v'},materials:[{path:'/workspace/input',byteLimit:10}],exactCommand:{argv:['/bin/true'],cwdRelative:'.'},expiresAt:2000},peer,signal);
  const persisted=JSON.parse((db.prepare('SELECT record_json FROM material_authority_challenges WHERE id=?').get(challenge.challengeId) as {record_json:string}).record_json).deadline;
  now=600;wall=900;await authority.authorize(challenge.challengeId,peer,signal);
  expect(received).toEqual(persisted);expect(Object.isFrozen(received)).toBe(true);
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
