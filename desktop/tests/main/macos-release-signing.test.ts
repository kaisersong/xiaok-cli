import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..', '..', '..');
const appleTeamId = 'Y9YR86UG94';

describe('macOS release signing contract', () => {
  it('keeps the macOS bundle id registered to the Apple Developer team', async () => {
    const config = JSON.parse(await readFile(join(repoRoot, 'desktop', 'electron-builder.json'), 'utf8')) as {
      appId?: string;
      mac?: {
        hardenedRuntime?: boolean;
        gatekeeperAssess?: boolean;
        notarize?: boolean;
        forceCodeSigning?: boolean;
      };
    };

    expect(config.appId).toBe('com.xiaok.desktop');
    expect(config.mac?.hardenedRuntime).toBe(true);
    expect(config.mac?.gatekeeperAssess).toBe(false);
    expect(config.mac?.notarize).toBe(true);
    expect(config.mac?.forceCodeSigning).not.toBe(true);
  });

  it('requires Developer ID signing and notarization in the GitHub macOS release job', async () => {
    const workflow = await readFile(join(repoRoot, '.github', 'workflows', 'desktop-release.yml'), 'utf8');

    expect(workflow).toContain('Validate macOS signing secrets');
    expect(workflow).toContain('Write Apple notarization API key');
    expect(workflow).toContain('Verify macOS signature and notarization');

    for (const secretName of [
      'MACOS_CERTIFICATE_P12_BASE64',
      'MACOS_CERTIFICATE_PASSWORD',
      'APPLE_TEAM_ID',
      'APPLE_API_KEY_ID',
      'APPLE_API_ISSUER',
      'APPLE_API_KEY_P8_BASE64',
    ]) {
      expect(workflow).toContain(`secrets.${secretName}`);
    }

    expect(workflow).toContain('CSC_LINK');
    expect(workflow).toContain('CSC_KEY_PASSWORD');
    expect(workflow).toContain('APPLE_API_KEY');
    expect(workflow).toContain('-c.mac.forceCodeSigning=true');
    expect(workflow).toContain('-c.mac.notarize=true');
    expect(workflow).toContain(`TeamIdentifier=${appleTeamId}`);
    expect(workflow).toContain('xcrun stapler validate');
    expect(workflow).not.toContain('APPLE_ID:');
    expect(workflow).not.toContain('APPLE_APP_SPECIFIC_PASSWORD');
  });
});
