export * from './types';
export { api } from './bridge';
export type { Api } from './bridge';

// Re-export individual API methods for convenience
export const {
  getMe,
  getCaptchaConfig,
  createThread,
  getThread,
  listThreads,
  updateThreadTitle,
  updateThreadSidebarState,
  deleteThread,
  searchThreads,
  listStarredThreadIds,
  starThread,
  unstarThread,
  createTask,
  subscribeTask,
  answerQuestion,
  cancelTask,
  getActiveTask,
  recoverTask,
  getModelConfig,
  saveModelConfig,
  selectMaterials,
  importMaterial,
  openArtifact,
  listPersonas,
  getActivePersona,
  listSkills,
  getMemoryConfig,
  getConnectorsConfig,
  getCreditsBalance,
} = (await import('./bridge')).api;