import {
  ASSISTANT_EVENING_LOOP_ID,
  ASSISTANT_MORNING_LOOP_ID,
  DEFAULT_PERSONAL_ASSISTANT_ID,
  type AssistantProfile,
  type AssistantStatus,
} from './assistant-types.js';
import type { LoopStore } from './loop-store.js';
import type { TimedActionService } from './timed-action-service.js';

const DEFAULT_WORKDAYS = [1, 2, 3, 4, 5];

export interface AssistantServiceOptions {
  loopStore: LoopStore;
  timedActionService: TimedActionService;
  now?: () => number;
  timeZone?: string;
}

export class AssistantService {
  private readonly now: () => number;
  private readonly timeZone: string;

  constructor(private readonly options: AssistantServiceOptions) {
    this.now = options.now ?? (() => Date.now());
    this.timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  bootstrap(): { profile: AssistantProfile } {
    const now = this.now();
    const profile = this.options.loopStore.ensureAssistantProfile({
      id: DEFAULT_PERSONAL_ASSISTANT_ID,
      status: 'needs_consent',
      locale: 'zh',
      timeZone: this.timeZone,
      eveningTime: '22:30',
      morningTime: '08:30',
      workdays: DEFAULT_WORKDAYS,
      quietHours: { start: '22:00', end: '08:00' },
      dataScopes: ['threads', 'projects', 'tasks', 'artifacts', 'automations', 'meetings'],
      createdAt: now,
      updatedAt: now,
    });
    this.options.loopStore.ensureBuiltInLoops(now);
    this.options.timedActionService.ensureAssistantLoopSchedule({
      id: 'assistant:default-personal-assistant:evening', loopId: ASSISTANT_EVENING_LOOP_ID,
      title: 'Personal assistant evening reflection', time: profile.eveningTime,
      timeZone: profile.timeZone, workdays: profile.workdays, status: profile.status === 'active' ? 'active' : 'paused',
    });
    this.options.timedActionService.ensureAssistantLoopSchedule({
      id: 'assistant:default-personal-assistant:morning', loopId: ASSISTANT_MORNING_LOOP_ID,
      title: 'Personal assistant morning briefing', time: profile.morningTime,
      timeZone: profile.timeZone, workdays: profile.workdays, status: profile.status === 'active' ? 'active' : 'paused',
    });
    this.projectStatus(profile.status, now);
    return { profile: this.options.loopStore.getAssistantProfile(DEFAULT_PERSONAL_ASSISTANT_ID)! };
  }

  setStatus(status: AssistantStatus): AssistantProfile {
    const profile = this.options.loopStore.setAssistantProfileStatus(DEFAULT_PERSONAL_ASSISTANT_ID, status, this.now());
    if (!profile) throw new Error('assistant profile does not exist');
    this.bootstrap();
    return profile;
  }

  private projectStatus(status: AssistantStatus, now: number): void {
    const loopStatus = status === 'active' ? 'active' : 'paused';
    this.options.loopStore.setLoopStatus(ASSISTANT_EVENING_LOOP_ID, loopStatus, now);
    this.options.loopStore.setLoopStatus(ASSISTANT_MORNING_LOOP_ID, loopStatus, now);
  }
}
