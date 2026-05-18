export interface DesktopNotificationInput {
  title: string;
  body: string;
  silent?: boolean;
  onClick?: () => void;
}

export interface DesktopNotificationResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
}

export interface DesktopNotificationPort {
  show(input: DesktopNotificationInput): Promise<DesktopNotificationResult> | DesktopNotificationResult;
}

export function createElectronDesktopNotificationPort(): DesktopNotificationPort {
  return {
    async show(input) {
      try {
        const electron = await import('electron');
        const Notification = (electron as any).Notification;
        if (typeof Notification !== 'function') {
          return { ok: false, skipped: true, reason: 'electron_notification_unavailable' };
        }
        if (typeof Notification.isSupported === 'function' && !Notification.isSupported()) {
          return { ok: false, skipped: true, reason: 'electron_notification_unsupported' };
        }

        const notification = new Notification({
          title: input.title,
          body: input.body,
          silent: input.silent ?? false,
        });
        if (input.onClick) {
          notification.on('click', input.onClick);
        }
        notification.show();
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          skipped: true,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
