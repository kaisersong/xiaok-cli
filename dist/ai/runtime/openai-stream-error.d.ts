/** Only called for the exact status-less SDK APIError at the model boundary. */
export declare function createOpenAIStreamError(raw: object): Error;
/** Revalidate the owned shape at the UI/runtime sink; never echo arbitrary text. */
export declare function getOpenAIStreamFailure(error: unknown): {
    message: string;
    retryable: boolean;
} | undefined;
