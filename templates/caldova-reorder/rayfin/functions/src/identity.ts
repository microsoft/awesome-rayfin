import { AudienceType, type RayfinContext } from '@microsoft/fabric-user-data-functions';

/** The regional manager who is signed in, as recorded against a reorder. */
export interface SignedInManager {
    /** Stable directory identifier for the requester. */
    id: string;
    /** User principal name, as it appears in Caldova's store directory. */
    upn: string;
}

/** Claim names vary by issuer; these are the ones that carry an identity. */
const ID_CLAIMS = ['sub', 'oid', 'objectId', 'userId'] as const;
const NAME_CLAIMS = ['upn', 'preferred_username', 'email', 'unique_name', 'mail'] as const;

type Claims = Record<string, unknown>;

/**
 * Reads the caller's identity from the tokens the platform hands the function.
 *
 * Deliberately not a parameter: who sent a reorder is decided by the signed-in
 * identity, never by the client that called the function. That is the whole
 * basis of the traceability claim on the recorded row.
 *
 * Two sources, in order of preference:
 *
 * 1. The Fabric on-behalf-of token — the signed-in user's own Entra identity.
 *    Its `upn` is what the semantic model's row-level security matches against
 *    `manager_upn`, so recording it keeps the app and the model consistent.
 * 2. The Rayfin session token, for environments where no Fabric connection is
 *    bound.
 */
export function signedInManager<TSchema extends Record<string, unknown>>(
    ctx: RayfinContext<TSchema>,
): SignedInManager {
    const session = decodeClaims(ctx.accessToken);
    const fabric = decodeClaims(tryFabricToken(ctx));

    // `id` is what the read policy authorises against: the entity's read rule is
    // `claims.sub eq requested_by_id`, and that claim comes from the session
    // token. Prefer it, and only fall back to Fabric.
    const id = firstClaim(session, ID_CLAIMS) ?? firstClaim(fabric, ID_CLAIMS);

    // `upn` is what a person reads, and what the model's row-level security
    // matches against `manager_upn`. The Fabric identity is the authority.
    const upn = firstClaim(fabric, NAME_CLAIMS) ?? firstClaim(session, NAME_CLAIMS);

    if (id && upn) return { id, upn };

    // Say what was actually there. Claim *names* only — never their values.
    const seen = [
        `session: [${claimNames(session)}]`,
        `fabric: [${claimNames(fabric)}]`,
    ].join('; ');

    throw new Error(
        `No user identity found on the tokens for this invocation; cannot record a reorder. Claims seen — ${seen}.`,
    );
}

function claimNames(claims: Claims | null): string {
    if (!claims) return 'none';
    const names = Object.keys(claims);
    return names.length > 0 ? names.join(', ') : 'empty';
}

function tryFabricToken<TSchema extends Record<string, unknown>>(
    ctx: RayfinContext<TSchema>,
): string {
    try {
        return ctx.getToken(AudienceType.Fabric) ?? '';
    } catch {
        // No Fabric connection bound for this invocation — fall through to the
        // session token rather than failing the reorder over a missing binding.
        return '';
    }
}

function firstClaim(claims: Claims | null, names: readonly string[]): string | null {
    if (!claims) return null;

    for (const name of names) {
        const value = claims[name];
        if (typeof value === 'string' && value.trim() !== '') return value;
    }

    return null;
}

/** Decode a JWT payload. Returns null for opaque tokens rather than throwing. */
function decodeClaims(token: string): Claims | null {
    const payload = token.split('.')[1];
    if (!payload) return null;

    try {
        return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Claims;
    } catch {
        return null;
    }
}
