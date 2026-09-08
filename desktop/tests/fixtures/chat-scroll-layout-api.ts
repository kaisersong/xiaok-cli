// Fixed external API dependencies only. The actual ChatView, ChatInput,
// ConversationIndexRail and ChatRightSurface DOM/scrolling are not replaced.
export const api = {
  listSkills: async () => [],
  getModelConfig: async () => ({ providers: [], models: [], defaultModelId: null }),
};
