/**
 * Public surface of the FP&A statements module. Application code that wants to
 * embed a piece imports it from here; the App wires the full page via a direct
 * lazy import (not this barrel) so the suite stays out of the initial chunk.
 */

// Data + domain model
export * from "./data/statementFacts";
export * from "./lib/time-aggregation";
export * from "./lib/statement-model";
export * from "./lib/currency";
export * from "./lib/drivers";
export * from "./lib/cashflow";
export * from "./lib/ibcs";
export * from "./lib/finance-math";
export * from "./lib/balance-sheet";
export * from "./lib/whatif-model";

// Feature components
export { FinancialStatement } from "./features/financial-statement";
export type { FinancialStatementProps } from "./features/financial-statement";
export { IbcsScenarioChart } from "./features/ibcs-scenario-chart";
export type { IbcsScenarioChartProps, ScenarioGroup } from "./features/ibcs-scenario-chart";
export { DriverBridge } from "./features/driver-bridge";
export type { DriverBridgeProps } from "./features/driver-bridge";
export { RollingForecast } from "./features/rolling-forecast";
export type { RollingForecastProps } from "./features/rolling-forecast";
export { StatementsPage } from "./features/statements-page";
export { BalanceSheetPage } from "./features/balance-sheet-page";
export type { BalanceSheetPageProps } from "./features/balance-sheet-page";
export { WhatIfPlannerPage } from "./features/whatif-planner-page";
