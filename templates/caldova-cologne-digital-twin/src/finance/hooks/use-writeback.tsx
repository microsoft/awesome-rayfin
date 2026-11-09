// Writeback in the Caldova Finance tab: OFF.
//
// The ported pages still read `useWriteback()` (GuvPage reads `effective` adjustments), so the hook keeps
// its shape and always answers the cockpit's own "off" value. No store, no Rayfin client, no app
// database tables: the tab writes nothing (SOURCE.md).

import { createContext, useContext, type ReactNode } from 'react';

import type { AdjustmentLike } from '@finance/lib/pnl/adjust';

/** A forecast adjustment as the P&L engine applies it (none while writeback is off). */
export type ForecastAdjustmentRecord = AdjustmentLike;

export interface WritebackValue {
  status: 'off';
  effective: Map<string, ForecastAdjustmentRecord>;
}

const EMPTY: WritebackValue = { status: 'off', effective: new Map() };

const WritebackContext = createContext<WritebackValue>(EMPTY);
export const useWriteback = () => useContext(WritebackContext);

/** Kept so a copied provider wrapper compiles; it only ever serves the "off" value. */
export function WritebackProvider({ children }: { children: ReactNode }) {
  return <WritebackContext.Provider value={EMPTY}>{children}</WritebackContext.Provider>;
}
