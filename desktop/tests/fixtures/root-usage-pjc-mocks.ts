import {vi} from 'vitest';
const probe = vi.hoisted(() => ({ active: undefined as any }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, appendFile: function(this: unknown, ...args: any[]) {
    return probe.active ? probe.active.append(actual.appendFile, this, args) : Reflect.apply(actual.appendFile, this, args);
  } };
});
vi.mock('../../electron/desktop-model-usage-admission.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../electron/desktop-model-usage-admission.js')>();
  return { ...actual, mapDesktopModelUsageAdmission: function(this: unknown, ...args: Parameters<typeof actual.mapDesktopModelUsageAdmission>) {
    const raw = Reflect.apply(actual.mapDesktopModelUsageAdmission, this, args);
    probe.active?.maps.push({ original: args[0], callback: args[1], cap: raw }); return raw;
  } };
});
vi.mock('../../../src/ai/runtime/provider-conversation-authorization.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/ai/runtime/provider-conversation-authorization.js')>();
  return { ...actual, streamDesktopTaskProviderConversation: function(this: unknown, ...args: Parameters<typeof actual.streamDesktopTaskProviderConversation>) {
    const raw = Reflect.apply(actual.streamDesktopTaskProviderConversation, this, args);
    probe.active?.sources.push(raw); return raw;
  } };
});
vi.mock('../../../src/ai/runtime/model-stream-recovery.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/ai/runtime/model-stream-recovery.js')>();
  return { ...actual, recoverModelStream: function(this: unknown, ...args: Parameters<typeof actual.recoverModelStream>) {
    const state = probe.active, input = args[0];
    if (state) {
      const open = input.open;
      input.open = function(this: unknown, ...openArgs: Parameters<typeof open>) {
        const source = Reflect.apply(open, this, openArgs);
        state.checkedSources.push(source); state.installReturn(source, 'outer'); return source;
      };
      state.recoverInputs.push({ input, originalOpen: open, signal: input.signal, physicalRun: input.physicalRun });
    }
    return Reflect.apply(actual.recoverModelStream, this, args);
  } };
});
vi.mock('../../electron/desktop-task-stream.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../electron/desktop-task-stream.js')>();
  return { ...actual, closeDesktopModelPhysicalScope: function(this: unknown, ...args: Parameters<typeof actual.closeDesktopModelPhysicalScope>) {
    const raw = Reflect.apply(actual.closeDesktopModelPhysicalScope, this, args);
    probe.active?.closed(args[0], args[1], raw, new Error('owned close observation').stack); return raw;
  } };
});
vi.mock('../../electron/goal-store-sqlite.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../electron/goal-store-sqlite.js')>();
  return { ...actual, SqliteGoalStore: function(...args: ConstructorParameters<typeof actual.SqliteGoalStore>) {
    const original = Reflect.construct(actual.SqliteGoalStore, args); probe.active?.goals.push(original); return original;
  } };
});
vi.mock('../../electron/artifact-workspace-store.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../electron/artifact-workspace-store.js')>();
  return { ...actual, ArtifactWorkspaceStore: function(...args: ConstructorParameters<typeof actual.ArtifactWorkspaceStore>) {
    const original = Reflect.construct(actual.ArtifactWorkspaceStore, args); probe.active?.artifacts.push(original); return original;
  } };
});

vi.mock('../../electron/desktop-multi-agent-service.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../electron/desktop-multi-agent-service.js')>();
  function ObservedService(...args: ConstructorParameters<typeof actual.DesktopMultiAgentService>) {
    const original = Reflect.construct(actual.DesktopMultiAgentService, args);
    const owner = probe.active?.owner;
    if (owner) { owner.service = owner.keep('service', original); owner.attachStore(args[0].store); owner.coordinator = owner.keep('coordinator', args[0].coordinator); }
    return original;
  }
  ObservedService.prototype = actual.DesktopMultiAgentService.prototype;
  return { ...actual, DesktopMultiAgentService: ObservedService };
});
vi.mock('../../../src/ai/memory/layered-store.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/ai/memory/layered-store.js')>();
  function ObservedMemory(...args: ConstructorParameters<typeof actual.LayeredMemoryStore>) {
    const original = Reflect.construct(actual.LayeredMemoryStore, args);
    if (probe.active) { probe.active.memoryCandidates.push(original); probe.active.owner.keep('memoryCandidates', probe.active.memoryCandidates); }
    return original;
  }
  ObservedMemory.prototype = actual.LayeredMemoryStore.prototype;
  return { ...actual, LayeredMemoryStore: ObservedMemory };
});

/** Preserve the one hoisted original fixture row without exporting a compiler hoist. */
export function readRootUsageProbe(){return probe;}
