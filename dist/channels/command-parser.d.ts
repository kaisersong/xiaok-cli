export type YZJRemoteCommand = {
    kind: 'help';
} | {
    kind: 'status';
    taskId?: string;
} | {
    kind: 'cancel';
    taskId: string;
} | {
    kind: 'approve';
    approvalId: string;
} | {
    kind: 'deny';
    approvalId: string;
} | {
    kind: 'bind';
    cwd?: string;
    clear?: boolean;
} | {
    kind: 'skill';
    skillName: string;
    args?: string;
} | {
    kind: 'plain';
    text: string;
};
export declare function parseYZJCommand(input: string): YZJRemoteCommand;
