/** Host-only provenance. A receipt proves exact segmentation, never disclosure permission. */
export interface FinalizedObservationProvenance {
  readonly hostInvocationId: string;
  readonly ownerGeneration: number;
  readonly wholeContent: string;
  readonly segments: Readonly<{ before: string; native: string; after: string }>;
}
export interface ObservationProvenanceReceipt { readonly kind: 'host-native-observation' }
export interface NativeObservationProvenancePort {
  appendSuffix(suffix: string): void;
  observeTransform(value: { before: string; after: string }): void;
  sealRegistry(finalResult: string): void;
  finalizeHistory(finalContent: string): ObservationProvenanceReceipt | undefined;
  invalidate(): void;
}
type State = { valid: boolean; stage: 'registry' | 'history' | 'finalized'; expected: string; suffix: string; prefix: string; wrapped: boolean };
const ports = new WeakMap<object, State>();
/** Only the exact host-created port can wrap a sealed body, once. No callbacks or property reads. */
export function wrapNativeObservationHistory(port: unknown, before: string, body: string, after: string): boolean {
  const state = port && typeof port === 'object' ? ports.get(port) : undefined;
  if (!state) return false;
  if (!state.valid || state.stage !== 'history' || state.wrapped || typeof before !== 'string'
    || typeof body !== 'string' || typeof after !== 'string' || body !== state.expected) { state.valid = false; return false; }
  state.wrapped = true; state.prefix = before; state.suffix += after; state.expected = before + body + after;
  return true;
}
const receipts = new WeakMap<object, { state: State; value: FinalizedObservationProvenance }>();
export function readFinalizedObservationProvenance(receipt: unknown): FinalizedObservationProvenance | undefined {
  if (!receipt || typeof receipt !== 'object') return undefined;
  const entry = receipts.get(receipt);
  return entry?.state.valid && entry.state.stage === 'finalized' ? entry.value : undefined;
}
export function createNativeObservationProvenance(input: {
  hostInvocationId: string; ownerGeneration: number; nativePreview: string;
}): NativeObservationProvenancePort {
  const { hostInvocationId, ownerGeneration, nativePreview } = input;
  const state: State = { valid: typeof hostInvocationId === 'string' && !!hostInvocationId
    && Number.isSafeInteger(ownerGeneration) && ownerGeneration >= 0 && typeof nativePreview === 'string',
    stage: 'registry', expected: nativePreview, suffix: '', prefix: '', wrapped: false };
  const registry = () => { if (state.stage !== 'registry') state.valid = false; return state.valid; };
  const port: NativeObservationProvenancePort = Object.freeze({
    appendSuffix(suffix: string) {
      if (!registry()) return;
      if (typeof suffix !== 'string') { state.valid = false; return; }
      state.expected += suffix; state.suffix += suffix;
    },
    observeTransform(value: { before: string; after: string }) {
      if (!registry()) return;
      if (!value || value.before !== state.expected || value.after !== value.before) state.valid = false;
    },
    sealRegistry(finalResult: string) {
      if (!registry()) return;
      if (finalResult !== state.expected) { state.valid = false; return; }
      state.stage = 'history';
    },
    finalizeHistory(finalContent: string) {
      if (!state.valid || state.stage !== 'history' || finalContent !== state.expected) { state.valid = false; return undefined; }
      state.stage = 'finalized';
      const receipt: ObservationProvenanceReceipt = Object.freeze({ kind: 'host-native-observation' });
      receipts.set(receipt, { state, value: Object.freeze({ hostInvocationId, ownerGeneration, wholeContent: finalContent,
        segments: Object.freeze({ before: state.prefix, native: nativePreview, after: state.suffix }) }) });
      return receipt;
    },
    invalidate() { state.valid = false; },
  });
  ports.set(port, state);
  return port;
}
