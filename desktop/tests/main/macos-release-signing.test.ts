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
    expect(workflow).toContain('Import macOS signing certificate');
    expect(workflow).toContain('Sign macOS bundled wheel binaries');
    expect(workflow).toContain('Package signed macOS app');
    expect(workflow).toContain('Notarize macOS app');
    expect(workflow).toContain('Package macOS distributables');
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
    expect(workflow).toContain('security import "$cert_path"');
    expect(workflow).toContain('scripts/sign-macos-wheel-binaries.py');
    expect(workflow).toContain('scripts/notarize-macos-app.sh desktop/release/mac-arm64/xiaok.app');
    expect(workflow).toContain('--identity "Developer ID Application: Kai Song (Y9YR86UG94)"');
    expect(workflow).toContain('--keychain "$MACOS_SIGNING_KEYCHAIN"');
    expect(workflow).toContain('--mac dir --arm64');
    expect(workflow).toContain('--mac dmg zip --arm64');
    expect(workflow).toContain('--prepackaged release/mac-arm64/xiaok.app');
    expect(workflow).toContain('-c.mac.forceCodeSigning=true');
    expect(workflow).toContain('-c.mac.notarize=false');
    expect(workflow).toContain('NOTARY_TIMEOUT_SECONDS: "1800"');
    expect(workflow).toContain('NOTARY_REUSE_IN_PROGRESS: "true"');
    expect(workflow).toContain('NOTARY_REUSE_WINDOW_SECONDS: "7200"');
    expect(workflow).toContain(`TeamIdentifier=${appleTeamId}`);
    expect(workflow).toContain('xcrun stapler validate');
    expect(workflow).not.toContain('-c.mac.notarize=true');
    expect(workflow).not.toContain('APPLE_ID:');
    expect(workflow).not.toContain('APPLE_APP_SPECIFIC_PASSWORD');
  });

  it('keeps Apple notarization observable instead of hiding it inside electron-builder', async () => {
    const script = await readFile(join(repoRoot, 'scripts', 'notarize-macos-app.sh'), 'utf8');

    expect(script).toContain('xcrun notarytool submit');
    expect(script).toContain('xcrun notarytool info');
    expect(script).toContain('xcrun notarytool history');
    expect(script).toContain('xcrun notarytool log');
    expect(script).toContain('xcrun stapler staple "$app_path"');
    expect(script).toContain('xcrun stapler validate "$app_path"');
    expect(script).toContain('Notary submission id: $submission_id');
    expect(script).toContain('try_staple_existing_ticket');
    expect(script).toContain('find_reusable_submission_id');
    expect(script).toContain('Reusing recent in-progress notarization submission');
    expect(script).not.toContain('--wait');
  });
});
