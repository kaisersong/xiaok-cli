export interface OrdinaryChildrenPolicy {
  readonly enabled: true;
  readonly maxDepth: number;
  readonly maxChildren: number;
  readonly expiresAt: number;
  readonly nativeTools: readonly string[];
}
const fields = ['enabled', 'maxDepth', 'maxChildren', 'expiresAt', 'nativeTools'];
const native = new Set(['read', 'bash', 'write', 'edit', 'glob', 'grep', 'ls']);
function deny(): never { throw new Error('SOL_PI_ORDINARY_CHILDREN_POLICY_INVALID'); }
/** Validation only. Parsed data is not a capability and does not authorize an agent. */
export function validateOrdinaryChildrenPolicy(input: unknown, now: number, parentExpiresAt: number): OrdinaryChildrenPolicy {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) deny();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(input).length !== fields.length || fields.some(key => !descriptors[key] || !('value' in descriptors[key]) || !descriptors[key].enumerable)) deny();
  const value = Object.fromEntries(fields.map(key => [key, descriptors[key].value]));
  if (value.enabled !== true || !Number.isSafeInteger(value.maxDepth) || value.maxDepth < 1 || value.maxDepth > 8
    || !Number.isSafeInteger(value.maxChildren) || value.maxChildren < 1 || value.maxChildren > 256
    || !Number.isSafeInteger(now) || !Number.isSafeInteger(parentExpiresAt) || !Number.isSafeInteger(value.expiresAt)
    || value.expiresAt <= now || value.expiresAt > parentExpiresAt || value.expiresAt - now > 86400000
    || !Array.isArray(value.nativeTools) || !value.nativeTools.length || value.nativeTools.length > native.size) deny();
  const toolDescriptors = Object.getOwnPropertyDescriptors(value.nativeTools);
  const tools: string[] = [];
  for (let i = 0; i < value.nativeTools.length; i++) {
    const property = toolDescriptors[String(i)];
    if (!property || !('value' in property) || typeof property.value !== 'string' || !native.has(property.value) || tools.includes(property.value)) deny();
    tools.push(property.value);
  }
  if (Reflect.ownKeys(value.nativeTools).length !== tools.length + 1) deny();
  return Object.freeze({ enabled: true, maxDepth: value.maxDepth, maxChildren: value.maxChildren,
    expiresAt: value.expiresAt, nativeTools: Object.freeze(tools) });
}
