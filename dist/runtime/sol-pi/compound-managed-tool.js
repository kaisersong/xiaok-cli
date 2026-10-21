const bindings = new WeakMap();
/** Main factory only, applied to the final scope wrapper. This is classification
 * for the coordinator's native path, never a permission bypass or readonly tag. */
export function bindManagedCompoundSpawnTool(tool, adapter) {
    if (bindings.has(tool) || typeof adapter.inspectPreparation !== 'function')
        throw Error('compound_managed_tool_binding');
    bindings.set(tool, { execute: tool.execute, permission: tool.permission, definition: JSON.stringify(tool.definition),
        adapter: Object.freeze({ ...(adapter.followup ? { followup: Object.freeze({ inspectPreparation: adapter.followup.inspectPreparation.bind(adapter.followup), inspectApplied: adapter.followup.inspectApplied.bind(adapter.followup), inspectCancelled: adapter.followup.inspectCancelled.bind(adapter.followup) }) } : {}), inspectPreparation: adapter.inspectPreparation.bind(adapter), ...(adapter.inspectResourcesReleased ? { inspectResourcesReleased: adapter.inspectResourcesReleased.bind(adapter) } : {}), ...(adapter.assertManagedResourceCurrent ? { assertManagedResourceCurrent: adapter.assertManagedResourceCurrent.bind(adapter) } : {}), ...(adapter.assertAdmissionCurrent ? { assertAdmissionCurrent: adapter.assertAdmissionCurrent.bind(adapter) } : {}) }) });
    return tool;
}
export function getManagedCompoundSpawnAdapter(tool) {
    const binding = bindings.get(tool);
    if (!binding || binding.execute !== tool.execute || binding.permission !== tool.permission || binding.definition !== JSON.stringify(tool.definition))
        return undefined;
    return binding.adapter;
}
