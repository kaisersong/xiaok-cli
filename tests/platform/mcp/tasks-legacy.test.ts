import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { createMcpClientConnection } from '../../../src/platform/mcp/transport.js';
import { callMcpToolWithTasks } from '../../../src/platform/mcp/tasks.js';

describe('actual 2025-11-25 legacy Tasks protocol', () => {
  it('uses official V1 schemas, polls a known handle, reads tasks/result, preserves isError and ordinary synchronous tools', async () => {
    const connection = await createMcpClientConnection('legacy-tasks',{type:'stdio',command:process.execPath,args:[join(process.cwd(),'tests/support/mcp-tasks-legacy-server.js')],protocol:{mode:'legacy'}});
    try {
      expect(connection.protocolEra).toBe('legacy'); expect(connection.tasks?.capabilities.execution).toBe(true);
      const catalog = await connection.client.listTools(); const handles: unknown[] = [];
      const result = await callMcpToolWithTasks(connection,{name:'work',arguments:{fail:true}},{declaration:catalog.tools[0],timeout:2000,observer:{handle:ref=>{handles.push(ref);},event:()=>{}}});
      expect(handles).toHaveLength(1); expect(handles[0]).toMatchObject({generation:'v1',taskId:'legacy-1'});
      expect(result).toMatchObject({isError:true,content:[{type:'text',text:'legacy result'}]});
      expect(await callMcpToolWithTasks(connection,{name:'ordinary',arguments:{}},{declaration:catalog.tools[1],timeout:2000})).toMatchObject({content:[{type:'text',text:'ordinary'}]});
    } finally { await connection.close(); }
  });
});
