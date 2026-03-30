interface TaskIdentity {
    taskId: string;
    sessionId: string;
    createdAt: number;
    updatedAt: number;
}
type TaskFactory<TTask, TCreateInput> = (taskId: string, now: number, input: TCreateInput) => TTask;
export declare class InMemoryTaskStore<TTask extends TaskIdentity, TCreateInput> {
    private readonly factory;
    private readonly tasks;
    private nextId;
    constructor(factory: TaskFactory<TTask, TCreateInput>);
    create(input: TCreateInput): TTask;
    get(taskId: string): TTask | undefined;
    update(taskId: string, patch: Partial<TTask>): TTask | undefined;
    listBySession(sessionId: string): TTask[];
    private compareTasks;
    private extractSequence;
}
export {};
