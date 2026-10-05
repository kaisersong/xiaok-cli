import { isDeepStrictEqual } from 'node:util';
const nativeTools = new WeakMap();
/** Host builtin factory registration, never a model or plugin descriptor field. */
export function registerBuiltinToolIdentity(tool, kind) {
    if (nativeTools.has(tool)) {
        if (getBuiltinToolIdentity(tool) !== kind)
            throw Error('compound_builtin_tool_changed');
        return;
    }
    nativeTools.set(tool, { kind, execute: tool.execute, permission: tool.permission, definition: structuredClone(tool.definition), precondition: tool.compoundFilePrecondition });
}
export function getBuiltinToolIdentity(tool) {
    const record = nativeTools.get(tool);
    if (!record)
        return undefined;
    if (record.execute !== tool.execute || record.permission !== tool.permission || record.precondition !== tool.compoundFilePrecondition || !isDeepStrictEqual(record.definition, tool.definition))
        throw Error('compound_builtin_tool_changed');
    return record.kind;
}
/** Called only by audited host sandbox/registry wrappers, not tool registration. */
export function inheritBuiltinToolIdentity(source, target) {
    const kind = getBuiltinToolIdentity(source);
    if (kind)
        registerBuiltinToolIdentity(target, kind);
}
