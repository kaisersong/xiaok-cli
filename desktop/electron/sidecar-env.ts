/** Only sidecar-owned namespaces may use prefix matching. */
export const SIDECAR_ENV_PREFIXES = ['KSWARM_', 'INTENT_BROKER_'] as const;

export const SIDECAR_ENV_NAMES = [
  // System identity, executable discovery, temporary files, locale and desktop session.
  'PATH', 'Path', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TEMP', 'TMP', 'TZ',
  'LANG', 'LANGUAGE', 'LC_ALL', 'LC_CTYPE', 'LC_COLLATE', 'LC_MESSAGES', 'LC_MONETARY',
  'LC_NUMERIC', 'LC_TIME', 'DISPLAY', 'WAYLAND_DISPLAY', 'DBUS_SESSION_BUS_ADDRESS', '__CF_USER_TEXT_ENCODING',
  // XDG locations keep configuration, data and runtime files in the user's chosen directories.
  'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'XDG_RUNTIME_DIR',
  // Windows system/user locations and shell discovery required by agent CLIs.
  'SystemRoot', 'SYSTEMROOT', 'windir', 'ComSpec', 'PATHEXT', 'USERPROFILE', 'APPDATA',
  'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH', 'SystemDrive', 'ProgramData', 'ALLUSERSPROFILE',
  'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'CommonProgramFiles', 'PUBLIC',
  'USERNAME', 'USERDOMAIN', 'COMPUTERNAME', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS', 'PSModulePath',
  // Proxy routing and trust stores for Node, Python, curl and Git behind enterprise proxies.
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
  'NODE_USE_ENV_PROXY', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
  'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE', 'GIT_SSL_CAINFO',
  // Agent SSH authentication and Node installation discovery.
  'SSH_AUTH_SOCK', 'NVM_DIR',
  // Desktop background Node command and application configuration location.
  'XIAOK_NODE_CMD', 'XIAOK_CONFIG_DIR',
  // Non-secret configuration read by the sidecars: endpoints, public OAuth IDs, timing and models.
  'PORT', 'BROKER_URL', 'BROKER_ROOT', 'RELAY_AUTH_URL', 'RELAY_GITHUB_CLIENT_ID', 'RELAY_GOOGLE_CLIENT_ID',
  'ENABLE_HUMAN_ESCALATION', 'PRUNE_THRESHOLD_MS', 'POLL_INTERVAL_MS', 'TASK_STALE_MS',
  'TASK_NO_PROGRESS_MS', 'NOTIFY_DEDUP_MS', 'OPENAI_BASE_URL', 'OPENAI_MODEL',
  'ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL', 'OLLAMA_BASE_URL', 'OLLAMA_MODEL',
] as const;

// KSWARM_*/INTENT_BROKER_* 前缀匹配会带上 KSWARM_API_KEY/KSWARM_RUNTIME_TOKEN
// （sidecar 自己读取的，允许）；其它密钥一律不传。
// GH_TOKEN/GITHUB_TOKEN、OPENAI_API_KEY/ANTHROPIC_API_KEY、BROKER_API_KEY、YZJ_*、AWS_* 均不在清单内。
// kswarm 读 OPENAI_API_KEY/ANTHROPIC_API_KEY 只是无配置时的兜底，这里不传，行为变化需要在 PR 说明。
export function buildSidecarEnv(parent: NodeJS.ProcessEnv, platform = process.platform): Record<string, string> {
  const normalize = (name: string) => platform === 'win32' ? name.toUpperCase() : name;
  const names = new Set<string>(SIDECAR_ENV_NAMES.map(normalize));
  const prefixes = SIDECAR_ENV_PREFIXES.map(normalize);
  return Object.fromEntries(Object.entries(parent).filter(([name, value]) =>
    typeof value === 'string' && (names.has(normalize(name)) || prefixes.some(prefix => normalize(name).startsWith(prefix))),
  )) as Record<string, string>;
}
