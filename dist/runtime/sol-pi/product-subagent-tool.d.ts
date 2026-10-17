import type { Tool, ModelAdapter, ToolExecutionContext } from '../../types.js';
import type { ToolRegistry } from '../../ai/tools/index.js';
import { AgentSessionState, type AgentSessionSnapshot } from '../../ai/runtime/session.js';
import type { createProductObservationOwner } from './product-bootstrap.js';
import type { ObservationSessionOwner } from './observation-session-owner.js';
import type { DelegatedChildExecutionInstallation } from './delegated-session-owner.js';
export interface ProductChildAllocation {
    readonly opaqueProductChildAllocation: true;
}
type ChildInstaller = (input: Readonly<{
    owner: ObservationSessionOwner;
    session: AgentSessionState;
    registry: ToolRegistry;
    recallTool: Tool;
}>) => Promise<DelegatedChildExecutionInstallation>;
export interface ProductObservationDelegationAdapter {
    allocate(input: Record<string, unknown>): ProductChildAllocation;
    getSession(allocation: ProductChildAllocation): AgentSessionState;
    getOutcome(allocation: ProductChildAllocation): 'not_started' | 'running' | 'completed' | 'failed';
    arm(allocation: ProductChildAllocation, context: Pick<ToolExecutionContext, 'session' | 'hostProviderInvocationId' | 'toolInvocationId'>, installer: ChildInstaller): void;
    discard(allocation: ProductChildAllocation): void;
}
export declare function getProductObservationDelegationAdapter(tool: Tool): ProductObservationDelegationAdapter | undefined;
type Product = Awaited<ReturnType<typeof createProductObservationOwner>>;
interface Options {
    product: Product;
    parentOwner: ObservationSessionOwner;
    sourceRegistry: ToolRegistry;
    adapter(): ModelAdapter;
    cwd: string;
    persist(snapshot: AgentSessionSnapshot): Promise<void>;
    buildSystemPrompt(cwd: string): Promise<string>;
    onCompleted?(): void;
    depth?: number;
}
/** Explicit product consent supplies authority; model arguments supply only the task text. */
export declare function createProductObservationSubagentTool(options: Options): Tool;
export {};
