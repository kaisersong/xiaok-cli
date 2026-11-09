import {assertOrdinaryLoopOwner} from './loop-run-context.js';
import type {AssistantDerivedRuntimePorts} from './assistant-derived-main.js';
import {attachAssistantDerivedContext,prepareAssistantProtectedInternalContext,type AssistantDerivedCapture} from './assistant-derived-lineage.js';
import type {LoopPublicationProducer} from './loop-store.js';
import type { EveningReflectionOutput, MorningBriefingOutput } from './assistant-llm.js';

export interface AssistantLoopProfile {
  id: 'default-personal-assistant';
  status: 'needs_consent' | 'active' | 'paused';
  locale: 'zh' | 'en';
  timeZone: string;
  eveningTime: string;
  morningTime: string;
  workdays: number[];
  quietHours: { start: string; end: string };
  dataScopes: Array<'threads' | 'projects' | 'tasks' | 'artifacts' | 'automations' | 'meetings'>;
  createdAt: number;
  updatedAt: number;
}

export interface AssistantLoopExecutorDependencies {
  derived?:AssistantDerivedRuntimePorts;
  getProfile(): AssistantLoopProfile | undefined | Promise<AssistantLoopProfile | undefined>;
  collect(input: {
    kind: 'evening' | 'morning';
    profile: AssistantLoopProfile;
    now: number;
    signal?: AbortSignal;
  }): unknown | Promise<unknown>;
  complete(input: {
    kind: 'evening' | 'morning';
    profile: AssistantLoopProfile;
    snapshot: unknown;
    signal?: AbortSignal;
  }): EveningReflectionOutput | MorningBriefingOutput | Promise<EveningReflectionOutput | MorningBriefingOutput>;
  stageCandidates(input: {
    runId: string;
    candidates: EveningReflectionOutput['candidates'];
    now: number;
  }): void | Promise<void>;
  recordEvidence(input: {
    runId: string;
    kind: 'evening' | 'morning';
    summary: string;
    output: EveningReflectionOutput | MorningBriefingOutput;
    now: number;
  }): string[] | Promise<string[]>;
  finishSuccess(input: {
    assertCurrent?:()=>void;
    runId: string;
    evidenceIds: string[];
    summary: string;
    now: number;
  }): void | Promise<void>;
  finishFailure(input: {
    runId: string;
    failureKind: 'executor_failed';
    message: string;
    now: number;
  }): void | Promise<void>;
}

export type AssistantLoopExecutionResult =
  | { status: 'success'|'publication_pending'; summary: string; candidateCount: number }
  | { status: 'skipped'; reason: 'needs_consent' | 'paused' | 'missing_profile' }
  | { status: 'failed'; reason: 'runtime_unavailable' };

export function createAssistantLoopExecutor(dependencies: AssistantLoopExecutorDependencies) {
  return {
    async execute(input: {
      kind: 'evening' | 'morning';
      runId: string;
      now: number;
      signal?: AbortSignal;
      publicationProducer?:Readonly<LoopPublicationProducer>;
    }): Promise<AssistantLoopExecutionResult> {
      const profile = await dependencies.getProfile();
      if (!profile) return { status: 'skipped', reason: 'missing_profile' };
      if (profile.status !== 'active') return { status: 'skipped', reason: profile.status };

      try {
        // Protected output retains the original fixed publication body. External
        // derived context is ordinary-only until that protocol binds it itself.
        const session=!input.publicationProducer?dependencies.derived?.beginCapture({kind:input.kind,profile,now:input.now}):undefined;
        const collected = await dependencies.collect({ kind: input.kind, profile, now: input.now,...(input.signal?{signal:input.signal}:{}) });
        const capture:AssistantDerivedCapture|undefined=session?await session.finish(collected):undefined;
        const internal=input.publicationProducer&&dependencies.derived?prepareAssistantProtectedInternalContext(collected,dependencies.derived.visibility):undefined;
        const assertCurrent=()=>{if(internal&&!internal.isCurrent())throw Error('assistant_derived_stale');if(capture){assertOrdinaryLoopOwner('loop_run',input.runId);if(!capture.isCurrent())throw Error('assistant_derived_stale');}};
        assertCurrent();if(capture)dependencies.derived!.recordCollection(input.runId,capture.lineage,capture.isCurrent);
        const snapshot=internal?internal.snapshot:dependencies.derived?attachAssistantDerivedContext(collected,capture):collected;
        const output = await dependencies.complete({ kind: input.kind, profile, snapshot, signal: input.signal });
        assertCurrent();
        let summary: string;
        let candidateCount = 0;
        if (input.kind === 'evening') {
          const evening = output as EveningReflectionOutput;
          summary = evening.summary;
          candidateCount = evening.candidates.length;
          if(!input.publicationProducer)await dependencies.stageCandidates({ runId: input.runId, candidates: evening.candidates, now: input.now });
        } else {
          const morning = output as MorningBriefingOutput;
          summary = morning.recommendations.length === 0
            ? 'assistant_morning_no_recommendations'
            : morning.recommendations.map(item => item.title).join('\n');
        }
        if(input.publicationProducer){input.publicationProducer.recordAssistantOutput(output,input.now);return {status:'publication_pending',summary,candidateCount};}
        assertCurrent();
        const evidenceIds = await dependencies.recordEvidence({
          runId: input.runId,
          kind: input.kind,
          summary,
          output,
          now: input.now,
        });
        assertCurrent();
        await dependencies.finishSuccess({ ...(capture?{assertCurrent}:{}),runId: input.runId, evidenceIds, summary, now: input.now });
        return { status: 'success', summary, candidateCount };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        await dependencies.finishFailure({
          runId: input.runId,
          failureKind: 'executor_failed',
          message: `runtime_unavailable: ${detail}`,
          now: input.now,
        });
        return { status: 'failed', reason: 'runtime_unavailable' };
      }
    },
  };
}
