const KEY_PREFIX = 'rk_live';
const PUBLIC_ID_LENGTH = 8;
const SECRET_LENGTH = 32;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const MAX_VALID_BYTE = 256 - (256 % ALPHABET.length);

export function randomString(length: number): string {
  let output = '';
  while (output.length < length) {
    const bytes = new Uint8Array((length - output.length) * 2);
    crypto.getRandomValues(bytes);

    for (const byte of bytes) {
      if (byte >= MAX_VALID_BYTE) continue;
      output += ALPHABET[byte % ALPHABET.length];
      if (output.length === length) break;
    }
  }
  return output;
}

export function generateApiKey(): {
  rawKey: string;
  prefix: string;
  publicId: string;
} {
  const publicId = randomString(PUBLIC_ID_LENGTH);
  const secret = randomString(SECRET_LENGTH);
  return {
    rawKey: `${KEY_PREFIX}_${publicId}_${secret}`,
    prefix: `${KEY_PREFIX}_${publicId}`,
    publicId,
  };
}
