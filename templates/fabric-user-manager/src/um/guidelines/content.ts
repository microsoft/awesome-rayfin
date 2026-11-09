/**
 * The Power BI guidelines as plain data.
 *
 * Taken over from the Power BI Fixer and reorganized on 2026-10-12 into three
 * areas: data integration, data modeling (with the Tabular Style Guide as its
 * last topic) and data visualization. Inside a topic the rules are ordered by
 * importance. Plain text only, so the content can be tested and searched. `{{question-id}}` in a text is filled
 * with the organization's answer and `q` names the question that tailors a
 * rule. Which drawing goes where is kept in figureIds.ts.
 */
export interface GuideLink {
  label: string;
  href: string;
}

export interface GuideItem {
  /** Leading marker, for example "1.", "a." or a bullet. Empty for a heading-like item. */
  marker?: string;
  /** Bold lead-in. */
  title?: string;
  text?: string;
  link?: GuideLink;
  /** The question whose answer is this organization's version of the rule. */
  q?: string;
  /** Set when the guide is read: topic and position of a rule, for example `2.5/7`. */
  place?: string;
  children?: GuideItem[];
}

export interface GuideSub {
  num: string;
  title: string;
  intro?: string;
  link?: GuideLink;
  items: GuideItem[];
}

export type SectionIcon = 'integration' | 'modeling' | 'report';

export interface GuideSection {
  id: string;
  num: string;
  title: string;
  icon: SectionIcon;
  subs: GuideSub[];
}

export const SECTIONS: GuideSection[] = [
  {
    id: "data-integration",
    num: "1",
    title: "Data Integration",
    icon: "integration",
    subs: [
      {
        num: "1.1",
        title: "Choose the connection",
        items: [
          {
            marker: "1.",
            title: "Import",
            text: "The default. Fastest queries and every modeling feature. Start here and leave it only for a reason."
          },
          {
            marker: "2.",
            title: "Direct Lake",
            text: "If needed: for very large data, or data that must be fresher than a scheduled refresh allows, when the data is in OneLake."
          },
          {
            marker: "3.",
            title: "Direct Query",
            text: "Almost never. Every visual sends a query to the source, so reports are slow and the source carries the load. Only when data cannot be copied or must be live to the second."
          }
        ]
      },
      {
        num: "1.2",
        title: "Load only what is needed",
        items: [
          {
            marker: "1.",
            title: "Reduce data volume",
            text: "Avoid loading rows or columns that are not necessary to answer the questions the report is meant to address."
          },
          {
            marker: "2.",
            title: "Reduce long-length, high-cardinality columns",
            text: "Avoid lengthy text columns (more than 100 characters), especially with many unique values: they cause longer processing times, bloated model sizes and slower user queries."
          },
          {
            q: "split-date-time",
            marker: "3.",
            title: "Split date and time",
            text: "For datetime columns whose values are not at midnight, split the time element from the date element (or round the time to midnight) to reduce column cardinality."
          },
          {
            marker: "4.",
            title: "Optimize data types",
            text: "Choose the smallest data type that holds the values."
          },
          {
            marker: "5.",
            title: "Remove redundant columns in related tables",
            text: "If only one is needed, delete the others from the model."
          },
          {
            marker: "6.",
            title: "Remove unused sources",
            text: "Remove sources that are not used or referenced in the report."
          }
        ]
      },
      {
        num: "1.3",
        title: "Shape the data upstream",
        items: [
          {
            marker: "1.",
            title: "Minimize Power Query transformations",
            text: "Offload transformations to the data warehouse where possible to improve model processing performance, and check whether query folding is occurring within your model."
          },
          {
            q: "source-strategy",
            marker: "2.",
            title: "Use views as the source",
            text: "A view shields the report from changes to the underlying tables."
          },
          {
            q: "calc-location",
            marker: "3.",
            title: "Avoid calculated columns and calculated tables",
            text: "This logic belongs in the backend.",
            children: [
              {
                marker: "a.",
                text: "Reduce the number of calculated columns: they do not compress as well as data columns, use more memory and slow processing. Offload the logic to the warehouse."
              },
              {
                marker: "b.",
                text: "Reduce the usage of calculated tables: migrate the logic to the warehouse to avoid technical debt and misalignment across models."
              },
              {
                marker: "c.",
                text: "This applies in particular to calculated columns that use RELATED."
              }
            ]
          }
        ]
      },
      {
        num: "1.4",
        title: "Direct Lake: when and what to expect",
        intro: "Choose Direct Lake when:",
        items: [
          {
            marker: "•",
            text: "Real-time data refresh is important."
          },
          {
            marker: "•",
            text: "Very large models are costly to refresh, or can only be refreshed incrementally or by partition."
          },
          {
            marker: "",
            title: "Considerations & limitations",
            children: [
              {
                marker: "a.",
                text: "Setup is slightly more complex."
              },
              {
                marker: "b.",
                text: "Not all data sources are supported."
              },
              {
                marker: "c.",
                text: "\"Auxiliary tables\" can only be added via lakehouse + shortcut to the Power BI warehouse."
              },
              {
                marker: "d.",
                text: "Calculated tables and calculated columns are not possible."
              },
              {
                marker: "e.",
                text: "Field parameters can only be added with Tabular Editor and take more effort there."
              },
              {
                marker: "f.",
                text: "Designing Direct Lake models in Power BI Desktop has limitations of its own. Check them before you start, or build the model in the Power BI service.",
                link: {
                  label: "Direct Lake in Power BI Desktop: considerations and limitations",
                  href: "https://learn.microsoft.com/en-us/fabric/get-started/direct-lake-power-bi-desktop#considerations-and-limitations"
                }
              },
              {
                marker: "g.",
                text: "Direct Lake has a longer list of further considerations and limitations, and it changes over time.",
                link: {
                  label: "Direct Lake overview: considerations and limitations",
                  href: "https://learn.microsoft.com/en-us/fabric/get-started/direct-lake-overview#considerations-and-limitations"
                }
              }
            ]
          }
        ]
      },
      {
        num: "1.5",
        title: "Gateway and tools",
        items: [
          {
            q: "gateway",
            marker: "1.",
            title: "Use an on-premises data gateway instead of a Personal Gateway",
            text: "The standard gateway is managed centrally, can be shared by many people and also serves Direct Query and live connections. The personal mode only serves import and belongs to one person (applies when the source is on-premises)."
          },
          {
            marker: "2.",
            title: "Power BI Desktop updates",
            text: "Work with the latest version to avoid discrepancies with the live version or colleagues."
          }
        ]
      }
    ]
  },
  {
    id: "data-modeling",
    num: "2",
    title: "Data Modeling",
    icon: "modeling",
    subs: [
      {
        num: "2.1",
        title: "Schema",
        items: [
          {
            q: "schema-approach",
            marker: "1.",
            title: "Build a star schema",
            text: "Consider a star schema instead of a snowflake architecture where possible: it is optimal for tabular models. Avoid flat tables too."
          },
          {
            q: "galaxy-schema",
            marker: "2.",
            title: "Several stars, shared dimensions",
            text: "Prefer a galaxy schema (multiple stars) over one big star schema: this allows different granularity and is also optimal performance-wise."
          },
          {
            marker: "3.",
            title: "KPIs in columns",
            text: "KPIs should be in columns and not in rows: unlike other BI tools, Power BI performs best with KPIs in separate columns."
          },
          {
            q: "separate-report-model",
            marker: "4.",
            title: "Separate report and semantic model",
            text: "Do this if more than one report uses the model as a source."
          }
        ]
      },
      {
        num: "2.2",
        title: "Relationships",
        items: [
          {
            marker: "1.",
            title: "Prefer one-to-many",
            text: "Prioritize \"one-to-many\" over \"many-to-many\" relations to boost performance: bridge tables can help avoid many-to-many."
          },
          {
            q: "relationship-policy",
            marker: "2.",
            title: "One direction",
            text: "Filter in a single direction, also on many-to-many relationships."
          },
          {
            marker: "3.",
            title: "Check the exceptions",
            text: "Check that bi-directional and many-to-many relationships are valid: they can degrade performance or cause unintended consequences."
          },
          {
            marker: "4.",
            title: "Fix referential-integrity violations",
            text: "Ensure the 'to' table's primary-key column contains all values in the 'from' table's foreign-key column: violations also produce a 'blank' member in slicers."
          }
        ]
      },
      {
        num: "2.3",
        title: "Date and time",
        items: [
          {
            q: "has-date-dim",
            marker: "1.",
            title: "A date table in every model",
            text: "Models should have at least a date table to take advantage of features such as time intelligence and a properly structured architecture."
          },
          {
            q: "marked-date-table",
            marker: "2.",
            title: "Mark it as a date table",
            text: "Date / calendar tables should be marked as a date table."
          },
          {
            q: "auto-datetime",
            marker: "3.",
            title: "Switch off Auto Date/Time",
            text: "Disable Auto-Date/Time in Power BI Desktop settings and remove automatically created date tables to save memory."
          }
        ]
      },
      {
        num: "2.4",
        title: "Columns and keys",
        items: [
          {
            q: "hide-keys",
            marker: "1.",
            title: "Hide foreign keys",
            text: "Foreign keys should always be hidden."
          },
          {
            marker: "2.",
            title: "Hide fact-table columns",
            text: "Hide fact-table columns used for aggregation in measures."
          },
          {
            q: "mark-pk-key",
            marker: "3.",
            title: "Mark primary keys",
            text: "Set the 'Key' property to 'True' for primary-key columns."
          },
          {
            q: "remove-unused",
            marker: "4.",
            title: "Remove unnecessary columns",
            text: "Hidden columns not referenced by any DAX expression, relationship, hierarchy level or Sort-By property should be removed."
          },
          {
            q: "flags-format",
            marker: "5.",
            title: "Format flag columns as Yes/No",
            text: "Yes/No is easier to read than 0/1 integers."
          }
        ]
      },
      {
        num: "2.5",
        title: "Measures",
        items: [
          {
            marker: "1.",
            title: "Create explicit measures",
            text: "Do not rely on the automatic aggregation of a column."
          },
          {
            q: "empty-measure-table",
            marker: "2.",
            title: "Use measure tables as a container",
            text: "Keep measures in one container table, named \"{{measure-table-name}}\".",
            children: [
              {
                marker: "a.",
                text: "A measure table is theoretically not needed if all columns in the fact table are hidden (fully denormalized)."
              },
              {
                marker: "b.",
                text: "In all other cases, strongly create a measure table to store measures: also beneficial during development."
              },
              {
                marker: "c.",
                title: "Benefits",
                children: [
                  {
                    marker: "i.",
                    text: "Easily locate measures: shown on top, with a consistent name."
                  },
                  {
                    marker: "ii.",
                    text: "Measures from multiple fact tables can be grouped together (e.g. actual vs. plan)."
                  }
                ]
              }
            ]
          },
          {
            marker: "3.",
            title: "Use display folders",
            children: [
              {
                marker: "a.",
                text: "Use folders and sub-folders to group measures and other fields."
              },
              {
                marker: "b.",
                text: "Give folders and sub-folders meaningful names."
              },
              {
                marker: "c.",
                text: "Create folders via Model → select a measure → Properties → Display Folder. Reusing the same name groups measures together."
              }
            ]
          },
          {
            marker: "4.",
            title: "Remove unnecessary measures",
            text: "Hidden measures not referenced by any DAX expression should be removed for maintainability."
          }
        ]
      },
      {
        num: "2.6",
        title: "DAX",
        items: [
          {
            q: "dax-avoid",
            marker: "1.",
            title: "Use DIVIDE for division",
            text: "Use DIVIDE instead of the \"/\" operator: it resolves divide-by-zero cases and avoids errors."
          },
          {
            marker: "2.",
            title: "Use DAX variables",
            text: "Use VAR inside a DAX expression when you need to make references inside a function."
          },
          {
            marker: "3.",
            title: "Use SWITCH instead of nested IF",
            text: "SWITCH(TRUE(), …) is more efficient than nested IF/ELSE."
          },
          {
            marker: "4.",
            title: "Avoid IFERROR",
            text: "It may cause performance degradation. For divide-by-zero, use DIVIDE instead."
          },
          {
            marker: "5.",
            title: "Use TREATAS instead of INTERSECT",
            text: "TREATAS is more efficient for virtual relationships."
          }
        ]
      },
      {
        num: "2.7",
        title: "Formats",
        intro: "From the Tabular Style Guide.",
        items: [
          {
            q: "currency-format",
            marker: "1.",
            text: "Currency, no decimals ($32,000): \\$#,0;(\\$#,0);\\$#,0"
          },
          {
            q: "whole-decimals",
            marker: "2.",
            text: "Whole number, no decimals, commas (32,000): #,0. Add a decimal (#,0.0) only when required, never when counting (e.g. customers)."
          },
          {
            q: "percent-format",
            marker: "3.",
            text: "Percentage, one decimal, commas (3,200.1%): #,0.0%;-#,0.0%;#,0.0%. Use as few decimals as possible."
          }
        ]
      },
      {
        num: "2.8",
        title: "Security and performance",
        items: [
          {
            marker: "1.",
            title: "Secure data with RLS or OLS",
            text: "Row-level security restricts rows, object-level security restricts tables and columns; both are defined as roles. Hiding objects, private tables and perspectives are not security. Keep each user in one role: membership in several roles combines their filters, and a user in both an RLS and an OLS role gets errors."
          },
          {
            marker: "2.",
            title: "Check if dynamic RLS is necessary",
            text: "Dynamic row-level security adds memory and performance overhead: weigh the pros and cons."
          },
          {
            marker: "3.",
            title: "Consider aggregations with Direct Query",
            text: "When using Direct Query in Power BI Premium, aggregations can boost performance."
          }
        ]
      },
      {
        num: "2.9",
        title: "Reuse building blocks",
        intro: "Keep these in a shared snippet repository and add them with the TMDL view:",
        items: [
          {
            marker: "•",
            text: "Calendar table."
          },
          {
            q: "time-intel-cg",
            marker: "•",
            text: "Calculation groups (time-intelligence calc group, units calc group)."
          },
          {
            marker: "•",
            text: "Parameters."
          },
          {
            q: "last-refresh",
            marker: "•",
            text: "Footer: last-refresh timestamp; data-source parameter table and measure."
          },
          {
            q: "measure-descriptions",
            marker: "•",
            text: "Descriptions for all measures."
          },
          {
            marker: "•",
            text: "Detail-rows expressions for all display folders (groups of measures)."
          }
        ]
      },
      {
        num: "2.10",
        title: "Naming: the essentials",
        items: [
          {
            marker: "1.",
            text: "Use {{naming-casing}} for visible objects; table prefixes: {{dim-fact-prefix}}."
          },
          {
            marker: "2.",
            text: "Objects should not start or end with a space."
          },
          {
            marker: "3.",
            text: "Special characters in object names: {{special-chars}}."
          },
          {
            marker: "4.",
            text: "Reference qualification: {{reference-qualification}} (e.g. TableName[Column Name], [Measure Name])."
          },
          {
            marker: "5.",
            text: "Measure references should be unqualified, e.g. [Measure Name]."
          },
          {
            marker: "6.",
            text: "Provide descriptive business names for tables, columns and measures without overly short abbreviations."
          },
          {
            marker: "7.",
            title: "Use similar names for related measures",
            text: "e.g. Target Frequency, Target Coverage, …",
            children: [
              {
                marker: "a.",
                text: "AC, PY, PM, PL, YTD, MTD, ΔPY, ΔPY %, ΔPL, ΔPL %."
              },
              {
                marker: "b.",
                text: "avg. (avoid \"Ø\" in an international context)."
              },
              {
                marker: "c.",
                text: "mio, k (avoid \"billion\" in a German context)."
              }
            ]
          }
        ]
      },
      {
        num: "2.11",
        title: "Tabular Style Guide",
        intro: "A widely adopted naming and formatting standard for tabular models by Michael Kovalsky (Elegant BI). A model is part of the front end: people see its tables, columns and measures, so names and formats should be made for them. Many of these rules can be checked automatically with the Best Practice Analyzer. Where your organization decided differently, its answer is shown beside the rule.",
        link: {
          label: "elegantbi.com: Tabular Style Guide",
          href: "https://www.elegantbi.com/post/tabularstyleguide"
        },
        items: [
          {
            marker: "",
            title: "General rules (all objects)",
            children: [
              {
                q: "words-spaces",
                marker: "•",
                text: "Always separate words with spaces in all visible objects."
              },
              {
                q: "naming-casing",
                marker: "•",
                text: "Always use Title Case."
              },
              {
                marker: "•",
                text: "Avoid these characters: [ ] { } ' \" = & * : ; . / \\ # @ ! _ = ^."
              },
              {
                q: "reserved-words",
                marker: "•",
                title: "Avoid these words",
                children: [
                  {
                    marker: "•",
                    text: "Reserved words (Table, Measure, Column, KPI): except a Hierarchy called \"Hierarchy\"."
                  },
                  {
                    marker: "•",
                    text: "'Total': avoids subtotals/grand totals showing as 'Total Total…'."
                  },
                  {
                    marker: "•",
                    text: "'Is': avoids columns like 'IsActive' instead of 'Active Flag'."
                  },
                  {
                    marker: "•",
                    text: "'Amount', 'Value': often redundant (a measure 'Sales Amount' can just be 'Sales')."
                  },
                  {
                    marker: "•",
                    text: "'Name': sometimes permissible ('Customer Name'), but often superfluous ('Region Name' → 'Region')."
                  }
                ]
              }
            ]
          },
          {
            marker: "",
            title: "Tables",
            children: [
              {
                marker: "•",
                text: "Avoid the word 'Hierarchy' in table names."
              },
              {
                q: "db-type-prefixes",
                marker: "•",
                title: "Five table types",
                text: "Model name → database view name:",
                children: [
                  {
                    marker: "•",
                    text: "Fact: Revenue → FACT_Revenue."
                  },
                  {
                    marker: "•",
                    text: "Dimension: Geography → DIM_Geography."
                  },
                  {
                    marker: "•",
                    text: "Bridge: GeographyBridge → BRIDGE_Geography."
                  },
                  {
                    marker: "•",
                    text: "Security: UserGeography → SEC_UserGeography."
                  },
                  {
                    marker: "•",
                    text: "Metadata: Data Dictionary → META_DataDictionary."
                  },
                  {
                    marker: "•",
                    text: "Note: GeographyBridge & UserGeography have no spaces: permissible since they are hidden."
                  }
                ]
              },
              {
                marker: "•",
                title: "Hidden and private tables",
                text: "Hidden tables can be completely removed from the semantic model with the \"private\" property in Tabular Editor. This must not be used to secure tables: IntelliSense will not work for them, but users could still write measures against them. Use it for bridge or user-role tables, never for hidden fact tables (which should stay non-private to allow report-specific measures)."
              }
            ]
          },
          {
            marker: "",
            title: "Calendar dimension",
            children: [
              {
                marker: "•",
                text: "Always mark as a date table."
              },
              {
                q: "date-key-format",
                marker: "•",
                text: "Primary key (DateId) must be INTEGER datatype in YYYYMMDD format."
              },
              {
                marker: "•",
                text: "Always split date and time (Calendar granularity is 'Day'; Time is more granular, e.g. hour or minute)."
              }
            ]
          },
          {
            marker: "",
            title: "Partitions and views",
            children: [
              {
                marker: "•",
                title: "Single-partitioned tables must have the same partition name as the table name",
                children: [
                  {
                    marker: "•",
                    text: "Always use simple views (SELECT * FROM [Schema].[View]). Views decouple the database layer from the model, allow quick changes, let multiple models query the same table, and make development much faster: especially in Tabular Editor."
                  },
                  {
                    marker: "•",
                    text: "Views should have no logic: all logic belongs in stored procedures / the database layer."
                  },
                  {
                    marker: "•",
                    text: "View schema should be the model name (abbreviated) appended by 'View' (e.g. WWIView for the Worldwide Importers model)."
                  }
                ]
              },
              {
                marker: "•",
                title: "Multi-partitioned tables must have partition names that start with the table name",
                children: [
                  {
                    marker: "•",
                    text: "Examples (Table = Revenue): Revenue FY19, Revenue FY20; Revenue FY19-Q1, Revenue FY19-Q2; Revenue FY19-M01, Revenue FY19-M02."
                  },
                  {
                    marker: "•",
                    text: "Partition in the database layer too: this enables parallel creation (saving time) and easy SELECT * querying, or call a stored procedure with a parameter filter."
                  }
                ]
              }
            ]
          },
          {
            marker: "",
            title: "Columns",
            children: [
              {
                marker: "•",
                title: "Flags",
                children: [
                  {
                    marker: "•",
                    text: "Must be STRING datatype."
                  },
                  {
                    marker: "•",
                    text: "Valid values: Yes, No, N/A, Unknown."
                  },
                  {
                    marker: "•",
                    text: "Never use 0/1 or Y/N."
                  },
                  {
                    marker: "•",
                    text: "Must be specified as a flag (e.g. 'Active Flag')."
                  }
                ]
              },
              {
                q: "pk-format",
                marker: "•",
                title: "Primary keys",
                children: [
                  {
                    marker: "•",
                    text: "INTEGER datatype, end in 'ID', Key = True in properties, generally hidden unless needed by the end user."
                  }
                ]
              },
              {
                marker: "•",
                title: "Foreign keys",
                children: [
                  {
                    marker: "•",
                    text: "INTEGER datatype, end in 'ID', always hidden, match the name of the corresponding primary key."
                  }
                ]
              },
              {
                q: "sortby-columns",
                marker: "•",
                title: "Sort-by columns",
                text: "INTEGER datatype, must be hidden."
              },
              {
                marker: "•",
                title: "Aggregatable columns",
                text: "INTEGER, CURRENCY or DECIMAL; hidden, with a measure created from the column; no spaces in the column name."
              },
              {
                q: "nonagg-summarize",
                marker: "•",
                title: "Non-aggregatable integer columns",
                text: "Set 'Summarize By' to 'None' / 'Do Not Summarize' so they are never accidentally aggregated."
              },
              {
                marker: "•",
                text: "Columns in the database layer (incl. views) should have no spaces: spaces are added in the model's 'Name' property."
              },
              {
                marker: "•",
                title: "References",
                text: "Columns referenced by measures should always be prefixed with the table name."
              },
              {
                marker: "•",
                text: "Dimension-table primary keys should contain all values in each related fact table's foreign keys: no blank members."
              },
              {
                q: "weburl-category",
                marker: "•",
                text: "Specify URLs / hyperlinks as Data Category = WebURL in the column properties."
              }
            ]
          },
          {
            marker: "",
            title: "Measures",
            children: [
              {
                marker: "•",
                title: "Naming",
                children: [
                  {
                    marker: "•",
                    text: "Descriptive but as brief as possible."
                  },
                  {
                    marker: "•",
                    text: "Prefixes: Avg; any product information (e.g. Azure …)."
                  },
                  {
                    q: "measure-suffixes",
                    marker: "•",
                    text: "Suffixes: YoY, QoQ, MoM, YTD, QTD, MTD, PY, PQ, PM, TTM, VTB, VTF; YoY %, QoQ %, MoM %. The % sign always goes at the end."
                  },
                  {
                    marker: "•",
                    text: "Examples: Billed Revenue · Billed Revenue PM · Billed Revenue MoM % · Billed Revenue YoY · Billed Revenue YTD PY · Billed Revenue YTD YoY % · Azure Billed Revenue Customer Count TTM."
                  }
                ]
              },
              {
                marker: "•",
                title: "References",
                text: "Measures referenced by other measures should never be prefixed with the table name."
              },
              {
                marker: "•",
                title: "Abbreviation key",
                text: "YoY = Year-over-Year · QoQ = Quarter-over-Quarter · MoM = Month-over-Month · YTD/QTD/MTD = Year/Quarter/Month-to-Date · PY/PQ/PM = Previous Year/Quarter/Month · TTM = Trailing 12 months · VTB = Variance-to-Budget · VTF = Variance-to-Forecast."
              },
              {
                marker: "•",
                text: "Instead of PY for previous year, Y-1 is also valid: important if Y-2 is a relevant KPI for the business context."
              },
              {
                marker: "•",
                text: "For target/budget numbers, \"PL\" is often preferred over BUD (BU could be confused with Business Unit, and a 3-letter BUD is not optimal when PY is only 2 letters)."
              }
            ]
          },
          {
            marker: "",
            title: "Hierarchies",
            children: [
              {
                marker: "•",
                text: "Must be suffixed with the word 'Hierarchy' (e.g. 'Geography Hierarchy')."
              },
              {
                marker: "•",
                text: "Attributes of the hierarchy must use the same names as their respective columns outside the hierarchy."
              },
              {
                marker: "•",
                text: "The order must correspond to the natural order of the hierarchy (granularity / drill-down)."
              },
              {
                marker: "•",
                text: "This facilitates easier working with external tools such as Tabular Editor."
              }
            ]
          },
          {
            marker: "",
            title: "Display folders",
            children: [
              {
                marker: "•",
                text: "Folders may be used to group two or more measures/columns within the same table."
              },
              {
                marker: "•",
                text: "If using a multi-folder (drill) approach, structure it the way your users categorize those measures/columns."
              }
            ]
          },
          {
            marker: "",
            title: "Relationships, data sources and perspectives",
            children: [
              {
                marker: "•",
                title: "Relationships",
                text: "Named automatically: no naming standards required."
              },
              {
                marker: "•",
                title: "Data sources",
                text: "Three components: Provider, Data Source, Initial Catalog (e.g. \"SqlServer ServerName DatabaseName\")."
              },
              {
                marker: "•",
                title: "Perspectives",
                text: "No additional standards beyond the General Rules."
              }
            ]
          }
        ]
      }
    ]
  },
  {
    id: "data-visualization",
    num: "3",
    title: "Data Visualization",
    icon: "report",
    subs: [
      {
        num: "3.1",
        title: "Page and layout",
        items: [
          {
            marker: "1.",
            title: "3-layer concept",
            text: "Structure the report in two, or better three, layers:",
            children: [
              {
                marker: "a.",
                text: "Overview: all KPIs as tiles or cards, or better, one table with percentage deviations to targets."
              },
              {
                marker: "b.",
                text: "Analysis: individual KPI (group) with visualization."
              },
              {
                marker: "c.",
                text: "Details: tables or small multiples."
              }
            ]
          },
          {
            marker: "2.",
            title: "Use the 3-line title concept (top-left of every page)",
            text: "Make it dynamic with SELECTEDVALUE where possible.",
            children: [
              {
                marker: "a.",
                text: "Company + Division."
              },
              {
                marker: "b.",
                text: "KPIs in bold, with units and currency."
              },
              {
                marker: "c.",
                text: "Time period."
              }
            ]
          },
          {
            marker: "3.",
            title: "Use one page size for all reports: {{page-size}}",
            text: "A larger 16:9 page keeps the aspect ratio of the default and has more pixels to work with.",
            children: [
              {
                marker: "a.",
                text: "No disadvantage: the report can look almost identical; the default theme uses a bigger font size to adjust."
              },
              {
                marker: "b.",
                text: "Only advantages: visuals can optionally be made a bit smaller for higher information density without losing clarity."
              }
            ]
          },
          {
            marker: "4.",
            text: "Use the template and design theme with a baked-in background. Don't build the background within Power BI from shapes and individual elements."
          },
          {
            marker: "5.",
            title: "Avoid scrolling pages",
            text: "Use a multi-page navigation concept; for visual scrolls, consolidate smaller segments into \"Others\"."
          }
        ]
      },
      {
        num: "3.2",
        title: "Filters and navigation",
        items: [
          {
            q: "filter-strategy",
            marker: "1.",
            title: "Use the Filter Pane instead of report slicers",
            children: [
              {
                marker: "a.",
                text: "Exception: slicers critical to showing the correct information. They should behave like a visual title or be tightly integrated (e.g. field parameters in a transparent slicer over cards)."
              },
              {
                marker: "b.",
                text: "Use slicers sparingly: too many slicers drastically slow performance."
              }
            ]
          },
          {
            marker: "2.",
            text: "Use \"in-report\" navigation instead of the built-in navigation."
          },
          {
            marker: "3.",
            title: "Avoid Power BI bookmarks for report functionality",
            children: [
              {
                marker: "a.",
                text: "Use page navigation."
              },
              {
                q: "reduce-measures",
                marker: "b.",
                text: "Use field parameters for KPIs / attributes."
              }
            ]
          },
          {
            marker: "4.",
            text: "Use cross-filtering instead of cross-highlighting."
          },
          {
            marker: "5.",
            title: "Use tooltips",
            text: "Report tooltips share additional information in a limited space and increase information density."
          },
          {
            marker: "6.",
            title: "Remove unnecessary interactions between visuals",
            text: "This reduces the number of queries fired at the back end and improves performance."
          }
        ]
      },
      {
        num: "3.3",
        title: "Charts and color",
        intro: "Increase the efficiency and effectiveness of reports through consistent visual patterns.",
        items: [
          {
            q: "ibcs",
            marker: "1.",
            title: "Focus on deviations",
            text: "To plan, previous time period and/or forecast."
          },
          {
            marker: "2.",
            title: "Orientation of charts",
            children: [
              {
                marker: "a.",
                title: "Structure → horizontal charts",
                children: [
                  {
                    marker: "i.",
                    text: "Horizontal bar charts (not column charts) with multiple tiers."
                  },
                  {
                    marker: "ii.",
                    text: "Tables."
                  }
                ]
              },
              {
                marker: "b.",
                title: "Time → vertical charts",
                children: [
                  {
                    marker: "i.",
                    text: "Vertical column charts (with in-line variances)."
                  },
                  {
                    marker: "ii.",
                    text: "Line charts."
                  }
                ]
              }
            ]
          },
          {
            marker: "3.",
            title: "Patterns of bars",
            children: [
              {
                marker: "a.",
                text: "Outlined bar: plan values = PL."
              },
              {
                marker: "b.",
                text: "Lighter filled color: previous-year values = PY."
              },
              {
                marker: "c.",
                text: "Filled color: actual values = AC."
              }
            ]
          },
          {
            marker: "4.",
            title: "Colors should mean something",
            children: [
              {
                marker: "a.",
                text: "Use color purposefully."
              },
              {
                marker: "b.",
                text: "Reserve red and green for deviations, and color by impact, not by sign: a cost that rose against the previous year is red."
              }
            ]
          },
          {
            marker: "5.",
            title: "Avoid low information-density visuals",
            text: "Especially pie charts and gauges, but also donut charts, treemaps, mekko, bullet charts and area-filled maps (if a map is really needed, use \"proportional pie charts\" on it instead)."
          },
          {
            marker: "6.",
            title: "Use the \"new card\"",
            children: [
              {
                marker: "a.",
                text: "One visual instead of many individual old cards."
              },
              {
                marker: "b.",
                text: "Avoid \"big numbers\": add reference labels, better sparklines."
              }
            ]
          },
          {
            marker: "7.",
            title: "Test custom-visual performance before use",
            text: "Uncertified custom visuals are not tested by the Power BI team: test them in Desktop and the cloud."
          }
        ]
      }
    ]
  }
];
