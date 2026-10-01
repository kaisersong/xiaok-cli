import {afterEach,describe,expect,it,vi} from 'vitest';

// bash 的 description 是**模块初始化时求值的平台常量**，不是 getter：
// 严格 tool-context projector 只接受自有 data descriptor，getter 会让任意工具的
// 调用被 KIMI_STRICT_TOOL_CONTEXT_REJECTED 阻断（见 reviews/kimi-k3-builtin-tool-context.md）。
// 因此验证 Windows/POSIX 文案必须在改完 process.platform 后**重新导入真实模块**，
// 不能把生产常量改回 getter 去迁就 mock。
describe('actual shell tool schema',()=>{
 afterEach(()=>{vi.resetModules();});
 it.each(['win32','darwin'] as const)('describes the actual %s shell and native search tools',async platform=>{
  const original=Object.getOwnPropertyDescriptor(process,'platform')!;
  try{
   Object.defineProperty(process,'platform',{...original,value:platform});
   vi.resetModules();
   const {bashTool}=await import('../../../src/ai/tools/bash.js');
   const description=JSON.parse(JSON.stringify(bashTool.definition)).description;
   expect(description).toContain(platform==='win32' ? 'cmd /c' : 'sh -c');
   expect(description).toContain('grep');
   if(platform==='win32')expect(description).toContain('PowerShell');
  }finally{Object.defineProperty(process,'platform',original);}
 });
});
