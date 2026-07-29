/**
 * Degraded project scorer: verifies ONLY that a project was successfully
 * created, by parsing the create_project tool response from the task
 * snapshot. Live project lifecycle state is owned by the KSwarm service and
 * is not present in the snapshot, so no lifecycle judgement happens here.
 *
 * The event-level ok flag is intentionally ignored: non-throwing tools are
 * always recorded with a truthy flag even when they return an error payload,
 * so success must be parsed from the response body (error key absent).
 */
export function scoreProject({ task, signals }) {
  const reasons = [];
  const results = (signals?.toolInvocations ?? []).filter(invocation => (
    invocation.type === 'result' && invocation.toolName === 'create_project'
  ));

  if (results.length === 0) {
    reasons.push('create_project-not-called');
    return Object.freeze({ passed: false, projectId: null, reasons });
  }

  for (const invocation of results) {
    let parsed;
    try {
      parsed = JSON.parse(invocation.response);
    } catch {
      continue;
    }
    if (
      typeof parsed === 'object'
      && parsed !== null
      && !Object.prototype.hasOwnProperty.call(parsed, 'error')
      && parsed.type === 'project_card'
      && typeof parsed.projectId === 'string'
      && parsed.projectId.length > 0
    ) {
      return Object.freeze({ passed: true, projectId: parsed.projectId, reasons: [] });
    }
  }

  reasons.push('create_project-response-not-a-successful-project-card');
  return Object.freeze({ passed: false, projectId: null, reasons });
}
