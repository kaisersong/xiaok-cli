export declare function createLogger(module: string): {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    child: (childModule: string) => /*elided*/ any;
};
export declare const log: {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    child: (childModule: string) => /*elided*/ any;
};
