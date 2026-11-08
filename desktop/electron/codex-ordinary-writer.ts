import { dirname } from 'node:path';
import { assertOrdinarySourceWriterRoute } from '../../src/runtime/verification/ordinary-source-writer-observation.js';
import { createKnownDirectoryWriterFence } from '../../src/runtime/verification/known-directory-writer-fence.js';
import { createRoomTurnCustody } from '../../src/runtime/verification/original-sdk-custody.js';

const NativeError = Error, freeze = Object.freeze;
const retained = new Set<object>();
const apply=Reflect.apply,setAdd=Set.prototype.add,setDelete=Set.prototype.delete,push=Array.prototype.push;
/** A denial/lifetime latch only. This never supplies a Main/Source/Native grant. */
export function createCodexOrdinaryWriter(resourceOwner:object) {
  const stock = createRoomTurnCustody();
  const held: unknown[] = [];
  let bound = false, closed = false, failed = false;
  let fence: ReturnType<typeof createKnownDirectoryWriterFence> | undefined;
  let retirement: Error | undefined;
  const failures: { raw: unknown }[] = [];
  const owner = {
    bind(file: string) {
      if (bound || typeof file !== 'string') throw new NativeError('CODEX_WRITER_BIRTH_INVALID');
      bound = true;
      if (file !== ':memory:' && file !== '') fence = createKnownDirectoryWriterFence(dirname(file), 'sqlite-db');
    },
    assertOpen() {
      if (retirement) throw retirement;
      if (!bound || closed || failed) throw new NativeError('CODEX_WRITER_UNCONFIRMED');
      try { assertOrdinarySourceWriterRoute(); fence?.assertOpen(); }
      catch (raw) {
        throw owner.retire(raw);
      }
    },
    retire(raw:unknown) {
      if(!retirement){retirement=new NativeError('CODEX_ORDINARY_WRITER_RETIRED',{cause:raw});apply(push,held,[resourceOwner,raw,retirement]);apply(setAdd,retained,[owner]);}
      return retirement;
    },
    isPolicy(raw: unknown) { return retirement !== undefined && raw === retirement; },
    retired() { return retirement !== undefined; },
    hold(raw: unknown) { apply(push,held,[raw]);stock.inventory(raw); },
    fail(raw: unknown) { failed = true;apply(push,failures,[{raw}]);apply(push,held,[resourceOwner,raw]);stock.inventory(raw);apply(setAdd,retained,[owner]); },
    async waitKnown() { await stock.waitPhysicalKnown();if(failed)throw failures[0]!.raw; },
    closed() { closed = true;if(!failed)apply(setDelete,retained,[owner]); },
    stock,
  };
  return freeze(owner);
}
export type CodexOrdinaryWriter = ReturnType<typeof createCodexOrdinaryWriter>;
