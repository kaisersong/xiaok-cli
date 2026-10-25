import type { PlatformRegistryFactory } from '../platform/runtime/registry-factory.js';
import type { CompoundExecutionCoordinator } from '../runtime/sol-pi/compound-execution-coordinator.js';
/** Internal CLI resource owner. This port carries no ownership-release capability. */
export declare function drainCliRegistryWriters(factory: PlatformRegistryFactory, compound?: CompoundExecutionCoordinator): Promise<void>;
/** Bounded finalization diagnostics. Never serialize SDK/request objects or
 * invoke callback-owned getters/toString while handling a cleanup failure. */
export declare function describeChatFinalizationFailures(error: unknown): string[];
