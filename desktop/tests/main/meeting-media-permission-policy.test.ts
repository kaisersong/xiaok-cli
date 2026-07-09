import { describe, expect, it } from 'vitest';
import {
  readMediaTypesFromPermissionDetails,
  shouldAllowMeetingMediaPermission,
} from '../../electron/meeting-media-permission-policy.js';

describe('meeting media permission policy', () => {
  it('allows only trusted audio media permission requests', () => {
    expect(shouldAllowMeetingMediaPermission({
      permission: 'media',
      mediaTypes: ['audio'],
      isTrustedWebContents: true,
    })).toBe(true);

    expect(shouldAllowMeetingMediaPermission({
      permission: 'media',
      mediaTypes: ['video'],
      isTrustedWebContents: true,
    })).toBe(false);

    expect(shouldAllowMeetingMediaPermission({
      permission: 'media',
      mediaTypes: ['audio'],
      isTrustedWebContents: false,
    })).toBe(false);

    expect(shouldAllowMeetingMediaPermission({
      permission: 'geolocation',
      mediaTypes: ['audio'],
      isTrustedWebContents: true,
    })).toBe(false);
  });

  it('extracts mediaTypes defensively from Electron permission details', () => {
    expect(readMediaTypesFromPermissionDetails({ mediaTypes: ['audio', 'video'] }))
      .toEqual(['audio', 'video']);
    expect(readMediaTypesFromPermissionDetails({ mediaTypes: ['audio', 42, null] }))
      .toEqual(['audio']);
    expect(readMediaTypesFromPermissionDetails({ mediaTypes: 'audio' })).toEqual([]);
    expect(readMediaTypesFromPermissionDetails(null)).toEqual([]);
  });
});
