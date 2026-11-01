import {assertOrdinaryLoopOwner} from './loop-run-context.js';
import {attachAssistantDerivedContext,hasAssistantExternalLineage,type AssistantDerivedCaptureSession,type AssistantDerivedLineage} from './assistant-derived-lineage.js';
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
  getProfile(): AssistantLoopProfile | undefined | Promise<AssistantLoopProfile | undefined>;
  collect(input: {
    signal?:AbortSignal;
    kind: 'evening' | 'morning';
    profile: AssistantLoopProfile;
    now: number;
  }): unknown | Promise<unknown>;
  beginDerivedCapture?(input:{runId:string;profile:AssistantLoopProfile;kind:'evening'|'morning';now:number;signal?:AbortSignal}):AssistantDerivedCaptureSession;
  recordCollection?(input: {lineage?:AssistantDerivedLineage;isCurrent?:()=>boolean;runId:string; profile:AssistantLoopProfile; kind: 'evening' | 'morning'; snapshot:unknown; now:number}): void | Promise<void>;
  finishAnalysis?(runId:string,status:'complete'|'failed'):void | Promise<void>;
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
  | { status: 'failed'; reason: 'runtime_unavailable'; errorCode?:'assistant_derived_protected_unsupported' };

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

      let derivedMode=false;
      try {
        const session=dependencies.beginDerivedCapture?.({runId:input.runId,profile,kind:input.kind,now:input.now,signal:input.signal});derivedMode=!!session;
        const rawSnapshot = await dependencies.collect({ kind: input.kind, profile, now: input.now,...(input.signal?{signal:input.signal}:{}) });
        const captured=await session?.finish(rawSnapshot);
        const assertCurrent=()=>{if(captured&&hasAssistantExternalLineage(captured.lineage)){try{assertOrdinaryLoopOwner('loop_run',input.runId);}catch{throw Error('assistant_derived_protected_unsupported');}}if(input.signal?.aborted||captured&&!captured.isCurrent())throw Error('assistant_derived_stale');};
        assertCurrent();
        if(captured&&hasAssistantExternalLineage(captured.lineage)&&input.publicationProducer)throw Error('assistant_derived_protected_unsupported');
        const snapshot=attachAssistantDerivedContext(rawSnapshot,captured);
        if(captured&&!dependencies.recordCollection)throw Error('assistant_derived_persistence_required');
        await dependencies.recordCollection?.({runId:input.runId,profile,kind:input.kind,snapshot,now:input.now,...(captured?{lineage:captured.lineage,isCurrent:captured.isCurrent}:{})});
        assertCurrent();
        const output = await dependencies.complete({ kind: input.kind, profile, snapshot, signal: input.signal });
        assertCurrent();
        await dependencies.finishAnalysis?.(input.runId,'complete');
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
        assertCurrent();
        if(input.publicationProducer){input.publicationProducer.recordAssistantOutput(output,input.now);return {status:'publication_pending',summary,candidateCount};}
        const evidenceIds = await dependencies.recordEvidence({
          runId: input.runId,
          kind: input.kind,
          summary,
          output,
          now: input.now,
        });
        assertCurrent();
        await dependencies.finishSuccess({ runId: input.runId, evidenceIds, summary, now: input.now });
        assertCurrent();
        return { status: 'success', summary, candidateCount };
      } catch (error) {
        // A publication or evidence error after completed analysis must not rewrite
        // analysis history. The owner makes terminal transitions idempotent.
        try { await dependencies.finishAnalysis?.(input.runId,'failed'); } catch { /* Keep original failure. */ }
        const detail = derivedMode?(error instanceof Error&&error.message==='assistant_derived_protected_unsupported'?error.message:'assistant_derived_unavailable'):error instanceof Error ? error.message : String(error);
        await dependencies.finishFailure({
          runId: input.runId,
          failureKind: 'executor_failed',
          message: `runtime_unavailable: ${detail}`,
          now: input.now,
        });
        return { status: 'failed', reason: 'runtime_unavailable',...(detail==='assistant_derived_protected_unsupported'?{errorCode:detail as 'assistant_derived_protected_unsupported'}:{}) };
      }
    },
  };
}
