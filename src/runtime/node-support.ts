export const MIN_NODE_VERSION = '22.14.0';

export function isNodeVersionAtLeast(version: string, minimum: string): boolean {
  const actual = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  const required = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(minimum);
  if (!actual || !required) return true;

  for (let index = 1; index <= 3; index++) {
    const actualPart = Number(actual[index]);
    const requiredPart = Number(required[index]);
    if (!Number.isSafeInteger(actualPart) || !Number.isSafeInteger(requiredPart)) return true;
  }
  for (let index = 1; index <= 3; index++) {
    const actualPart = Number(actual[index]);
    const requiredPart = Number(required[index]);
    if (actualPart > requiredPart) return true;
    if (actualPart < requiredPart) return false;
  }
  return true;
}

export function shouldBlockChatOnOldNode(input: {
  platform: string;
  version: string;
  print: boolean;
  json: boolean;
}): boolean {
  return input.platform === 'linux' && !input.print && !input.json
    && !isNodeVersionAtLeast(input.version, MIN_NODE_VERSION);
}

export function oldNodeMessage(version: string): string {
  return 'xiaok 需要 Node 22.14.0 或更新版本，你现在用的是 ' + version
    + '。请升级 Node 后重新运行，可用 nvm 或官网安装包升级。';
}
