/** Fixed deployment plan, not an engine qualification. The installed caller must
 * verify the full package and service identity before executing any command. */
export declare function buildPrivateMacEnginePlan(input: {
    releaseRoot: string;
    stateRoot: string;
    baseImageSha256: string;
    dockerArchiveSha256: string;
    creationNonce: string;
}): Readonly<{
    name: "xiaok-engine";
    hostSocket: string;
    configPath: string;
    unit: "[Unit]\nDescription=Xiaok isolated verification engine\nAfter=network.target\n[Service]\nType=simple\nGroup=xiaokvm\nEnvironment=PATH=/usr/local/lib/xiaok-engine:/usr/sbin:/usr/bin:/sbin:/bin\nRuntimeDirectory=xiaok-engine\nRuntimeDirectoryMode=0750\nExecStart=/usr/local/lib/xiaok-engine/dockerd --host=unix:///run/xiaok-engine/docker.sock --group=xiaokvm --data-root=/var/lib/xiaok-engine --exec-root=/run/xiaok-engine/runtime --pidfile=/run/xiaok-engine/docker.pid --bridge=none --iptables=false --ip6tables=false --ip-forward=false --userland-proxy=false\nDelegate=yes\nKillMode=process\nRestart=no\n[Install]\nWantedBy=multi-user.target\n";
    configJson: string;
    bootstrapScript: string;
    executable: string;
    env: Readonly<{
        PATH: string;
        HOME: string;
        LIMA_HOME: string;
        LC_ALL: "C";
        DYLD_LIBRARY_PATH: string;
        DYLD_FALLBACK_LIBRARY_PATH: "/var/empty";
        QEMU_MODULE_DIR: string;
        GIO_MODULE_DIR: string;
        GIO_EXTRA_MODULES: string;
    }>;
    validateArgv: readonly string[];
    startArgv: readonly string[];
    copyEngineArgv: readonly string[];
    bootstrapArgv: readonly string[];
}>;
