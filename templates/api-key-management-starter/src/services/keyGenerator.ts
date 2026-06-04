const KEY_PREFIX = 'rk_live';
const PUBLIC_ID_LENGTH = 8;
const SECRET_LENGTH = 32;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function randomString(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let output = '';
  for (const byte of bytes) {
    output += ALPHABET[byte % ALPHABET.length];
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
