/**
 * Stand-in for Caldova's purchasing system.
 *
 * The real system is not part of this app. For the demo it is hosted here as a
 * function in the same workspace, so the outbound call in `sendReorder` is a
 * real HTTP round trip that depends on nothing outside Fabric — no venue
 * network, no third-party service.
 *
 * Only the endpoint is stood in. The request shape, the acknowledgement and the
 * failure modes are the ones the real system publishes.
 */

/** A reorder as purchasing receives it. */
export interface PurchaseOrderRequest {
    store_id: string;
    sku: string;
    units: number;
    requested_by: string;
}

/** Purchasing's acknowledgement. */
export interface PurchaseOrderAcknowledgement {
    purchaseOrderId: string;
    expectedDelivery: string;
}

/** Purchasing commits to a delivery window rather than a precise date. */
const LEAD_TIME_DAYS = 3;

const MAX_UNITS_PER_ORDER = 10_000;

export function acceptPurchaseOrder(
    request: PurchaseOrderRequest,
): PurchaseOrderAcknowledgement {
    if (!request.store_id || !request.sku) {
        throw new Error('A purchase order needs both a store and a product.');
    }

    if (!Number.isInteger(request.units) || request.units < 1) {
        throw new Error(`Units must be a positive whole number, got ${request.units}.`);
    }

    if (request.units > MAX_UNITS_PER_ORDER) {
        throw new Error(`Units exceed the ${MAX_UNITS_PER_ORDER} per-order limit.`);
    }

    const expectedDelivery = new Date();
    expectedDelivery.setUTCDate(expectedDelivery.getUTCDate() + LEAD_TIME_DAYS);

    return {
        purchaseOrderId: purchaseOrderId(request.sku),
        expectedDelivery: expectedDelivery.toISOString().slice(0, 10),
    };
}

/** Purchasing order ids are the product line, the date, and a short unique tail. */
function purchaseOrderId(sku: string): string {
    const line = sku.split('-')[0] ?? 'GEN';
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const tail = Math.random().toString(36).slice(2, 8).toUpperCase();

    return `PO-${line}-${today}-${tail}`;
}
