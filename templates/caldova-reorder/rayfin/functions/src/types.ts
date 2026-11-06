/**
 * Function schema types for RayfinClient.
 *
 * Export a single schema type that maps each function name to its
 * input/output type pair.  Import this from your frontend app when
 * constructing RayfinClient so invocations are fully type-checked.
 *
 * The schema is a closed object type: only the function names listed
 * below are accepted by `client.functions.<name>.invoke(...)`.  This file
 * is regenerated automatically by `rayfin dev functions apply` whenever
 * `udf.func()` registrations change.
 *
 * IMPORTANT: This file must NOT import any Node.js packages — it is
 * resolved by the frontend app's TypeScript compiler.
 */

export type AppFunctionsSchema = {
  sendReorder: {
    input: { storeId: string; sku: string; units: number };
    output: {
      requestId: string;
      purchaseOrderId: string;
      expectedDelivery: string;
    };
  };
  purchaseOrders: {
    input: { store_id: string; sku: string; units: number; requested_by: string };
    output: { purchaseOrderId: string; expectedDelivery: string };
  };
  resetDemoReorders: {
    input: Record<string, never>;
    output: {
      deleted: number;
      cleared: {
        requestId: string;
        storeId: string;
        sku: string;
        units: number;
        requestedAt: string;
      }[];
    };
  };
};

