import type { Config } from '../../types.js';
import type { AgentSessionState, AgentSessionSnapshot } from '../../ai/runtime/session.js';
import type { ObservationReadFileScope } from './observation-service.js';
import { type ValidatedSemanticPolicy } from './semantic-policy.js';
import { type CompoundHostStorage } from './compound-host-storage.js';
export interface ProductObservationPolicy {
    readonly opaqueProductObservationPolicy: never;
}
interface PermissionRevisionPort {
    getRevision(): number;
    onRevisionChanged(listener: (revision: number) => void): () => void;
}
/** Explicit user CLI file only. Never discover this file from a project or model input. */
export declare function parseObservationPolicyFile(file: string): ProductObservationPolicy;
/** Select the formal model only for this live session. Never persist configuration. */
export declare function prepareObservationConfig(config: Config, approved: ProductObservationPolicy): Config;
/** Main-owned review display of the already parsed user grant; never rereads a file. */
export declare function describeProductObservationPolicy(approved: ProductObservationPolicy): Readonly<{
    model: "deepseek-flash";
    destination: Readonly<{
        provider: string;
        url: string;
    }>;
    expiresAt: number;
    ordinaryChildren: Readonly<{
        nativeTools: readonly string[];
        enabled: true;
        maxDepth: number;
        maxChildren: number;
        expiresAt: number;
    }> | undefined;
    compoundExecution: Readonly<{
        version: 1;
        mode: "mechanism-experiment";
    }> | undefined;
    semanticCompaction: Readonly<{
        pricing: Readonly<{
            source: string;
            model: "deepseek-flash";
            inputMissUnitsPerMillion: number;
            inputHitUnitsPerMillion: number;
            outputUnitsPerMillion: number;
            validUntil: number;
        }>;
        priceRevision: string;
        version: 1;
        mode: "automatic" | "mechanism-experiment";
        currency: "USD";
        maxCalls: number;
        maxCostUnits: number;
        maxOutputTokens: number;
        expiresAt: number;
    }> | undefined;
    readFileScopes: readonly Readonly<{
        filePath: string;
        startLine: number;
        endLine?: number;
    }>[];
    bashSources: readonly Readonly<{
        command: string;
        cwd: string;
    }>[];
    localPersistence: true;
    allowUnclassifiedText: true;
    allowModelDisclosure: true;
}>;
export declare function createProductObservationOwner(input: {
    policy: ProductObservationPolicy;
    session: AgentSessionState;
    profileRoot: string;
    environmentRoot: string;
    credentialSecrets: readonly string[];
    persist(snapshot: AgentSessionSnapshot): Promise<void>;
    permissionManager: PermissionRevisionPort;
    hostCwd?: string;
    compoundStorage?: CompoundHostStorage;
    executionPersistence?: {
        store: import('../../ai/runtime/session-store/store.js').SessionStore;
        root: string;
        initialize?: (snapshot: import('../../ai/runtime/session.js').AgentSessionSnapshot, lease: import('../../ai/runtime/session-store/execution-authority.js').SessionExecutionLease) => Promise<void>;
    };
}): Promise<Readonly<{
    owner: import("./observation-session-owner.js").ObservationSessionOwner;
    semanticCompactionOwner: import("./semantic-compaction-owner.js").SemanticCompactionOwner | undefined;
    compoundDomain: Readonly<{
        getBinding(): Readonly<import("./compound-execution-domain.js").CompoundExecutionDomainBinding>;
        assertCurrent: () => void;
        retiredSessionIdentities(lease: import("../../ai/runtime/session-store/execution-authority.js").SessionExecutionLease): readonly string[];
        beginRetirement(lease: import("../../ai/runtime/session-store/execution-authority.js").SessionExecutionLease): void;
        retire({ authority }: {
            authority: import("../../ai/runtime/session-store/execution-authority.js").SessionExecutionAuthority;
        }): Promise<Readonly<import("./compound-execution-domain.js").CompoundExecutionDomainBinding>>;
        close(lease: import("../../ai/runtime/session-store/execution-authority.js").SessionExecutionLease): void;
        assertForEffect(lease: import("../../ai/runtime/session-store/execution-authority.js").SessionExecutionLease): void;
    }> | undefined;
    executionAuthority: import("../../ai/runtime/session-store/execution-authority.js").SessionExecutionAuthority | undefined;
    executionSignal: AbortSignal;
    recallTool: import("../../types.js").Tool;
    summary: Readonly<{
        ordinaryChildren: Readonly<{
            nativeTools: readonly string[];
            enabled: true;
            maxDepth: number;
            maxChildren: number;
            expiresAt: number;
        }> | undefined;
        environmentId: "deepseek-recipe-0.1.1";
        model: "deepseek-flash";
        destination: Readonly<{
            model: "deepseek-flash";
            provider: string;
            url: string;
        }>;
        expiresAt: number;
        semanticCompaction: ValidatedSemanticPolicy | undefined;
        compoundExecution: Readonly<{
            version: 1;
            mode: "mechanism-experiment";
        }> | undefined;
        readFileScopes: ObservationReadFileScope[];
        exactBashSources: number;
        toolSurface: "native-only";
        redactorVersion: string;
        storageBudget: Readonly<{
            profileRoot: string;
            profileBytes: number;
            reservedBytes: number;
        }>;
    }>;
    createChildExecutionPlan(child: {
        session: AgentSessionState;
        persist(snapshot: AgentSessionSnapshot): Promise<void>;
        parentOwner?: import("./observation-session-owner.js").ObservationSessionOwner;
        surface?: "cli" | "desktop-managed";
        installChildExecution?: Parameters<typeof import("./delegated-session-owner.js").createDelegatedObservationExecutionPlan>[0]["installChildExecution"];
    }): object;
    prepareMessagePublication(message: Omit<Parameters<typeof import("./observation-message-publication.js").prepareObservationMessagePublication>[0], "approval">): Promise<import("./observation-message-publication.js").ObservationMessagePublication>;
    revoke(): void;
    getStatus(): Readonly<{
        revoked: boolean;
        disposed: boolean;
        ownerMode: "active" | "unavailable" | "recall-only";
    }>;
    dispose(): Promise<void> | undefined;
}>>;
/** Host deletion/startup event; never opens grants or resumes an observation owner. */
export declare function reconcileProductObservationReferences(profileRoot: string): Promise<void>;
export {};
