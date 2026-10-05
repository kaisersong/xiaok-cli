import {expect,it} from 'vitest';
import {isMaterialPathInside,validateMaterialTaskId} from '../../../src/runtime/task-host/material-paths.js';
it.each([
 ['C:\\root\\task\\file','c:/ROOT',true],['D:\\root\\file','C:\\root',false],['C:\\rooted\\file','C:\\root',false],
 ['\\\\server\\share\\root\\file','\\\\SERVER\\SHARE\\root',true],['\\\\server\\other\\root\\file','\\\\server\\share\\root',false],
 ['C:\\root\\..foo\\file','C:\\root',true],['C:\\root\\..\\escape','C:\\root',false],
] as const)('uses Windows containment for %s', (child,parent,expected)=>expect(isMaterialPathInside(child,parent,'win32')).toBe(expected));
it.each(['CON','nul.txt','LPT9.md','task.','task ','a:b','..','a/b','a\\b'])('rejects unsafe portable task directory %s',value=>expect(()=>validateMaterialTaskId(value)).toThrow());
it('keeps ordinary Unicode and dotted identifiers',()=>{expect(()=>validateMaterialTaskId('用户任务.v2')).not.toThrow();expect(isMaterialPathInside('/root/..foo/file','/root','posix')).toBe(true);});
