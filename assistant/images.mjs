import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MAX_BYTES = 180000;
const MAX_CHUNKS = 80;

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function createImageInbox(directory = join(tmpdir(), 'imx-screen-photos')) {
  mkdirSync(directory, { recursive: true });
  const photos = new Map();
  function ack(msg, ok, reason) {
    return { type: 'image_ack', device_id: msg.device_id, image_id: msg.image_id || msg.message_id, ok, reason };
  }
  return {
    pathFor(id) {
      const photo = photos.get(id);
      return photo?.path || '';
    },
    handle(msg) {
      const id = msg.image_id || msg.message_id;
      if (!/^[A-Za-z0-9_.-]{1,64}$/.test(id || '')) return ack(msg, false, 'invalid_image');
      if (msg.type === 'image_start') {
        const bytes = Number(msg.bytes);
        const chunks = Number(msg.chunks);
        if (!Number.isInteger(bytes) || bytes < 1 || bytes > MAX_BYTES || !Number.isInteger(chunks) || chunks < 1 || chunks > MAX_CHUNKS) return ack(msg, false, 'invalid_image');
        photos.set(id, { bytes, chunks, crc: Number(msg.crc32) >>> 0, parts: new Array(chunks), got: 0, path: '' });
        return null;
      }
      const photo = photos.get(id);
      if (!photo) return ack(msg, false, 'image_not_started');
      if (msg.type === 'image_chunk') {
        const seq = msg.seq;
        if (!Number.isInteger(seq) || seq < 0 || seq >= photo.chunks || typeof msg.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(msg.data)) return ack(msg, false, 'invalid_chunk');
        if (photo.parts[seq] == null) {
          photo.parts[seq] = Buffer.from(msg.data, 'base64');
          photo.got++;
        }
        return null;
      }
      if (msg.type === 'image_end') {
        if (photo.got !== photo.chunks || photo.parts.some(part => part == null)) return ack(msg, false, 'missing_chunk');
        const data = Buffer.concat(photo.parts);
        if (data.length !== photo.bytes || crc32(data) !== photo.crc) return ack(msg, false, 'crc_mismatch');
        const path = join(directory, id + '.jpg');
        writeFileSync(path, data);
        photo.path = path;
        photo.parts = [];
        return ack(msg, true);
      }
      return ack(msg, false, 'invalid_image');
    }
  };
}
