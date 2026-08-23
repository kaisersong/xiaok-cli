/**
 * Static host gateway factory (design v58 §4.4, §5.3, §6.2, §6.3).
 *
 * Every gateway is registered once for the process lifetime. It never captures a
 * bare backend: each call takes an invocation lease from the currently committed
 * provider generation, so a replacement or retirement can never be observed as a
 * half-swapped tool. When no generation is committed the tool stays visible and
 * returns a structured unavailable result instead of touching a draining
 * transport.
 */

import type { Tool, ToolExecutionContext } from '../../../src/types.js';
import {
  canonicalAbortError,
  ProviderUnavailableRetryError,
  type ProviderInvocationLease,
} from '../../../src/platform/provider-runtime/types.js';
import {
  gatewayContract,
  hasSupportedReportComponent,
  HOST_GATEWAY_CONTRACTS,
  resolveReportTheme,
  type HostGatewayContract,
} from './host-gateway-contracts.js';

export interface ProviderOperationCall {
  readonly operation: string;
  readonly input: Record<string, unknown>;
}

/** The provider value published by an adapter into the server-level slot. */
export interface RendererProviderValue {
  call(request: ProviderOperationCall, signal: AbortSignal): Promise<string>;
}

export interface GatewayRuntimeFacade {
  /** Throws `ProviderUnavailableRetryError` when nothing is committed. */
  acquire(
    capabilityKey: string,
    options: { callerSignal?: AbortSignal },
  ): ProviderInvocationLease<RendererProviderValue>;
  /** Current unavailable diagnostic for a capability, for the visible tool. */
  describeUnavailable(capabilityKey: string): { code: string; message: string; retryable: boolean };
}

export const UNAVAILABLE_RESULT_PREFIX = 'provider_unavailable';

function unavailableResult(diagnostic: { code: string; message: string; retryable: boolean }): string {
  return JSON.stringify({
    ok: false,
    error_code: diagnostic.code,
    message: diagnostic.message,
    retryable: diagnostic.retryable,
  });
}

function validateGatewayInput(contract: HostGatewayContract, input: Record<string, unknown>): Record<string, unknown> {
  if (contract.operation === 'preview_section') {
    const sectionIr = input.section_ir;
    if (typeof sectionIr !== 'string' || sectionIr.trim() === '') {
      throw new Error('invalid_section_ir: section_ir must be a non-empty .report.md DSL string');
    }
    if (!hasSupportedReportComponent(sectionIr)) {
      throw new Error(
        'invalid_section_ir: section_ir must contain at least one supported :::component block '
        + '(a JSON payload renders an empty fragment)',
      );
    }
  }
  if (contract.operation === 'render_report') {
    const theme = resolveReportTheme(input);
    const forwarded: Record<string, unknown> = { ...input };
    delete forwarded.theme;
    if (theme !== undefined) forwarded.theme_override = theme;
    return forwarded;
  }
  return input;
}

export function createHostGateway(
  contract: HostGatewayContract,
  runtime: GatewayRuntimeFacade,
): Tool {
  return {
    permission: contract.permission,
    definition: {
      name: contract.canonicalName,
      description: contract.description,
      inputSchema: contract.inputSchema,
    },
    async execute(input: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
      const forwarded = validateGatewayInput(contract, input);

      let lease: ProviderInvocationLease<RendererProviderValue>;
      try {
        lease = runtime.acquire(contract.capabilityKey, { callerSignal: context?.signal });
      } catch (error) {
        if (error instanceof ProviderUnavailableRetryError) {
          return unavailableResult(runtime.describeUnavailable(contract.capabilityKey));
        }
        throw error;
      }

      try {
        return await lease.value.call({ operation: contract.operation, input: forwarded }, lease.signal);
      } catch (error) {
        // Classification comes from the lease's frozen abort source, never from
        // the SDK error shape (design §3.4).
        if (lease.abortSource === 'caller') throw canonicalAbortError();
        if (lease.abortSource === 'runtime') {
          return unavailableResult({
            code: UNAVAILABLE_RESULT_PREFIX,
            message: 'provider retired while the call was in flight',
            retryable: true,
          });
        }
        throw error;
      } finally {
        lease.release();
      }
    },
  };
}

/** All eight historical canonical names, for a registry that should see them. */
export function createAllHostGateways(runtime: GatewayRuntimeFacade): Tool[] {
  return HOST_GATEWAY_CONTRACTS.map((contract) => createHostGateway(contract, runtime));
}

export function createHostGatewayByName(canonicalName: string, runtime: GatewayRuntimeFacade): Tool {
  return createHostGateway(gatewayContract(canonicalName), runtime);
}
