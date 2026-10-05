import {mkdtempSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import {ToolRegistry} from '../../../src/ai/tools/index.js';
import {bashTool} from '../../../src/ai/tools/bash.js';
import {mcpTestContext} from '../../support/mcp-cancellation-context.js';
const clean:Array<()=>void>=[];afterEach(()=>clean.splice(0).reverse().forEach(f=>f()));
function fixture(){const root=mkdtempSync(join(tmpdir(),'compound-isolated-bash-'));clean.push(()=>rmSync(root,{recursive:true,force:true}));const registry=new ToolRegistry({autoMode:true},[bashTool]);clean.push(()=>registry.dispose());return{root,registry};}
it('compound native bash cannot fall through to an unsupervised host shell',async()=>{
 const f=fixture();const result=await f.registry.executeTool('bash',{command:'printf unsafe > marker',workdir:f.root},{...mcpTestContext(),compoundPhase:{}});
 expect(result).toContain('compound_isolated_execution_required');expect(existsSync(join(f.root,'marker'))).toBe(false);
});
it('native final authorization invokes the fixed host isolated port with frozen actual command parameters',async()=>{
 const f=fixture(),executeIsolatedCommand=vi.fn(async actual=>{expect(Object.isFrozen(actual)).toBe(true);return 'qualified backend result';});
 const result=await f.registry.executeTool('bash',{command:'printf isolated > marker',workdir:f.root,timeout_ms:71,max_chars:500},{...mcpTestContext(),compoundPhase:{executeIsolatedCommand} as any});
 expect(result).toBe('qualified backend result');expect(executeIsolatedCommand).toHaveBeenCalledWith({command:'printf isolated > marker',workdir:f.root,timeoutMs:71,maxChars:500},expect.any(Function));expect(existsSync(join(f.root,'marker'))).toBe(false);
});
