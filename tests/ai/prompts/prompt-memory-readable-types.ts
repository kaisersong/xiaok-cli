import type { MemoryStore } from '../../../src/ai/memory/store.js';
import type { PromptBuilder, PromptMemoryReadable } from '../../../src/ai/prompts/builder.js';

type Assert<T extends true> = T;
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type BuilderDeps = NonNullable<ConstructorParameters<typeof PromptBuilder>[0]>;
type BuilderMemory = NonNullable<BuilderDeps['memoryStore']>;
type ReadFixture = Pick<MemoryStore, 'listRelevant'>;

export type FullStoreSaveStillRequired = Assert<{} extends Pick<MemoryStore, 'save'> ? false : true>;
export type ReaderListRelevantStillRequired = Assert<{} extends Pick<PromptMemoryReadable, 'listRelevant'> ? false : true>;
export type OriginalReadFixtureAccepted = Assert<ReadFixture extends BuilderMemory ? true : false>;
export type FullStoreAccepted = Assert<MemoryStore extends BuilderMemory ? true : false>;
export type ReadFixtureNotAWriteStore = Assert<ReadFixture extends MemoryStore ? false : true>;
export type SearchSignaturePreserved = Assert<Same<PromptMemoryReadable['search'], MemoryStore['search']>>;
export type ListRelevantSignaturePreserved = Assert<Same<PromptMemoryReadable['listRelevant'], MemoryStore['listRelevant']>>;
export type ExistingSaveMemberCompatible = Assert<Same<PromptMemoryReadable['save'], MemoryStore['save'] | undefined>>;
