// Public presentation contract. Runtime implementation remains host-owned.
export type {
  ActivitySource, WorkKind, WorkExecutionState, ReportingPreference, ActivityOrigin,
  WorkEvent, WorkBinding, WorkWatch, WorkProjection, ConversationActivity, ConversationWorkView, McpInputForm,
} from '../../src/runtime/conversation-activity/types.js';
export type { WorkAttention } from '../../src/runtime/conversation-activity/attention-projector.js';

export type { AttentionReason } from '../../src/runtime/conversation-activity/attention-catalog.js';
