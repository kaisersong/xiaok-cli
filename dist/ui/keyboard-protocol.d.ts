/** Request only key disambiguation; keep text/IME input and legacy Enter intact. */
export declare function retainKeyboardProtocol(): () => void;
/** Preserve the existing control-key and Ctrl+C owner paths for CSI-u terminals. */
export declare function normalizeEnhancedKeys(bytes: Buffer): Buffer;
