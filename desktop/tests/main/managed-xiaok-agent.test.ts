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
  it('builds desktop-managed xiaok seed payload as a runtime reference without provider secrets', () => {
    const payload = buildManagedXiaokAgentPayload(
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

    expect(payload).toMatchObject({
      id: 'xiaok-po',
      name: 'PO-Agent',
      runtimeType: 'xiaok',
      runtimeSource: 'desktop-agent-runtime',
      runtimePath: null,
      execution: { mode: 'hosted', hostParticipantId: 'xiaok-desktop' },
      runtimeModel: 'claude-sonnet-4-6',
      provider: null,
      model: null,
      apiKey: null,
      baseUrl: null,
      roles: ['project_owner'],
    });
    expect(payload.runtimeHealth).toMatchObject({
      state: 'unknown',
      source: 'desktop-agent-runtime',
    });
    expect(payload.runtimeHealth.taskCapabilities).toEqual(expect.arrayContaining([
      'research',
      'analysis',
      'web_research',
      'report_generation',
      'presentation_generation',
    ]));
    expect(payload.runtimeHealth.outputCapabilities).toEqual(expect.arrayContaining([
      'markdown',
      'html',
      'report_html',
    ]));
  });

  it('keeps runtime model for desktop while withholding openai-compatible provider config from kswarm', () => {
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

    expect(payload.runtimeSource).toBe('desktop-agent-runtime');
    expect(payload.runtimeModel).toBe('gpt-4o');
    expect(payload.provider).toBeNull();
    expect(payload.model).toBeNull();
    expect(payload.baseUrl).toBeNull();
    expect(payload.apiKey).toBeNull();
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
      { runtimePath: null },
    );

    const patch = diffManagedXiaokAgentPatch(
      {
        id: 'xiaok-worker',
        name: 'Worker-Agent',
        description: 'worker',
        instructions: 'work',
        runtimeType: 'xiaok',
        runtimePath: 'C:\\Users\\song\\AppData\\Roaming\\npm\\xiaok.cmd',
        runtimeSource: undefined,
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'sk-anthropic',
        roles: ['worker'],
        capabilities: desired.capabilities,
      },
      desired,
    );

    expect(patch).toMatchObject({
      runtimePath: null,
      runtimeSource: 'desktop-agent-runtime',
      execution: { mode: 'hosted', hostParticipantId: 'xiaok-desktop' },
      provider: null,
      model: null,
      baseUrl: null,
      apiKey: null,
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
      execution: { mode: 'hosted', hostParticipantId: 'xiaok-desktop' },
      provider: null,
      model: null,
      baseUrl: null,
      apiKey: null,
    });
  });
});

describe('resolveLocalXiaokRuntimePath', () => {
  it('does not auto-bind the Windows global xiaok PowerShell launcher for default desktop agents', () => {
    const runtimePath = resolveLocalXiaokRuntimePath({
      platform: 'win32',
      env: {
        APPDATA: 'C:\\Users\\song\\AppData\\Roaming',
      },
      exists: (candidate) => candidate === 'C:\\Users\\song\\AppData\\Roaming\\npm\\xiaok.ps1',
    });

    expect(runtimePath).toBeNull();
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

  it('does not auto-bind an explicit Windows PowerShell launcher shim by default', () => {
    const runtimePath = resolveLocalXiaokRuntimePath({
      platform: 'win32',
      env: {
        KSWARM_XIAOK_PS1_PATH: 'D:\\tools\\xiaok.ps1',
      },
      exists: (candidate) => candidate === 'D:\\tools\\xiaok.ps1',
    });

    expect(runtimePath).toBeNull();
  });
});
