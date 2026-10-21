export interface PermissionModalState {
  type: 'permission';
  toolName: string;
  targetLines: string[];
  reviewScopes?: string[];
  reviewRules?: string[];
  options: string[];
  selectedIndex: number;
}

export type ModalState = PermissionModalState;
