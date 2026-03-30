export interface SessionBinding {
    sessionId: string;
    channel: 'yzj';
    chatId: string;
    userId?: string;
    cwd: string;
    repoRoot?: string;
    branch?: string;
    updatedAt: number;
}
interface BindInput {
    sessionId: string;
    chatId: string;
    userId?: string;
    cwd: string;
}
export declare class InMemorySessionBindingStore {
    private readonly bindings;
    bind(input: BindInput): Promise<SessionBinding>;
    get(sessionId: string): SessionBinding | undefined;
    clear(sessionId: string): boolean;
}
export {};
