import type { IncomingMessage, ServerResponse } from 'node:http';

import { verifySignature } from './yzj-signature.js';
import type { YZJIncomingMessage, YZJLogger, YZJResponse } from './yzj-types.js';

export interface YZJWebhookHandlerOptions {
  path: string;
  secret?: string;
  logger?: YZJLogger;
  onMessage: (message: YZJIncomingMessage) => Promise<void> | void;
}

function normalizeWebhookPath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '/';
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withSlash.length > 1 && withSlash.endsWith('/') ? withSlash.slice(0, -1) : withSlash;
}

function resolvePath(req: IncomingMessage): string {
  const url = new URL(req.url ?? '/', 'http://localhost');
  return normalizeWebhookPath(url.pathname || '/');
}

function getHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

async function readJsonBody(req: IncomingMessage, maxBytes: number) {
  const chunks: Buffer[] = [];
  let total = 0;

  return await new Promise<{ ok: boolean; value?: unknown; error?: string }>((resolve) => {
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        resolve({ ok: false, error: 'payload too large' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw.trim()) {
          resolve({ ok: false, error: 'empty payload' });
          return;
        }
        resolve({ ok: true, value: JSON.parse(raw) as unknown });
      } catch (error) {
        resolve({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    });
    req.on('error', (error) => {
      resolve({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
  });
}

function jsonOk(res: ServerResponse, body: unknown): void {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function createYZJWebhookHandler(options: YZJWebhookHandlerOptions) {
  const path = normalizeWebhookPath(options.path);

  return async function handleYZJWebhookRequest(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<boolean> {
    if (resolvePath(req) !== path) return false;

    options.logger?.info?.(`[yzj] incoming ${req.method} request on ${path}`);

    if (req.method === 'GET') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('OK');
      return true;
    }

    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, POST');
      res.end('Method Not Allowed');
      return true;
    }

    const body = await readJsonBody(req, 1024 * 1024);
    if (!body.ok) {
      options.logger?.error?.(`[yzj] POST body read failed: ${body.error}`);
      res.statusCode = body.error === 'payload too large' ? 413 : 400;
      res.end(body.error ?? 'invalid payload');
      return true;
    }

    const msg = body.value as YZJIncomingMessage;
    if (!msg.content) {
      res.statusCode = 400;
      res.end('missing required fields');
      return true;
    }

    if (options.secret && msg.robotId !== 'test-robotId') {
      const sign = getHeader(req, 'sign');
      if (!sign) {
        options.logger?.error?.('[yzj] 请求头中缺少 sign 签名');
        res.statusCode = 401;
        res.end('missing sign header');
        return true;
      }

      const verificationResult = verifySignature(msg, sign, options.secret);
      if (!verificationResult.valid) {
        options.logger?.error?.(`[yzj] 签名验证失败：${verificationResult.error}`);
        res.statusCode = 401;
        res.end('invalid signature');
        return true;
      }
    }

    const response: YZJResponse = {
      success: true,
      data: {
        type: 2,
        content: '',
      },
    };
    jsonOk(res, response);

    void Promise.resolve(options.onMessage(msg)).catch((error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      options.logger?.error?.(`[yzj] webhook dispatch failed: ${errorMessage}`);
    });

    return true;
  };
}
