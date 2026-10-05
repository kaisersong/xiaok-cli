/** Explicit installer action, never startup self-elevation. Root account creation and
 * reviewable package staging precede this call; interrupted installation is not auto-repaired. */
export declare function initializeInstalledMacState(packageHash: string, expectedServiceUid: number, expectedReceiverUid: number): void;
