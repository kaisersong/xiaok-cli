// Fixed external API boundary only. Actual ChatView, ChatInput, readonly hook,
// ConversationIndexRail and ChatRightSurface DOM/lifecycles are not replaced.
import type { Api } from '../../renderer/src/api';

// Ordinary local UI notifications, not Main/SDK skill-catalog authority.
const skillsChanged = new EventTarget();

export function emitSkillsChangedForFixture(): void {
  skillsChanged.dispatchEvent(new Event('skills-changed'));
}

export const api = {
  listSkills: async () => [],
  getModelConfig: async () => ({
    configPath: '',
    defaultProvider: '',
    defaultModelId: '',
    providers: [],
    models: [],
    providerProfiles: [],
  }),
  onSkillsChanged(handler: () => void): () => void {
    const listener = () => handler();
    skillsChanged.addEventListener('skills-changed', listener);
    return () => skillsChanged.removeEventListener('skills-changed', listener);
  },
} satisfies Pick<Api, 'listSkills' | 'getModelConfig' | 'onSkillsChanged'>;
