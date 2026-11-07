export const ENTERPRISE_CLI_PROVIDERS = ['dingtalk', 'feishu', 'wecom'] as const;
export type EnterpriseCliProvider = typeof ENTERPRISE_CLI_PROVIDERS[number];
export interface EnterpriseCliArtifact {
  version: string;
  urls: string[];
  checksum: string;
  format: 'tar.gz' | 'zip';
  entry: string;
  licenseEntry: string;
  noticeEntry?: string;
}
export const ENTERPRISE_CLI_COMMANDS = { dingtalk: 'dws', feishu: 'lark-cli', wecom: 'wecom-cli' } as const;
// Release digests from the matching official npm package checksums.txt;
// WeCom SRI from its official platform npm packages, verified 2026-11-05.
const digests = {
  "dingtalk": {
    "dws-linux-amd64.tar.gz": "25959351407e51d4aba7638790ff1cd04fdd7eaa56b313a26b689c03628e0ee2",
    "dws-linux-arm64.tar.gz": "1170453962f1bd049f27097385cab8b68dbf25cd69f45eb020e5d3bca0cad605",
    "dws-windows-amd64.zip": "3cb839866497405581c8ba5ef069e635495e9ee8afa8ff736c11f66db726184e",
    "dws-windows-arm64.zip": "349cec555a59dff53ceb142ccf2f9e29727bf879ceb045fb9f51962226b5dcb2",
    "dws-darwin-amd64.tar.gz": "1021d30296534c380bd27967b1641d5a5e42573e263c56d8a984dd13eb9991c2",
    "dws-darwin-arm64.tar.gz": "ffbb8962de879a5693ea380654813f45f9252f39d5527a24e135567aa2c36dea",
    "dws-skills.zip": "506fe3d7c4437187c71812d5d94227f3cd4d7c569800a7466ae1a79838f84f73",
    "dws-openharmony-arm64.tar.gz": "5d12309c796778466a1d5a518e789f44af5fe691bee98162fe15c227b5caf61d"
  },
  "feishu": {
    "lark-cli-1.0.99-darwin-amd64.tar.gz": "31f900409082728761346a94b7b81038c78b302883b69c36b849b23d843d7de1",
    "lark-cli-1.0.99-darwin-arm64.tar.gz": "f24f4106d1b0b1a4ee9a24ec0953dee6e518476bbe3d9758f78a732477525b21",
    "lark-cli-1.0.99-linux-amd64.tar.gz": "fd29f51030dde6919b6ca9173bc87852d3846f253d198022ea2d9ee63527b945",
    "lark-cli-1.0.99-linux-arm64.tar.gz": "2837145e72922d558538494d0da30ac6c509681fc0791f8818f4ddb87f5125b4",
    "lark-cli-1.0.99-linux-riscv64.tar.gz": "31bed6e817b3446609db7cfa6d82a501494ff60644a8c736ded918fc407c937c",
    "lark-cli-1.0.99-windows-amd64.zip": "1b43cb63ff533ee067db45d93a862074d147df5a0d05f95c2d2a7c70c3f97375",
    "lark-cli-1.0.99-windows-arm64.zip": "6ce96dd8559ef7e0a2b4e228b81a955e3df71e6e19f2d2070b65df232b4ae8a4"
  }
} as const;
const wecom = {
  "darwin-arm64": {
    "url": "https://registry.npmjs.org/@wecom/cli-darwin-arm64/-/cli-darwin-arm64-1.3.4.tgz",
    "integrity": "sha512-mktTGWYWqwE5exPs/vdiYcwas77G7DPEhAmj1Hl0LqQHUp6tfwplSfJQ/TaESZvmKtoqDglrywtIQeJ0ksFsWA=="
  },
  "darwin-x64": {
    "url": "https://registry.npmjs.org/@wecom/cli-darwin-x64/-/cli-darwin-x64-1.3.4.tgz",
    "integrity": "sha512-w9TuS95c06uyqbylxNjBCtC3GvR/6Vf6WK1zvsIcif7ivUq6Gu5scssagbD6rBWwhQUJ6o2MQKufpa439mL8bg=="
  },
  "win32-x64": {
    "url": "https://registry.npmjs.org/@wecom/cli-win32-x64/-/cli-win32-x64-1.3.4.tgz",
    "integrity": "sha512-FomGDkkDVZpKB9GZjAdMvR7491z9DMiaEzYQyDkA+3Yx6I100gJFnIJ31VZr6oMIRrZCT19GzNP+7c4DzuoPbg=="
  },
  "linux-x64": {
    "url": "https://registry.npmjs.org/@wecom/cli-linux-x64/-/cli-linux-x64-1.3.4.tgz",
    "integrity": "sha512-Mguwa8AqwTM5hqKZXBs7lwMJ7AZLCJpu+usuHdQLQV9bzF3gM9e70khKHAQCS7focgMHvT/+mW++S7JvXKdL6Q=="
  },
  "linux-arm64": {
    "url": "https://registry.npmjs.org/@wecom/cli-linux-arm64/-/cli-linux-arm64-1.3.4.tgz",
    "integrity": "sha512-BUvkJCMiM6aImK1MGjA6TuNslfay9eg/cOrmmvg3RLAlB9xTQUfqdq9YQxFog04wEpnlZSsgNXq6bWQaIvwX9w=="
  }
} as const;
export function getEnterpriseCliArtifact(provider: EnterpriseCliProvider, platform: NodeJS.Platform, arch: string): EnterpriseCliArtifact | undefined {
  if (!['darwin', 'linux', 'win32'].includes(platform) || !['x64', 'arm64'].includes(arch)) return undefined;
  const target = `${platform}-${arch}`;
  if (provider === 'wecom') {
    const artifact = wecom[target as keyof typeof wecom];
    return artifact ? { version: '1.3.4', urls: [artifact.url], checksum: artifact.integrity.replace('sha512-', 'sha512:'), format: 'tar.gz', entry: `package/bin/wecom-cli${platform === 'win32' ? '.exe' : ''}`, licenseEntry: 'package/LICENSE' } : undefined;
  }
  const os = platform === 'win32' ? 'windows' : platform;
  const cpu = arch === 'x64' ? 'amd64' : 'arm64';
  const format = platform === 'win32' ? 'zip' : 'tar.gz';
  const version = provider === 'dingtalk' ? '1.0.67' : '1.0.99';
  const asset = provider === 'dingtalk' ? `dws-${os}-${cpu}.${format}` : `lark-cli-${version}-${os}-${cpu}.${format}`;
  const digest = (digests[provider] as Record<string, string>)[asset];
  if (!digest) return undefined;
  const repo = provider === 'dingtalk' ? 'DingTalk-Real-AI/dingtalk-workspace-cli' : 'larksuite/cli';
  const urls = [`https://github.com/${repo}/releases/download/v${version}/${asset}`];
  if (provider === 'feishu') urls.push(`https://registry.npmmirror.com/-/binary/lark-cli/v${version}/${asset}`);
  return { version, urls, checksum: `sha256:${digest}`, format, entry: `${ENTERPRISE_CLI_COMMANDS[provider]}${platform === 'win32' ? '.exe' : ''}`, licenseEntry: 'LICENSE', ...(provider === 'dingtalk' ? { noticeEntry: 'NOTICE' } : {}) };
}
