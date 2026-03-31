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
interface SessionBindingStore {
    bind(input: BindInput): Promise<SessionBinding>;
    get(sessionId: string): SessionBinding | undefined;
    clear(sessionId: string): boolean;
}
export declare class InMemorySessionBindingStore implements SessionBindingStore {
    private readonly bindings;
    bind(input: BindInput): Promise<SessionBinding>;
    get(sessionId: string): SessionBinding | undefined;
    clear(sessionId: string): boolean;
}
export declare class FileSessionBindingStore implements SessionBindingStore {
    private readonly bindings;
    private readonly filePath;
    constructor(filePath: string);
    bind(input: BindInput): Promise<SessionBinding>;
    get(sessionId: string): SessionBinding | undefined;
    clear(sessionId: string): boolean;
    private load;
    private persist;
}
export {};
