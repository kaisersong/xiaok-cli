import { describe, expect, it, vi } from 'vitest';

import { resolveAutoUpdaterExport } from '../../electron/updater.js';

describe('desktop updater', () => {
  it('loads autoUpdater from CommonJS default exports', () => {
    const updater = { checkForUpdates: vi.fn() };

    expect(resolveAutoUpdaterExport({ default: { autoUpdater: updater } })).toBe(updater);
  });

  it('prefers named autoUpdater exports when available', () => {
    const namedUpdater = { checkForUpdates: vi.fn() };
    const defaultUpdater = { checkForUpdates: vi.fn() };

    expect(resolveAutoUpdaterExport({
      autoUpdater: namedUpdater,
      default: { autoUpdater: defaultUpdater },
    })).toBe(namedUpdater);
  });

  it('returns null when the module does not expose autoUpdater', () => {
    expect(resolveAutoUpdaterExport({ default: {} })).toBeNull();
  });
});
