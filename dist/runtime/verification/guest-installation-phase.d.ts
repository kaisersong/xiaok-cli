/** Fixed service-private guest phase scripts. No project command or path input. */
export declare function guestInstallationLock(creationNonce: string): string;
export declare function guestArchiveInstall(input: {
    creationNonce: string;
    file: 'docker.tgz' | 'worker.tar';
    sha256: string;
}): string;
