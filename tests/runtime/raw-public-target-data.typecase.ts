import type {intentPublicationTarget, IntentPublicationTargetData, IntentPublicationCandidate} from '../../src/runtime/intent-delegation/publication-candidate-journal.js';

// Compile-only API candidate. All imports erase; no target/binding/parser/route call.
type MinimalReader = (data:IntentPublicationTargetData,row:IntentPublicationCandidate)=>ReturnType<typeof intentPublicationTarget>;
type AcceptsMinimalData = typeof intentPublicationTarget extends MinimalReader ? true : false;
export const acceptsMinimalTargetData:AcceptsMinimalData=true;
