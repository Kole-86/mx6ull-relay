import { PAGE } from './text-page.js';

const ID = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_FRAME = 32 * 1024;
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});
function equal(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
    if (url.pathname === '/health') return json({ ok: true, service: 'imx-ai-relay', protocol: 1 });
    if (url.pathname === '/') return new Response(PAGE, { headers: {
      'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer'
    }});
    if (url.pathname !== '/ws') return json({ error: 'not_found' }, 404);
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'websocket_required' }, 426);
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) return json({ error: 'origin_not_allowed' }, 403);
    const role = url.searchParams.get('role'), id = url.searchParams.get('id');
    if (!['device', 'cloud'].includes(role) || (role === 'device' && !ID.test(id || ''))) return json({ error: 'invalid_role_or_id' }, 400);
    // The bridge and test clients deliberately use different, newly generated credentials.
    const expected = role === 'cloud' ? env.LAB_BRIDGE_TOKEN : env.LAB_DEVICE_TOKEN;
    if (!expected || expected.length < 32 || !env.LAB_DEVICE_TOKEN || !env.LAB_BRIDGE_TOKEN || equal(env.LAB_DEVICE_TOKEN, env.LAB_BRIDGE_TOKEN)) return json({ error: 'lab_not_configured' }, 503);
    const protocols = (request.headers.get('sec-websocket-protocol') || '').split(',').map(s => s.trim());
    const token = protocols.find(s => s.startsWith('auth.'))?.slice(5) || '';
    if (!protocols.includes('codex-lab.v1') || !equal(token, expected)) return json({ error: 'unauthorized' }, 401);
    return env.CODEX_LAB_RELAY.get(env.CODEX_LAB_RELAY.idFromName('codex-lab-main')).fetch(request);
  }
};

export class CodexLabRelay {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }
  live(tag, exclude) {
    return this.ctx.getWebSockets(tag).filter(s => s !== exclude && s.readyState === 1);
  }
  send(ws, value) { try { ws.send(JSON.stringify(value)); } catch {} }
  status(exclude) {
    const online = this.live('cloud', exclude).length > 0;
    for (const ws of this.live('device')) this.send(ws, { type: 'status', event: online ? 'cloud_online' : 'cloud_offline' });
  }
  async fetch(request) {
    const url = new URL(request.url), role = url.searchParams.get('role'), id = url.searchParams.get('id') || '';
    if (role === 'cloud' && this.live('cloud').length) return json({ error: 'bridge_already_connected' }, 409);
    if (role === 'device' && this.live('device').length >= 12) return json({ error: 'too_many_devices' }, 429);
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, role === 'cloud' ? ['cloud'] : ['device', 'device:' + id]);
    server.serializeAttachment({ role, id });
    this.send(server, { type: 'status', event: 'connected', role, device_id: id });
    if (role === 'device') this.send(server, { type: 'status', event: this.live('cloud').length ? 'cloud_online' : 'cloud_offline' });
    else this.status();
    return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': 'codex-lab.v1' } });
  }
  async webSocketMessage(ws, raw) {
    const meta = ws.deserializeAttachment();
    if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > MAX_FRAME) return this.send(ws, { type: 'error', reason: 'invalid_frame' });
    let msg;
    try { msg = JSON.parse(raw); } catch { return this.send(ws, { type: 'error', reason: 'invalid_json' }); }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return this.send(ws, { type: 'error', reason: 'invalid_message' });
    if (msg.type === 'cloud_ping' && meta.role === 'cloud') return this.send(ws, { type: 'cloud_pong', id: msg.id });
    if (meta.role === 'device') {
      if (msg.type !== 'text' || !ID.test(msg.message_id || '') || typeof msg.text !== 'string' || !msg.text.trim() || msg.text.length > 4000 || (msg.device_id !== undefined && msg.device_id !== meta.id)) return this.send(ws, { type: 'error', reason: 'invalid_question', reply_to: msg.message_id });
      const cloud = this.live('cloud')[0];
      if (!cloud) return this.send(ws, { type: 'error', reason: 'cloud_offline', reply_to: msg.message_id });
      this.send(cloud, { type: 'text', device_id: meta.id, message_id: msg.message_id, text: msg.text.trim() });
      return;
    }
    if (!['ai_reply', 'processing', 'error'].includes(msg.type) || !ID.test(msg.device_id || '') || !ID.test(msg.reply_to || '')) return this.send(ws, { type: 'error', reason: 'invalid_reply' });
    if (msg.type === 'ai_reply' && (typeof msg.text !== 'string' || msg.text.length > 12000)) return this.send(ws, { type: 'error', reason: 'invalid_reply' });
    const targets = this.live('device:' + msg.device_id);
    if (!targets.length) return this.send(ws, { type: 'delivery_failed', device_id: msg.device_id, reply_to: msg.reply_to });
    for (const target of targets) this.send(target, msg);
  }
  async webSocketClose(ws) { if (ws.deserializeAttachment()?.role === 'cloud') this.status(ws); }
  async webSocketError(ws) {
    try { ws.close(1011, 'connection error'); } catch {}
    if (ws.deserializeAttachment()?.role === 'cloud') this.status(ws);
  }
}
