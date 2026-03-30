import type { ChannelDeliveryTransport } from './notifier.js';
import type { OutboundChannelMessage } from './types.js';
import type { YZJLogger } from './yzj-types.js';

export interface YZJTransportOptions {
  sendMsgUrl: string;
  logger?: YZJLogger;
  chunkLimit?: number;
}

export interface YZJDeliveryResult {
  chunks: number;
  durationMs: number;
}

export class YZJTransport implements ChannelDeliveryTransport {
  constructor(private readonly options: YZJTransportOptions) {}

  async deliver(message: OutboundChannelMessage): Promise<void> {
    await this.deliverWithMetrics(message);
  }

  async deliverWithMetrics(message: OutboundChannelMessage): Promise<YZJDeliveryResult> {
    if (message.channel !== 'yzj') {
      throw new Error(`YZJ transport cannot deliver channel ${message.channel}`);
    }

    const startAt = Date.now();
    const operatorName = typeof message.target.metadata?.operatorName === 'string'
      ? message.target.metadata.operatorName
      : '';
    const replySummary = typeof message.target.metadata?.replySummary === 'string'
      ? message.target.metadata.replySummary
      : '';
    const chunks = splitText(message.text, this.options.chunkLimit ?? 20_000);

    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index]!;
      const payload: Record<string, unknown> = {
        msgtype: 2,
        content: chunk,
        notifyParams: [] as Array<{ type: string; values: string[] }>,
      };

      if (message.target.userId) {
        (payload.notifyParams as Array<{ type: string; values: string[] }>).push({
          type: 'openIds',
          values: [message.target.userId],
        });
      }

      if (message.target.messageId) {
        payload.param = {
          replyMsgId: message.target.messageId,
          replyTitle: '',
          isReference: true,
          replySummary,
          replyPersonName: operatorName,
        };
        payload.paramType = 3;
      }

      const chunkStartedAt = Date.now();
      const response = await fetch(this.options.sendMsgUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`YZJ send failed: HTTP ${response.status} ${body}`);
      }

      this.options.logger?.info?.(
        `[yzj] outbound delivered chunk ${index + 1}/${chunks.length} chars=${chunk.length} in ${Date.now() - chunkStartedAt}ms`,
      );
    }

    return {
      chunks: chunks.length,
      durationMs: Date.now() - startAt,
    };
  }
}

function splitText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > limit) {
    const slice = remaining.slice(0, limit);
    const breakIndex = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('\n'));
    const chunkEnd = breakIndex >= Math.floor(limit * 0.4) ? breakIndex + (slice[breakIndex] === '\n' && slice[breakIndex + 1] === '\n' ? 2 : 1) : limit;
    chunks.push(remaining.slice(0, chunkEnd).trimEnd());
    remaining = remaining.slice(chunkEnd).trimStart();
  }

  if (remaining) chunks.push(remaining);
  return chunks.filter(Boolean);
}
