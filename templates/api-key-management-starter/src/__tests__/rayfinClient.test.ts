import { describe, expect, it } from 'vitest';

import { isLocalBackend } from '@/services/rayfinClient';

describe('isLocalBackend', () => {
  it('detects localhost API URLs', () => {
    expect(isLocalBackend('http://localhost:5168')).toBe(true);
    expect(isLocalBackend('http://127.0.0.1:5168')).toBe(true);
  });

  it('rejects hosted API URLs', () => {
    expect(isLocalBackend('https://api.contoso.example')).toBe(false);
  });
});
