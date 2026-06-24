/* eslint-disable @typescript-eslint/no-explicit-any */
// Faithful TS port of `_model_bpa_rules.py` plus PKG-3 detect-only rules.
// Rules retain their Python semantics: predicate returns `true` to flag
// a violation. `obj` is a scope-specific wrapper (see engine.ts), `tom`
// is the TomContext shim that mirrors `tom.*` helpers from sempy_labs.

import type { BpaRule } from "./types";

const reTest = (re: RegExp, s: string | undefined | null): boolean =>
  !!s && re.test(s);

export const MODEL_BPA_RULES: BpaRule[] = [
  // ── Performance ─────────────────────────────────────────────────────
  {
    category: "Performance",
    scope: "Column",
    severity: "Warning",
    name: "Do not use floating point data types",
    description:
      'The "Double" floating point data type should be avoided, as it can result in unpredictable roundoff errors and decreased performance in certain scenarios. Use "Int64" or "Decimal" where appropriate (but note that "Decimal" is limited to 4 digits after the decimal sign).',
    predicate: (obj) => obj.DataType === "Double",
  },
  {
    category: "Performance",
    scope: "Column",
    severity: "Warning",
    name: "Avoid using calculated columns",
    description:
      "Calculated columns do not compress as well as data columns so they take up more memory. They also slow down processing times for both the table as well as process recalc. Offload calculated column logic to your data warehouse and turn these calculated columns into data columns.",
    url: "https://www.elegantbi.com/post/top10bestpractices",
    predicate: (obj) => obj.Type === "Calculated",
  },
  {
    category: "Performance",
    scope: "Relationship",
    severity: "Warning",
    name: "Check if bi-directional and many-to-many relationships are valid",
    description:
      "Bi-directional and many-to-many relationships may cause performance degradation or even have unintended consequences. Make sure to check these specific relationships to ensure they are working as designed and are actually necessary.",
    url: "https://www.sqlbi.com/articles/bidirectional-relationships-and-ambiguity-in-dax",
    predicate: (obj) =>
      (obj.FromCardinality === "Many" && obj.ToCardinality === "Many") ||
      obj.CrossFilteringBehavior === "BothDirections",
  },
  {
    category: "Performance",
    scope: "Row Level Security",
    severity: "Info",
    name: "Check if dynamic row level security (RLS) is necessary",
    description:
      "Usage of dynamic row level security (RLS) can add memory and performance overhead. Please research the pros/cons of using it.",
    url: "https://docs.microsoft.com/power-bi/admin/service-admin-rls",
    predicate: (obj) =>
      reTest(/USERPRINCIPALNAME\s*\(\s*\)|USERNAME\s*\(\s*\)/i, obj.FilterExpression),
  },
  {
    category: "Performance",
    scope: "Table",
    severity: "Warning",
    name: "Avoid using many-to-many relationships on tables used for dynamic row level security",
    description:
      "Using many-to-many relationships on tables which use dynamic row level security can cause serious query performance degradation. This pattern's performance problems compound when snowflaking multiple many-to-many relationships against a table which contains row level security. Instead, use one of the patterns shown in the article below where a single dimension table relates many-to-one to a security table.",
    url: "https://www.elegantbi.com/post/dynamicrlspatterns",
    predicate: (obj, tom) =>
      tom.used_in_relationships({ object: obj }).some(
        (r) => r.FromCardinality === "Many" && r.ToCardinality === "Many",
      ) &&
      tom.all_rls().some((t) => t.Table.Name === obj.Name),
  },
  {
    category: "Performance",
    scope: "Relationship",
    severity: "Warning",
    name: "Many-to-many relationships should be single-direction",
    description:
      "Many-to-many relationships should not be bi-directional unless absolutely required.",
    predicate: (obj) =>
      obj.FromCardinality === "Many" &&
      obj.ToCardinality === "Many" &&
      obj.CrossFilteringBehavior === "BothDirections",
  },
  {
    category: "Performance",
    scope: "Column",
    severity: "Warning",
    name: "Set IsAvailableInMdx to false on non-attribute columns",
    description:
      "To speed up processing time and conserve memory after processing, attribute hierarchies should not be built for columns that are never used for slicing by MDX clients. In other words, all hidden columns that are not used as a Sort By Column or referenced in user hierarchies should have their IsAvailableInMdx property set to false. The IsAvailableInMdx property is not relevant for Direct Lake models.",
    url: "https://blog.crossjoin.co.uk/2018/07/02/isavailableinmdx-ssas-tabular",
    predicate: (obj, tom) =>
      tom.is_direct_lake() === false &&
      obj.IsAvailableInMDX &&
      (obj.IsHidden || obj.Parent.IsHidden) &&
      obj.SortByColumn === null &&
      tom.used_in_sort_by({ column: obj }).length === 0 &&
      tom.used_in_hierarchies({ column: obj }).length === 0,
  },
  {
    category: "Performance",
    scope: "Partition",
    severity: "Warning",
    name: "Set 'Data Coverage Definition' property on the DirectQuery partition of a hybrid table",
    description:
      "Setting the 'Data Coverage Definition' property may lead to better performance because the engine knows when it can only query the import-portion of the table and when it needs to query the DirectQuery portion of the table.",
    url: "https://learn.microsoft.com/analysis-services/tom/table-partitions?view=asallproducts-allversions",
    predicate: (obj, tom) =>
      tom.is_hybrid_table({ table_name: obj.Parent.Name }) &&
      obj.Mode === "DirectQuery" &&
      obj.DataCoverageDefinition === null,
  },
  {
    category: "Performance",
    scope: "Model",
    severity: "Warning",
    name: "Dual mode is only relevant for dimension tables if DirectQuery is used for the corresponding fact table",
    description:
      "Only use Dual mode for dimension tables/partitions where a corresponding fact table is in DirectQuery. Using Dual mode in other circumstances (i.e. rest of the model is in Import mode) may lead to performance issues especially if the number of measures in the model is high.",
    predicate: (_obj, tom) => {
      const parts = Array.from(tom.all_partitions());
      return !parts.some((p) => p.Mode === "DirectQuery") && parts.some((p) => p.Mode === "Dual");
    },
  },
  {
    category: "Performance",
    scope: "Table",
    severity: "Warning",
    name: "Set dimensions tables to dual mode instead of import when using DirectQuery on fact tables",
    description:
      "When using DirectQuery, dimension tables should be set to Dual mode in order to improve query performance.",
    url: "https://learn.microsoft.com/power-bi/transform-model/desktop-storage-mode#propagation-of-the-dual-setting",
    predicate: (obj, tom) => {
      const importParts = Array.from(obj.Partitions).filter((p: any) => p.Mode === "Import").length;
      return (
        importParts === 1 &&
        obj.Partitions.Count === 1 &&
        tom.has_hybrid_table() &&
        tom
          .used_in_relationships({ object: obj })
          .some((r) => r.ToCardinality === "One" && r.ToTable.Name === obj.Name)
      );
    },
  },
  {
    category: "Performance",
    scope: "Partition",
    severity: "Warning",
    name: "Minimize Power Query transformations",
    description:
      "Minimize Power Query transformations in order to improve model processing performance. It is a best practice to offload these transformations to the data warehouse if possible. Also, please check whether query folding is occurring within your model. Please reference the article below for more information on query folding.",
    url: "https://docs.microsoft.com/power-query/power-query-folding",
    predicate: (obj) => {
      if (obj.SourceType !== "M") return false;
      const expr = obj.Source?.Expression ?? "";
      const triggers = [
        'Table.Combine("',
        'Table.Join("',
        'Table.NestedJoin("',
        'Table.AddColumn("',
        'Table.Group("',
        'Table.Sort("',
        'Table.Pivot("',
        'Table.Unpivot("',
        'Table.UnpivotOtherColumns("',
        'Table.Distinct("',
        '[Query=(""SELECT',
        "Value.NativeQuery",
        "OleDb.Query",
        "Odbc.Query",
      ];
      return triggers.some((t) => expr.includes(t));
    },
  },
  {
    category: "Performance",
    scope: "Table",
    severity: "Warning",
    name: "Consider a star-schema instead of a snowflake architecture",
    description:
      "Generally speaking, a star-schema is the optimal architecture for tabular models. That being the case, there are valid cases to use a snowflake approach. Please check your model and consider moving to a star-schema architecture.",
    url: "https://docs.microsoft.com/power-bi/guidance/star-schema",
    predicate: (obj, tom) => {
      if (obj.CalculationGroup !== null) return false;
      const rels = tom.used_in_relationships({ object: obj });
      const fromHit = rels.some((r) => r.FromTable.Name === obj.Name);
      const toHit = rels.some((r) => r.ToTable.Name === obj.Name);
      return fromHit && toHit;
    },
  },
  {
    category: "Performance",
    scope: "Model",
    severity: "Warning",
    name: "Avoid using views when using Direct Lake mode",
    description:
      "In Direct Lake mode, views will always fall back to DirectQuery. Thus, in order to obtain the best performance use lakehouse tables instead of views.",
    url: "https://learn.microsoft.com/fabric/get-started/direct-lake-overview#fallback",
    predicate: (_obj, tom) => tom.is_direct_lake_using_view(),
  },
  {
    category: "Performance",
    scope: "Measure",
    severity: "Warning",
    name: "Avoid adding 0 to a measure",
    description:
      "Adding 0 to a measure in order for it not to show a blank value may negatively impact performance.",
    predicate: (obj) => {
      const e = (obj.Expression ?? "").replace(/\s/g, "");
      return (
        e.startsWith("0+") ||
        e.endsWith("+0") ||
        reTest(/DIVIDE\s*\(\s*[^,]+,\s*[^,]+,\s*0\s*\)/i, obj.Expression) ||
        reTest(/IFERROR\s*\(\s*[^,]+,\s*0\s*\)/i, obj.Expression)
      );
    },
  },
  {
    category: "Performance",
    scope: "Table",
    severity: "Warning",
    name: "Reduce usage of calculated tables",
    description:
      "Migrate calculated table logic to your data warehouse. Reliance on calculated tables will lead to technical debt and potential misalignments if you have multiple models on your platform.",
    predicate: (obj, tom) =>
      tom.is_field_parameter({ table_name: obj.Name }) === false &&
      tom.is_calculated_table({ table_name: obj.Name }),
  },
  {
    category: "Performance",
    scope: "Column",
    severity: "Warning",
    name: "Reduce usage of calculated columns that use the RELATED function",
    description:
      "Calculated columns do not compress as well as data columns and may cause longer processing times. As such, calculated columns should be avoided if possible. One scenario where they may be easier to avoid is if they use the RELATED function.",
    url: "https://www.sqlbi.com/articles/storage-differences-between-calculated-columns-and-calculated-tables",
    predicate: (obj) => obj.Type === "Calculated" && reTest(/related\s*\(/i, obj.Expression),
  },
  {
    category: "Performance",
    scope: "Model",
    severity: "Warning",
    name: "Avoid excessive bi-directional or many-to-many relationships",
    description:
      "Limit use of b-di and many-to-many relationships. This rule flags the model if more than 30% of relationships are bi-di or many-to-many.",
    url: "https://www.sqlbi.com/articles/bidirectional-relationships-and-ambiguity-in-dax",
    predicate: (obj) => {
      const rels = obj.Relationships as any[];
      const total = Math.max(obj.Relationships.Count, 1);
      const bidi = rels.filter((r) => r.CrossFilteringBehavior === "BothDirections").length;
      const m2m = rels.filter((r) => r.FromCardinality === "Many" && r.ToCardinality === "Many").length;
      return (bidi + m2m) / total > 0.3;
    },
  },
  {
    category: "Performance",
    scope: "Table",
    severity: "Warning",
    name: "Remove auto-date table",
    description:
      "Avoid using auto-date tables. Make sure to turn off auto-date table in the settings in Power BI Desktop. This will save memory resources.",
    url: "https://www.youtube.com/watch?v=xu3uDEHtCrg",
    predicate: (obj, tom) =>
      tom.is_calculated_table({ table_name: obj.Name }) &&
      (obj.Name.startsWith("DateTableTemplate_") || obj.Name.startsWith("LocalDateTable_")),
  },
  {
    category: "Performance",
    scope: "Table",
    severity: "Warning",
    name: "Date/calendar tables should be marked as a date table",
    description:
      "This rule looks for tables that contain the words 'date' or 'calendar' as they should likely be marked as a date table.",
    url: "https://docs.microsoft.com/power-bi/transform-model/desktop-date-tables",
    predicate: (obj) =>
      (reTest(/date/i, obj.Name) || reTest(/calendar/i, obj.Name)) &&
      String(obj.DataCategory).toLowerCase() !== "time",
  },
  {
    category: "Performance",
    scope: "Table",
    severity: "Warning",
    name: "Large tables should be partitioned",
    description:
      "Large tables should be partitioned in order to optimize processing. This is not relevant for semantic models in Direct Lake mode as they can only have one partition per table.",
    predicate: (obj, tom) =>
      tom.is_direct_lake() === false &&
      obj.Partitions.Count === 1 &&
      tom.row_count({ object: obj }) > 25000000,
  },
  {
    category: "Performance",
    scope: "Row Level Security",
    severity: "Warning",
    name: "Limit row level security (RLS) logic",
    description:
      "Try to simplify the DAX used for row level security. Usage of the functions within this rule can likely be offloaded to the upstream systems (data warehouse).",
    predicate: (obj) => {
      const f = (obj.FilterExpression ?? "").toLowerCase();
      return ["right(", "left(", "filter(", "upper(", "lower(", "find("].some((t) => f.includes(t));
    },
  },
  {
    category: "Performance",
    scope: "Model",
    severity: "Warning",
    name: "Model should have a date table",
    description:
      "Generally speaking, models should generally have a date table. Models that do not have a date table generally are not taking advantage of features such as time intelligence or may not have a properly structured architecture.",
    predicate: (obj) => {
      for (const t of obj.Tables) {
        if (String(t.DataCategory).toLowerCase() !== "time") continue;
        for (const c of t.Columns) {
          if (c.IsKey && c.DataType === "DateTime") return false;
        }
      }
      return true;
    },
  },

  // ── Error Prevention ────────────────────────────────────────────────
  {
    category: "Error Prevention",
    scope: "Calculation Item",
    severity: "Error",
    name: "Calculation items must have an expression",
    description:
      "Calculation items must have an expression. Without an expression, they will not show any values.",
    predicate: (obj) => (obj.Expression ?? "").length === 0,
  },
  {
    category: "Error Prevention",
    scope: "Relationship",
    severity: "Warning",
    name: "Relationship columns should be of the same data type",
    description:
      "Columns used in a relationship should be of the same data type. Ideally, they will be of integer data type (see the related rule '[Formatting] Relationship columns should be of integer data type'). Having columns within a relationship which are of different data types may lead to various issues.",
    predicate: (obj) =>
      !!obj.FromColumn.DataType &&
      !!obj.ToColumn.DataType &&
      obj.FromColumn.DataType !== obj.ToColumn.DataType,
  },
  {
    category: "Error Prevention",
    scope: "Column",
    severity: "Error",
    name: "Data columns must have a source column",
    description:
      "Data columns must have a source column. A data column without a source column will cause an error when processing the model.",
    predicate: (obj) => obj.Type === "Data" && (obj.SourceColumn ?? "").length === 0,
  },
  {
    category: "Error Prevention",
    scope: "Column",
    severity: "Warning",
    name: "Set IsAvailableInMdx to true on necessary columns",
    description:
      "In order to avoid errors, ensure that attribute hierarchies are enabled if a column is used for sorting another column, used in a hierarchy, used in variations, or is sorted by another column. The IsAvailableInMdx property is not relevant for Direct Lake models.",
    predicate: (obj, tom) =>
      tom.is_direct_lake() === false &&
      obj.IsAvailableInMDX === false &&
      (tom.used_in_sort_by({ column: obj }).length > 0 ||
        tom.used_in_hierarchies({ column: obj }).length > 0 ||
        obj.SortByColumn !== null),
  },
  {
    category: "Error Prevention",
    scope: "Table",
    severity: "Error",
    name: "Avoid the USERELATIONSHIP function and RLS against the same table",
    description:
      "The USERELATIONSHIP function may not be used against a table which also leverages row-level security (RLS). This will generate an error when using the particular measure in a visual. This rule will highlight the table which is used in a measure's USERELATIONSHIP function as well as RLS.",
    url: "https://blog.crossjoin.co.uk/2013/05/10/userelationship-and-tabular-row-security",
    predicate: (obj, tom) => {
      const tableName = obj.Name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(
        `USERELATIONSHIP\\s*\\(\\s*.+?(?=\\])\\]\\s*,\\s*'*${tableName}'*\\[`,
        "i",
      );
      const measureHit = Array.from(tom.all_measures()).some((m) => reTest(re, m.Expression));
      const rlsHit = tom.all_rls().some((r) => r.Table.Name === obj.Name);
      return measureHit && rlsHit;
    },
  },

  // ── DAX Expressions ─────────────────────────────────────────────────
  {
    category: "DAX Expressions",
    scope: "Measure",
    severity: "Warning",
    name: "Avoid using the IFERROR function",
    description:
      "Avoid using the IFERROR function as it may cause performance degradation. If you are concerned about a divide-by-zero error, use the DIVIDE function as it naturally resolves such errors as blank (or you can customize what should be shown in case of such an error).",
    url: "https://www.elegantbi.com/post/top10bestpractices",
    predicate: (obj) => reTest(/iferror\s*\(/i, obj.Expression),
  },
  {
    category: "DAX Expressions",
    scope: "Measure",
    severity: "Warning",
    name: "Use the TREATAS function instead of INTERSECT for virtual relationships",
    description:
      "The TREATAS function is more efficient and provides better performance than the INTERSECT function when used in virutal relationships.",
    url: "https://www.sqlbi.com/articles/propagate-filters-using-treatas-in-dax",
    predicate: (obj) => reTest(/intersect\s*\(/i, obj.Expression),
  },
  {
    category: "DAX Expressions",
    scope: "Measure",
    severity: "Warning",
    name: "The EVALUATEANDLOG function should not be used in production models",
    description:
      "The EVALUATEANDLOG function is meant to be used only in development/test environments and should not be used in production models.",
    url: "https://pbidax.wordpress.com/2022/08/16/introduce-the-dax-evaluateandlog-function",
    predicate: (obj) => reTest(/evaluateandlog\s*\(/i, obj.Expression),
  },
  {
    category: "DAX Expressions",
    scope: "Measure",
    severity: "Warning",
    name: "Measures should not be direct references of other measures",
    description:
      "This rule identifies measures which are simply a reference to another measure. As an example, consider a model with two measures: [MeasureA] and [MeasureB]. This rule would be triggered for MeasureB if MeasureB's DAX was MeasureB:=[MeasureA]. Such duplicative measures should be removed.",
    predicate: (obj, tom) =>
      Array.from(tom.all_measures()).some((m) => obj.Expression === `[${m.Name}]`),
  },
  {
    category: "DAX Expressions",
    scope: "Measure",
    severity: "Warning",
    name: "No two measures should have the same definition",
    description:
      "Two measures with different names and defined by the same DAX expression should be avoided to reduce redundancy.",
    predicate: (obj, tom) => {
      const norm = (s: string) => (s ?? "").replace(/\s+/g, "");
      const a = norm(obj.Expression);
      if (!a) return false;
      return Array.from(tom.all_measures()).some(
        (m) => norm(m.Expression) === a && m.Name !== obj.Name,
      );
    },
  },
  {
    category: "DAX Expressions",
    scope: "Measure",
    severity: "Warning",
    name: "Avoid addition or subtraction of constant values to results of divisions",
    description: "Adding a constant value may lead to performance degradation.",
    predicate: (obj) =>
      reTest(/DIVIDE\s*\((\s*.*?)\)\s*[+-]\s*1|\/\s*.*(?=[-+]\s*1)/i, obj.Expression),
  },
  {
    category: "DAX Expressions",
    scope: "Measure",
    severity: "Warning",
    name: "Avoid using '1-(x/y)' syntax",
    description:
      "Instead of using the '1-(x/y)' or '1+(x/y)' syntax to achieve a percentage calculation, use the basic DAX functions (as shown below). Using the improved syntax will generally improve the performance.",
    predicate: (obj) =>
      reTest(
        /[0-9]+\s*[-+]\s*[(]*\s*SUM\s*\(\s*'*[A-Za-z0-9 _]+'*\s*\[[A-Za-z0-9 _]+\]\s*\)\s*\//i,
        obj.Expression,
      ) || reTest(/[0-9]+\s*[-+]\s*DIVIDE\s*\(/i, obj.Expression),
  },
  {
    category: "DAX Expressions",
    scope: "Measure",
    severity: "Warning",
    name: "Filter measure values by columns, not tables",
    description:
      "Instead of using this pattern FILTER('Table',[Measure]>Value) for the filter parameters of a CALCULATE or CALCULATETABLE function, use one of the options below (if possible). Filtering on a specific column will produce a smaller table for the engine to process, thereby enabling faster performance.",
    url: "https://docs.microsoft.com/power-bi/guidance/dax-avoid-avoid-filter-as-filter-argument",
    predicate: (obj) =>
      reTest(
        /CALCULATE\s*\(\s*[^,]+,\s*FILTER\s*\(\s*'*[A-Za-z0-9 _]+'*\s*,\s*\[[^\]]+\]/i,
        obj.Expression,
      ) ||
      reTest(
        /CALCULATETABLE\s*\(\s*[^,]*,\s*FILTER\s*\(\s*'*[A-Za-z0-9 _]+'*\s*,\s*\[/i,
        obj.Expression,
      ),
  },
  {
    category: "DAX Expressions",
    scope: "Measure",
    severity: "Warning",
    name: "Filter column values with proper syntax",
    description:
      "Instead of using this pattern FILTER('Table','Table'[Column]=\"Value\") for the filter parameters of a CALCULATE or CALCULATETABLE function, use KEEPFILTERS or a direct column predicate.",
    url: "https://docs.microsoft.com/power-bi/guidance/dax-avoid-avoid-filter-as-filter-argument",
    predicate: (obj) =>
      reTest(
        /CALCULATE\s*\(\s*[^,]+,\s*FILTER\s*\(\s*'*[A-Za-z0-9 _]+'*\s*,\s*'*[A-Za-z0-9 _]+'*\[[A-Za-z0-9 _]+\]/i,
        obj.Expression,
      ) ||
      reTest(
        /CALCULATETABLE\s*\([^,]*,\s*FILTER\s*\(\s*'*[A-Za-z0-9 _]+'*\s*,\s*'*[A-Za-z0-9 _]+'*\[[A-Za-z0-9 _]+\]/i,
        obj.Expression,
      ),
  },
  {
    category: "DAX Expressions",
    scope: "Measure",
    severity: "Warning",
    name: "Use the DIVIDE function for division",
    description:
      'Use the DIVIDE  function instead of using "/". The DIVIDE function resolves divide-by-zero cases. As such, it is recommended to use to avoid errors.',
    url: "https://docs.microsoft.com/power-bi/guidance/dax-divide-function-operator",
    predicate: (obj) => reTest(/\]\s*\/(?!\/)(?!\*)|\)\s*\/(?!\/)(?!\*)/i, obj.Expression),
  },
  {
    category: "DAX Expressions",
    scope: ["Measure", "Calculated Table", "Calculated Column", "Calculation Item"],
    severity: "Error",
    name: "Column references should be fully qualified",
    description:
      "Using fully qualified column references makes it easier to distinguish between column and measure references, and also helps avoid certain errors. When referencing a column in DAX, first specify the table name, then specify the column name in square brackets.",
    url: "https://www.elegantbi.com/post/top10bestpractices",
    predicate: (obj, tom) => tom.unqualified_columns({ object: obj }).length > 0,
  },
  {
    category: "DAX Expressions",
    scope: ["Measure", "Calculated Table", "Calculated Column", "Calculation Item"],
    severity: "Error",
    name: "Measure references should be unqualified",
    description:
      "Using unqualified measure references makes it easier to distinguish between column and measure references, and also helps avoid certain errors. When referencing a measure using DAX, do not specify the table name. Use only the measure name in square brackets.",
    url: "https://www.elegantbi.com/post/top10bestpractices",
    predicate: (obj, tom) => tom.fully_qualified_measures({ object: obj }).length > 0,
  },
  {
    category: "DAX Expressions",
    scope: "Relationship",
    severity: "Warning",
    name: "Inactive relationships that are never activated",
    description:
      "Inactive relationships are activated using the USERELATIONSHIP function. If an inactive relationship is not referenced in any measure via this function, the relationship will not be used. It should be determined whether the relationship is not necessary or to activate the relationship via this method.",
    url: "https://dax.guide/userelationship",
    predicate: (obj, tom) => {
      if (obj.IsActive !== false) return false;
      const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(
        `USERELATIONSHIP\\s*\\(\\s*'*${esc(obj.FromTable.Name)}'*\\[${esc(obj.FromColumn.Name)}\\]\\s*,\\s*'*${esc(obj.ToTable.Name)}'*\\[${esc(obj.ToColumn.Name)}\\]`,
        "i",
      );
      return !Array.from(tom.all_measures()).some((m) => reTest(re, m.Expression));
    },
  },

  // ── Maintenance ─────────────────────────────────────────────────────
  {
    category: "Maintenance",
    scope: "Column",
    severity: "Warning",
    name: "Remove unnecessary columns",
    description:
      "Hidden columns that are not referenced by any DAX expressions, relationships, hierarchy levels or Sort By-properties should be removed.",
    predicate: (obj, tom) =>
      (obj.IsHidden || obj.Parent.IsHidden) &&
      tom.used_in_relationships({ object: obj }).length === 0 &&
      tom.used_in_hierarchies({ column: obj }).length === 0 &&
      tom.used_in_sort_by({ column: obj }).length === 0 &&
      tom.depends_on({ object: obj }).length > 0,
  },
  {
    category: "Maintenance",
    scope: "Measure",
    severity: "Warning",
    name: "Remove unnecessary measures",
    description: "Hidden measures that are not referenced by any DAX expressions should be removed for maintainability.",
    predicate: (obj, tom) => obj.IsHidden && tom.referenced_by({ object: obj }).length === 0,
  },
  {
    category: "Maintenance",
    scope: "Table",
    severity: "Warning",
    name: "Ensure tables have relationships",
    description: "This rule highlights tables which are not connected to any other table in the model with a relationship.",
    predicate: (obj, tom) =>
      tom.used_in_relationships({ object: obj }).length === 0 && obj.CalculationGroup === null,
  },
  {
    category: "Maintenance",
    scope: "Table",
    severity: "Warning",
    name: "Calculation groups with no calculation items",
    description: "Calculation groups have no function unless they have calculation items.",
    predicate: (obj) =>
      obj.CalculationGroup !== null && obj.CalculationGroup.CalculationItems.length === 0,
  },
  {
    category: "Maintenance",
    scope: ["Column", "Measure", "Table"],
    severity: "Info",
    name: "Visible objects with no description",
    description:
      "Add descriptions to objects. These descriptions are shown on hover within the Field List in Power BI Desktop. Additionally, you can leverage these descriptions to create an automated data dictionary.",
    predicate: (obj) => obj.IsHidden === false && (obj.Description ?? "").length === 0,
  },

  // ── Formatting ──────────────────────────────────────────────────────
  {
    category: "Formatting",
    scope: "Column",
    severity: "Warning",
    name: "Provide format string for 'Date' columns",
    description: 'Columns of type "DateTime" that have "Date" in their names should be formatted.',
    predicate: (obj) =>
      reTest(/date/i, obj.Name) &&
      obj.DataType === "DateTime" &&
      ![
        "mm/dd/yyyy",
        "mm-dd-yyyy",
        "dd/mm/yyyy",
        "dd-mm-yyyy",
        "yyyy-mm-dd",
        "yyyy/mm/dd",
      ].includes((obj.FormatString ?? "").toLowerCase()),
  },
  {
    category: "Formatting",
    scope: "Column",
    severity: "Warning",
    name: "Do not summarize numeric columns",
    description:
      'Numeric columns (integer, decimal, double) should have their SummarizeBy property set to "None" to avoid accidental summation in Power BI (create measures instead).',
    predicate: (obj) =>
      (obj.DataType === "Int64" || obj.DataType === "Decimal" || obj.DataType === "Double") &&
      obj.SummarizeBy !== "None" &&
      !(obj.IsHidden || obj.Parent.IsHidden),
  },
  {
    category: "Formatting",
    scope: "Measure",
    severity: "Info",
    name: "Provide format string for measures",
    description: "Visible measures should have their format string property assigned.",
    predicate: (obj) =>
      obj.IsHidden === false &&
      (obj.FormatString ?? "").length === 0 &&
      !obj.FormatStringDefinition,
  },
  {
    category: "Formatting",
    scope: "Column",
    severity: "Info",
    name: "Add data category for columns",
    description: "Add Data Category property for appropriate columns.",
    url: "https://docs.microsoft.com/power-bi/transform-model/desktop-data-categorization",
    predicate: (obj) => {
      if ((obj.DataCategory ?? "").length !== 0) return false;
      const lo = (obj.Name ?? "").toLowerCase();
      return ["country", "city", "continent", "latitude", "longitude"].some((p) => lo.startsWith(p));
    },
  },
  {
    category: "Formatting",
    scope: "Measure",
    severity: "Warning",
    name: "Percentages should be formatted with thousands separators and 1 decimal",
    description: "For a better user experience, percengage measures should be formatted with a '%' sign.",
    predicate: (obj) =>
      (obj.FormatString ?? "").includes("%") && obj.FormatString !== "#,0.0%;-#,0.0%;#,0.0%",
  },
  {
    category: "Formatting",
    scope: "Measure",
    severity: "Warning",
    name: "Whole numbers should be formatted with thousands separators and no decimals",
    description: "For a better user experience, whole numbers should be formatted with commas.",
    predicate: (obj) => {
      const f = obj.FormatString ?? "";
      return !f.includes("$") && !f.includes("%") && !["#,0", "#,0.0"].includes(f);
    },
  },
  {
    category: "Formatting",
    scope: "Column",
    severity: "Info",
    name: "Hide foreign keys",
    description: "Foreign keys should always be hidden as they should not be used by end users.",
    predicate: (obj, tom) =>
      obj.IsHidden === false &&
      tom
        .used_in_relationships({ object: obj })
        .some((r) => r.FromColumn.Name === obj.Name && r.FromCardinality === "Many"),
  },
  {
    category: "Formatting",
    scope: "Column",
    severity: "Info",
    name: "Mark primary keys",
    description: "Set the 'Key' property to 'True' for primary key columns within the column properties.",
    predicate: (obj, tom) =>
      tom
        .used_in_relationships({ object: obj })
        .some(
          (r) =>
            r.ToTable.Name === obj.Table.Name &&
            r.ToColumn.Name === obj.Name &&
            r.ToCardinality === "One",
        ) &&
      obj.IsKey === false &&
      obj.Table.DataCategory !== "Time",
  },
  {
    category: "Formatting",
    scope: "Column",
    severity: "Info",
    name: "Month (as a string) must be sorted",
    description:
      "This rule highlights month columns which are strings and are not sorted. If left unsorted, they will sort alphabetically (i.e. April, August...). Make sure to sort such columns so that they sort properly (January, February, March...).",
    predicate: (obj) =>
      reTest(/month/i, obj.Name) &&
      !reTest(/months/i, obj.Name) &&
      obj.DataType === "String" &&
      String(obj.SortByColumn?.Name ?? "").length === 0,
  },
  {
    category: "Formatting",
    scope: "Relationship",
    severity: "Warning",
    name: "Relationship columns should be of integer data type",
    description:
      "It is a best practice for relationship columns to be of integer data type. This applies not only to data warehousing but data modeling as well.",
    predicate: (obj) =>
      !!obj.FromColumn.DataType &&
      !!obj.ToColumn.DataType &&
      (obj.FromColumn.DataType !== "Int64" || obj.ToColumn.DataType !== "Int64"),
  },
  {
    category: "Formatting",
    scope: "Column",
    severity: "Warning",
    name: "Provide format string for 'Month' columns",
    description: 'Columns of type "DateTime" that have "Month" in their names should be formatted as "MMMM yyyy".',
    predicate: (obj) =>
      reTest(/month/i, obj.Name) &&
      obj.DataType === "DateTime" &&
      obj.FormatString !== "MMMM yyyy",
  },
  {
    category: "Formatting",
    scope: "Column",
    severity: "Info",
    name: "Format flag columns as Yes/No value strings",
    description: "Flags must be properly formatted as Yes/No as this is easier to read than using 0/1 integer values.",
    predicate: (obj) => {
      const lo = (obj.Name ?? "").toLowerCase();
      const startsIs =
        lo.startsWith("is") &&
        obj.DataType === "Int64" &&
        !(obj.IsHidden || obj.Parent.IsHidden);
      const endsFlag =
        lo.endsWith(" flag") &&
        obj.DataType !== "String" &&
        !(obj.IsHidden || obj.Parent.IsHidden);
      return startsIs || endsFlag;
    },
  },
  {
    category: "Formatting",
    scope: ["Table", "Column", "Measure", "Partition", "Hierarchy"],
    severity: "Error",
    name: "Objects should not start or end with a space",
    description:
      "Objects should not start or end with a space. This usually happens by accident and is difficult to find.",
    predicate: (obj) => {
      const n = obj.Name ?? "";
      return n.length > 0 && (n[0] === " " || n[n.length - 1] === " ");
    },
  },
  {
    category: "Formatting",
    scope: ["Table", "Column", "Measure", "Partition", "Hierarchy"],
    severity: "Info",
    name: "First letter of objects must be capitalized",
    description: "The first letter of object names should be capitalized to maintain professional quality.",
    predicate: (obj) => {
      const n = obj.Name ?? "";
      return n.length > 0 && n[0] !== n[0].toUpperCase();
    },
  },

  // ── Naming Conventions ──────────────────────────────────────────────
  {
    category: "Naming Conventions",
    scope: ["Table", "Column", "Measure", "Partition", "Hierarchy"],
    severity: "Warning",
    name: "Object names must not contain special characters",
    description: "Object names should not include tabs, line breaks, etc.",
    predicate: (obj) => reTest(/[\t\r\n]/, obj.Name),
  },

  // ── PKG-3: detect-only rule-coverage expansion ──────────────────────
  // Pure predicates evaluable from the TMDL-derived model. Translation-,
  // perspective- and legacy-connection-string rules (E2/E3/E7–E10/E17/E22)
  // are intentionally not added here: they require culture / perspective /
  // connectionString data the in-browser engine does not capture, so they
  // would only ever no-op or produce noise.
  {
    category: "Maintenance",
    scope: ["Measure", "Calculation Item"],
    severity: "Info",
    name: "Revisit unfinished DAX (// TODO)",
    description:
      "Expressions containing a TODO comment indicate unfinished logic that should be revisited before publishing.",
    predicate: (obj) => reTest(/\/\/\s*todo|\/\*[\s\S]*?todo/i, obj.Expression),
  },
  {
    category: "Naming Conventions",
    scope: ["Column", "Hierarchy"],
    severity: "Info",
    name: "Avoid camelCase in column and hierarchy names",
    description:
      "Column and hierarchy names should be human-readable with spaces (e.g. 'Sales Amount') rather than camelCase/PascalCase run together (e.g. 'SalesAmount').",
    predicate: (obj) => {
      const n = obj.Name ?? "";
      return /[a-z][A-Z]/.test(n) && !n.includes(" ");
    },
  },
  {
    category: "Naming Conventions",
    scope: ["Measure", "Table"],
    severity: "Info",
    name: "Avoid camelCase in measure and table names",
    description:
      "Measure and table names should be human-readable with spaces rather than camelCase/PascalCase run together.",
    predicate: (obj) => {
      const n = obj.Name ?? "";
      return /[a-z][A-Z]/.test(n) && !n.includes(" ");
    },
  },
  {
    category: "Maintenance",
    scope: "Partition",
    severity: "Info",
    name: "Partition names should match the table name",
    description:
      "For tables with a single partition, the partition name should match the table name for clarity and maintainability.",
    predicate: (obj) => obj.Parent?.Partitions?.Count === 1 && obj.Name !== obj.__table,
  },
  {
    category: "Maintenance",
    scope: "Relationship",
    severity: "Info",
    name: "Relationship columns should share the same name",
    description:
      "Relationships are easier to follow when both sides reference columns with the same name. Differing names often signal an unintended or mis-mapped relationship.",
    predicate: (obj) =>
      !!obj.FromColumn.Name &&
      !!obj.ToColumn.Name &&
      obj.FromColumn.Name !== obj.ToColumn.Name,
  },
  {
    category: "Performance",
    scope: "Table",
    severity: "Info",
    name: "Avoid single-attribute dimensions",
    description:
      "A dimension table that exposes only a single attribute can usually be denormalized into the fact table, removing a relationship and saving memory.",
    predicate: (obj, tom) => {
      const cols = (obj.Columns ?? []).filter(
        (c: any) => c.Type !== "RowNumber" && !c.IsHidden,
      );
      if (cols.length > 1) return false;
      return tom.used_in_relationships({ object: obj }).length > 0;
    },
  },
  {
    category: "Maintenance",
    scope: "Partition",
    severity: "Info",
    name: "Specify Application Name in the connection string",
    description:
      "M partitions that read from SQL Server should set an explicit Application Name so the workload is identifiable in monitoring and DMVs.",
    predicate: (obj) =>
      obj.SourceType === "M" &&
      reTest(/Sql\.Databases?\s*\(/i, obj.Source?.Expression) &&
      !reTest(/Application Name/i, obj.Source?.Expression),
  },

  // ── PKG-14: display-folder organization (pairs with the Display Folders
  //    organizer tool / MA3). Flag folder-less columns and measures in large
  //    tables so they can be auto-grouped into display folders. Hierarchies are
  //    not captured by the in-browser engine, so E4 is scoped to columns only.
  {
    category: "Formatting",
    scope: "Column",
    severity: "Info",
    name: "Organize columns into display folders",
    description:
      "Tables with more than 10 columns are much easier to navigate when their columns are grouped into display folders. Use the Display Folders tool to auto-organize related columns into folders.",
    predicate: (obj) =>
      obj.Type !== "RowNumber" &&
      !/^RowNumber-/i.test(obj.Name ?? "") &&
      (obj.Table?.Columns?.length ?? 0) > 10 &&
      String(obj.DisplayFolder ?? "").length === 0,
  },
  {
    category: "Formatting",
    scope: "Measure",
    severity: "Info",
    name: "Organize measures into display folders",
    description:
      "Tables with more than 10 measures are much easier to navigate when their measures are grouped into display folders. Use the Display Folders tool to auto-organize related measures into folders.",
    predicate: (obj) =>
      (obj.Table?.Measures?.length ?? 0) > 10 &&
      String(obj.DisplayFolder ?? "").length === 0,
  },
];
