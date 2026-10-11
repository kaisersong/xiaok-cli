/** Read one control field without enumerating the caller's other fields. */
export declare function readApplicationOwnDataField(value: unknown, key: string, error: string): Readonly<{
    present: boolean;
    kind: 'missing' | 'data' | 'accessor';
    value: unknown;
}>;
/** Inspect own descriptors without evaluating input accessors or Proxy traps. */
export declare function applicationDataDescriptors(value: unknown, maximumKeys?: number, error?: string): PropertyDescriptorMap;
/** Count canonical JSON bytes before allocating escaped strings or a full clone.
 * This is only a data bound; it supplies no execution or approval authority. */
export declare function captureApplicationData(raw: unknown, limits: {
    maximumBytes: number;
    maximumNodes: number;
    maximumDepth?: number;
    invalid: string;
    limit: string;
}): any;
