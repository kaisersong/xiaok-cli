/**
 * Slide renderer adapter — `parallel-generation` resource mode (design v58 §4.5,
 * §6.2; R43-03, R46-01).
 *
 * The mode matters for two frozen behaviours:
 *
 *  - Replacement prepares and validates a new generation while the old one keeps
 *    serving, so a failed reconnect never takes the renderer offline.
 *  - A default-output render promotes its artifact *while the generation child
 *    stays ready*. Report is invocation-scoped and must close its child before
 *    promotion; doing that to slide would drop the committed provider and force a
 *    reconnect on every render, which is why the two modes are separated.
 */

import { REQUIRED_PROVIDER_OPERATIONS } from '../provider-gateways/host-gateway-contracts.js';
import type {
  ProviderOperationCall,
  RendererProviderValue,
} from '../provider-gateways/create-host-gateways.js';

export class SlideActivationError extends Error {
  readonly code: string;

  constructor(code: string, detail: string) {
    super(`${code}: ${detail}`);
    this.code = code;
    this.name = 'SlideActivationError';
  }
}

export interface SlideRuntimeIdentity {
  /** Interpreter resolved from a digest-owned generation; never PATH/global venv. */
  readonly pythonCommand: string;
  readonly pythonArgs: readonly string[];
  readonly runtimeContractDigest: string;
  readonly runtimeGenerationId: string;
  readonly environmentTemplateDigest: string;
}

export interface SlideConnection {
  listOperations(): Promise<readonly string[]>;
  call(request: ProviderOperationCall, signal: AbortSignal): Promise<string>;
  /** Generation-owned child close; invoked once per generation. */
  close(): Promise<void>;
  getChildPid(): number | null;
}

export interface SlideActivationInput {
  readonly runtime: SlideRuntimeIdentity;
  connect(): Promise<SlideConnection>;
  /** Minimal render probe proving the closure is complete. */
  readinessSmoke(connection: SlideConnection): Promise<void>;
}

export interface SlideActivationOutput {
  readonly value: RendererProviderValue;
  readonly closeOnce: () => Promise<void>;
  readonly childPid: number | null;
}

/**
 * Activation: connect → verify the full operation set atomically → readiness
 * smoke. A partial `tools/list` must not commit, because four Skill gateways share
 * one server-level slot and a missing operation would present a falsely ready
 * provider.
 */
export async function activateSlideProvider(input: SlideActivationInput): Promise<SlideActivationOutput> {
  assertDigestOwnedRuntime(input.runtime);

  const connection = await input.connect();
  try {
    const advertised = new Set(await connection.listOperations());
    const required = REQUIRED_PROVIDER_OPERATIONS['mcp:slide-renderer'];
    const missing = required.filter((op) => !advertised.has(op));
    if (missing.length > 0) {
      throw new SlideActivationError(
        'activation_failed',
        `slide-renderer is missing required operations: ${missing.join(', ')}`,
      );
    }
    await input.readinessSmoke(connection);
  } catch (error) {
    // Provisional generation: release it and let any old generation keep serving.
    await connection.close().catch(() => undefined);
    throw error;
  }

  let closed: Promise<void> | null = null;
  return {
    value: {
      call: (request, signal) => connection.call(request, signal),
    },
    closeOnce: () => {
      closed ??= connection.close();
      return closed;
    },
    childPid: connection.getChildPid(),
  };
}

/** Reserved slide never resolves an interpreter from PATH or a shared venv. */
export function assertDigestOwnedRuntime(runtime: SlideRuntimeIdentity): void {
  const command = runtime.pythonCommand;
  if (!command.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(command)) {
    throw new SlideActivationError('blocked_external', `python command must be absolute: ${command}`);
  }
  if (!command.includes('.provider-store-v2')) {
    throw new SlideActivationError(
      'blocked_external',
      'python command must live inside a v2 runtime generation, not a shared venv',
    );
  }
  for (const forbidden of ['XIAOK_PYTHON_CMD', 'runtime/python-env']) {
    if (command.includes(forbidden)) {
      throw new SlideActivationError('blocked_external', `python command must not come from ${forbidden}`);
    }
  }
  if (!runtime.runtimeContractDigest || !runtime.runtimeGenerationId) {
    throw new SlideActivationError('blocked_external', 'runtime generation identity is incomplete');
  }
  if (!runtime.environmentTemplateDigest) {
    throw new SlideActivationError(
      'blocked_external',
      'environmentTemplateDigest must be part of the runtime contract',
    );
  }
  const args = [...runtime.pythonArgs];
  if (args[0] !== '-I' || args[1] !== '-u') {
    throw new SlideActivationError('blocked_external', 'python args must be frozen as -I -u');
  }
}
