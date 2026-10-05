/** Inspect descriptors without executing caller accessors or Proxy traps. */
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
