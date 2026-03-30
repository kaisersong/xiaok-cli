export declare class ToolExplorer {
    private calls;
    private collapsed;
    addCall(name: string, input: Record<string, unknown>): void;
    setResult(index: number, result: string, isError: boolean): void;
    render(): void;
    private getSummary;
    reset(): void;
}
