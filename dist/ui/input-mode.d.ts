/** Windows ReadConsole can retain a cooked read across a rapid raw-mode toggle. */
export declare function retainRawInputModeForSession(): () => void;
/** Only for internal reader handoffs; external terminal owners must still set cooked mode. */
export declare function pauseInputForHandoff(): void;
