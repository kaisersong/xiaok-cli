/** Renders reviewable system changes only. It does not install, launch, or grant qualification. */
export declare function renderMacOSDeploymentInstaller(input: unknown): Readonly<{
    releaseId: string;
    installScript: string;
}>;
