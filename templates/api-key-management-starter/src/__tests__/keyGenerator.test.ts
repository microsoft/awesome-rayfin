import { describe, expect, it } from 'vitest';

import { randomString } from '@/services/keyGenerator';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const ALPHABET_PATTERN = new RegExp(`^[${ALPHABET}]+$`);

describe('randomString', () => {
  it('returns the requested length', () => {
    expect(randomString(48)).toHaveLength(48);
  });

  it('uses only allowed characters', () => {
    expect(randomString(512)).toMatch(ALPHABET_PATTERN);
  });

  it('produces varied output', () => {
    const sample = randomString(256);
    expect(new Set(sample).size).toBeGreaterThan(16);
    expect(randomString(32)).not.toBe(randomString(32));
  });
});
