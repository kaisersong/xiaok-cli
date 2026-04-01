import type { InputStateSnapshot } from './input-model.js';
import type { ModalState } from './modal-state.js';
import type { OverlayState } from './overlay-state.js';

export type FocusTarget = 'input' | 'overlay' | 'modal' | 'none';

export interface SurfaceState {
  prompt: string;
  transcript: string[];
  input: InputStateSnapshot;
  overlay: OverlayState | null;
  modal: ModalState | null;
  focusTarget: FocusTarget;
  terminalSize: {
    columns: number;
    rows: number;
  };
}
