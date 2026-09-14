//-----------------------------------------------------------------------
// Semantic Directory — Contoso Sales demo dataset generator.
//
// Emits a deterministic, self-contained demo "brain"
// (src/catalog/data/catalog.dataset.json) so the template renders a full,
// explorable model out of the box — before anyone connects a real Fabric
// semantic model. The moment a workspace + model are configured, the live
// path takes over and this demo bundle becomes the "never blank" fallback.
//
// Contoso Sales is a classic star schema (one Sales fact + conformed
// dimensions) with ~24 inter-referencing measures, so measure DNA, families,
// lineage, relationships and the entity constellation all light up.
//
// Re-run:  npm run build:demo
// Deterministic + offline. No network, no AI, no external inputs.
//-----------------------------------------------------------------------

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, "..", "src", "catalog", "data");
const OUT_FILE = join(OUT_DIR, "catalog.dataset.json");

// ---------- source systems (what feeds the model) ----------
const SOURCE_SYSTEMS = [
    { id: "ContosoERP", label: "Contoso ERP", what: "Orders, invoices and store operations — the transactional sales ledger.", confidence: "confirmed" },
    { id: "ContosoCRM", label: "Contoso CRM", what: "Customer master, segmentation and account hierarchy.", confidence: "confirmed" },
    { id: "ContosoPIM", label: "Contoso PIM", what: "Product information: catalog, categories, brands and list pricing.", confidence: "confirmed" },
    { id: "ContosoRef", label: "Reference Data", what: "Conformed calendar and geography reference dimensions.", confidence: "confirmed" },
];

// ---------- tables (star schema) ----------
// physicalSource drives source-system rollup; storageMode drives Direct Lake.
const TABLES = [
    { name: "Sales", storageMode: "DirectLake", hidden: false, description: "Order-line fact — one row per product sold on an order.", physicalSource: "contoso_erp.fact_sales", sourceSystem: "ContosoERP" },
    { name: "Product", storageMode: "DirectLake", hidden: false, description: "Product catalog: category, subcategory, brand and list price.", physicalSource: "contoso_pim.dim_product", sourceSystem: "ContosoPIM" },
    { name: "Customer", storageMode: "DirectLake", hidden: false, description: "Customer master with segment and account details.", physicalSource: "contoso_crm.dim_customer", sourceSystem: "ContosoCRM" },
    { name: "Store", storageMode: "DirectLake", hidden: false, description: "Retail and online stores where orders are placed.", physicalSource: "contoso_erp.dim_store", sourceSystem: "ContosoERP" },
    { name: "Date", storageMode: "DirectLake", hidden: false, description: "Conformed calendar — day, month, quarter and fiscal year.", physicalSource: "contoso_ref.dim_date", sourceSystem: "ContosoRef" },
    { name: "Geography", storageMode: "DirectLake", hidden: false, description: "Shared geography: city, state, country and region.", physicalSource: "contoso_ref.dim_geography", sourceSystem: "ContosoRef" },
    { name: "Measures", storageMode: "Import", hidden: false, description: "Home table for the model's reporting measures.", physicalSource: null, sourceSystem: null },
];

// ---------- columns ----------
const col = (table, name, type, extra = {}) => ({
    name,
    table,
    type,
    hidden: extra.hidden ?? false,
    category: extra.category ?? null,
    folder: extra.folder ?? null,
    description: extra.description ?? null,
});

const COLUMNS = [
    // Sales fact
    col("Sales", "SalesKey", "Int64", { hidden: true }),
    col("Sales", "OrderDate", "DateTime", { description: "Date the order line was placed." }),
    col("Sales", "ProductKey", "Int64", { hidden: true }),
    col("Sales", "CustomerKey", "Int64", { hidden: true }),
    col("Sales", "StoreKey", "Int64", { hidden: true }),
    col("Sales", "Quantity", "Int64", { description: "Units sold on the order line." }),
    col("Sales", "UnitPrice", "Decimal", { description: "Price per unit at time of sale." }),
    col("Sales", "UnitCost", "Decimal", { description: "Landed cost per unit." }),
    col("Sales", "SalesAmount", "Decimal", { description: "Extended line revenue (quantity × unit price − discount)." }),
    col("Sales", "DiscountAmount", "Decimal", { description: "Discount applied to the order line." }),
    // Product dim
    col("Product", "ProductKey", "Int64", { hidden: true }),
    col("Product", "ProductName", "String", { description: "Display name of the product." }),
    col("Product", "Category", "String", { description: "Top-level product category." }),
    col("Product", "Subcategory", "String", { description: "Product subcategory." }),
    col("Product", "Brand", "String", { description: "Manufacturer brand." }),
    col("Product", "Color", "String"),
    col("Product", "ListPrice", "Decimal", { description: "Catalog list price." }),
    // Customer dim
    col("Customer", "CustomerKey", "Int64", { hidden: true }),
    col("Customer", "CustomerName", "String", { description: "Customer or account name." }),
    col("Customer", "Segment", "String", { description: "Business segment (Consumer, SMB, Enterprise)." }),
    col("Customer", "GeographyKey", "Int64", { hidden: true }),
    col("Customer", "Email", "String", { hidden: true }),
    // Store dim
    col("Store", "StoreKey", "Int64", { hidden: true }),
    col("Store", "StoreName", "String", { description: "Store display name." }),
    col("Store", "StoreType", "String", { description: "Channel: Retail, Online or Reseller." }),
    col("Store", "GeographyKey", "Int64", { hidden: true }),
    col("Store", "OpenDate", "DateTime"),
    // Date dim
    col("Date", "DateKey", "Int64", { hidden: true }),
    col("Date", "Date", "DateTime", { description: "Calendar date." }),
    col("Date", "Year", "Int64", { description: "Calendar year." }),
    col("Date", "Quarter", "String", { description: "Calendar quarter (Q1–Q4)." }),
    col("Date", "Month", "String", { description: "Month name.", folder: null }),
    col("Date", "MonthNumber", "Int64", { hidden: true }),
    col("Date", "FiscalYear", "Int64", { description: "Fiscal year (July start)." }),
    // Geography dim
    col("Geography", "GeographyKey", "Int64", { hidden: true }),
    col("Geography", "City", "String", { description: "City name." }),
    col("Geography", "State", "String"),
    col("Geography", "Country", "String", { description: "Country / region." }),
    col("Geography", "Continent", "String"),
    col("Geography", "SalesRegion", "String", { description: "Reporting region (AMER, EMEA, APAC)." }),
];

// ---------- measures (~24, inter-referencing → real dependency graph) ----------
// folder groups drive family clustering; DAX references other measures + columns.
const m = (name, folder, dax, description, format = null) => ({
    name,
    table: "Measures",
    folder,
    format,
    hidden: false,
    dax,
    description,
    sources: [],
    stewardPending: false,
});

const MEASURES = [
    // Base aggregations
    m("Total Sales", "Sales", "SUM(Sales[SalesAmount])", "Total revenue across all order lines.", "\\$#,0"),
    m("Total Cost", "Profitability", "SUMX(Sales, Sales[Quantity] * Sales[UnitCost])", "Landed cost of everything sold.", "\\$#,0"),
    m("Total Quantity", "Volume", "SUM(Sales[Quantity])", "Total units sold.", "#,0"),
    m("Discount Amount", "Profitability", "SUM(Sales[DiscountAmount])", "Total discounts given.", "\\$#,0"),
    m("Order Count", "Volume", "DISTINCTCOUNT(Sales[SalesKey])", "Number of distinct order lines.", "#,0"),
    m("Customer Count", "Customers", "DISTINCTCOUNT(Sales[CustomerKey])", "Distinct customers who purchased.", "#,0"),
    m("Product Count", "Customers", "DISTINCTCOUNT(Sales[ProductKey])", "Distinct products sold.", "#,0"),
    // Profitability (reference base measures)
    m("Net Sales", "Sales", "[Total Sales] - [Discount Amount]", "Revenue after discounts.", "\\$#,0"),
    m("Gross Profit", "Profitability", "[Total Sales] - [Total Cost]", "Revenue minus cost of goods sold.", "\\$#,0"),
    m("Gross Margin %", "Profitability", "DIVIDE([Gross Profit], [Total Sales])", "Gross profit as a share of revenue.", "0.0%"),
    m("Average Selling Price", "Volume", "DIVIDE([Total Sales], [Total Quantity])", "Revenue per unit sold.", "\\$#,0.00"),
    m("Average Order Value", "Volume", "DIVIDE([Total Sales], [Order Count])", "Revenue per order line.", "\\$#,0"),
    m("Units per Order", "Volume", "DIVIDE([Total Quantity], [Order Count])", "Average units on each order line.", "#,0.0"),
    // Customer analytics
    m("Sales per Customer", "Customers", "DIVIDE([Total Sales], [Customer Count])", "Average revenue per customer.", "\\$#,0"),
    // Time intelligence (reference base + Date)
    m("Sales YTD", "Time Intelligence", "TOTALYTD([Total Sales], 'Date'[Date])", "Year-to-date revenue.", "\\$#,0"),
    m("Sales MTD", "Time Intelligence", "TOTALMTD([Total Sales], 'Date'[Date])", "Month-to-date revenue.", "\\$#,0"),
    m("Sales PY", "Time Intelligence", "CALCULATE([Total Sales], SAMEPERIODLASTYEAR('Date'[Date]))", "Revenue in the same period last year.", "\\$#,0"),
    m("Sales YoY", "Time Intelligence", "[Total Sales] - [Sales PY]", "Revenue change vs last year.", "\\$#,0"),
    m("Sales YoY %", "Time Intelligence", "DIVIDE([Sales YoY], [Sales PY])", "Year-over-year growth rate.", "0.0%"),
    // Targets & variance (a small family with a shared stem)
    m("Sales Target", "Targets", "[Sales PY] * 1.1", "Plan: 10% growth over last year.", "\\$#,0"),
    m("Sales vs Target", "Targets", "[Total Sales] - [Sales Target]", "Revenue above or below target.", "\\$#,0"),
    m("Sales vs Target %", "Targets", "DIVIDE([Sales vs Target], [Sales Target])", "Attainment gap as a percentage.", "0.0%"),
    // Profitability targets
    m("Margin Target %", "Targets", "0.42", "Target gross margin for the year.", "0.0%"),
    m("Margin vs Target", "Targets", "[Gross Margin %] - [Margin Target %]", "Margin above or below target.", "0.0%"),
];

// ---------- relationships (fact → dims, plus snowflaked geography) ----------
const rel = (fromTable, fromColumn, toTable, toColumn) => ({
    fromTable,
    fromColumn,
    fromCardinality: "Many",
    toCardinality: "One",
    toTable,
    toColumn,
    active: true,
    crossFilter: "OneDirection",
});

const RELATIONSHIPS = [
    rel("Sales", "ProductKey", "Product", "ProductKey"),
    rel("Sales", "CustomerKey", "Customer", "CustomerKey"),
    rel("Sales", "StoreKey", "Store", "StoreKey"),
    rel("Sales", "OrderDate", "Date", "Date"),
    rel("Customer", "GeographyKey", "Geography", "GeographyKey"),
    rel("Store", "GeographyKey", "Geography", "GeographyKey"),
];

// ---------- freshness (mostly fresh, one stale, to exercise the UI) ----------
const FRESHNESS = [
    { system: "ContosoERP", detail: "Sales — hourly", latest: "2025-01-15T14:05:00", status: "fresh" },
    { system: "ContosoCRM", detail: "Customer master — daily", latest: "2025-01-15T06:30:00", status: "fresh" },
    { system: "ContosoPIM", detail: "Product catalog — daily", latest: "2025-01-15T05:10:00", status: "fresh" },
    { system: "ContosoRef", detail: "Calendar & geography", latest: "2025-01-01T00:00:00", status: "fresh", note: "reference — rarely changes" },
    { system: "ContosoERP", detail: "Store dimension — weekly", latest: "2025-01-06T02:00:00", status: "stale", note: "~9 days (weekly load)" },
];

// ---------- automated source→model tie-out pass rates ----------
const QA_TIEOUT = [
    { area: "Sales revenue", system: "ContosoERP", passed: 512, failed: 0 },
    { area: "Customer counts", system: "ContosoCRM", passed: 288, failed: 3 },
    { area: "Product catalog", system: "ContosoPIM", passed: 194, failed: 0 },
];

// ---------- adoption (drives the "who uses this" panel) ----------
const ADOPTION = {
    workspace_totals: { distinct_users: 412, total_views: 9840 },
    model_totals: { distinct_users: 168, total_views: 3120, note: "Demo figures — replace by connecting your model." },
    top_reports: [
        { report: "Sales Overview", views: 1240, users: 92, kind: "Report" },
        { report: "Margin & Profitability", views: 860, users: 61, kind: "Report" },
        { report: "Customer Segments", views: 540, users: 44, kind: "Report" },
        { report: "Store Performance", views: 480, users: 38, kind: "Report" },
    ],
};

// ---------- business glossary (generic retail/finance) ----------
const GLOSSARY = [
    { term: "COGS", meaning: "Cost of Goods Sold — the landed cost of items sold.", confidence: "confirmed", category: "Profitability", aliases: ["Cost of Goods Sold", "Total Cost"] },
    { term: "Gross Margin", meaning: "Gross profit as a percentage of revenue.", confidence: "confirmed", category: "Profitability", aliases: ["GM", "Margin"] },
    { term: "ASP", meaning: "Average Selling Price — revenue divided by units sold.", confidence: "standard", category: "Volume", aliases: ["Average Selling Price"] },
    { term: "AOV", meaning: "Average Order Value — revenue divided by order count.", confidence: "standard", category: "Volume", aliases: ["Average Order Value"] },
    { term: "Net Sales", meaning: "Revenue after discounts and returns.", confidence: "confirmed", category: "Sales", aliases: ["Net Revenue"] },
    { term: "YTD", meaning: "Year-to-Date — cumulative from the start of the year.", confidence: "standard", category: "Time", aliases: ["Year to Date"] },
    { term: "MTD", meaning: "Month-to-Date — cumulative from the start of the month.", confidence: "standard", category: "Time", aliases: ["Month to Date"] },
    { term: "YoY", meaning: "Year-over-Year — change vs the same period last year.", confidence: "standard", category: "Time", aliases: ["Year over Year"] },
    { term: "Segment", meaning: "Customer grouping: Consumer, SMB or Enterprise.", confidence: "confirmed", category: "Customer", aliases: [] },
    { term: "SKU", meaning: "Stock Keeping Unit — a distinct sellable product.", confidence: "standard", category: "Product", aliases: ["Stock Keeping Unit"] },
];

// ---------- build ----------
function main() {
    const dataset = {
        generatedAt: new Date().toISOString(),
        source: {
            model: "Contoso Sales (Demo)",
            workspace: "Semantic Directory Demo",
            dataset: "00000000-0000-0000-0000-000000000000",
            capturedUtc: new Date().toISOString().slice(0, 10),
            note: "Bundled demo brain. Connect a real Fabric model to replace it live.",
        },
        counts: {
            measures: MEASURES.length,
            measuresWithDax: MEASURES.filter((x) => x.dax).length,
            measuresDescribed: MEASURES.filter((x) => x.description).length,
            columns: COLUMNS.length,
            tables: TABLES.length,
            relationships: RELATIONSHIPS.length,
        },
        measures: MEASURES,
        columns: COLUMNS,
        tables: TABLES,
        relationships: RELATIONSHIPS,
        sourceSystems: SOURCE_SYSTEMS,
        freshness: FRESHNESS,
        qaTieOut: QA_TIEOUT,
        adoption: ADOPTION,
        glossary: GLOSSARY,
    };

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(OUT_FILE, JSON.stringify(dataset), "utf8");

    const kb = (Buffer.byteLength(JSON.stringify(dataset), "utf8") / 1024).toFixed(0);
    console.log(`\u2714 wrote ${OUT_FILE} (${kb} KB)`);
    console.log(`  measures ${dataset.counts.measures} (dax ${dataset.counts.measuresWithDax}, described ${dataset.counts.measuresDescribed})`);
    console.log(`  columns ${dataset.counts.columns}  tables ${dataset.counts.tables}  relationships ${dataset.counts.relationships}`);
}

main();
