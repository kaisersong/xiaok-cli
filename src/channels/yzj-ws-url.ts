export function deriveYZJWebSocketUrl(webhookUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(webhookUrl);
  } catch {
    throw new Error('invalid webhookUrl');
  }

  const token = parsed.searchParams.get('yzjtoken')?.trim();
  if (!token) throw new Error('missing yzjtoken');
  if (!parsed.host) throw new Error('missing host');

  return `wss://${parsed.host}/xuntong/websocket?yzjtoken=${encodeURIComponent(token)}`;
}
