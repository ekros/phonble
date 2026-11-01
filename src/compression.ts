const hasCompressionStreams = () =>
  typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

export const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

const base64ToBytes = (data: string) => {
  const binary = atob(data);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const transform = async (bytes: Uint8Array, stream: CompressionStream | DecompressionStream) => {
  const output = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(output).arrayBuffer());
};

export const gzipBase64 = async (bytes: Uint8Array) => {
  if (!hasCompressionStreams()) return null;
  return bytesToBase64(await transform(bytes, new CompressionStream('gzip')));
};

export const gunzipBase64 = async (data: string) => {
  if (!hasCompressionStreams()) throw new Error('Gzip decompression is unavailable');
  return transform(base64ToBytes(data), new DecompressionStream('gzip'));
};
