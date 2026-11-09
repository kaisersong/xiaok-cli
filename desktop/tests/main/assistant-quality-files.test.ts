import {it,expect} from 'vitest';import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createAssistantQualityFilePorts} from '../../electron/assistant-quality-files.js';
it('uses only native-selected files, checks size before read, and checks the current grant after selection before saving',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'quality-files-')),file=join(dir,'review.json');writeFileSync(file,'{"labels":[]}');let current=true;
 const ports=createAssistantQualityFilePorts({chooseSave:async()=>{current=false;return file;},chooseOpen:async()=>file});
 try{expect(await ports.open(20)).toBe('{"labels":[]}');await expect(ports.open(2)).rejects.toThrow();await expect(ports.save('new',()=>{if(!current)throw Error('revoked');})).rejects.toThrow('revoked');expect(readFileSync(file,'utf8')).toBe('{"labels":[]}');
 const cancelled=createAssistantQualityFilePorts({chooseSave:async()=>null,chooseOpen:async()=>null});expect(await cancelled.open(20)).toBeNull();expect(await cancelled.save('new',()=>{})).toBe(false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
