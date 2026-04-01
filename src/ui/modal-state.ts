export interface PermissionModalState {
  type: 'permission';
  toolName: string;
  targetLines: string[];
  options: string[];
  selectedIndex: number;
}

export type ModalState = PermissionModalState;
