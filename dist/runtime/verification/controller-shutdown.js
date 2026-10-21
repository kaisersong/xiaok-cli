/** Best-effort controller teardown. A failed drain never authorizes releasing its
 * actual lifetime lock; the entry retains that object for the remaining process. */
export async function closeInstalledControllerComponents(input) {
    const components = [...input.components], finalizers = [...(input.finalizers ?? [])], closeLifetime = input.closeLifetime, retainLifetime = input.retainLifetime, errors = [];
    for (const close of components)
        try {
            await close();
        }
        catch (error) {
            errors.push(error);
        }
    // Dependent capacity, identity and broker owners remain live after any unknown drain.
    if (!errors.length)
        for (const finalize of finalizers) {
            try {
                await finalize();
            }
            catch (error) {
                errors.push(error);
                break;
            }
        }
    if (!errors.length)
        try {
            closeLifetime();
        }
        catch (error) {
            errors.push(error);
        }
    if (errors.length) {
        retainLifetime();
        throw new AggregateError(errors, 'installed_controller_shutdown_unknown');
    }
}
