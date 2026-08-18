export const DEFAULT_ASSISTANT_MORNING_SCHEDULE_ID = 'assistant:default-personal-assistant:morning';
export const DEFAULT_ASSISTANT_EVENING_SCHEDULE_ID = 'assistant:default-personal-assistant:evening';

export interface AssistantScheduleLabels {
  morningScheduleName: string;
  eveningScheduleName: string;
}

export function getAssistantScheduleDisplayName(
  task: { id: string; name: string },
  labels: AssistantScheduleLabels,
): string {
  if (task.id === DEFAULT_ASSISTANT_MORNING_SCHEDULE_ID) return labels.morningScheduleName;
  if (task.id === DEFAULT_ASSISTANT_EVENING_SCHEDULE_ID) return labels.eveningScheduleName;
  return task.name;
}
