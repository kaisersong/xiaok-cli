/** Fixed Linux-worker evidence for netdevice-mediated IPv4/IPv6/L2 only.
 * This does not qualify VSOCK, Unix sockets, shared memory or parent host IPC.
 * The functions are shared with ordinary controls; no caller-selected paths,
 * command callbacks, authority or qualification issuer are exposed. */
export declare const NETDEVICE_CHECK_FUNCTIONS: string;
export declare function buildNetdeviceTransmitDisabledCheck(): string;
/** Exact terminal daemon attachment evidence, additional to every original
 * HostConfig check. Not a cleanup identity check or a pre-kill eligibility gate;
 * NetworkMode=none alone is not a transmit-disabled proof. */
export declare function assertDockerNoneNetworkAttachment(value: unknown): void;
