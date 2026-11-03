type Reason = 'symlink' | 'symlink_target_missing' | 'symlink_loop' | 'not_directory' | 'owner' | 'mode' | 'unreadable' | 'invalid_path';
export declare class ProfileAccountHomeError extends Error {
    readonly path: string;
    readonly reason: Reason;
    constructor(path: string, reason: Reason);
}
/** Config overrides name the .xiaok directory itself. UID remains an OS fact. */
export declare function resolveProfileAccountHome(): {
    home: string;
    base: string;
};
export declare function inspectProfileAccountHome(): {
    ok: true;
} | {
    ok: false;
    path: string;
    reason: ProfileAccountHomeError['reason'];
};
export {};
