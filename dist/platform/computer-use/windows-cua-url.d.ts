export declare function validatedBrowserUrl(value: unknown): string;
/** Rechecked at native dispatch; no executable or arbitrary arguments escape. */
export declare function validateNativeBrowserLaunch(input: Readonly<Record<string, unknown>>): {
    urls: string[];
};
