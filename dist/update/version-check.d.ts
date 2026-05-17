export interface UpdateCheckResult {
    current: string;
    latest: string;
    hasUpdate: boolean;
}
export declare function checkForUpdate(currentVersion: string): Promise<UpdateCheckResult | null>;
