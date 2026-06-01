import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  findIntentBrokerProtocolUrl,
  isIntentBrokerProtocolUrl,
  registerIntentBrokerProtocolClient,
} from '../../electron/intent-broker-protocol.js';

const repoRoot = join(__dirname, '..', '..', '..');

describe('intent-broker protocol handling', () => {
  it('recognizes only intent-broker protocol urls', () => {
    expect(isIntentBrokerProtocolUrl('intent-broker:')).toBe(true);
    expect(isIntentBrokerProtocolUrl('intent-broker://task/123')).toBe(true);
    expect(isIntentBrokerProtocolUrl('https://example.com')).toBe(false);
    expect(isIntentBrokerProtocolUrl('intent-broker')).toBe(false);
  });

  it('finds a deep link in Windows command line arguments', () => {
    expect(findIntentBrokerProtocolUrl(['xiaok.exe', 'intent-broker://task/123'])).toBe('intent-broker://task/123');
    expect(findIntentBrokerProtocolUrl(['xiaok.exe', '--flag'])).toBe(null);
  });

  it('registers the protocol only on Windows', () => {
    const calls: unknown[] = [];
    const app = {
      isDefaultProtocolClient: () => false,
      setAsDefaultProtocolClient: (...args: unknown[]) => {
        calls.push(args);
        return true;
      },
    };

    expect(registerIntentBrokerProtocolClient(app, { platform: 'darwin' })).toBe(false);
    expect(calls).toEqual([]);

    expect(registerIntentBrokerProtocolClient(app, { platform: 'win32', execPath: 'C:\\app\\xiaok.exe' })).toBe(true);
    expect(calls).toEqual([['intent-broker']]);
  });

  it('passes app path when registering from electron.exe on Windows', () => {
    const calls: unknown[] = [];
    const app = {
      isDefaultProtocolClient: () => false,
      getAppPath: () => 'D:\\projects\\xiaok-cli\\desktop',
      setAsDefaultProtocolClient: (...args: unknown[]) => {
        calls.push(args);
        return true;
      },
    };

    expect(registerIntentBrokerProtocolClient(app, {
      platform: 'win32',
      execPath: 'C:\\Users\\song\\AppData\\Local\\electron.exe',
    })).toBe(true);

    expect(calls).toEqual([
      ['intent-broker', 'C:\\Users\\song\\AppData\\Local\\electron.exe', ['D:\\projects\\xiaok-cli\\desktop']],
    ]);
  });

  it('declares intent-broker protocol in electron-builder config', async () => {
    const config = JSON.parse(await readFile(join(repoRoot, 'desktop', 'electron-builder.json'), 'utf8'));
    expect(config.protocols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          schemes: expect.arrayContaining(['intent-broker']),
        }),
      ]),
    );
  });
});
