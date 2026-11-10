import {captureGithubReadData,captureGithubOpaqueRecord,githubReadRecord as record,githubReadFields as fields,githubReadTest as test,githubReadHash as hash,githubReadId as id,githubReadText as text,githubReadFreeze as freeze,githubReadFail as fail,decodeGithubProviderBytes,type GithubEntry,type GithubRepository} from './dsh-github-read-data.js';
import {types} from 'node:util';
const apply=Reflect.apply,lower=String.prototype.toLowerCase,safeInteger=Number.isSafeInteger;
const descriptor=Object.getOwnPropertyDescriptor,own=Object.hasOwn,isProxy=types.isProxy;
export interface GithubRepositoryCandidate {owner:string;repo:string}
export function parseGithubRepositoryCandidate(raw:unknown):GithubRepositoryCandidate {const r=record(captureGithubReadData(raw));fields(r,['owner','repo']);if(typeof r.owner!=='string'||!test(/^[A-Za-z0-9-]{1,39}$/,r.owner)||typeof r.repo!=='string'||!test(/^[A-Za-z0-9_.-]{1,100}$/,r.repo)||r.repo==='.'||r.repo==='..')fail();return freeze({owner:apply(lower,r.owner,[]) as string,repo:apply(lower,r.repo,[]) as string});}
export interface GithubSetupRepositoryPlan {schemaVersion:1;kind:'repository_discovery';method:'GET';origin:'https://api.github.com';pathname:string;query:readonly [];boundRepository:null;candidateRepository:GithubRepositoryCandidate;parentIssue:null;expectedBody:'';planHash:string}
export function planGithubSetupRepositoryGet(raw:unknown):GithubSetupRepositoryPlan {const candidateRepository=parseGithubRepositoryCandidate(raw),data={schemaVersion:1 as const,kind:'repository_discovery' as const,method:'GET' as const,origin:'https://api.github.com' as const,pathname:`/repos/${candidateRepository.owner}/${candidateRepository.repo}`,query:[] as [],boundRepository:null,candidateRepository,parentIssue:null,expectedBody:'' as const};return freeze({...data,planHash:hash('dsh-github-setup-repository-plan-v1',data)});}
export interface GithubSetupRepositoryPage {kind:'repository_discovery';completeness:'complete'|'partial';rawBodyHash:string;entry:GithubEntry<GithubRepository>}
export function decodeGithubSetupRepository(raw:unknown):GithubSetupRepositoryPage {
 const r=captureGithubOpaqueRecord(raw,['candidateRepository','bytes','maxBytes']);const slot=descriptor(r,'bytes');if(!slot||!own(slot,'value'))fail();const candidate=parseGithubRepositoryCandidate(r.candidateRepository),parsed=decodeGithubProviderBytes(slot.value,r.maxBytes as number);let entry:GithubEntry<GithubRepository>;
 try{const value=record(parsed.value),owner=record(value.owner),repository={id:id(value.id),nodeId:text(value.node_id),owner:text(owner.login),repo:text(value.name),ownerId:id(owner.id)};entry=apply(lower,repository.owner,[])===candidate.owner&&apply(lower,repository.repo,[])===candidate.repo?{kind:'value',value:repository}:{kind:'unavailable',reason:'SCOPE_MISMATCH'};}catch{entry={kind:'unavailable',reason:'PROVIDER_OBJECT_INVALID'};}
 return freeze({kind:'repository_discovery',completeness:entry.kind==='value'?'complete':'partial',rawBodyHash:parsed.rawBodyHash,entry});
}

import {parseGithubBoundRepository,decodeGithubObject,type GithubBoundRepository,type GithubObjectV1} from './dsh-github-read-data.js';
export interface GithubIssueIdentityPlan {schemaVersion:1;kind:'issue_identity';method:'GET';origin:'https://api.github.com';pathname:string;query:readonly [];boundRepository:GithubBoundRepository;parentIssue:null;commentId:null;page:null;since:null;labelNames:readonly [];expectedBody:'';expectedIssueId:string;issueNumber:number;planHash:string}
export function planGithubIssueIdentityGet(raw:unknown):GithubIssueIdentityPlan {
 const r=record(captureGithubReadData(raw));fields(r,['boundRepository','expectedIssueId','issueNumber']);const bound=parseGithubBoundRepository(r.boundRepository),expectedIssueId=id(r.expectedIssueId);
 if(typeof r.expectedIssueId!=='string'||typeof r.issueNumber!=='number'||!safeInteger(r.issueNumber)||r.issueNumber<1)fail();
 const data={schemaVersion:1 as const,kind:'issue_identity' as const,method:'GET' as const,origin:'https://api.github.com' as const,pathname:`/repos/${bound.owner}/${bound.repo}/issues/${r.issueNumber}`,query:[] as [],boundRepository:bound,parentIssue:null,commentId:null,page:null,since:null,labelNames:[] as [],expectedBody:'' as const,expectedIssueId,issueNumber:r.issueNumber};
 return freeze({...data,planHash:hash('dsh-github-issue-identity-plan-v1',data)});
}
export interface GithubIssueIdentityPage {kind:'issue_identity';completeness:'complete'|'partial';rawBodyHash:string;entry:GithubEntry<GithubObjectV1>}
export function decodeGithubIssueIdentity(raw:unknown):GithubIssueIdentityPage {
 const r=captureGithubOpaqueRecord(raw,['boundRepository','expectedIssueId','issueNumber','bytes','maxBytes','representationTag']),plan=planGithubIssueIdentityGet({boundRepository:r.boundRepository,expectedIssueId:r.expectedIssueId,issueNumber:r.issueNumber}),parsed=decodeGithubProviderBytes(r.bytes,r.maxBytes as number);
 let entry=decodeGithubObject({schemaVersion:1,kind:'issue',raw:parsed.value,boundRepository:plan.boundRepository,parentIssue:null,representationTag:r.representationTag});
 if(entry.kind==='value'&&(entry.value.objectId!==plan.expectedIssueId||entry.value.issueNumber!==plan.issueNumber))entry={kind:'unavailable',reason:'SCOPE_MISMATCH'};
 return freeze({kind:'issue_identity',completeness:entry.kind==='unavailable'||entry.kind==='value'&&entry.value.completeness!=='complete'?'partial':'complete',rawBodyHash:parsed.rawBodyHash,entry});
}
