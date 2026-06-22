// GuidelinesTab — a polished, in-app rendering of the Power BI Guidelines.
//
// Content adapted from the internal "Power BI Guidelines" document covering
// data integration, data modeling, report design and maintenance best
// practices. Rendered as a self-contained, scrollable reference surface with
// a table of contents, numbered sections and nested checklists — styled with
// Fluent UI v9 tokens so it matches the rest of the Power BI Fixer shell.

import { useCallback, useEffect, useState, Fragment } from 'react';
import {
  makeStyles,
  shorthands,
  tokens,
  Title2,
  Title3,
  Subtitle1,
  Subtitle2,
  Body1,
  Body1Strong,
  Link,
  Divider,
} from '@fluentui/react-components';
import {
  DatabaseLink20Regular,
  DataTrending20Regular,
  DocumentBulletList20Regular,
  Wrench20Regular,
  Ruler20Regular,
  Open16Regular,
} from '@fluentui/react-icons';
import type { ReactElement, ReactNode } from 'react';
import { GuidelinesQuestionnaire } from './GuidelinesQuestionnaire';
import {
  loadGuidelineAnswers,
  teamAnswer,
  defaultPlaceholder,
  GUIDELINES_STORAGE_KEY,
  GUIDELINES_ANSWERS_EVENT,
  type Answer,
} from './guidelinesQuestions';

// ---------------------------------------------------------------------------
// Content model
// ---------------------------------------------------------------------------

type GuideItem = {
  /** Leading marker, e.g. "1.", "a.", "•". Optional. */
  marker?: string;
  /** Bolded lead-in phrase. Optional. */
  title?: string;
  /** Body text following the title. Optional. */
  text?: ReactNode;
  /** Nested sub-items. */
  children?: GuideItem[];
};

type GuideSub = {
  num: string;
  title: string;
  intro?: ReactNode;
  items: GuideItem[];
};

type GuideSection = {
  id: string;
  num: string;
  title: string;
  icon: ReactElement;
  subs: GuideSub[];
};

const learn = (label: string, href: string) => (
  <Link href={href} target="_blank" rel="noopener noreferrer">
    {label} <Open16Regular />
  </Link>
);

const SECTIONS: GuideSection[] = [
  {
    id: 'data-integration',
    num: '1',
    title: 'Data Integration & Power Query',
    icon: <DatabaseLink20Regular />,
    subs: [
      {
        num: '1.1',
        title: 'Data Connections',
        items: [
          { marker: '•', title: 'Import' },
          { marker: '•', title: 'Direct Query' },
          { marker: '•', title: 'Direct Lake' },
        ],
      },
      {
        num: '1.2',
        title: 'Import mode',
        items: [
          { marker: 'a.', text: 'Remove the unnecessary rows and columns from source data.' },
          {
            marker: 'b.',
            text: 'Use views as the source of data — any changes to the underlying tables will then not impact the existing report.',
          },
          { marker: 'c.', text: 'Make sure the data types are optimized.' },
          {
            marker: 'd.',
            text: 'Split DateTime columns into two columns (one for Date, one for Time) for better model performance and easier use.',
          },
        ],
      },
      {
        num: '1.3',
        title: 'Direct Lake connection type',
        intro: 'Choose Direct Lake when:',
        items: [
          { marker: '•', text: 'Real-time data refresh is important.' },
          {
            marker: '•',
            text: 'Super-large data models have a big "cost impact", or models are only refreshable via incremental refresh / partitions.',
          },
          {
            marker: '',
            title: 'Considerations & limitations',
            children: [
              { marker: 'a.', text: 'Setup is slightly more complex.' },
              { marker: 'b.', text: 'Not all data sources are supported.' },
              { marker: 'c.', text: '"Auxiliary tables" can only be added via lakehouse + shortcut to the Power BI warehouse.' },
              { marker: 'd.', text: 'Calculated tables and calculated columns are not possible.' },
              {
                marker: 'e.',
                text: 'Field parameters are only possible via Tabular Editor, and not as easy to implement there (this functionality was used heavily in the Celonis report).',
              },
              {
                marker: 'f.',
                text: (
                  <>
                    Designing data models in Power BI Desktop is currently in preview with many
                    limitations — use the Power BI Service instead:{' '}
                    {learn(
                      'Direct Lake in Power BI Desktop — considerations & limitations',
                      'https://learn.microsoft.com/en-us/fabric/get-started/direct-lake-power-bi-desktop#considerations-and-limitations'
                    )}
                  </>
                ),
              },
              {
                marker: 'g.',
                text: (
                  <>
                    There is a long list of further considerations / limitations (at least
                    currently) with Direct Lake:{' '}
                    {learn(
                      'Direct Lake overview — considerations & limitations',
                      'https://learn.microsoft.com/en-us/fabric/get-started/direct-lake-overview#considerations-and-limitations'
                    )}
                  </>
                ),
              },
            ],
          },
        ],
      },
      {
        num: '1.4',
        title: 'Other Best Practices',
        items: [
          {
            marker: '1.',
            title: 'Minimize Power Query transformations',
            text: 'Offload transformations to the data warehouse where possible to improve model processing performance, and check whether query folding is occurring within your model.',
          },
          {
            marker: '2.',
            title: 'Split date and time',
            text: 'For datetime columns whose values are not at midnight, split the time element from the date element (or round the time to midnight) to reduce column cardinality.',
          },
          {
            marker: '3.',
            title: 'Reduce long-length, high-cardinality columns',
            text: 'Avoid lengthy text columns (more than 100 characters), especially with many unique values — they cause longer processing times, bloated model sizes and slower user queries.',
          },
          {
            marker: '4.',
            title: 'Reduce data volume',
            text: 'Avoid loading rows or columns that are not necessary to answer the questions the report is meant to address.',
          },
          {
            marker: '5.',
            title: 'Remove redundant columns in related tables',
            text: 'If only one is needed, delete the others from the model.',
          },
          {
            marker: '6.',
            title: 'Remove unused sources',
            text: 'Remove sources that are not used or referenced in the report.',
          },
        ],
      },
    ],
  },
  {
    id: 'data-modeling',
    num: '2',
    title: 'Data Modeling',
    icon: <DataTrending20Regular />,
    subs: [
      {
        num: '2.1',
        title: 'General Data Modeling',
        items: [
          {
            marker: '1.',
            title: 'Separate report and semantic model',
            text: 'Do this if more than one report uses the model as a source (see the appendix for details).',
          },
          {
            marker: '2.',
            title: 'Calendar table',
            children: [
              { marker: 'a.', text: 'Models should have at least a date table to take advantage of features such as time intelligence and a properly structured architecture.' },
              { marker: 'b.', text: 'Date / calendar tables should be marked as a date table.' },
              { marker: 'c.', text: 'Disable Auto-Date/Time in Power BI Desktop settings and remove automatically created date tables to save memory.' },
            ],
          },
          { marker: '3.', title: 'Create explicit measures.' },
          {
            marker: '4.',
            title: 'Avoid calculated columns and Power Query transformations',
            text: 'These should be done in the backend.',
            children: [
              { marker: 'a.', text: 'Reduce the number of calculated columns — they do not compress as well as data columns, use more memory and slow processing. Offload the logic to the warehouse.' },
              { marker: 'b.', text: 'Reduce the usage of calculated tables — migrate the logic to the warehouse to avoid technical debt and misalignment across models.' },
            ],
          },
          { marker: '5.', title: 'Remove unnecessary columns', text: 'Hidden columns not referenced by any DAX expression, relationship, hierarchy level or Sort-By property should be removed.' },
          { marker: '6.', title: 'Remove unnecessary measures', text: 'Hidden measures not referenced by any DAX expression should be removed for maintainability.' },
          {
            marker: '7.',
            title: '"Star Schema All The Things"',
            children: [
              { marker: 'a.', text: 'Consider a star schema instead of a snowflake architecture where possible — it is optimal for tabular models. Avoid flat tables too.' },
              { marker: 'b.', text: 'KPIs should be in columns and not in rows — unlike other BI tools, Power BI performs best with KPIs in separate columns.' },
              { marker: 'c.', text: 'Prefer a galaxy schema (multiple stars) over one big star schema — this allows different granularity and is also optimal performance-wise.' },
            ],
          },
          {
            marker: '8.',
            title: 'Relationships',
            children: [
              { marker: 'a.', text: 'Prioritize "one-to-many" over "many-to-many" relations to boost performance — bridge tables can help avoid many-to-many.' },
              { marker: 'b.', text: 'Many-to-many relationships should be made in a single direction.' },
              { marker: 'c.', text: 'Check that bi-directional and many-to-many relationships are valid — they can degrade performance or cause unintended consequences.' },
            ],
          },
          {
            marker: '9.',
            title: 'Use the internal repository together with the TMDL View for',
            children: [
              { marker: 'a.', text: 'Calendar table.' },
              { marker: 'b.', text: 'Calculation groups (time-intelligence calc group, units calc group).' },
              { marker: 'c.', text: 'Parameters.' },
              { marker: 'd.', text: 'Footer: last-refresh timestamp; data-source parameter table and measure.' },
              { marker: 'e.', text: 'Adding descriptions to all measures with the TMDL View.' },
              { marker: 'f.', text: 'Adding detail-rows expressions to all display folders (groups of measures) with the TMDL View.' },
            ],
          },
        ],
      },
      {
        num: '2.2',
        title: 'DAX — Data Analysis Expressions',
        items: [
          { marker: '1.', title: 'Use DIVIDE for division', text: 'Use DIVIDE instead of the "/" operator — it resolves divide-by-zero cases and avoids errors.' },
          { marker: '2.', title: 'Use DAX variables', text: 'Use VAR inside a DAX expression when you need to make references inside a function.' },
          { marker: '3.', title: 'Use SWITCH instead of nested IF', text: 'SWITCH(TRUE(), …) is more efficient than nested IF/ELSE.' },
          { marker: '4.', title: 'Avoid IFERROR', text: 'It may cause performance degradation. For divide-by-zero, use DIVIDE instead.' },
          { marker: '5.', title: 'Use TREATAS instead of INTERSECT', text: 'TREATAS is more efficient for virtual relationships.' },
          { marker: '6.', title: 'Reduce calculated columns that use RELATED', text: 'Calculated columns do not compress well and slow processing — avoid them where possible.' },
        ],
      },
      {
        num: '2.3',
        title: 'Organization of Measures',
        items: [
          {
            marker: '1.',
            title: 'Use measure tables as a container',
            text: 'Use the measure container table named "{{measure-table-name}}" (singular, not "Measures").',
            children: [
              { marker: 'a.', text: 'A measure table is theoretically not needed if all columns in the fact table are hidden (fully denormalized).' },
              { marker: 'b.', text: 'In all other cases, strongly create a measure table to store measures — also beneficial during development.' },
              {
                marker: 'c.',
                title: 'Benefits',
                children: [
                  { marker: 'i.', text: 'Easily locate measures — shown on top, with a consistent name.' },
                  { marker: 'ii.', text: 'Measures from multiple fact tables can be grouped together (e.g. actual vs. plan).' },
                ],
              },
            ],
          },
          {
            marker: '2.',
            title: 'Use display folders',
            children: [
              { marker: 'a.', text: 'Use folders and sub-folders to group measures and other fields.' },
              { marker: 'b.', text: 'Give folders and sub-folders meaningful names.' },
              { marker: 'c.', text: 'Create folders via Model → select a measure → Properties → Display Folder. Reusing the same name groups measures together.' },
            ],
          },
        ],
      },
      {
        num: '2.4',
        title: 'Extended Properties of Columns',
        items: [
          { marker: '1.', title: 'Hide foreign keys', text: 'Foreign keys should always be hidden.' },
          { marker: '2.', title: 'Hide fact-table columns', text: 'Hide fact-table columns used for aggregation in measures.' },
          { marker: '3.', title: 'Mark primary keys', text: "Set the 'Key' property to 'True' for primary-key columns." },
          { marker: '4.', title: 'Format flag columns as Yes/No', text: 'Yes/No is easier to read than 0/1 integers.' },
        ],
      },
      {
        num: '2.5',
        title: 'Naming Conventions',
        items: [
          { marker: '1.', text: 'Use {{naming-casing}} for visible objects; table prefixes: {{dim-fact-prefix}}.' },
          { marker: '2.', text: 'Objects should not start or end with a space.' },
          { marker: '3.', text: 'Special characters in object names: {{special-chars}}.' },
          { marker: '4.', text: 'Reference qualification: {{reference-qualification}} (e.g. TableName[Column Name], [Measure Name]).' },
          { marker: '5.', text: 'Measure references should be unqualified, e.g. [Measure Name].' },
          { marker: '6.', text: 'Provide descriptive business names for tables, columns and measures without overly short abbreviations.' },
          {
            marker: '7.',
            title: 'Use similar names for related measures',
            text: 'e.g. Target Frequency, Target Coverage, …',
            children: [
              { marker: 'a.', text: 'AC, PY, PM, PL, YTD, MTD, ΔPY, ΔPY %, ΔPL, ΔPL %.' },
              { marker: 'b.', text: 'avg. (avoid "Ø" in an international context).' },
              { marker: 'c.', text: 'mio, k (avoid "billion" in a German context).' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'report-design',
    num: '3',
    title: 'Report Design',
    icon: <DocumentBulletList20Regular />,
    subs: [
      {
        num: '3.1',
        title: 'General Recommendations',
        items: [
          { marker: '1.', text: "Use the template and design theme with a baked-in background. Don't build the background within Power BI from shapes and individual elements." },
          {
            marker: '2.',
            title: 'Use the 3-line title concept (top-left of every page)',
            text: 'Make it dynamic with SELECTEDVALUE where possible.',
            children: [
              { marker: 'a.', text: 'Company + Division.' },
              { marker: 'b.', text: 'KPIs in bold, with units and currency.' },
              { marker: 'c.', text: 'Time period.' },
            ],
          },
          {
            marker: '3.',
            title: 'Use the Filter Pane instead of report slicers',
            children: [
              { marker: 'a.', text: 'Exception: slicers critical to showing the correct information — they should behave like a visual title or be tightly integrated (e.g. field parameters in a transparent slicer over cards).' },
              { marker: 'b.', text: 'Use slicers sparingly — too many slicers drastically slow performance.' },
            ],
          },
          { marker: '4.', text: 'Use "in-report" navigation instead of the built-in navigation.' },
          {
            marker: '5.',
            title: '3-layer concept',
            text: 'Structure the report in two — better three — layers:',
            children: [
              { marker: 'a.', text: 'Overview: all KPIs as tiles/cards (the "Netflix" principle) or, better, one big table with percentage deviations to targets.' },
              { marker: 'b.', text: 'Analysis: individual KPI (group) with visualization.' },
              { marker: 'c.', text: 'Details: tables or small multiples.' },
            ],
          },
          {
            marker: '6.',
            title: 'Avoid Power BI bookmarks for report functionality',
            children: [
              { marker: 'a.', text: 'Use page navigation.' },
              { marker: 'b.', text: 'Use field parameters for KPIs / attributes.' },
            ],
          },
          { marker: '7.', text: 'Use cross-filtering instead of cross-highlighting.' },
          {
            marker: '8.',
            title: 'Use a custom 1080×1920 page size',
            text: 'Instead of the default 16:9, keep the same aspect ratio but increase the pixel count.',
            children: [
              { marker: 'a.', text: 'No disadvantage: the report can look almost identical; the default theme uses a bigger font size to adjust.' },
              { marker: 'b.', text: 'Only advantages: visuals can optionally be made a bit smaller for higher information density without losing clarity.' },
            ],
          },
          { marker: '9.', title: 'Use tooltips', text: 'Report tooltips share additional information in a limited space and increase information density.' },
          { marker: '10.', title: 'Avoid scrolling pages', text: 'Use a multi-page navigation concept; for visual scrolls, consolidate smaller segments into "Others".' },
          { marker: '11.', title: 'Test custom-visual performance before use', text: 'Uncertified custom visuals are not tested by the Power BI team — test them in Desktop and the cloud.' },
          { marker: '12.', title: 'Remove unnecessary interactions between visuals', text: 'This reduces the number of queries fired at the back end and improves performance.' },
        ],
      },
      {
        num: '3.2',
        title: 'Report Visualization — Pattern Recognition',
        intro: 'Increase the efficiency and effectiveness of reports through consistent visual patterns.',
        items: [
          {
            marker: '1.',
            title: 'Orientation of charts',
            children: [
              {
                marker: 'a.',
                title: 'Structure → horizontal charts',
                children: [
                  { marker: 'i.', text: 'Horizontal bar charts (not column charts) with multiple tiers.' },
                  { marker: 'ii.', text: 'Tables.' },
                ],
              },
              {
                marker: 'b.',
                title: 'Time → vertical charts',
                children: [
                  { marker: 'i.', text: 'Vertical column charts (with in-line variances).' },
                  { marker: 'ii.', text: 'Line charts.' },
                ],
              },
            ],
          },
          { marker: '2.', title: 'Focus on deviations', text: 'To plan, previous time period and/or forecast.' },
          {
            marker: '3.',
            title: 'Patterns of bars',
            children: [
              { marker: 'a.', text: 'Filled color: actual values = AC.' },
              { marker: 'b.', text: 'Lighter filled color: previous-year values = PY.' },
              { marker: 'c.', text: 'Outlined bar: plan values = PL.' },
            ],
          },
          {
            marker: '4.',
            title: 'Avoid low information-density visuals',
            text: 'Especially pie charts and gauges, but also donut charts, treemaps, mekko, bullet charts and area-filled maps (if a map is really needed, use "proportional pie charts" on it instead).',
          },
          {
            marker: '5.',
            title: 'Use the "new card"',
            children: [
              { marker: 'a.', text: 'One visual instead of many individual old cards.' },
              { marker: 'b.', text: 'Avoid "big numbers" — add reference labels, better sparklines.' },
            ],
          },
          {
            marker: '6.',
            title: 'Colors should mean something',
            children: [
              { marker: 'a.', text: 'Use color purposefully.' },
              { marker: 'b.', text: 'Reserve red and green for deviations: positive and negative impact (e.g. increased cost vs. previous year is green).' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'other',
    num: '4',
    title: 'Other',
    icon: <Wrench20Regular />,
    subs: [
      {
        num: '4.1',
        title: 'Maintenance',
        items: [
          { marker: '1.', title: 'Power BI Desktop updates', text: 'Work with the latest version to avoid discrepancies with the live version or colleagues.' },
          { marker: '2.', title: 'Fix referential-integrity violations', text: "Ensure the 'to' table's primary-key column contains all values in the 'from' table's foreign-key column — violations also produce a 'blank' member in slicers." },
          { marker: '3.', title: 'Use an on-premises data gateway instead of a Personal Gateway', text: 'The Enterprise Gateway imports nothing, is more efficient with large databases and lets more people update the report (applies when the source is on-premises).' },
        ],
      },
      {
        num: '4.2',
        title: 'Performance',
        items: [
          { marker: '1.', title: 'Consider aggregations with Direct Query', text: 'When using Direct Query in Power BI Premium, aggregations can boost performance.' },
          { marker: '2.', title: 'Check if dynamic RLS is necessary', text: 'Dynamic row-level security adds memory and performance overhead — weigh the pros and cons.' },
        ],
      },
      {
        num: '4.3',
        title: 'Appendix — Detailed Naming & Modeling Conventions',
        items: [
          {
            marker: '',
            title: 'Visible objects',
            children: [
              { marker: '•', text: 'Words in visible objects separated by spaces: {{words-spaces}}.' },
              { marker: '•', text: 'Casing for all visible objects: {{naming-casing}}.' },
              { marker: '•', text: 'Prohibited characters: [ ] { } \' " = & * : ; . / \\ # @ ! _ = ^.' },
              {
                marker: '•',
                title: 'Restricted words',
                children: [
                  { marker: '–', text: "Reserved words like Table, Measure, Column, KPI (except 'Hierarchy' in hierarchies)." },
                  { marker: '–', text: "'Total' to avoid redundancy in totals." },
                  { marker: '–', text: "'Is' to promote clarity in column names." },
                  { marker: '–', text: "'Amount', 'Value' for being often redundant." },
                  { marker: '–', text: "'Name' unless necessary, like in 'Customer Name'." },
                  { marker: '–', text: "Avoid using 'Hierarchy' in table names." },
                ],
              },
            ],
          },
          {
            marker: '',
            title: 'Calendar dimension',
            children: [
              { marker: '•', text: 'Must be marked as a date table.' },
              { marker: '•', text: 'Primary key (DateId) should be INTEGER in YYYYMMDD format.' },
              { marker: '•', text: "Date and time must be split, with Calendar granularity at 'Day' and Time more granular." },
            ],
          },
          {
            marker: '',
            title: 'Table-type naming conventions',
            children: [
              { marker: '•', text: 'Fact table (e.g. Revenue in model, FACT_Revenue in database).' },
              { marker: '•', text: 'Dimension table (e.g. Geography in model, DIM_Geography in database).' },
              { marker: '•', text: 'Bridge table (e.g. GeographyBridge in model, BRIDGE_Geography in database).' },
              { marker: '•', text: 'Security table (e.g. UserGeography in model, SEC_UserGeography in database).' },
              { marker: '•', text: 'Metadata table (e.g. Data Dictionary in model, META_DataDictionary in database).' },
              { marker: '•', text: 'Note the absence of spaces in GeographyBridge and UserGeography.' },
            ],
          },
          {
            marker: '',
            title: 'Hidden & private tables',
            children: [
              { marker: '•', text: 'Hidden tables can be completely removed from the semantic model with the "private" property in Tabular Editor. This must not be used to secure tables — IntelliSense will not work for them, but users could still write measures against them. Use it for bridge or user-role tables, never for hidden fact tables (which should stay non-private to allow report-specific measures).' },
            ],
          },
          {
            marker: '',
            title: 'Partitions & views',
            children: [
              { marker: '•', text: 'Single-partitioned tables should have the same name for partition and table.' },
              { marker: '•', text: 'Use simple views for quick development and flexibility.' },
              { marker: '•', text: 'Views must have no logic — logic should reside in stored procedures.' },
              { marker: '•', text: "View schema should include the model name followed by 'View'." },
              { marker: '•', text: 'Multi-partitioned tables must begin partition names with the table name (e.g. Revenue FY19, Revenue FY19-Q1, Revenue FY19-M01).' },
              { marker: '•', text: 'Partitioning should be done in the database layer for efficiency and query simplification.' },
            ],
          },
          {
            marker: '',
            title: 'Column data types & properties',
            children: [
              { marker: '•', text: 'Flags must be STRING datatype with values like Yes, No, N/A, Unknown.' },
              { marker: '•', text: "Primary keys should be INTEGER, end in 'ID', be marked as Key and generally hidden." },
              { marker: '•', text: "Foreign keys must also be INTEGER, end in 'ID', be hidden and match primary-key names." },
              { marker: '•', text: 'Sort-by columns require INTEGER datatype and should be hidden.' },
              { marker: '•', text: 'Aggregatable columns should be INTEGER, CURRENCY or DECIMAL, hidden, and create a measure.' },
              { marker: '•', text: "Non-aggregable integer columns should be marked as 'None' or 'Do Not Summarize'." },
              { marker: '•', text: 'Columns in the database layer should not have spaces — spaces are added in the model.' },
              { marker: '•', text: 'Dimension-table primary keys should align with fact-table foreign keys, avoiding blanks.' },
              { marker: '•', text: 'Specify URLs as WebURL in column properties.' },
              { marker: '•', text: 'Apply formatting rules for currency, whole numbers and percentages.' },
            ],
          },
          {
            marker: '',
            title: 'Measure naming',
            children: [
              { marker: '•', text: 'Brief and descriptive.' },
              { marker: '•', text: 'Prefixes like Avg.' },
              { marker: '•', text: 'Suffixes like PY, PQ, PM, YTD, TTM, VTB.' },
              { marker: '•', text: 'Measure references should not prefix with the table name.' },
            ],
          },
          {
            marker: '',
            title: 'Hierarchies',
            children: [
              { marker: '•', text: "Must end with 'Hierarchy'." },
              { marker: '•', text: 'Attributes must match column names outside the hierarchy.' },
              { marker: '•', text: 'The order should reflect natural hierarchy levels.' },
              { marker: '•', text: 'This facilitates easier working with external tools such as Tabular Editor.' },
            ],
          },
          {
            marker: '',
            title: 'Roles, folders & connections',
            children: [
              { marker: '•', text: 'Roles must not be used to secure parts of your semantic model — use OLS or, better, RLS. Ensure role members do not overlap between roles to prevent errors and unauthorized data viewing.' },
              { marker: '•', text: 'Display folders group two or more measures/columns within the same table; a multi-folder approach should align with user categorization methods.' },
              { marker: '•', text: 'Connection-string names should include three components: Provider, Data Source, Initial Catalog.' },
            ],
          },
          {
            marker: '',
            title: 'Abbreviations',
            children: [
              { marker: '•', text: 'Define abbreviations like YoY, QoQ, MoM, YTD, QTD, MTD, PY, PQ, PM, TTM (trailing 12 months), VTB (variance-to-budget) and VTF (variance-to-forecast).' },
              { marker: '•', text: 'Instead of PY for previous year, Y-1 is also valid — important if Y-2 is a relevant KPI for the business context.' },
              { marker: '•', text: 'For target/budget numbers, "PL" is often preferred over BUD (BU could be confused with Business Unit, and a 3-letter BUD is not optimal when PY is only 2 letters).' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'tabular-style-guide',
    num: '5',
    title: 'Tabular Style Guide',
    icon: <Ruler20Regular />,
    subs: [
      {
        num: '5.0',
        title: 'About this guide',
        intro: (
          <>
            A widely-adopted naming and formatting standard for tabular models by Michael Kovalsky
            (Elegant BI). Models are part of the front end — users see tables, columns and measures —
            so naming and formatting should be created in their best interest. Many of these rules can
            be auto-validated with Tabular Editor's Best Practice Analyzer. Source:{' '}
            {learn('elegantbi.com — Tabular Style Guide', 'https://www.elegantbi.com/post/tabularstyleguide')}.
          </>
        ),
        items: [],
      },
      {
        num: '5.1',
        title: 'General Rules (all objects)',
        items: [
          { marker: '•', text: 'Always separate words with spaces in all visible objects.' },
          { marker: '•', text: 'Always use Title Case.' },
          { marker: '•', text: 'Avoid these characters: [ ] { } \' " = & * : ; . / \\ # @ ! _ = ^.' },
          {
            marker: '•',
            title: 'Avoid these words',
            children: [
              { marker: '○', text: 'Reserved words (Table, Measure, Column, KPI) — except a Hierarchy called "Hierarchy".' },
              { marker: '○', text: "'Total' — avoids subtotals/grand totals showing as 'Total Total…'." },
              { marker: '○', text: "'Is' — avoids columns like 'IsActive' instead of 'Active Flag'." },
              { marker: '○', text: "'Amount', 'Value' — often redundant (a measure 'Sales Amount' can just be 'Sales')." },
              { marker: '○', text: "'Name' — sometimes permissible ('Customer Name'), but often superfluous ('Region Name' → 'Region')." },
            ],
          },
        ],
      },
      {
        num: '5.2',
        title: 'Tables',
        items: [
          { marker: '•', text: "Avoid the word 'Hierarchy' in table names." },
          {
            marker: '•',
            title: 'Calendar dimension',
            children: [
              { marker: '○', text: 'Always mark as a date table.' },
              { marker: '○', text: 'Primary key (DateId) must be INTEGER datatype in YYYYMMDD format.' },
              { marker: '○', text: "Always split date and time (Calendar granularity is 'Day'; Time is more granular, e.g. hour or minute)." },
            ],
          },
          {
            marker: '•',
            title: 'Five table types',
            text: 'Model name → database view name:',
            children: [
              { marker: '○', text: 'Fact — Revenue → FACT_Revenue.' },
              { marker: '○', text: 'Dimension — Geography → DIM_Geography.' },
              { marker: '○', text: 'Bridge — GeographyBridge → BRIDGE_Geography.' },
              { marker: '○', text: 'Security — UserGeography → SEC_UserGeography.' },
              { marker: '○', text: 'Metadata — Data Dictionary → META_DataDictionary.' },
              { marker: '○', text: "Note: GeographyBridge & UserGeography have no spaces — permissible since they are hidden." },
            ],
          },
        ],
      },
      {
        num: '5.3',
        title: 'Partitions',
        items: [
          {
            marker: '•',
            title: 'Single-partitioned tables must have the same partition name as the table name',
            children: [
              { marker: '○', text: 'Always use simple views (SELECT * FROM [Schema].[View]). Views decouple the database layer from the model, allow quick changes, let multiple models query the same table, and make development much faster — especially in Tabular Editor.' },
              { marker: '○', text: 'Views should have no logic — all logic belongs in stored procedures / the database layer.' },
              { marker: '○', text: "View schema should be the model name (abbreviated) appended by 'View' (e.g. WWIView for the Worldwide Importers model)." },
            ],
          },
          {
            marker: '•',
            title: 'Multi-partitioned tables must have partition names that start with the table name',
            children: [
              { marker: '○', text: 'Examples (Table = Revenue): Revenue FY19, Revenue FY20; Revenue FY19-Q1, Revenue FY19-Q2; Revenue FY19-M01, Revenue FY19-M02.' },
              { marker: '○', text: 'Partition in the database layer too — this enables parallel creation (saving time) and easy SELECT * querying, or call a stored procedure with a parameter filter.' },
            ],
          },
        ],
      },
      {
        num: '5.4',
        title: 'Columns',
        items: [
          {
            marker: '•',
            title: 'Flags',
            children: [
              { marker: '○', text: 'Must be STRING datatype.' },
              { marker: '○', text: 'Valid values: Yes, No, N/A, Unknown.' },
              { marker: '○', text: 'Never use 0/1 or Y/N.' },
              { marker: '○', text: "Must be specified as a flag (e.g. 'Active Flag')." },
            ],
          },
          {
            marker: '•',
            title: 'Primary keys',
            children: [
              { marker: '○', text: "INTEGER datatype, end in 'ID', Key = True in properties, generally hidden unless needed by the end user." },
            ],
          },
          {
            marker: '•',
            title: 'Foreign keys',
            children: [
              { marker: '○', text: "INTEGER datatype, end in 'ID', always hidden, match the name of the corresponding primary key." },
            ],
          },
          { marker: '•', title: 'Sort-by columns', text: 'INTEGER datatype, must be hidden.' },
          { marker: '•', title: 'Aggregatable columns', text: 'INTEGER, CURRENCY or DECIMAL; hidden, with a measure created from the column; no spaces in the column name.' },
          { marker: '•', title: 'Non-aggregatable integer columns', text: "Set 'Summarize By' to 'None' / 'Do Not Summarize' so they are never accidentally aggregated." },
          { marker: '•', text: "Columns in the database layer (incl. views) should have no spaces — spaces are added in the model's 'Name' property." },
          { marker: '•', title: 'References', text: 'Columns referenced by measures should always be prefixed with the table name.' },
          { marker: '•', text: "Dimension-table primary keys should contain all values in each related fact table's foreign keys — no blank members." },
          { marker: '•', text: 'Specify URLs / hyperlinks as Data Category = WebURL in the column properties.' },
        ],
      },
      {
        num: '5.5',
        title: 'Measures',
        items: [
          {
            marker: '•',
            title: 'Formatting',
            children: [
              { marker: '○', text: 'Currency, no decimals ($32,000): \\$#,0;(\\$#,0);\\$#,0' },
              { marker: '○', text: 'Whole number, no decimals, commas (32,000): #,0 — add a decimal (#,0.0) only when required; never when counting (e.g. customers).' },
              { marker: '○', text: 'Percentage, one decimal, commas (3,200.1%): #,0.0%;-#,0.0%;#,0.0% — use as few decimals as possible.' },
            ],
          },
          {
            marker: '•',
            title: 'Naming',
            children: [
              { marker: '○', text: 'Descriptive but as brief as possible.' },
              { marker: '○', text: 'Prefixes: Avg; any product information (e.g. Azure …).' },
              { marker: '○', text: 'Suffixes: YoY, QoQ, MoM, YTD, QTD, MTD, PY, PQ, PM, TTM, VTB, VTF; YoY %, QoQ %, MoM % — the % sign always goes at the end.' },
              { marker: '○', text: 'Examples: Billed Revenue · Billed Revenue PM · Billed Revenue MoM % · Billed Revenue YoY · Billed Revenue YTD PY · Billed Revenue YTD YoY % · Azure Billed Revenue Customer Count TTM.' },
            ],
          },
          { marker: '•', title: 'References', text: 'Measures referenced by other measures should never be prefixed with the table name.' },
          {
            marker: '•',
            title: 'Abbreviation key',
            text: 'YoY = Year-over-Year · QoQ = Quarter-over-Quarter · MoM = Month-over-Month · YTD/QTD/MTD = Year/Quarter/Month-to-Date · PY/PQ/PM = Previous Year/Quarter/Month · TTM = Trailing 12 months · VTB = Variance-to-Budget · VTF = Variance-to-Forecast.',
          },
        ],
      },
      {
        num: '5.6',
        title: 'Hierarchies',
        items: [
          { marker: '•', text: "Must be suffixed with the word 'Hierarchy' (e.g. 'Geography Hierarchy')." },
          { marker: '•', text: 'Attributes of the hierarchy must use the same names as their respective columns outside the hierarchy.' },
          { marker: '•', text: 'The order must correspond to the natural order of the hierarchy (granularity / drill-down).' },
        ],
      },
      {
        num: '5.7',
        title: 'Relationships, Data Sources, Perspectives & Roles',
        items: [
          { marker: '•', title: 'Relationships', text: 'Named automatically — no naming standards required.' },
          { marker: '•', title: 'Data sources', text: 'Three components: Provider, Data Source, Initial Catalog (e.g. "SqlServer ServerName DatabaseName").' },
          { marker: '•', title: 'Perspectives', text: 'No additional standards beyond the General Rules.' },
          { marker: '•', title: 'Roles', text: 'Role members must not overlap between roles — overlap can cause errors or expose data a user should not see.' },
        ],
      },
      {
        num: '5.8',
        title: 'Display Folders',
        items: [
          { marker: '•', text: 'Folders may be used to group two or more measures/columns within the same table.' },
          { marker: '•', text: 'If using a multi-folder (drill) approach, structure it the way your users categorize those measures/columns.' },
        ],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const useStyles = makeStyles({
  root: {
    height: '100%',
    overflowY: 'auto',
    backgroundColor: tokens.colorNeutralBackground1,
  },
  inner: {
    maxWidth: '900px',
    marginInline: 'auto',
    paddingBlock: '32px 64px',
    paddingInline: '32px',
    display: 'flex',
    flexDirection: 'column',
    rowGap: '24px',
  },
  hero: { display: 'flex', flexDirection: 'column', rowGap: '8px' },
  tagline: { color: tokens.colorNeutralForeground2 },
  badgeRow: {
    display: 'flex',
    flexWrap: 'wrap',
    columnGap: '8px',
    rowGap: '8px',
    marginTop: '4px',
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    columnGap: '6px',
    fontSize: '12px',
    color: tokens.colorNeutralForeground2,
    backgroundColor: tokens.colorNeutralBackground3,
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    ...shorthands.borderRadius('4px'),
    ...shorthands.padding('3px', '8px'),
  },
  toc: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '8px',
  },
  tocCard: {
    display: 'flex',
    alignItems: 'center',
    columnGap: '10px',
    textAlign: 'left',
    cursor: 'pointer',
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    ...shorthands.borderRadius('8px'),
    ...shorthands.padding('12px', '14px'),
    color: tokens.colorNeutralForeground1,
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground2Hover,
      ...shorthands.borderColor(tokens.colorBrandStroke1),
    },
  },
  tocIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: tokens.colorBrandForeground1,
  },
  tocNum: { color: tokens.colorNeutralForeground3, fontSize: '12px' },
  section: { display: 'flex', flexDirection: 'column', rowGap: '14px', scrollMarginTop: '16px' },
  sectionHeader: { display: 'flex', alignItems: 'center', columnGap: '12px' },
  sectionChip: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '34px',
    height: '34px',
    fontWeight: 600,
    color: tokens.colorNeutralForegroundOnBrand,
    backgroundColor: tokens.colorBrandBackground,
    ...shorthands.borderRadius('8px'),
  },
  sub: { display: 'flex', flexDirection: 'column', rowGap: '8px' },
  subHeader: { display: 'flex', alignItems: 'baseline', columnGap: '8px' },
  subNum: { color: tokens.colorBrandForeground1, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: '13px' },
  subIntro: { color: tokens.colorNeutralForeground2 },
  list: { display: 'flex', flexDirection: 'column', rowGap: '6px', marginBlock: 0 },
  nested: { marginTop: '6px', marginLeft: '4px', paddingLeft: '14px', borderLeft: `2px solid ${tokens.colorNeutralStroke2}` },
  item: { display: 'flex', columnGap: '8px', alignItems: 'baseline' },
  marker: {
    flexShrink: 0,
    minWidth: '20px',
    color: tokens.colorNeutralForeground3,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: '12px',
    lineHeight: '20px',
  },
  itemBody: { color: tokens.colorNeutralForeground1 },
  footnote: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  teamValue: {
    fontWeight: 600,
    color: tokens.colorBrandForeground1,
    backgroundColor: tokens.colorBrandBackground2,
    ...shorthands.borderRadius('4px'),
    ...shorthands.padding('0', '5px'),
    whiteSpace: 'nowrap',
  },
  placeholderValue: {
    color: tokens.colorNeutralForeground3,
    fontStyle: 'italic',
    ...shorthands.borderBottom('1px', 'dotted', tokens.colorNeutralStroke1),
  },
});

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

/** Live team answers, re-read whenever the questionnaire persists a change. */
function useGuidelineAnswers(): Record<string, Answer> {
  const [answers, setAnswers] = useState<Record<string, Answer>>(loadGuidelineAnswers);
  useEffect(() => {
    const refresh = () => setAnswers(loadGuidelineAnswers());
    const onStorage = (e: StorageEvent) => {
      if (e.key === GUIDELINES_STORAGE_KEY) refresh();
    };
    window.addEventListener(GUIDELINES_ANSWERS_EVENT, refresh);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(GUIDELINES_ANSWERS_EVENT, refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  return answers;
}

const TOKEN_RE = /(\{\{[a-z0-9-]+\}\})/i;

/**
 * Replace `{{question-id}}` tokens in a guideline string with the team's
 * answer (highlighted) or a muted default placeholder when unanswered. Non-string
 * ReactNodes (already-built JSX) pass through unchanged.
 */
function renderWithTokens(
  node: ReactNode,
  answers: Record<string, Answer>,
  styles: ReturnType<typeof useStyles>,
): ReactNode {
  if (typeof node !== 'string' || !TOKEN_RE.test(node)) return node;
  return node.split(TOKEN_RE).map((part, i) => {
    const m = part.match(/^\{\{([a-z0-9-]+)\}\}$/i);
    if (!m) return <Fragment key={i}>{part}</Fragment>;
    const qid = m[1];
    const team = teamAnswer(answers, qid);
    if (team) {
      return (
        <span key={i} className={styles.teamValue} title="Your team's convention">
          {team}
        </span>
      );
    }
    return (
      <span
        key={i}
        className={styles.placeholderValue}
        title="Default — set your team's convention in 'Customize these guidelines for your team' above"
      >
        {defaultPlaceholder(qid)}
      </span>
    );
  });
}

function ItemList({
  items,
  answers,
  nested,
}: {
  items: GuideItem[];
  answers: Record<string, Answer>;
  nested?: boolean;
}) {
  const styles = useStyles();
  return (
    <div className={nested ? styles.nested : styles.list}>
      {items.map((it, i) => (
        <div key={i} className={styles.item}>
          {it.marker !== '' && <span className={styles.marker}>{it.marker ?? '•'}</span>}
          <div className={styles.itemBody}>
            {it.title && <Body1Strong>{renderWithTokens(it.title, answers, styles)}</Body1Strong>}
            {it.title && it.text ? (
              <Body1> — {renderWithTokens(it.text, answers, styles)}</Body1>
            ) : it.text ? (
              <Body1>{renderWithTokens(it.text, answers, styles)}</Body1>
            ) : null}
            {it.children && <ItemList items={it.children} answers={answers} nested />}
          </div>
        </div>
      ))}
    </div>
  );
}

export function GuidelinesTab() {
  const styles = useStyles();
  const answers = useGuidelineAnswers();

  const scrollTo = useCallback((id: string) => {
    document.getElementById(`guideline-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return (
    <div className={styles.root}>
      <div className={styles.inner}>
        {/* Hero */}
        <div className={styles.hero}>
          <Title2>Power BI Guidelines</Title2>
          <Body1 className={styles.tagline}>
            A consolidated reference of best practices for building Power BI solutions —
            spanning data integration, data modeling, report design and maintenance. Use it as a
            checklist when designing semantic models and reports.
          </Body1>
          <div className={styles.badgeRow}>
            <span className={styles.badge}>Data Integration</span>
            <span className={styles.badge}>Data Modeling</span>
            <span className={styles.badge}>Report Design</span>
            <span className={styles.badge}>Maintenance &amp; Performance</span>
          </div>
        </div>

        {/* Customize for your team */}
        <GuidelinesQuestionnaire />

        {/* Table of contents */}
        <div className={styles.toc}>
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" className={styles.tocCard} onClick={() => scrollTo(s.id)}>
              <span className={styles.tocIcon}>{s.icon}</span>
              <span>
                <span className={styles.tocNum}>{s.num}. </span>
                <Body1Strong>{s.title}</Body1Strong>
              </span>
            </button>
          ))}
        </div>

        <Divider />

        {/* Sections */}
        {SECTIONS.map((s) => (
          <section key={s.id} id={`guideline-${s.id}`} className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionChip}>{s.num}</span>
              <Title3>{s.title}</Title3>
            </div>
            {s.subs.map((sub) => (
              <div key={sub.num} className={styles.sub}>
                <div className={styles.subHeader}>
                  <span className={styles.subNum}>{sub.num}</span>
                  <Subtitle2>{sub.title}</Subtitle2>
                </div>
                {sub.intro && <Body1 className={styles.subIntro}>{sub.intro}</Body1>}
                <ItemList items={sub.items} answers={answers} />
              </div>
            ))}
            <Divider />
          </section>
        ))}

        <Subtitle1>Keep your models lean, your schemas star-shaped and your reports focused.</Subtitle1>
        <Body1 className={styles.footnote}>
          Adapted from the internal Power BI Guidelines document for quick in-app reference.
        </Body1>
      </div>
    </div>
  );
}
