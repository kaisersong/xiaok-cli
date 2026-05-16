import { describe, expect, it } from 'vitest';

import { buildBackgroundNodeSpawnOptions } from '../../electron/kswarm-service.js';

describe('kswarm service spawn options', () => {
  it('hides Windows console windows for desktop-managed background services', () => {
    const options = buildBackgroundNodeSpawnOptions({
      platform: 'win32',
      cwd: 'D:\\projects\\intent-broker',
      env: { PORT: '4318' },
    });

    expect(options).toMatchObject({
      cwd: 'D:\\projects\\intent-broker',
      env: { PORT: '4318' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  });

  it('keeps the same stdio contract on non-Windows platforms without forcing windowsHide', () => {
    const options = buildBackgroundNodeSpawnOptions({
      platform: 'darwin',
      env: { PORT: '4400' },
    });

    expect(options).toMatchObject({
      env: { PORT: '4400' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(options.windowsHide).toBeUndefined();
  });
});
