import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {it,expect,vi,afterEach} from 'vitest';
const {spawn}=vi.hoisted(()=>({spawn:vi.fn()}));vi.mock('child_process',()=>({spawn}));
import {createBashTool} from '../../../src/ai/tools/bash.js';
afterEach(()=>{vi.restoreAllMocks();spawn.mockReset();});
it('Windows elevation detection survives stdout/stderr interleaving before actual exit',async()=>{
 vi.spyOn(process,'platform','get').mockReturnValue('win32');
 const child=Object.assign(new EventEmitter(),{pid:1234,stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn(),unref:vi.fn()});
 spawn.mockImplementation((command:string)=>{
  if(command==='taskkill'){queueMicrotask(()=>child.emit('close',null));return Object.assign(new EventEmitter(),{unref:vi.fn()});}
  queueMicrotask(()=>{child.stdout.write('adminis');child.stderr.write('progress\n');child.stdout.write('trator privileges are required');});return child;
 });
 const result=await createBashTool().execute({command:'fixture',timeout_ms:1000,max_chars:1024});
 expect(result).toContain('管理员权限');expect(result).not.toContain('超时');
 expect(spawn).toHaveBeenCalledWith('taskkill',expect.any(Array),expect.any(Object));
});
