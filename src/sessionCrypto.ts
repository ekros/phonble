const encoder = new TextEncoder();
const decoder = new TextDecoder();

const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const base64UrlToBytes = (value: string) => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
};

export type EncryptedEnvelope = {
  type: 'encrypted';
  iv: string;
  data: string;
};

export const generateSessionKey = () => {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  return bytesToBase64Url(bytes);
};

export const canEncryptSessionPayload = () =>
  typeof globalThis.crypto?.subtle?.encrypt === 'function' &&
  typeof globalThis.crypto?.subtle?.decrypt === 'function';

const importSessionKey = (encoded: string) =>
  globalThis.crypto.subtle.importKey('raw', base64UrlToBytes(encoded), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

export const encryptSessionPayload = async (sessionKey: string, payload: unknown): Promise<EncryptedEnvelope> => {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await importSessionKey(sessionKey),
    encoder.encode(JSON.stringify(payload)),
  );
  return {
    type: 'encrypted',
    iv: bytesToBase64Url(iv),
    data: bytesToBase64Url(new Uint8Array(encrypted)),
  };
};

export const decryptSessionPayload = async <T>(sessionKey: string, envelope: EncryptedEnvelope): Promise<T> => {
  const decrypted = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlToBytes(envelope.iv) },
    await importSessionKey(sessionKey),
    base64UrlToBytes(envelope.data),
  );
  return JSON.parse(decoder.decode(decrypted)) as T;
};

export const isEncryptedEnvelope = (value: unknown): value is EncryptedEnvelope => {
  if (!value || typeof value !== 'object') return false;
  const envelope = value as Record<string, unknown>;
  return envelope.type === 'encrypted' && typeof envelope.iv === 'string' && typeof envelope.data === 'string';
};

export const createSessionFragment = (sessionKey: string) => `key=${encodeURIComponent(sessionKey)}`;

export const getSessionKeyFromLocation = () => {
  const key = new URLSearchParams(window.location.hash.slice(1)).get('key');
  return key && /^[A-Za-z0-9_-]{43}$/.test(key) ? key : '';
};
