import { describe, expect, it } from 'vitest';
import {
  readMediaTypesFromPermissionDetails,
  shouldAllowDesktopRendererPermission,
} from '../../electron/desktop-permission-policy.js';

describe('desktop renderer permission policy', () => {
  it('allows clipboard writes only from the main window', () => {
    expect(shouldAllowDesktopRendererPermission({
      permission: 'clipboard-sanitized-write',
      mediaTypes: [],
      isMainWindowWebContents: true,
      isMeetingRecorderWebContents: false,
    })).toBe(true);

    expect(shouldAllowDesktopRendererPermission({
      permission: 'clipboard-sanitized-write',
      mediaTypes: [],
      isMainWindowWebContents: false,
      isMeetingRecorderWebContents: true,
    })).toBe(false);

    expect(shouldAllowDesktopRendererPermission({
      permission: 'clipboard-sanitized-write',
      mediaTypes: [],
      isMainWindowWebContents: false,
      isMeetingRecorderWebContents: false,
    })).toBe(false);

    expect(shouldAllowDesktopRendererPermission({
      permission: 'clipboard-read',
      mediaTypes: [],
      isMainWindowWebContents: true,
      isMeetingRecorderWebContents: false,
    })).toBe(false);
  });

  it('allows audio media only from the main or meeting-recorder window', () => {
    expect(shouldAllowDesktopRendererPermission({
      permission: 'media',
      mediaTypes: ['audio'],
      isMainWindowWebContents: true,
      isMeetingRecorderWebContents: false,
    })).toBe(true);

    expect(shouldAllowDesktopRendererPermission({
      permission: 'media',
      mediaTypes: ['audio'],
      isMainWindowWebContents: false,
      isMeetingRecorderWebContents: true,
    })).toBe(true);

    expect(shouldAllowDesktopRendererPermission({
      permission: 'media',
      mediaTypes: ['video'],
      isMainWindowWebContents: true,
      isMeetingRecorderWebContents: false,
    })).toBe(false);

    expect(shouldAllowDesktopRendererPermission({
      permission: 'media',
      mediaTypes: ['audio'],
      isMainWindowWebContents: false,
      isMeetingRecorderWebContents: false,
    })).toBe(false);

    expect(shouldAllowDesktopRendererPermission({
      permission: 'geolocation',
      mediaTypes: ['audio'],
      isMainWindowWebContents: true,
      isMeetingRecorderWebContents: false,
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
