import {expect,it} from 'vitest';
import {resolveNodeChildRuntime} from '../../src/runtime/node-child-runtime.js';
it('keeps an ordinary CLI launch on its own Node even when a legacy override exists',()=>{
 const runtime=resolveNodeChildRuntime({XIAOK_NODE_CMD:'/fixture/custom-node',PATH:'/fixture'});
 expect(runtime.command).toBe(process.execPath);expect(runtime.argsPrefix).toEqual([]);
});
it('preserves the explicit development override only for callers that previously offered it',()=>{
 const runtime=resolveNodeChildRuntime({XIAOK_NODE_CMD:'/fixture/custom-node',PATH:'/fixture'},true);
 expect(runtime.command).toBe('/fixture/custom-node');expect(runtime.argsPrefix).toEqual([]);expect(runtime.env.PATH).toBe('/fixture');
});
