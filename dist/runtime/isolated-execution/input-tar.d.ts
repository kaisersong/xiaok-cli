/** Builds controller-owned archive bytes; never passes a project supplied TAR to the engine. */
export declare function buildInputFileArchive(input: {
    path: string;
    bytes: Buffer;
    executable: boolean;
}): Buffer;
