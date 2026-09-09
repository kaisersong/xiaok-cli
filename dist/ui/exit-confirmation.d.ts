export declare function createExitConfirmation(now?: () => number, windowMs?: number): {
    press(): boolean;
    reset(): void;
};
