export function assertCompoundFileEffectCurrent(port) {
    const result = port?.assertBeforeFileMutation?.();
    if (result !== undefined) {
        void Promise.resolve(result).catch(() => { });
        throw Error('compound_file_effect_guard_must_be_synchronous');
    }
}
