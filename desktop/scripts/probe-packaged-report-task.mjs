import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
const [adapter, bundle, root] = process.argv.slice(2);
const { createMcpClientConnection } = await import(pathToFileURL(adapter).href);
const connection = await createMcpClientConnection('packaged-report-contract', {
  type: 'stdio', command: process.execPath, args: [bundle],
  env: { XIAOK_REPORT_TASKS_ROOT: join(root, 'report-tasks'), ELECTRON_RUN_AS_NODE: '1' },
  protocol: { mode: 'modern', version: '2026-07-28' }, timeout: { startup: 5000, call: 5000 },
}, { cwd: root, clientName: 'xiaok-pack-contract' });
let execution;
try {
  if (connection.protocolEra !== 'modern' || !connection.tasks?.capabilities.execution) throw new Error('MCP Tasks capability absent');
  const output = join(root, 'contract.html');
  execution = await connection.tasks.callTool('render_report', {
    ir_content: '---\ntitle: Packaging contract\ntheme: corporate-blue\nreport_class: mixed\n---\n\n## Contract\n\n:::kpi\nitems:\n  - label: Verified\n    value: 1\n:::\n', output_path: output,
  }, { requestTimeoutMs: 5000 });
  if (execution.kind !== 'task') throw new Error('render_report returned synchronously instead of a durable Tasks handle');
  const settled = await execution.settle({ close: false, signal: AbortSignal.timeout(5000) });
  if (settled.outcome.status !== 'completed' || settled.outcome.result?.isError) throw new Error('report task did not complete successfully');
  if (!readFileSync(output, 'utf8').includes('Packaging contract')) throw new Error('report output absent');
} finally {
  await execution?.detach();
  await connection.client.close();
  connection.dispose();
}
