/**
 * Artifact Editing State Machine
 *
 * States: preview → annotating → submitted → reviewing → done
 *         + timeout_idle (from submitted after 60s)
 *
 * Used by renderer-side ArtifactViewer component.
 */

export type ArtifactEditingState =
  | 'preview'
  | 'annotating'
  | 'submitted'
  | 'timeout_idle'
  | 'reviewing'
  | 'done';

export type ArtifactEditingAction =
  | { type: 'START_ANNOTATING' }
  | { type: 'CANCEL_ANNOTATING' }
  | { type: 'SUBMIT' }
  | { type: 'FILE_CHANGED' }
  | { type: 'TIMEOUT' }
  | { type: 'FINISH' }
  | { type: 'RESET' };

export function artifactEditingReducer(
  state: ArtifactEditingState,
  action: ArtifactEditingAction,
): ArtifactEditingState {
  switch (action.type) {
    case 'START_ANNOTATING':
      if (state === 'preview' || state === 'timeout_idle' || state === 'reviewing') {
        return 'annotating';
      }
      return state;

    case 'CANCEL_ANNOTATING':
      if (state === 'annotating') return 'preview';
      return state;

    case 'SUBMIT':
      if (state === 'annotating') return 'submitted';
      return state;

    case 'FILE_CHANGED':
      if (state === 'submitted' || state === 'annotating') return 'reviewing';
      return state;

    case 'TIMEOUT':
      if (state === 'submitted') return 'timeout_idle';
      return state;

    case 'FINISH':
      if (state === 'reviewing' || state === 'annotating' || state === 'timeout_idle') {
        return 'done';
      }
      return state;

    case 'RESET':
      return 'preview';

    default:
      return state;
  }
}

export const INITIAL_STATE: ArtifactEditingState = 'preview';

/** Timeout duration for submitted → timeout_idle (ms) */
export const SUBMIT_TIMEOUT_MS = 60_000;
