import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('production Python readiness startup order', () => {
  it('starts Python preparation only after the renderer load completes', () => {
    const source = readFileSync(join(__dirname, '../../electron/main.ts'), 'utf8');
    const loadStart = source.indexOf('if (devServer) {\n    await window.loadURL(devServer);');
    const loadComplete = source.indexOf("debugMain('createWindow:loaded')", loadStart);
    const pythonPrepare = source.indexOf('void prepareBundledPluginPythonRuntime(pluginDeployment)', loadComplete);

    expect(loadStart).toBeGreaterThan(-1);
    expect(loadComplete).toBeGreaterThan(loadStart);
    expect(pythonPrepare).toBeGreaterThan(loadComplete);
  });

  it('does not publish managed Python readiness through process.env', () => {
    const source = readFileSync(join(__dirname, '../../electron/main.ts'), 'utf8');
    expect(source).not.toContain('process.env.XIAOK_PYTHON_CMD =');
  });
});
