import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
export const ORIGINAL_SERVICES_CANDIDATE_SOURCE_SHA256='9272b770cf0110ce404ec6575d2afa583231cc27cd7ac3cf6b25596d5a472d6c';
const alias='__fixedOriginalCandidateObservation';
const targets=[['runKSwarmHandoffTask','kswarm_direct'],['runWorkspaceProjectTask','room_project']];
function prefix(url){
 if(basename(fileURLToPath(url))!=='accepted-root-candidate-observation.mjs')throw Error('FIXTURE_CANDIDATE_COMPANION');
 return `import {recordOriginalCandidate as ${alias}} from ${JSON.stringify(url)};\n`;
}
function insertion(kind){return `\n${alias}(${JSON.stringify(kind)},originalRootCandidate);\n`;}
export function restoreOriginalCandidateServices(contents,url){
 let source=contents;const header=prefix(url);
 if(!source.startsWith(header))throw Error('FIXTURE_CANDIDATE_INVERSE');source=source.slice(header.length);
 for(const [,kind] of targets){const value=insertion(kind),at=source.indexOf(value);if(at<0||source.indexOf(value,at+1)>=0)throw Error('FIXTURE_CANDIDATE_INVERSE');source=source.slice(0,at)+source.slice(at+value.length);}
 return Buffer.from(source,'utf8');
}
export function instrumentOriginalCandidateServices(bytes,url){
 if(!Buffer.isBuffer(bytes))throw Error('FIXTURE_CANDIDATE_SOURCE_BYTES');
 const sha=createHash('sha256').update(bytes).digest('hex');if(sha!==ORIGINAL_SERVICES_CANDIDATE_SOURCE_SHA256)throw Error('FIXTURE_CANDIDATE_SOURCE_SHA');
 const raw=bytes.toString('utf8');if(!Buffer.from(raw).equals(bytes)||raw.includes(alias))throw Error('FIXTURE_CANDIDATE_SOURCE_ENCODING');
 const parsed=ts.createSourceFile('desktop-services.ts',raw,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),edits=[];
 if(parsed.parseDiagnostics.length)throw Error('FIXTURE_CANDIDATE_SOURCE_PARSE');
 for(const [name,kind] of targets){
  const found=[];function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text===name)found.push(node);ts.forEachChild(node,visit);}visit(parsed);
  if(found.length!==1)throw Error('FIXTURE_CANDIDATE_AST_UNIQUE');const fn=found[0];
  if(!fn.body||!fn.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword)||fn.parameters.length!==1||!ts.isObjectBindingPattern(fn.parameters[0].name)||fn.parameters[0].name.elements.filter(e=>ts.isIdentifier(e.name)&&e.name.text==='originalRootCandidate').length!==1)throw Error('FIXTURE_CANDIDATE_AST_SHAPE');
  edits.push({at:fn.body.getStart(parsed)+1,text:insertion(kind)});
 }
 let contents=raw;for(const edit of edits.sort((a,b)=>b.at-a.at))contents=contents.slice(0,edit.at)+edit.text+contents.slice(edit.at);contents=prefix(url)+contents;
 if(ts.createSourceFile('observed.ts',contents,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS).parseDiagnostics.length||!restoreOriginalCandidateServices(contents,url).equals(bytes))throw Error('FIXTURE_CANDIDATE_INVERSE');
 return {contents,targets:edits.length,originalSha256:sha};
}
export function originalCandidateObservationPlugin(repo,companionUrl){
 const source=resolve(repo,'desktop/electron/desktop-services.ts');
 return {name:'original-candidate-fixture-observation',setup(build){build.onLoad({filter:/desktop-services\.ts$/},args=>{if(resolve(args.path)!==source)return;const transformed=instrumentOriginalCandidateServices(readFileSync(source),companionUrl);return {contents:transformed.contents,loader:'ts',resolveDir:dirname(source)};});}};
}
