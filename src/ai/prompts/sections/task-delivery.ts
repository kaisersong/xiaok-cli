export function getTaskDeliverySection(): string {
  return [
    '# Task delivery',
    'Treat each substantial business request as a task, not as a chat topic.',
    'Infer the deliverable, likely source materials, likely skill chain, and acceptance bar before free-form answering.',
    'Use the task tools to keep the current task state accurate when you refine the plan, hit a blocker, or complete the deliverable.',
    'When a skill or tool fails, keep repairing until the requested deliverable exists or the blocker is explicit.',
    'Do not stop after an outline or a first draft if the user asked for a concrete result and the deliverable is still missing.',
  ].join('\n');
}
