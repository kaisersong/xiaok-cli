import {describe,it,expect} from 'vitest';
import {bashTool} from '../../../src/ai/tools/bash.js';
describe('actual shell tool schema',()=>{
 it.each(['win32','darwin'] as const)('describes the actual %s shell and native search tools',platform=>{
  const original=Object.getOwnPropertyDescriptor(process,'platform')!;
  try {
   Object.defineProperty(process,'platform',{...original,value:platform});
   const description=JSON.parse(JSON.stringify(bashTool.definition)).description;
   expect(description).toContain(platform==='win32' ? 'cmd /c' : 'sh -c');
   expect(description).toContain('grep');
   if(platform==='win32')expect(description).toContain('PowerShell');
  }finally{Object.defineProperty(process,'platform',original);}
 });
});
