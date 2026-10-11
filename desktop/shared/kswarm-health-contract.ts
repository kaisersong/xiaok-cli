/** Base dynamic workflows remain usable when optional pattern-v1 support is absent. */
export function hasDynamicWorkflowSupport(body: Record<string, unknown> | null): boolean {
  return Array.isArray(body?.features) && body.features.includes('dynamic_workflows');
}

export function hasWorkflowPatternCapabilities(body: Record<string, unknown> | null): boolean {
  const capabilities = body?.workflowCapabilities;
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) return false;
  const record = capabilities as Record<string, unknown>;
  return record.schemaVersion === 'kswarm_workflow_patterns_v1'
    && record.compiledContract === true && record.patternPublicView === true;
}
