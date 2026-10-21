import {realpathSync,statSync,accessSync,constants} from 'node:fs';
import {resolve} from 'node:path';
/** Explicit user-selected files only. This runs as the product's user, not the
 * privileged service. Controller must independently prove caller access; these
 * paths and sizes are a request, never an authorization or OS attestation. */
export function selectExplicitValidationFiles(paths:readonly string[],cwd:string):Array<{path:string;byteLimit:number}>{
 if(!Array.isArray(paths)||!paths.length||paths.length>1024)throw Error('validation_material_selection_required');
 const seen=new Set<string>();let total=0;
 const result=paths.map(selected=>{
  if(typeof selected!=='string'||!selected.trim()||selected.includes('\0'))throw Error('validation_material_invalid_path');
  const path=realpathSync(resolve(cwd,selected));
  if(seen.has(path))throw Error('validation_material_duplicate_file');seen.add(path);
  const stat=statSync(path);if(!stat.isFile())throw Error('validation_material_regular_file_required');
  accessSync(path,constants.R_OK);
  const byteLimit=Math.max(1,stat.size);total+=byteLimit;
  if(!Number.isSafeInteger(byteLimit)||total>2*1024**3)throw Error('validation_material_selection_limit');
  return Object.freeze({path,byteLimit});
 });
 return Object.freeze(result) as unknown as Array<{path:string;byteLimit:number}>;
}
