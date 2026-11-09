declare namespace runtime {
  interface BrokerNodeRuntime {
    command: string;
    env: NodeJS.ProcessEnv;
    expected: {node: string; sqlite: string; executableSha256: string};
  }
  interface BrokerRuntimeOptions {
    isPackaged: boolean;
    resourcesPath: string;
    platform?: NodeJS.Platform;
    arch?: string;
    env?: NodeJS.ProcessEnv;
  }
  function resolvePackagedBrokerRuntime(options: BrokerRuntimeOptions): BrokerNodeRuntime | null;
  function brokerRuntimeMatchesHealth(body: Record<string, unknown> | null, runtime: BrokerNodeRuntime): boolean;
  function assertRuntimeFileReadsKnown(): void;
}
export = runtime;
