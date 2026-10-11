import {realpathSync,statSync} from 'node:fs';
import {isAbsolute,join,relative,resolve,sep} from 'node:path';
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value:unknown)=>typeof value==='string'?value.trim():'';
/** Only current project submission files are granted as read-only references. */
export function resolveKSwarmReviewReadPaths(payload:Record<string,unknown>,detail:unknown):string[]{
 if(!record(detail)||!record(detail.project)||detail.project.id!==payload.projectId)return [];
 const workspace=record(detail.workspace)?detail.workspace:{};
 const projectRoot=text(detail.project.workFolder)||text(workspace.path);
 const artifactsRoot=text(detail.project.artifactsDir)||(projectRoot?join(projectRoot,'artifacts'):'');
 const result=record(payload.result)?payload.result:{};
 if(!artifactsRoot||!Array.isArray(result.artifacts))return [];
 const files=new Set<string>();let root:string;try{root=realpathSync(artifactsRoot);}catch{return [];}
 for(const artifact of result.artifacts){
  const raw=typeof artifact==='string'?artifact:record(artifact)?text(artifact.path)||text(artifact.filename):'';
  if(!raw)continue;
  try{const file=realpathSync(isAbsolute(raw)?raw:resolve(artifactsRoot,raw.replace(/^artifacts[\\/]/,'')));const rel=relative(root,file);if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)||!statSync(file).isFile())continue;files.add(file);}catch{/* Missing evidence remains unavailable; never widen the scope. */}
 }
 return [...files];
}
