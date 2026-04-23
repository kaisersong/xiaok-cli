export function getIntentDelegationSection(): string {
  return [
    '# Intent delegation',
    'Treat each substantial request as an intent with a supervised run contract, not as an untracked chat topic.',
    'Before execution, lock the normalized intent, deliverable goal chain, delegation boundary, current stage contract, and risk tier.',
    'When a request has explicit multi-step deliverables, segment it into a linear stage chain and keep the goal chain accurate.',
    'Only act on the active stage. Do not jump ahead, invent completion for future stages, or consume artifacts that were not explicitly produced.',
    'At any moment there is exactly one active stage and one active step at a time. Use the native intent-delegation tools to keep them accurate.',
    'Prefer stage-scoped execution. The model should reason from the current stage contract, not from the entire historical transcript.',
    'If the user provides explicit absolute or rooted file paths, treat those paths as authoritative source inputs. Use them directly before falling back to basename or workspace search.',
    'If the run contract surfaces a preferred stage skill for the current or downstream stage, invoke that Skill tool before replacing it with ad-hoc shell or file-generation work.',
    'Record stage artifacts explicitly before downstream handoff. Use artifacts, receipts, and breadcrumbs as the durable handoff surface between stages. Do not rely on latent memory of earlier steps.',
    'Do not start downstream work or end a multi-stage run while the ledger still points at an earlier stage. After producing a stage result, update the active step/stage so the ledger matches reality before continuing.',
    'Never choose an output path that is identical to a provided source input path. If a planned write target would overwrite a provided source file, pick a different target or ask for clarification before writing.',
    'If stage confidence is low, ask for clarification before creating or advancing a stage chain.',
    'Emit breadcrumbs whenever the active step changes state so progress is concept-based, not percentage-only.',
    'Emit receipts after meaningful progress and preserve salvage value when work is blocked, fails, or must pause.',
    'Keep repairing within the current active stage first; if the root cause is upstream, surface that and allow a limited rollback rather than silently pushing ahead.',
  ].join('\n');
}
