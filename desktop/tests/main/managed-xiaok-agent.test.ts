import { describe, expect, it } from 'vitest';

import type { Config } from '../../../src/types.js';
import {
  buildManagedXiaokAgentPayload,
  diffManagedXiaokAgentPatch,
  resolveLocalXiaokRuntimePath,
} from '../../electron/managed-xiaok-agent.js';

function makeConfig(overrides?: Partial<Config>): Config {
  return {
    schemaVersion: 2,
    defaultProvider: 'anthropic',
    defaultModelId: 'anthropic-default',
    providers: {
      anthropic: {
        type: 'first_party',
        protocol: 'anthropic',
        apiKey: 'sk-anthropic',
        baseUrl: 'https://api.anthropic.com',
      },
      openai: {
        type: 'first_party',
        protocol: 'openai_legacy',
        apiKey: 'sk-openai',
        baseUrl: 'https://api.openai.com/v1',
      },
    },
    models: {
      'anthropic-default': {
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        label: 'Claude Sonnet 4.6',
      },
      'openai-default': {
        provider: 'openai',
        model: 'gpt-4o',
        label: 'GPT-4o',
      },
    },
    defaultMode: 'interactive',
    channels: {},
    ...overrides,
  };
}

describe('managed xiaok agent payload', () => {
  it('maps anthropic desktop config to a kswarm-compatible xiaok agent payload', () => {
    const payload = buildManagedXiaokAgentPayload(
      {
        id: 'xiaok-po',
        name: 'PO-Agent',
        description: 'po',
        instructions: 'plan',
        roles: ['project_owner'],
      },
      makeConfig(),
      { runtimePath: 'C:\\Users\\song\\AppData\\Roaming\\npm\\xiaok.cmd' },
    );

    expect(payload).toMatchObject({
      id: 'xiaok-po',
      name: 'PO-Agent',
      runtimeType: 'xiaok',
      runtimePath: 'C:\\Users\\song\\AppData\\Roaming\\npm\\xiaok.cmd',
      runtimeModel: 'claude-sonnet-4-6',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      apiKey: 'sk-anthropic',
      baseUrl: 'https://api.anthropic.com',
      roles: ['project_owner'],
    });
  });

  it('maps openai-compatible desktop providers to kswarm openai provider', () => {
    const config = makeConfig({
      defaultProvider: 'openai',
      defaultModelId: 'openai-default',
    });

    const payload = buildManagedXiaokAgentPayload(
      {
        name: 'Worker-Agent',
        instructions: 'work',
        roles: ['worker'],
      },
      config,
      { runtimePath: null },
    );

    expect(payload.provider).toBe('openai');
    expect(payload.model).toBe('gpt-4o');
    expect(payload.baseUrl).toBe('https://api.openai.com/v1');
    expect(payload.runtimePath).toBeNull();
  });

  it('computes a patch only when managed runtime fields drift', () => {
    const desired = buildManagedXiaokAgentPayload(
      {
        id: 'xiaok-worker',
        name: 'Worker-Agent',
        description: 'worker',
        instructions: 'work',
        roles: ['worker'],
      },
      makeConfig(),
      { runtimePath: 'C:\\Users\\song\\AppData\\Roaming\\npm\\xiaok.cmd' },
    );

    const patch = diffManagedXiaokAgentPatch(
      {
        id: 'xiaok-worker',
        name: 'Worker-Agent',
        description: 'worker',
        instructions: 'work',
        runtimeType: 'xiaok',
        runtimePath: null,
        provider: null,
        model: null,
        baseUrl: null,
        apiKey: null,
        roles: ['worker'],
        capabilities: desired.capabilities,
      },
      desired,
    );

    expect(patch).toMatchObject({
      runtimePath: 'C:\\Users\\song\\AppData\\Roaming\\npm\\xiaok.cmd',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      apiKey: 'sk-anthropic',
    });
  });

  it('computes a patch that explicitly clears stale CLI runtime paths for desktop-managed agents', () => {
    const desired = buildManagedXiaokAgentPayload(
      {
        id: 'xiaok-po',
        name: 'PO-Agent',
        description: 'po',
        instructions: 'plan',
        roles: ['project_owner'],
      },
      makeConfig(),
      { runtimePath: null },
    );

    const patch = diffManagedXiaokAgentPatch(
      {
        id: 'xiaok-po',
        name: 'PO-Agent',
        description: 'po',
        instructions: 'plan',
        runtimeType: 'xiaok',
        runtimePath: 'C:\\Users\\song\\AppData\\Roaming\\npm\\xiaok.ps1',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'sk-anthropic',
        roles: ['project_owner'],
        capabilities: desired.capabilities,
      },
      desired,
    );

    expect(patch).toMatchObject({
      runtimePath: null,
    });
  });
});

describe('resolveLocalXiaokRuntimePath', () => {
  it('auto-binds the Windows global xiaok PowerShell launcher when available', () => {
    const runtimePath = resolveLocalXiaokRuntimePath({
      platform: 'win32',
      env: {
        APPDATA: 'C:\\Users\\song\\AppData\\Roaming',
      },
      exists: (candidate) => candidate === 'C:\\Users\\song\\AppData\\Roaming\\npm\\xiaok.ps1',
    });

    expect(runtimePath).toBe('C:\\Users\\song\\AppData\\Roaming\\npm\\xiaok.ps1');
  });

  it('still honors an explicit native runtime override when provided', () => {
    const runtimePath = resolveLocalXiaokRuntimePath({
      platform: 'win32',
      env: {
        KSWARM_XIAOK_PATH: 'C:\\Tools\\xiaok.exe',
      },
      exists: (candidate) => candidate === 'C:\\Tools\\xiaok.exe',
    });

    expect(runtimePath).toBe('C:\\Tools\\xiaok.exe');
  });

  it('uses an explicit Windows PowerShell launcher override when provided', () => {
    const runtimePath = resolveLocalXiaokRuntimePath({
      platform: 'win32',
      env: {
        KSWARM_XIAOK_PS1_PATH: 'D:\\tools\\xiaok.ps1',
      },
      exists: (candidate) => candidate === 'D:\\tools\\xiaok.ps1',
    });

    expect(runtimePath).toBe('D:\\tools\\xiaok.ps1');
  });
});
