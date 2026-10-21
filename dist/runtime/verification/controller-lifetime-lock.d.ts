/** Private filesystem primitive only. The installed caller must first establish
 * its separated OS identity and root. This lock never proves a guest is stopped. */
export declare function acquireControllerLifetimeLock(inputRoot: string): Readonly<{
    assertCurrent(): void;
    close(): void;
}>;
