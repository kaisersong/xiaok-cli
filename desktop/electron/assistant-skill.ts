import {realpathSync,statSync,openSync,fstatSync,readSync,closeSync,constants} from 'node:fs';
import {join,relative,isAbsolute,sep} from 'node:path';
import {getBundledSkillRoots} from '../../src/ai/skills/defaults.js';
import {parseFrontmatter} from '../../src/ai/skills/loader.js';
/** One curated bundled skill; no general catalog, user/project/plugin overrides or executable resources. */
export function loadAssistantSkillInstructions():string {
 for(const root of getBundledSkillRoots()){
  let raw:string;
  try{
   const realRoot=realpathSync(root),file=realpathSync(join(root,'xiaok-assistant','SKILL.md')),local=relative(realRoot,file);
   if(!local||isAbsolute(local)||local==='..'||local.startsWith('..'+sep))throw Error('assistant_builtin_skill_invalid');
   const expected=statSync(file);if(!expected.isFile()||expected.size>16000)throw Error('assistant_builtin_skill_invalid');
   const fd=openSync(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
   try{const actual=fstatSync(fd);if(!actual.isFile()||actual.size>16000||actual.ino!==expected.ino||actual.dev!==expected.dev)throw Error('assistant_builtin_skill_invalid');const buffer=Buffer.alloc(16001);const length=readSync(fd,buffer,0,buffer.length,0);if(length>16000)throw Error('assistant_builtin_skill_invalid');raw=buffer.subarray(0,length).toString('utf8');}
   finally{closeSync(fd);}
  }
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;if(error instanceof Error&&error.message==='assistant_builtin_skill_invalid')throw error;throw Error('assistant_builtin_skill_unavailable');}
  if(Buffer.byteLength(raw)>16000)throw Error('assistant_builtin_skill_invalid');
  const skill=parseFrontmatter(raw);
  if(skill?.name!=='xiaok-assistant')throw Error('assistant_builtin_skill_invalid');
  return `\n\n## 内置技能：小K助理\n${skill.content}`;
 }
 throw Error('assistant_builtin_skill_unavailable');
}
