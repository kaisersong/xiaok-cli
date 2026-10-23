import { type DockerStdinDescriptor } from './docker-request.js';
export interface VolumeProposal {
    name: string;
    creationNonce: string;
    engineEpoch: string;
    bytes: number;
}
/** Fixed tmpfs driver options. Names/nonces are controller generated; labels alone grant no authority. */
export declare function buildDockerVolumeRequest(raw: VolumeProposal): {
    Name: string;
    Driver: string;
    DriverOpts: {
        type: string;
        device: string;
        o: string;
    };
    Labels: {
        'xiaok.creation': string;
        'xiaok.engine-epoch': string;
    };
};
interface Common {
    imageDigest: string;
    attemptId: string;
    scopeDigest: string;
    inputVolume: string;
    outputVolume: string;
}
type MountedProposal = Common & ({
    role: 'holder';
} | {
    role: 'worker';
    command: {
        argv: readonly string[];
        cwdRelative: string;
    };
    stdin?: DockerStdinDescriptor;
});
/** Holder never executes project code. Its input mount is writable only while the private controller populates it.
 * Sealing and exclusion of subsequent archive writes are enforced by the durable runner state machine. */
export declare function buildDockerMountedRequest(raw: MountedProposal): {
    WorkingDir: string;
    Labels: {
        'xiaok.role': "holder" | "worker";
        'xiaok.attempt': string;
        'xiaok.scope': string;
        'xiaok.seccomp': string;
    };
    HostConfig: {
        Mounts: {
            Type: string;
            Source: string;
            Target: string;
            ReadOnly: boolean;
            VolumeOptions: {
                NoCopy: boolean;
            };
        }[];
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
    Image: string;
    Cmd: string[];
    Entrypoint: string[];
    User: string;
    Env: string[];
    AttachStdin: boolean;
    AttachStdout: boolean;
    AttachStderr: boolean;
    Tty: boolean;
    OpenStdin: boolean;
    Healthcheck: {
        Test: string[];
    };
};
export declare const MOUNTED_POLICY_SHA256: string;
export {};
