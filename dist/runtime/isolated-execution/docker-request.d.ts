export declare const WORKER_SECCOMP_JSON: string;
export declare const WORKER_SECCOMP_SHA256: string;
/** imageDigest is a platform Docker image/config ID; the installer resolves OCI manifests before this API. */
export declare function buildDockerWorkerRequest(input: unknown): {
    Image: string;
    Cmd: string[];
    Entrypoint: string[];
    User: string;
    Env: string[];
    WorkingDir: string;
    AttachStdin: boolean;
    AttachStdout: boolean;
    AttachStderr: boolean;
    Tty: boolean;
    OpenStdin: boolean;
    Healthcheck: {
        Test: string[];
    };
    Labels: {
        'xiaok.attempt': string;
        'xiaok.scope': string;
        'xiaok.seccomp': string;
    };
    HostConfig: {
        NetworkMode: string;
        ReadonlyRootfs: boolean;
        Privileged: boolean;
        CapDrop: string[];
        CapAdd: never[];
        SecurityOpt: string[];
        PidsLimit: number;
        Memory: number;
        MemorySwap: number;
        NanoCpus: number;
        CgroupnsMode: string;
        IpcMode: string;
        PidMode: string;
        UTSMode: string;
        Binds: never[];
        PortBindings: {};
        PublishAllPorts: boolean;
        RestartPolicy: {
            Name: string;
        };
        AutoRemove: boolean;
        LogConfig: {
            Type: string;
            Config: {
                'max-size': string;
                'max-file': string;
                compress: string;
            };
        };
        Tmpfs: {
            '/tmp': string;
        };
        Ulimits: {
            Name: string;
            Soft: number;
            Hard: number;
        }[];
    };
};
/** Docker merges image Env/Volumes into container config, so fixed create fields alone are insufficient. */
export declare function assertDockerImageConfiguration(input: unknown): void;
/** Hashes the entire fixed container policy, with invocation-specific fields represented by fixed placeholders. */
export declare const WORKER_POLICY_SHA256: string;
export interface DockerStdinDescriptor {
    readonly sha256: string;
    readonly bytes: number;
}
/** Private blackbox input mode: exact approved argv, no shell wrapper or new
 * environment. Invocation scope separately commits the approved case identity. */
export declare function buildDockerStdinWorkerRequest(input: {
    request: unknown;
    stdin: DockerStdinDescriptor;
}): {
    AttachStdin: boolean;
    OpenStdin: boolean;
    StdinOnce: boolean;
    Labels: {
        'xiaok.stdin-sha256': string;
        'xiaok.stdin-bytes': string;
        'xiaok.attempt': string;
        'xiaok.scope': string;
        'xiaok.seccomp': string;
    };
    Image: string;
    Cmd: string[];
    Entrypoint: string[];
    User: string;
    Env: string[];
    WorkingDir: string;
    AttachStdout: boolean;
    AttachStderr: boolean;
    Tty: boolean;
    Healthcheck: {
        Test: string[];
    };
    HostConfig: {
        NetworkMode: string;
        ReadonlyRootfs: boolean;
        Privileged: boolean;
        CapDrop: string[];
        CapAdd: never[];
        SecurityOpt: string[];
        PidsLimit: number;
        Memory: number;
        MemorySwap: number;
        NanoCpus: number;
        CgroupnsMode: string;
        IpcMode: string;
        PidMode: string;
        UTSMode: string;
        Binds: never[];
        PortBindings: {};
        PublishAllPorts: boolean;
        RestartPolicy: {
            Name: string;
        };
        AutoRemove: boolean;
        LogConfig: {
            Type: string;
            Config: {
                'max-size': string;
                'max-file': string;
                compress: string;
            };
        };
        Tmpfs: {
            '/tmp': string;
        };
        Ulimits: {
            Name: string;
            Soft: number;
            Hard: number;
        }[];
    };
};
