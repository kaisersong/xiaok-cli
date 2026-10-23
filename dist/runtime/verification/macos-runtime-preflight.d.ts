import { type DeploymentPackageInventory } from './deployment-package.js';
type Probe = Readonly<{
    executable: string;
    argv: readonly string[];
    env: Readonly<Record<string, string>>;
}>;
/** Packaging diagnostic only. The service separately checks root ownership and installed identity. */
export declare function buildMacRuntimeProbe(releaseRoot: string, stateRoot: string): Readonly<{
    qemu: Probe;
    lima: Probe;
}>;
/** Admits only observed frozen images or the OS-owned shared-cache namespace, never arbitrary Homebrew. */
export declare function inspectMacRuntimeLoadTrace(releaseRoot: string, input: DeploymentPackageInventory, stderr: string): readonly string[];
/** Calls the actual packaged executables after full byte census, and verifies the census again afterwards. */
export declare function probeFrozenMacRuntime(input: {
    releaseRoot: string;
    stateRoot: string;
    inventory: DeploymentPackageInventory;
}): Readonly<{
    qemuVersion: string;
    limaVersion: string;
    loadedImages: readonly string[];
}>;
export {};
