import type { createApplicationBindingAuthority } from './application-binding-authority.js';
import type { ControllerPeer } from './controller-public-daemon.js';
/** Fixed installed application routing. Observations and recovery use the same
 * lifecycle gate; only authorize can enter the original native authority. */
export declare function createControllerApplicationRouting(input: {
    application: ReturnType<typeof createApplicationBindingAuthority>;
    assertCurrent(): void;
    renew(signal: AbortSignal): Promise<void>;
}): Readonly<{
    invoke(method: string, payload: unknown, peer: ControllerPeer, signal: AbortSignal): Promise<unknown>;
}>;
