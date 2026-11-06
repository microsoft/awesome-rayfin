/**
 * Client for Caldova's purchasing system.
 *
 * The endpoint is stood in for the demo (see `purchasing-mock.ts`), but nothing
 * else here is: this is the request shape purchasing publishes, with a timeout
 * and errors that say what actually went wrong.
 */
import type { RayfinContext } from '@microsoft/fabric-user-data-functions';

/** A reorder as purchasing expects to receive it. */
export interface PurchaseOrderRequest {
    storeId: string;
    sku: string;
    units: number;
    requestedBy: string;
}

/** Purchasing's acknowledgement of a reorder. */
export interface PurchaseOrder {
    purchaseOrderId: string;
    expectedDelivery: string;
}

/** Where purchasing lives, and the credentials to reach it. */
export interface PurchasingConnection {
    endpoint: string;
    accessToken: string;
    publishableKey: string;
}

export class PurchasingError extends Error {
    constructor(
        message: string,
        readonly status?: number,
    ) {
        super(message);
        this.name = 'PurchasingError';
    }
}

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Resolve the purchasing connection for this invocation.
 *
 * `PURCHASING_API_URL` is set per environment. It falls back to the stand-in
 * endpoint hosted in this workspace, so the demo can always reach purchasing.
 */
export function purchasing<TSchema extends Record<string, unknown>>(
    ctx: RayfinContext<TSchema>,
): PurchasingConnection {
    const endpoint =
        ctx.getSecret('PURCHASING_API_URL') ??
        `${ctx.baseUrl.replace(/\/$/, '')}/functions/purchaseOrders/invoke`;

    return {
        endpoint,
        accessToken: ctx.accessToken,
        publishableKey: ctx.publishableKey,
    };
}

export async function sendToPurchasing(
    connection: PurchasingConnection,
    order: PurchaseOrderRequest,
): Promise<PurchaseOrder> {
    let response: Response;

    try {
        response = await fetch(connection.endpoint, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${connection.accessToken}`,
                'x-publishable-key': connection.publishableKey,
            },
            body: JSON.stringify({
                store_id: order.storeId,
                sku: order.sku,
                units: order.units,
                requested_by: order.requestedBy,
            }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch {
        throw new PurchasingError(
            `Could not reach the purchasing system at ${connection.endpoint}.`,
        );
    }

    if (!response.ok) {
        throw new PurchasingError(
            `Purchasing rejected the order: ${response.status} ${response.statusText}. ` +
                `${await describeFailure(response)} (endpoint: ${connection.endpoint})`,
            response.status,
        );
    }

    const acknowledgement = await readAcknowledgement(response);

    if (!acknowledgement.purchaseOrderId) {
        throw new PurchasingError('Purchasing accepted the order but returned no order id.');
    }

    return {
        purchaseOrderId: acknowledgement.purchaseOrderId,
        expectedDelivery: acknowledgement.expectedDelivery ?? 'unconfirmed',
    };
}

/**
 * Read whatever the far side said about the failure.
 *
 * A client that swallows the server's own explanation makes every incident a
 * guessing game, so the response body is carried into the error — trimmed, in
 * case purchasing answers with a stack trace or an HTML error page.
 */
async function describeFailure(response: Response): Promise<string> {
    try {
        const body = (await response.text()).trim();
        if (!body) return 'No detail returned.';

        return body.length > 300 ? `${body.slice(0, 300)}…` : body;
    } catch {
        return 'The failure response could not be read.';
    }
}

/**
 * The stand-in endpoint is hosted as a function, so its acknowledgement arrives
 * inside the platform's invocation envelope. Unwrap it when it is there, and
 * read the body directly when purchasing is reached over its own API.
 */
async function readAcknowledgement(response: Response): Promise<Partial<PurchaseOrder>> {
    const body = (await response.json()) as
        | Partial<PurchaseOrder>
        | {
              output?: Partial<PurchaseOrder> | string;
              errors?: unknown[];
              status?: string;
          };

    if (body && typeof body === "object" && ("output" in body || "errors" in body)) {
        const envelope = body as { output?: Partial<PurchaseOrder> | string; errors?: unknown[] };

        // A rejected order comes back inside a successful HTTP response, so the
        // envelope's own errors have to be checked rather than the status code.
        if (envelope.errors?.length) {
            const [first] = envelope.errors;
            const detail = typeof first === "string" ? first : JSON.stringify(first);
            throw new PurchasingError(`Purchasing rejected the order: ${detail}`);
        }

        if (envelope.output !== undefined) {
            // The platform hands back the return value as-is, or JSON-encoded when
            // the payload crossed the wire as a string.
            return typeof envelope.output === "string"
                ? (JSON.parse(envelope.output) as Partial<PurchaseOrder>)
                : envelope.output;
        }
    }

    return body as Partial<PurchaseOrder>;
}
