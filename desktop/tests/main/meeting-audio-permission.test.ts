import { describe, expect, it, vi } from 'vitest';
import { createMeetingAudioPermissionService } from '../../electron/meeting-audio-permission.js';

describe('Meeting audio permission service', () => {
  it('uses macOS media access APIs to request microphone permission', async () => {
    const getMediaAccessStatus = vi.fn().mockReturnValue('not-determined');
    const askForMediaAccess = vi.fn().mockResolvedValue(true);
    const service = createMeetingAudioPermissionService({
      platform: 'darwin',
      getMediaAccessStatus,
      askForMediaAccess,
    });

    expect(await service.getStatus()).toEqual({ status: 'prompt' });
    expect(await service.requestPermission()).toEqual({ status: 'granted' });
    expect(getMediaAccessStatus).toHaveBeenCalledWith('microphone');
    expect(askForMediaAccess).toHaveBeenCalledWith('microphone');
  });

  it('surfaces denied microphone permission without pretending a prompt happened', async () => {
    const service = createMeetingAudioPermissionService({
      platform: 'darwin',
      getMediaAccessStatus: vi.fn().mockReturnValue('denied'),
      askForMediaAccess: vi.fn().mockResolvedValue(false),
    });

    expect(await service.requestPermission()).toEqual({ status: 'denied' });
  });
});
