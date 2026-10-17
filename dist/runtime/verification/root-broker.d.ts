/** Installed root-only daemon. No public caller can choose paths, helpers, commands
 * or environment. This function does not install itself or request elevation. */
export declare function startInstalledMacRootBroker(): Promise<{
    close(): Promise<void>;
}>;
