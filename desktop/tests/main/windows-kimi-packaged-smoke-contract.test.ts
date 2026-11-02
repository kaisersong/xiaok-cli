import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const VERIFY_WITH_SMOKE_ROOT =
  /verify-packaged-kimi-smoke-result\.mjs\s+\$resultPath\s+\$smokeRoot/;

describe('Windows packaged Kimi release gate', () => {
  it('launches win-unpacked and gates models via KIMI_CODING_PROFILES verifier', () => {
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
    expect(workflow).toContain('desktop/release/win-unpacked/xiaok.exe');
    expect(workflow).toMatch(VERIFY_WITH_SMOKE_ROOT);
    expect(workflow).not.toMatch(/foreach \(\$model in @\(/);
    expect(workflow).not.toMatch(/modelResults\.Count -ne \d+/);
    expect(workflow).toContain('scripts/check-desktop-sibling-pins.mjs');
  });

  it('runs packaged smoke on related PR/push paths, not only workflow_dispatch', () => {
    const workflow = readFileSync(
      join(process.cwd(), '..', '.github', 'workflows', 'desktop-cross-platform.yml'),
      'utf8',
    );
    const jobIndex = workflow.indexOf('windows-kimi-packaged-smoke:');
    const packageIndex = workflow.indexOf('Package Windows Kimi smoke app', jobIndex);
    const smokeIndex = workflow.indexOf('Run packaged Windows Kimi K3 smoke', jobIndex);

    expect(workflow).toContain('workflow_dispatch: {}');
    expect(workflow).toContain('detect-packaged-kimi-smoke:');
    expect(workflow).toContain('sibling-pin-consistency:');
    expect(jobIndex).toBeGreaterThan(-1);
    expect(workflow.slice(jobIndex)).toContain("needs.detect-packaged-kimi-smoke.outputs.run_smoke == 'true'");
    expect(workflow.slice(jobIndex)).not.toContain("if: github.event_name == 'workflow_dispatch'");
    expect(workflow.slice(jobIndex)).toContain('runs-on: windows-2022');
    expect(packageIndex).toBeGreaterThan(jobIndex);
    expect(smokeIndex).toBeGreaterThan(packageIndex);
    expect(workflow.slice(jobIndex)).toContain('desktop/release/win-unpacked/xiaok.exe');
    expect(workflow.slice(jobIndex)).toMatch(VERIFY_WITH_SMOKE_ROOT);
    expect(workflow.slice(jobIndex)).not.toMatch(/foreach \(\$model in @\(/);
    expect(workflow).toContain('src/ai/providers/kimi-models.ts');
    expect(workflow).not.toContain('gh release');
  });
});
