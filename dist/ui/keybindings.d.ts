export type Action = 'submit' | 'newline' | 'history-prev' | 'history-next' | 'cursor-left' | 'cursor-right' | 'cursor-home' | 'cursor-end' | 'word-left' | 'word-right' | 'delete-back' | 'delete-word-back' | 'delete-to-start' | 'delete-to-end' | 'yank' | 'undo' | 'redo' | 'search-history' | 'clear-screen' | 'cancel' | 'eof' | 'escape' | 'tab' | 'shift-tab';
export declare function loadKeybindingsSync(): Map<string, Action>;
export declare function loadKeybindings(): Promise<Map<string, Action>>;
export declare function getBindingMap(): Map<string, Action>;
export declare function resolveAction(keyName: string): Action | undefined;
export declare function identifyKey(data: string, offset: number): {
    key: string;
    consumed: number;
} | null;
