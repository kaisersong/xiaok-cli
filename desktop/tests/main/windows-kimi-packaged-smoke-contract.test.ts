import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Windows packaged Kimi release gate', () => {
  it('launches win-unpacked and gates both K3 models plus auth, rollback, and canary checks', () => {
    const workflow = readFileSync(
      join(process.cwd(), '..', '.github', 'workflows', 'desktop-release.yml'),
      'utf8',
    );
    const packageIndex = workflow.indexOf('Package Windows installer');
    const smokeIndex = workflow.indexOf('Run packaged Windows Kimi K3 smoke');
    const uploadIndex = workflow.indexOf('Upload to GitHub Release', smokeIndex);

    expect(packageIndex).toBeGreaterThan(-1);
    expect(smokeIndex).toBeGreaterThan(packageIndex);
    expect(uploadIndex).toBeGreaterThan(smokeIndex);
    expect(workflow).toContain("desktop/release/win-unpacked/xiaok.exe");
    expect(workflow).toContain("foreach ($model in @('k3', 'k3-256k'))");
    expect(workflow).toContain('authorizationDenyNetworkRequests');
    expect(workflow).toContain('rollbackDenyNetworkRequests');
    expect(workflow).toContain('PACKAGED_SMOKE_RUNTIME_ONLY');
  });

  it('provides a manually dispatchable packaged smoke without release side effects', () => {
    const workflow = readFileSync(
      join(process.cwd(), '..', '.github', 'workflows', 'desktop-cross-platform.yml'),
      'utf8',
    );
    const jobIndex = workflow.indexOf('windows-kimi-packaged-smoke:');
    const packageIndex = workflow.indexOf('Package Windows Kimi smoke app', jobIndex);
    const smokeIndex = workflow.indexOf('Run packaged Windows Kimi K3 smoke', jobIndex);

    expect(workflow).toContain('workflow_dispatch: {}');
    expect(jobIndex).toBeGreaterThan(-1);
    expect(workflow.slice(jobIndex)).toContain("if: github.event_name == 'workflow_dispatch'");
    expect(workflow.slice(jobIndex)).toContain('runs-on: windows-2022');
    expect(packageIndex).toBeGreaterThan(jobIndex);
    expect(smokeIndex).toBeGreaterThan(packageIndex);
    expect(workflow.slice(jobIndex)).toContain('desktop/release/win-unpacked/xiaok.exe');
    expect(workflow.slice(jobIndex)).toContain('PACKAGED_SMOKE_RUNTIME_ONLY');
    expect(workflow).not.toContain('gh release');
  });
});
