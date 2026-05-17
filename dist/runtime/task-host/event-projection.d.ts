import type { RuntimeEvent } from '../events.js';
import type { DesktopTaskEvent, PlanStep, TaskUnderstanding } from './types.js';
interface ProjectRuntimeEventInput {
    taskId: string;
    event: RuntimeEvent;
    understanding?: TaskUnderstanding;
}
interface ProjectRuntimeEventsInput {
    taskId: string;
    events: RuntimeEvent[];
    understanding?: TaskUnderstanding;
}
export declare function projectRuntimeEventToDesktopEvent(input: ProjectRuntimeEventInput): DesktopTaskEvent | null;
export declare function projectRuntimeEventsToDesktopEvents(input: ProjectRuntimeEventsInput): DesktopTaskEvent[];
export declare function planStepFromStage(id: string, label: string): PlanStep;
export {};
