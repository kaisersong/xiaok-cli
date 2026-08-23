/**
 * The three reserved provider ComponentSpecs (design v58 §6.1–§6.3, §9.3).
 *
 * Kept separate from `main.ts` so the bootstrap only has to call
 * `pluginProviderRuntime.start(reservedProviderSpecs(...))` after the trusted
 * source resolution and the compatibility deployment have run.
 *
 * Activation state today: each spec resolves its provider value through the
 * existing MCP connection layer, which is what makes the eight host gateways
 * reachable. The digest-owned Python runtime (slide) and the report host-Node
 * identity binding are enforced by their adapters, so a spec whose prerequisites
 * are missing fails activation and the component projects a typed blocked state
 * instead of pretending to be ready.
 */

import type { PluginComponentSpec } from '../../../src/platform/provider-runtime/lifecycle-reconciler.js';
import type { ProviderOperationCall, RendererProviderValue } from './create-host-gateways.js';
import { REQUIRED_PROVIDER_OPERATIONS } from './host-gateway-contracts.js';

export interface ReservedProviderBridge {
  /** Returns the operations the live server advertises via `tools/list`. */
  listOperations(server: 'slide-renderer' | 'report-renderer'): Promise<readonly string[]>;
  /** Calls one operation on the live server. */
  call(
    server: 'slide-renderer' | 'report-renderer',
    request: ProviderOperationCall,
    signal: AbortSignal,
  ): Promise<string>;
  /** Closes the generation-owned child, if the resource mode owns one. */
  close(server: 'slide-renderer' | 'report-renderer'): Promise<void>;
}

function rendererSpec(
  id: string,
  pluginName: string,
  version: string,
  server: 'slide-renderer' | 'report-renderer',
  capabilityKey: 'mcp:slide-renderer' | 'mcp:report-renderer',
  resourceMode: PluginComponentSpec['resourceMode'],
  bridge: ReservedProviderBridge,
): PluginComponentSpec {
  return {
    id,
    pluginName,
    version,
    activation: 'startup',
    resourceMode,
    provides: capabilityKey,
    activate: async () => {
      // Atomic operation-set check: four Skill gateways share one server-level
      // slot, so a partial catalog must not commit (design §3.4).
      const advertised = new Set(await bridge.listOperations(server));
      const missing = REQUIRED_PROVIDER_OPERATIONS[capabilityKey].filter((op) => !advertised.has(op));
      if (missing.length > 0) {
        throw new Error(`activation_failed: ${server} is missing ${missing.join(', ')}`);
      }
      const value: RendererProviderValue = {
        call: (request, signal) => bridge.call(server, request, signal),
      };
      return {
        value,
        ...(resourceMode === 'parallel-generation'
          ? { closeOnce: () => bridge.close(server) }
          : {}),
      };
    },
  };
}

export function reservedProviderSpecs(
  bridge: ReservedProviderBridge,
  versions: { slide: string; report: string },
): PluginComponentSpec[] {
  return [
    rendererSpec(
      'mcp:slide-renderer-provider', 'kai-slide-creator', versions.slide,
      'slide-renderer', 'mcp:slide-renderer', 'parallel-generation', bridge,
    ),
    rendererSpec(
      'mcp:report-renderer-provider', 'kai-report-creator', versions.report,
      // Report owns one child per invocation, so the generation has no long-lived
      // transport to close (design §4.5).
      'report-renderer', 'mcp:report-renderer', 'invocation-scoped', bridge,
    ),
  ];
}
