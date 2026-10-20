export interface ActivityOwnerQualification {
    profileId: string;
    configDigest: string;
    generation: number;
}
/** Auto-detection cannot turn a protected root with missing identity into Standalone. */
export declare function readProtectedOwnerQualification(root: string): ActivityOwnerQualification | undefined;
