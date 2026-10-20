import type { Tool } from '../../src/types.js';
import { isSettledLocalTool } from '../../src/ai/tools/index.js';
import type { DesktopCapabilityEntry } from './desktop-multi-agent-capabilities.js';

const knownFactories = new WeakSet<DesktopCapabilityEntry['bindInvocation']>();

/** Constructs only this audited forwarding path; never accepts an execution callback. */
export function createKnownLocalBindingFactory(tool: Tool): DesktopCapabilityEntry['bindInvocation'] {
  if (!isSettledLocalTool(tool)) throw new Error('local_operation_unqualified');
  const execute = tool.execute;
  const factory: DesktopCapabilityEntry['bindInvocation'] = authority => async (input, context) => {
    if (authority.agentId !== `root_${authority.groupId}`) throw new Error('tool_scope_unsupported');
    if (!isSettledLocalTool(tool) || tool.execute !== execute) throw new Error('local_operation_unqualified');
    return execute.call(tool, input, context);
  };
  knownFactories.add(factory);
  return factory;
}

export function isKnownLocalBindingFactory(factory: DesktopCapabilityEntry['bindInvocation']): boolean {
  return knownFactories.has(factory);
}
