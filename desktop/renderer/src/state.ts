import type {
  DesktopTaskEvent,
  NeedsUserQuestion,
  PlanStep,
  SalvageSummary,
  TaskResult,
  TaskSnapshot,
  TaskSnapshotStatus,
  TaskUnderstanding,
} from '../../../src/runtime/task-host/types.js';

export interface AppProgressItem {
  eventId: string;
  message: string;
  stage?: string;
}

export interface AppState {
  taskId: string | null;
  status: TaskSnapshotStatus | null;
  understanding: TaskUnderstanding | null;
  plan: PlanStep[];
  currentQuestion: NeedsUserQuestion | null;
  progress: AppProgressItem[];
  assistantText: string;
  result: TaskResult | null;
  salvage: SalvageSummary | null;
  error: string | null;
}

export function createInitialAppState(): AppState {
  return {
    taskId: null,
    status: null,
    understanding: null,
    plan: [],
    currentQuestion: null,
    progress: [],
    assistantText: '',
    result: null,
    salvage: null,
    error: null,
  };
}

export function reduceAppEvent(state: AppState, event: DesktopTaskEvent): AppState {
  if (event.type === 'task_started') {
    return { ...state, taskId: event.taskId, status: state.status ?? 'understanding', error: null };
  }
  if (event.type === 'understanding_updated') {
    return {
      ...state,
      understanding: event.understanding,
      plan: event.understanding.suggestedPlan,
    };
  }
  if (event.type === 'plan_updated') {
    return { ...state, plan: event.plan };
  }
  if (event.type === 'needs_user') {
    return { ...state, status: 'waiting_user', currentQuestion: event.question };
  }
  if (event.type === 'progress') {
    if (state.progress.some((item) => item.eventId === event.eventId)) {
      return { ...state, status: 'running', currentQuestion: null };
    }
    return {
      ...state,
      status: 'running',
      currentQuestion: null,
      progress: [...state.progress, { eventId: event.eventId, message: event.message, stage: event.stage }],
    };
  }
  if (event.type === 'assistant_delta') {
    return { ...state, status: 'running', currentQuestion: null, assistantText: state.assistantText + event.delta };
  }
  if (event.type === 'result') {
    return {
      ...state,
      status: 'completed',
      currentQuestion: null,
      assistantText: state.assistantText || event.result.summary,
      result: event.result,
    };
  }
  if (event.type === 'salvage') {
    return {
      ...state,
      status: event.salvage.reason === 'cancelled' ? 'cancelled' : 'failed',
      currentQuestion: null,
      salvage: event.salvage,
    };
  }
  if (event.type === 'error') {
    return { ...state, status: 'failed', currentQuestion: null, error: event.message };
  }
  return state;
}

export function hydrateAppStateFromSnapshot(snapshot: TaskSnapshot): AppState {
  let state: AppState = {
    ...createInitialAppState(),
    taskId: snapshot.taskId,
    status: snapshot.status,
    result: snapshot.result ?? null,
    salvage: snapshot.salvage ?? null,
  };
  for (const event of snapshot.events) {
    state = reduceAppEvent(state, event);
  }
  return { ...state, status: snapshot.status };
}
