import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createWorkflowScriptPreview } from '../../desktop/electron/workflow-script-contract.js';
import { REPORT_FINAL_REVIEW_WORKFLOW_SCRIPT_EXAMPLE } from '../../desktop/electron/kswarm-dynamic-workflow-script-tool.js';

type EvalCase = {
  id: string;
  template: 'report_final_review';
  expectedWorkflowId: string;
  minAgentCalls: number;
  minParallelCalls: number;
  requiredLabels: string[];
};

type EvalFixture = {
  cases: EvalCase[];
};

const TEMPLATE_SCRIPTS: Record<EvalCase['template'], string> = {
  report_final_review: REPORT_FINAL_REVIEW_WORKFLOW_SCRIPT_EXAMPLE,
};

function main(): void {
  const fixture = readFixture();
  const failures: string[] = [];

  for (const item of fixture.cases) {
    const script = TEMPLATE_SCRIPTS[item.template];
    const preview = createWorkflowScriptPreview(script, {
      projectId: 'eval-project',
      requestedBy: 'eval',
    });

    if (!preview.ok) {
      failures.push(`${item.id}: preview failed with ${preview.error}`);
      continue;
    }
    if (preview.workflowId !== item.expectedWorkflowId) {
      failures.push(`${item.id}: expected workflowId ${item.expectedWorkflowId}, got ${preview.workflowId}`);
    }
    if ((preview.analysis.agentCallCount || 0) < item.minAgentCalls) {
      failures.push(`${item.id}: expected at least ${item.minAgentCalls} agent calls`);
    }
    if ((preview.analysis.parallelCallCount || 0) < item.minParallelCalls) {
      failures.push(`${item.id}: expected at least ${item.minParallelCalls} parallel calls`);
    }
    for (const label of item.requiredLabels) {
      if (!script.includes(label)) failures.push(`${item.id}: missing required label ${label}`);
    }
  }

  console.log('Dynamic Workflow Parallel Eval');
  console.log('');
  if (failures.length === 0) {
    console.log(`PASS dynamic-workflow-parallel: ${fixture.cases.length}/${fixture.cases.length}`);
    return;
  }

  console.log(`FAIL dynamic-workflow-parallel: ${fixture.cases.length - failures.length}/${fixture.cases.length}`);
  for (const failure of failures) console.log(`- ${failure}`);
  process.exit(1);
}

function readFixture(): EvalFixture {
  const file = resolve(process.cwd(), 'evals/dynamic-workflow-parallel.cases.json');
  return JSON.parse(readFileSync(file, 'utf8')) as EvalFixture;
}

main();
