import { z } from 'zod';
import type { EnterpriseCliProvider, EnterpriseCliState, EnterpriseCliConnection } from '../shared/enterprise-cli-ipc-contract.js';
const dateSchema = z.string().max(64).datetime({ offset: true });
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
function parse(text: string): Record<string, any> { try { return record(JSON.parse(text)); } catch { return {}; } }
function text(value: unknown, limit = 256): string | undefined { return typeof value === 'string' && value.trim() && value.length <= limit && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : undefined; }
export function enterpriseCliArgs(provider: EnterpriseCliProvider, kind: 'login' | 'setup' | 'check'): string[] {
  if (provider === 'dingtalk') return kind === 'check' ? ['auth','status','--readonly','--format','json'] : ['auth','login','--no-browser','--format','json'];
  if (provider === 'feishu') return kind === 'check' ? ['auth','status','--json'] : kind === 'setup' ? ['config','init','--new','--brand','feishu'] : ['auth','login','--domain','im,calendar,contact','--json'];
  return kind === 'check' ? ['auth','show'] : ['auth','init','--noninteractive','--no-browser'];
}
export function projectEnterpriseCliStatus(provider: EnterpriseCliProvider, code: number | null, stdout: string, stderr: string, checkedAt: string): { phase: EnterpriseCliState['phase']; connection?: EnterpriseCliConnection } {
  const data = parse(stdout); const error = record(parse(stderr).error);
  if (provider === 'feishu' && error.type === 'config' && ['not_configured','missing_config'].includes(error.subtype)) return { phase: 'needsSetup' };
  if (code !== 0) return { phase: 'failed' };
  let raw: Record<string, any>; let identityType: 'user' | 'bot' = 'user';
  if (provider === 'dingtalk') {
    if (data.reason || data.success !== true || typeof data.authenticated !== 'boolean') return { phase: 'failed' };
    if (!data.authenticated) return { phase: 'signedOut' };
    raw = { name: data.user_name, openId: data.user_id, orgId: data.corp_id, organization: data.corp_name, expiresAt: data.expires_at, tokenStatus: data.token_valid === true ? 'valid' : data.refresh_token_valid === true ? 'needs_refresh' : 'expired' };
  } else if (provider === 'feishu') {
    const user = record(record(data.identities).user);
    if (!text(data.appId)) return { phase: 'failed' };
    if (user.available !== true) return { phase: 'signedOut' };
    raw = { name: user.userName, openId: user.openId, expiresAt: user.expiresAt, tokenStatus: user.tokenStatus };
  } else {
    if (/^Status: unauthorized\s*$/m.test(stdout)) return { phase: 'signedOut' };
    if (!/^Status: authorized\s*$/m.test(stdout)) return { phase: 'failed' };
    identityType = 'bot'; raw = { openId: stdout.match(/^Bot ID: ([^\r\n]+)$/m)?.[1] };
  }
  const connection: EnterpriseCliConnection = { checkedAt, identityType };
  for (const [key, limit] of [['name',200], ['openId',256], ['orgId',256], ['organization',300]] as const) {
    const value = text(raw[key], limit); if (value) connection[key] = value;
  }
  const date = dateSchema.safeParse(raw.expiresAt); if (date.success && Number.isFinite(Date.parse(date.data))) connection.expiresAt = new Date(date.data).toISOString();
  if (['valid','needs_refresh','expired'].includes(raw.tokenStatus)) connection.tokenStatus = raw.tokenStatus;
  return { phase: 'connected', connection };
}
/** Only official complete authorization links are eligible; raw links stay Main-private. */
export function findEnterpriseCliAuthorizationUrl(provider: EnterpriseCliProvider, output: string): string | undefined {
  for (const match of output.matchAll(/https:\/\/[^\s<>"'\u001b]+(?=[\s<>"'\u001b])/g)) {
    try {
      const url = new URL(match[0]); if (url.username || url.password || url.hash || url.href.length > 8192) continue;
      if (provider === 'wecom' && url.origin === 'https://work.weixin.qq.com' && url.pathname === '/ai/qc/gen'
        && url.searchParams.get('source') === 'wecom_cli_external' && /^[A-Za-z0-9_-]{1,2048}$/.test(url.searchParams.get('scode') ?? '')
        && [...url.searchParams.keys()].every(key => ['source','scode'].includes(key))) return url.href;
      if (provider === 'dingtalk' && url.origin === 'https://login.dingtalk.com' && url.pathname === '/oauth2/auth' && url.searchParams.get('client_id') && url.searchParams.get('response_type') === 'code') {
        const redirect = new URL(url.searchParams.get('redirect_uri') ?? '');
        if (redirect.protocol === 'http:' && ['127.0.0.1','localhost'].includes(redirect.hostname) && !redirect.username && !redirect.password) return url.href;
      }
      if (provider === 'feishu' && ['https://open.feishu.cn','https://accounts.feishu.cn','https://open.larksuite.com','https://accounts.larksuite.com'].includes(url.origin)
        && (url.pathname === '/page/cli' || /^\/oauth\/v1\/device(?:\/[^/]+)?$/.test(url.pathname))
        && url.searchParams.get('user_code') && !['redirect','redirect_uri','redirect_url'].some(key => url.searchParams.has(key))) return url.href;
    } catch { /* Ignore incomplete or untrusted URLs. */ }
  }
  return undefined;
}
