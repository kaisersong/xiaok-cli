// @vitest-environment node
import {it,expect,vi,afterEach} from 'vitest';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAssistantQualityFilePorts} from '../../electron/assistant-quality-files.js';
const roots:string[]=[];
const original={fstatSync:fs.fstatSync,readFileSync:fs.readFileSync,readSync:fs.readSync};
afterEach(()=>{vi.restoreAllMocks();fs.fstatSync=original.fstatSync;fs.readFileSync=original.readFileSync;fs.readSync=original.readSync;syncBuiltinESMExports();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
it('bounds consumed bytes when a native-selected regular file grows after the held stat',async()=>{
 let injected=false;
 const root=fs.mkdtempSync(join(tmpdir(),'quality-growing-'));roots.push(root);const file=join(root,'review.json'),max=64;
 fs.writeFileSync(file,'{}');let fileReadBytes=0,syncReadBytes=0;
 fs.fstatSync=((fd:number)=>{
  const held=original.fstatSync(fd);if(!injected){injected=true;fs.appendFileSync(file,Buffer.alloc(1024*1024));}return held;
 }) as typeof fs.fstatSync;
 fs.readFileSync=((fd:number)=>{
  const data=original.readFileSync(fd);fileReadBytes+=data.length;return data;
 }) as typeof fs.readFileSync;
 fs.readSync=((fd:number,buffer:Buffer,offset:number,length:number,position:number|null)=>{
  const count=original.readSync(fd,buffer,offset,length,position);syncReadBytes+=count;return count;
 }) as typeof fs.readSync;
 syncBuiltinESMExports();
 const ports=createAssistantQualityFilePorts({chooseOpen:async()=>file,chooseSave:async()=>null});
 await expect(ports.open(max)).rejects.toThrow('assistant_quality_file_changed');
 expect(Math.max(fileReadBytes,syncReadBytes)).toBeLessThanOrEqual(max+1);
});
it('handles actual short reads and decodes complete UTF-8 once',async()=>{
 fs.readSync=((fd:number,buffer:Buffer,offset:number,length:number,position:number|null)=>original.readSync(fd,buffer,offset,Math.min(2,length),position)) as typeof fs.readSync;
 syncBuiltinESMExports();
 const root=fs.mkdtempSync(join(tmpdir(),'quality-short-'));roots.push(root);const file=join(root,'review.json'),contents='{"标签":"人工"}';fs.writeFileSync(file,contents);
 const ports=createAssistantQualityFilePorts({chooseOpen:async()=>file,chooseSave:async()=>null});
 expect(await ports.open(Buffer.byteLength(contents))).toBe(contents);
});
