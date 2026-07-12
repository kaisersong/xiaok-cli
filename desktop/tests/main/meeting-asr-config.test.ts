import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type Config } from '../../../src/types.js';
import {
  applyMeetingAsrConfigUpdate,
  createMeetingAsrConfigSnapshot,
  resolveMeetingAliyunAsrCredentials,
  resolveMeetingVolcengineAsrCredentials,
} from '../../electron/meeting-asr-config.js';

function freshConfig(): Config {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Config;
}

describe('meeting ASR config', () => {
  it('stores provider credentials while exposing only redacted status to renderer', () => {
    const config = freshConfig();

    applyMeetingAsrConfigUpdate(config, {
      defaultProvider: 'volcengine-asr',
      volcengine: {
        appKey: 'volc-app-key',
        accessKey: 'volc-access-key',
        endpoint: 'https://example.test/volc',
      },
    });

    expect(config.meeting?.asr?.defaultProvider).toBe('volcengine-asr');
    expect(config.meeting?.asr?.volcengine?.appKey).toBe('volc-app-key');
    expect(config.meeting?.asr?.volcengine?.accessKey).toBe('volc-access-key');

    const snapshot = createMeetingAsrConfigSnapshot(config);

    expect(snapshot.defaultProvider).toBe('volcengine-asr');
    expect(snapshot.volcengine.appKeyConfigured).toBe(true);
    expect(snapshot.volcengine.accessKeyConfigured).toBe(true);
    expect(snapshot.volcengine.endpoint).toBe('https://example.test/volc');
    expect(JSON.stringify(snapshot)).not.toContain('volc-access-key');
    expect(JSON.stringify(snapshot)).not.toContain('volc-app-key');
  });

  it('stores Bailian API credentials without exposing the API key', () => {
    const config = freshConfig();

    applyMeetingAsrConfigUpdate(config, {
      aliyun: {
        apiKey: 'sk-aliyun-api-key',
        baseUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com/',
        model: 'fun-asr',
      },
    });

    expect(config.meeting?.asr?.aliyun?.apiKey).toBe('sk-aliyun-api-key');
    expect(config.meeting?.asr?.aliyun?.baseUrl).toBe('https://workspace.cn-beijing.maas.aliyuncs.com');
    expect(config.meeting?.asr?.aliyun?.model).toBe('fun-asr');
    expect(createMeetingAsrConfigSnapshot(config).aliyun).toEqual({
      configured: true,
      apiKeyConfigured: true,
      baseUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com',
      model: 'fun-asr',
    });

    applyMeetingAsrConfigUpdate(config, {
      aliyun: {
        clearApiKey: true,
      },
    });

    expect(config.meeting?.asr?.aliyun?.apiKey).toBeUndefined();
    expect(createMeetingAsrConfigSnapshot(config).aliyun.apiKeyConfigured).toBe(false);
  });

  it('reads a legacy Aliyun appKey as a Bailian API key', () => {
    const config = freshConfig();
    config.meeting = {
      asr: {
        aliyun: {
          appKey: 'legacy-sk-api-key',
          accessToken: 'unused-nls-token',
          endpoint: 'https://workspace.cn-beijing.maas.aliyuncs.com',
        },
      },
    };

    expect(resolveMeetingAliyunAsrCredentials(config)).toEqual({
      apiKey: 'legacy-sk-api-key',
      baseUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com',
      model: 'fun-asr',
    });
  });

  it('migrates only legacy Volcengine flash defaults to streaming 2.0', () => {
    const config = freshConfig();
    config.meeting = {
      asr: {
        volcengine: {
          appKey: 'volc-app-key',
          accessKey: 'volc-access-key',
          endpoint: 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash',
          resourceId: 'volc.bigasr.auc_turbo',
        },
      },
    };

    expect(resolveMeetingVolcengineAsrCredentials(config)).toEqual({
      appKey: 'volc-app-key',
      accessKey: 'volc-access-key',
      endpoint: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async',
      resourceId: 'volc.seedasr.sauc.duration',
    });
    expect(createMeetingAsrConfigSnapshot(config).volcengine).toMatchObject({
      endpoint: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async',
      resourceId: 'volc.seedasr.sauc.duration',
    });
  });

  it('preserves custom Volcengine streaming endpoints and resource IDs', () => {
    const config = freshConfig();
    config.meeting = {
      asr: {
        volcengine: {
          appKey: 'volc-api-key',
          endpoint: 'wss://gateway.example.test/custom-asr',
          resourceId: 'volc.custom.resource',
        },
      },
    };

    expect(resolveMeetingVolcengineAsrCredentials(config)).toMatchObject({
      endpoint: 'wss://gateway.example.test/custom-asr',
      resourceId: 'volc.custom.resource',
    });
  });
});
