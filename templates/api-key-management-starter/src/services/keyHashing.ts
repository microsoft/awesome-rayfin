function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashApiKey(rawKey: string): Promise<string> {
  const data = new TextEncoder().encode(rawKey);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bufferToHex(digest);
}
