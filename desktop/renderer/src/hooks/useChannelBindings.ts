import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api';
import type { ChannelBindingResponse } from '../api';

export type { ChannelBindingResponse };
export type ChannelBindings = ChannelBindingResponse[];

export interface UseChannelBindingsOptions {
  accessToken: string;
  channelId?: string;
  pollIntervalMs?: number;
}

/**
 * Shared hook that replaces the 5s polling + listChannelBindings pattern
 * duplicated across 5 channel settings panels (Telegram, Discord, QQ, QQBot,
 * Weixin). Each panel previously had its own refreshBindings + setInterval.
 *
 * Multi-instance note: if multiple panels render simultaneously, each will
 * poll independently. For multi-instance scenarios, lift to a Context provider.
 *
 * Usage:
 *   const { bindings, refresh } = useChannelBindings({ accessToken, channelId: channel?.id });
 */
export function useChannelBindings({
  accessToken,
  channelId,
  pollIntervalMs = 5000,
}: UseChannelBindingsOptions): {
  bindings: ChannelBindings;
  refresh: () => Promise<void>;
} {
  const [bindings, setBindings] = useState<ChannelBindings>([]);

  const accessTokenRef = useRef(accessToken);
  const channelIdRef = useRef(channelId);
  accessTokenRef.current = accessToken;
  channelIdRef.current = channelId;

  const refresh = useCallback(async () => {
    const cid = channelIdRef.current;
    const token = accessTokenRef.current;
    if (!cid || !token) {
      setBindings([]);
      return;
    }
    try {
      setBindings(await api.listChannelBindings(token, cid));
    } catch {
      setBindings([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (!channelId) return;
    const id = window.setInterval(() => void refresh(), pollIntervalMs);
    return () => window.clearInterval(id);
  }, [channelId, accessToken, pollIntervalMs, refresh]);

  return { bindings, refresh };
}
