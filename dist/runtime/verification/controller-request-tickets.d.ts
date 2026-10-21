/** Process-private monotonic one-use tickets. A new process has no old tickets. */
export declare function createControllerRequestTickets(): Readonly<{
    issue(principal: string): string;
    consume(id: unknown, principal: string): void;
}>;
