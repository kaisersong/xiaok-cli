import { type InstalledCompositeLifetime } from './installed-composite-lifetime.js';
/** Explicit root installer operation; no automatic escalation, service start,
 * request execution, credential rotation, or caller-selected input path. */
export declare function provisionInstalledEgress(packageHash: string): void;
/** The actual service validates committed publication before opening a listener.
 * Read-only directory/file fsync is intentional: mere rename visibility does
 * not establish the writer's final durability barrier. */
export declare function readInstalledEgressConfiguration(lifetime: InstalledCompositeLifetime): Readonly<{
    targets: readonly Readonly<{
        destination: string;
        model: string;
        protocol: string;
        headers: Readonly<{
            [x: string]: string;
        }>;
    }>[];
    assertCurrent(): void;
}>;
