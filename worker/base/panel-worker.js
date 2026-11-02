// Serve the phone panel from this directory. The relay and /mini/ws stay in the
// existing temp-led worker. This subclass only adds the real light reading.
import base, { CodexLabRelay as VoiceRelay } from './mini-worker.js';
import { PAGE } from './panel-page.js';

const DEVICE = 'imx6ull_temp_led_01';

function illuminance(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 30000) return value;
  return undefined;
}

const headers = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"
};

export class CodexLabRelay extends VoiceRelay {
  async webSocketMessage(ws, raw) {
    const meta = ws.deserializeAttachment();
    if (meta?.role === 'mini_board' && !meta.retired && typeof raw === 'string') {
      let msg = null;
      try { msg = JSON.parse(raw); } catch { msg = null; }
      if (msg && msg.type === 'mini_state' && msg.device_id === DEVICE) {
        const lux = illuminance(msg.illuminance_lux);
        const tempOk = msg.temperature_c === null || (Number.isFinite(msg.temperature_c) && msg.temperature_c >= -40 && msg.temperature_c <= 150);
        const ledOk = msg.led_on === null || typeof msg.led_on === 'boolean';
        const modeOk = ['steady', 'nonsteady', 'error'].includes(msg.led_mode);
        if (!tempOk || !ledOk || !modeOk || lux === undefined) return;
        const state = {
          type: 'mini_state',
          device_id: DEVICE,
          temperature_c: msg.temperature_c,
          illuminance_lux: lux,
          led_on: msg.led_on,
          led_mode: msg.led_mode,
          observed_at: typeof msg.observed_at === 'string' ? msg.observed_at.slice(0, 40) : null,
          received_at_ms: Date.now()
        };
        ws.serializeAttachment({ ...meta, state });
        this.notify(state);
        return;
      }
    }
    if (typeof raw === 'string' && raw.length < 32000) {
      let frame = null;
      try { frame = JSON.parse(raw); } catch { frame = null; }
      if (frame && meta?.role === 'device' && ['image_start', 'image_chunk', 'image_end'].includes(frame.type)) {
        const cloud = this.live('cloud')[0];
        if (!cloud) return this.send(ws, { type: 'image_ack', device_id: meta.id, image_id: frame.image_id || frame.message_id, ok: false, reason: 'cloud offline' });
        this.send(cloud, { ...frame, device_id: meta.id });
        return;
      }
      if (frame && meta?.role === 'cloud' && frame.type === 'image_ack') {
        for (const device of this.live('device:' + frame.device_id)) this.send(device, frame);
        return;
      }
    }
    return super.webSocketMessage(ws, raw);
  }
}
export default {
  fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/mini' || url.pathname === '/panel') {
      return new Response(PAGE, { headers });
    }
    return base.fetch(request, env, ctx);
  }
};
