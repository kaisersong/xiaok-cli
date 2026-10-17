/** Best-effort controller teardown. A failed drain never authorizes releasing its
 * actual lifetime lock; the entry retains that object for the remaining process. */
export declare function closeInstalledControllerComponents(input: {
    components: readonly (() => void | Promise<void>)[];
    finalizers?: readonly (() => void | Promise<void>)[];
    closeLifetime(): void;
    retainLifetime(): void;
}): Promise<void>;
