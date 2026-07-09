export type MeetingMicrophonePermissionStatus = 'granted' | 'denied' | 'prompt' | 'restricted' | 'unknown' | 'unsupported';

export interface MeetingAudioPermissionResult {
  status: MeetingMicrophonePermissionStatus;
}

export interface MeetingAudioPermissionDeps {
  platform: NodeJS.Platform | string;
  getMediaAccessStatus?: (mediaType: 'microphone') => string;
  askForMediaAccess?: (mediaType: 'microphone') => Promise<boolean>;
}

function normalizeMediaAccessStatus(status: string | undefined): MeetingMicrophonePermissionStatus {
  switch (status) {
    case 'granted':
      return 'granted';
    case 'denied':
      return 'denied';
    case 'restricted':
      return 'restricted';
    case 'not-determined':
      return 'prompt';
    case undefined:
      return 'unknown';
    default:
      return 'unknown';
  }
}

export function createMeetingAudioPermissionService(deps: MeetingAudioPermissionDeps) {
  const supportsSystemPrompt = deps.platform === 'darwin'
    && typeof deps.getMediaAccessStatus === 'function'
    && typeof deps.askForMediaAccess === 'function';

  async function getStatus(): Promise<MeetingAudioPermissionResult> {
    if (!supportsSystemPrompt) return { status: 'unknown' };
    return { status: normalizeMediaAccessStatus(deps.getMediaAccessStatus?.('microphone')) };
  }

  async function requestPermission(): Promise<MeetingAudioPermissionResult> {
    if (!supportsSystemPrompt) return { status: 'unknown' };
    const current = normalizeMediaAccessStatus(deps.getMediaAccessStatus?.('microphone'));
    if (current === 'denied' || current === 'restricted' || current === 'granted') {
      return { status: current };
    }

    const granted = await deps.askForMediaAccess?.('microphone');
    if (granted) return { status: 'granted' };
    return { status: normalizeMediaAccessStatus(deps.getMediaAccessStatus?.('microphone')) };
  }

  return { getStatus, requestPermission };
}
