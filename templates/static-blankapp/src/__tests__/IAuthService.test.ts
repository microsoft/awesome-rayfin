import { describe, expect, it } from 'vitest';

import { toAuthUser } from '../services/IAuthService';

describe('toAuthUser', () => {
  it('uses the provided name when present', () => {
    expect(toAuthUser({ id: 'u1', email: 'alice@contoso.com', name: 'Alice' }))
      .toEqual({
        id: 'u1',
        email: 'alice@contoso.com',
        name: 'Alice',
      });
  });

  it('falls back to the email local-part when name is missing', () => {
    expect(toAuthUser({ id: 'u1', email: 'alice@contoso.com' })).toEqual({
      id: 'u1',
      email: 'alice@contoso.com',
      name: 'alice',
    });
  });
});
