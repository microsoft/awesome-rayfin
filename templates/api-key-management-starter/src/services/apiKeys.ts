import { AuthError } from '@microsoft/rayfin-client';

import { getGlobalSessionExpiredHandler } from './sessionExpiredHandler';

import { generateApiKey } from './keyGenerator';
import { hashApiKey } from './keyHashing';
import { getRayfinClient } from './rayfinClient';

export type ApiKeyStatus = 'active' | 'revoked';

export interface ApiKeyRecord {
  id: string;
  label: string;
  prefix?: string;
  ownerUserId: string;
  status: ApiKeyStatus;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt?: Date | null;
  expiresAt?: Date | null;
}

export interface CreateApiKeyResult {
  rawKey: string;
  record: ApiKeyRecord;
}

/** Re-throw the error after triggering session expiry if it's an auth error. */
function handleError(err: unknown): never {
  const isAuthError =
    err instanceof AuthError ||
    (err instanceof Error && 'status' in err && (err as { status: number }).status === 401);

  if (isAuthError) {
    const handler = getGlobalSessionExpiredHandler();
    if (handler) handler();
  }
  throw err;
}

export async function getApiKeys(): Promise<ApiKeyRecord[]> {
  try {
    const client = getRayfinClient();
    const results = await client.data.ApiKey.select([
      'id',
      'label',
      'prefix',
      'ownerUserId',
      'status',
      'createdAt',
      'updatedAt',
      'lastUsedAt',
      'expiresAt',
    ])
      .orderBy({ createdAt: 'desc' })
      .execute();
    return results as ApiKeyRecord[];
  } catch (err) {
    handleError(err);
  }
}

export async function createApiKey(label: string): Promise<CreateApiKeyResult> {
  try {
    const client = getRayfinClient();
    const session = client.auth.getSession();
    if (!session.isAuthenticated || !session.user) {
      throw new Error('Cannot create key: user is not authenticated.');
    }

    const generated = generateApiKey();
    const keyHash = await hashApiKey(generated.rawKey);
    const now = new Date();

    const record = (await client.data.ApiKey.create({
      label,
      keyHash,
      ownerUserId: session.user.id,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      prefix: generated.prefix,
    })) as ApiKeyRecord;

    return { rawKey: generated.rawKey, record };
  } catch (err) {
    handleError(err);
  }
}

export async function revokeApiKey(id: string): Promise<void> {
  try {
    const client = getRayfinClient();
    await client.data.ApiKey.update({ id }, { status: 'revoked', updatedAt: new Date() });
  } catch (err) {
    handleError(err);
  }
}
