import type { OriginalMainAcceptedRootPort } from './main-room-root-admission.js';
type AcceptedKind = 'kswarm_direct' | 'room_project';
interface Binding {
  readonly kind: AcceptedKind;
  readonly service: object;
  read(): OriginalMainAcceptedRootPort;
  loading?: Promise<void>;
}
const bindings = new WeakMap<object, Binding>(),
  apply = Reflect.apply,
  get = WeakMap.prototype.get,
  set = WeakMap.prototype.set;
function exact(row: Binding, kind: AcceptedKind, service: unknown): void {
  if (row.kind !== kind || row.service !== service)
    throw Error('ROOT_RESOURCE_ORIGINAL_ACCEPTED_BINDING_REQUIRED');
}
/** Passive Node-safe lookup. A genuine candidate must reject a missing port. */
export function readOptionalOriginalMainAcceptedAdmission(
  kind: AcceptedKind,
  producer: unknown,
  service: unknown,
): OriginalMainAcceptedRootPort | null {
  const row = apply(get, bindings, [producer]) as Binding | undefined;
  if (!row) return null;
  exact(row, kind, service);
  return row.read();
}
/** Only the fixed original owner's private reader, never a caller callback. */
export async function cacheOriginalMainAcceptedAdmission(
  kind: AcceptedKind,
  producer: object,
  service: object,
): Promise<void> {
  if (kind !== 'kswarm_direct' && kind !== 'room_project')
    throw Error('ROOT_RESOURCE_ORIGINAL_ACCEPTED_BINDING_REQUIRED');
  const prior = apply(get, bindings, [producer]) as Binding | undefined;
  if (prior) {
    exact(prior, kind, service);
    await prior.loading;
    prior.read();
    return;
  }
  const row: Binding = {
    kind,
    service,
    read() {
      throw Error('ROOT_RESOURCE_ACCEPTED_BINDING_PENDING');
    },
  };
  apply(set, bindings, [producer, row]);
  row.loading = (async () => {
    try {
      const original = await import('./main-room-root-admission.js');
      const read =
        kind === 'kswarm_direct'
          ? original.readOriginalMainDirectAdmission
          : original.readOriginalMainRoomProjectAdmission;
      read(producer, service);
      row.read = () => read(producer, service);
    } catch (error) {
      row.read = () => {
        throw error;
      };
      throw error;
    }
  })();
  await row.loading;
}
