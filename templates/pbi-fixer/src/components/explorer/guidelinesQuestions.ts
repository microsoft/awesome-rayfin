// Question bank powering the "Customize these guidelines for your team"
// questionnaire on the Guidelines tab. 50 optional questions — a mix of
// single-choice, multi-select and free-text — that let a team capture its own
// conventions on top of the standard Power BI / Tabular best practices.
//
// Sources that informed these questions:
//  • Tabular Style Guide (Michael Kovalsky / Elegant BI)
//  • "My Top 10 Tabular Data Model Best Practices" (Alexander Korn,
//    actionablereporting.com) — e.g. USERELATIONSHIP for multiple date roles,
//    last-refresh timestamp per partition, empty measure tables, SELECT * source.

export type QuestionType = 'single' | 'multi' | 'text';

export interface GuidelineQuestion {
  id: string;
  category: string;
  /** Short label used in the generated convention summary. */
  label: string;
  /** Full question text shown in the wizard. */
  question: string;
  /** Optional hint shown under the question. */
  help?: string;
  type: QuestionType;
  /** Choices for single / multi questions. */
  options?: string[];
  /** Adds a free-text "Other / notes" field next to the choices. */
  allowOther?: boolean;
  /** Placeholder for text questions / the "Other" field. */
  placeholder?: string;
}

export interface Answer {
  choice?: string;
  choices?: string[];
  other?: string;
  text?: string;
}

export const QUESTION_CATEGORIES = [
  'Naming & General',
  'Tables & Schema',
  'Calendar & Time',
  'Columns & Keys',
  'Measures & DAX',
  'Relationships, Reports & Governance',
] as const;

export const GUIDELINE_QUESTIONS: GuidelineQuestion[] = [
  // ---- Naming & General ---------------------------------------------------
  {
    id: 'naming-casing',
    category: 'Naming & General',
    label: 'Casing convention',
    question: 'Which casing convention do you use for visible object names?',
    type: 'single',
    options: ['Title Case', 'PascalCase', 'camelCase', 'snake_case'],
    allowOther: true,
  },
  {
    id: 'words-spaces',
    category: 'Naming & General',
    label: 'Words separated by spaces',
    question: 'Do you separate words with spaces in visible object names?',
    type: 'single',
    options: ['Yes', 'No'],
  },
  {
    id: 'dim-fact-prefix',
    category: 'Naming & General',
    label: 'Dim / Fact prefixes',
    question: 'Do you prefix table names with "Dim" / "Fact"?',
    help: 'Many style guides recommend clean business names with no technical prefix in the model.',
    type: 'single',
    options: ['No prefix (clean names)', 'Dim & Fact prefixes', 'Only Fact prefixed', 'Custom'],
    allowOther: true,
  },
  {
    id: 'object-language',
    category: 'Naming & General',
    label: 'Object name language',
    question: 'Which language do you use for object names?',
    type: 'text',
    placeholder: 'e.g. English, German, …',
  },
  {
    id: 'special-chars',
    category: 'Naming & General',
    label: 'Special characters',
    question: 'Are special characters allowed in object names?',
    type: 'single',
    options: ['No special characters', 'Only spaces', 'Allowed (specify)'],
    allowOther: true,
  },
  {
    id: 'measure-table-name',
    category: 'Naming & General',
    label: 'Measure table name',
    question: 'What do you name your measure container table?',
    type: 'text',
    placeholder: 'e.g. Measure',
  },
  {
    id: 'reference-qualification',
    category: 'Naming & General',
    label: 'Reference qualification',
    question: 'How do you qualify references in DAX?',
    type: 'single',
    options: [
      'Columns qualified, measures unqualified',
      'Everything qualified',
      'No strict rule',
    ],
  },
  {
    id: 'db-layer-casing',
    category: 'Naming & General',
    label: 'Database-layer casing',
    question: 'Which casing do you use for database-layer objects (views / tables)?',
    type: 'single',
    options: ['UPPER_SNAKE_CASE', 'lower_snake_case', 'PascalCase', 'Same as model'],
    allowOther: true,
  },
  {
    id: 'reserved-words',
    category: 'Naming & General',
    label: 'Forbidden words',
    question: 'Do you forbid reserved / redundant words (Total, Is, Amount, Value, Name)?',
    type: 'single',
    options: ['Yes, all of them', 'Some of them', 'No'],
    allowOther: true,
  },
  {
    id: 'naming-extra',
    category: 'Naming & General',
    label: 'Extra naming rules',
    question: 'Any additional naming rules you want to capture?',
    type: 'text',
    placeholder: 'Free text…',
  },

  // ---- Tables & Schema ----------------------------------------------------
  {
    id: 'schema-approach',
    category: 'Tables & Schema',
    label: 'Schema approach',
    question: 'Which modeling approach do you enforce?',
    type: 'single',
    options: ['Strict star schema', 'Star preferred', 'Snowflake allowed', 'Flat tables allowed'],
  },
  {
    id: 'galaxy-schema',
    category: 'Tables & Schema',
    label: 'Galaxy schema',
    question: 'Do you prefer multiple fact tables (galaxy schema) over one big star?',
    type: 'single',
    options: ['Yes', 'No', 'Depends on the use case'],
  },
  {
    id: 'empty-measure-table',
    category: 'Tables & Schema',
    label: 'Empty measure table',
    question: 'Do you use a dedicated (empty) measure table to organize measures?',
    type: 'single',
    options: ['Yes, one', 'Yes, one per subject area', 'No'],
    allowOther: true,
  },
  {
    id: 'calc-location',
    category: 'Tables & Schema',
    label: 'Calculation location',
    question: 'Where should calculations primarily live?',
    help: 'Best practice is to push logic to the database / warehouse where possible.',
    type: 'single',
    options: ['Database / warehouse', 'Power Query', 'DAX in the model', 'Mixed'],
  },
  {
    id: 'source-strategy',
    category: 'Tables & Schema',
    label: 'Source strategy',
    question: 'How do you source tables into the model?',
    help: 'A SELECT * view (or a table populated via stored procedure for Direct Query) keeps the model flexible.',
    type: 'single',
    options: [
      'Views (SELECT *)',
      'Views (explicit columns)',
      'Tables via stored procedure',
      'Direct tables',
    ],
    allowOther: true,
  },
  {
    id: 'db-type-prefixes',
    category: 'Tables & Schema',
    label: 'DB type prefixes',
    question: 'Which database table-type prefixes do you use?',
    type: 'multi',
    options: ['FACT_', 'DIM_', 'BRIDGE_', 'SEC_', 'META_', 'None'],
    allowOther: true,
  },
  {
    id: 'remove-unused',
    category: 'Tables & Schema',
    label: 'Remove unused objects',
    question: 'Do you regularly remove unused columns and tables?',
    type: 'single',
    options: ['Yes', 'Ad-hoc', 'No'],
  },
  {
    id: 'tables-extra',
    category: 'Tables & Schema',
    label: 'Extra modeling rules',
    question: 'Any additional table / modeling rules?',
    type: 'text',
    placeholder: 'Free text…',
  },

  // ---- Calendar & Time ----------------------------------------------------
  {
    id: 'has-date-dim',
    category: 'Calendar & Time',
    label: 'Date dimension',
    question: 'Do you have a dedicated Date / Calendar dimension?',
    type: 'single',
    options: ['Yes', 'No', 'Planned'],
  },
  {
    id: 'fiscal-usage',
    category: 'Calendar & Time',
    label: 'Fiscal year usage',
    question: 'Do you use a fiscal year?',
    type: 'single',
    options: ['Calendar year only', 'Fiscal year', 'Both'],
  },
  {
    id: 'fiscal-start',
    category: 'Calendar & Time',
    label: 'Fiscal year start',
    question: 'When does your fiscal year start?',
    help: 'Pick the month your fiscal year begins (skip if you only use the calendar year).',
    type: 'single',
    options: ['January', 'April', 'July', 'October'],
    allowOther: true,
    placeholder: 'Other month…',
  },
  {
    id: 'auto-datetime',
    category: 'Calendar & Time',
    label: 'Auto Date/Time disabled',
    question: 'Is Auto Date/Time disabled in your models?',
    type: 'single',
    options: ['Yes', 'No'],
  },
  {
    id: 'marked-date-table',
    category: 'Calendar & Time',
    label: 'Marked as date table',
    question: 'Is your date table marked as a date table?',
    type: 'single',
    options: ['Yes', 'No'],
  },
  {
    id: 'date-key-format',
    category: 'Calendar & Time',
    label: 'Date key format',
    question: 'Which date key format do you use?',
    type: 'single',
    options: ['INTEGER YYYYMMDD', 'Date datatype', 'Both'],
    allowOther: true,
  },
  {
    id: 'split-date-time',
    category: 'Calendar & Time',
    label: 'Split date & time',
    question: 'Do you split Date and Time into separate columns?',
    type: 'single',
    options: ['Yes', 'No', 'N/A (no time component)'],
  },
  {
    id: 'time-intel-cg',
    category: 'Calendar & Time',
    label: 'Time intelligence calc group',
    question: 'Do you use a Time Intelligence calculation group?',
    type: 'single',
    options: ['Yes', 'No', 'Planned'],
  },

  // ---- Columns & Keys -----------------------------------------------------
  {
    id: 'flags-format',
    category: 'Columns & Keys',
    label: 'Flag format',
    question: 'How do you store boolean flags?',
    type: 'single',
    options: ['String Yes / No', '0 / 1 integer', 'Y / N'],
    allowOther: true,
  },
  {
    id: 'pk-format',
    category: 'Columns & Keys',
    label: 'Primary key format',
    question: 'What is your primary key datatype & convention?',
    type: 'single',
    options: ["INTEGER ending in 'ID'", 'GUID', 'Natural key'],
    allowOther: true,
  },
  {
    id: 'hide-keys',
    category: 'Columns & Keys',
    label: 'Hide key columns',
    question: 'Do you hide foreign keys and key columns?',
    type: 'single',
    options: ['Yes', 'No'],
  },
  {
    id: 'mark-pk-key',
    category: 'Columns & Keys',
    label: 'Mark PK as Key',
    question: 'Do you set Key = True on primary keys?',
    type: 'single',
    options: ['Yes', 'No'],
  },
  {
    id: 'sortby-columns',
    category: 'Columns & Keys',
    label: 'Sort-by columns',
    question: 'Are sort-by columns integer and hidden?',
    type: 'single',
    options: ['Yes', 'No'],
  },
  {
    id: 'nonagg-summarize',
    category: 'Columns & Keys',
    label: 'Non-aggregatable integers',
    question: "Do you set 'Summarize By = None' on non-aggregatable integers?",
    type: 'single',
    options: ['Yes', 'No'],
  },
  {
    id: 'weburl-category',
    category: 'Columns & Keys',
    label: 'URL data category',
    question: 'Do you set Data Category = WebURL for URL / hyperlink columns?',
    type: 'single',
    options: ['Yes', 'No', 'N/A'],
  },

  // ---- Measures & DAX -----------------------------------------------------
  {
    id: 'currency-format',
    category: 'Measures & DAX',
    label: 'Currency format',
    question: 'Which currency format string do you standardize on?',
    type: 'text',
    placeholder: '\\$#,0;(\\$#,0);\\$#,0',
  },
  {
    id: 'whole-decimals',
    category: 'Measures & DAX',
    label: 'Whole-number decimals',
    question: 'Default decimals for whole numbers?',
    type: 'single',
    options: ['0', '1', '2'],
  },
  {
    id: 'percent-format',
    category: 'Measures & DAX',
    label: 'Percentage format',
    question: 'Which percentage format string do you use?',
    type: 'text',
    placeholder: '#,0.0%',
  },
  {
    id: 'measure-suffixes',
    category: 'Measures & DAX',
    label: 'Measure suffixes',
    question: 'Which time-comparison suffix style do you use?',
    type: 'single',
    options: ['PY / YoY / YTD …', 'Custom'],
    allowOther: true,
  },
  {
    id: 'dax-avoid',
    category: 'Measures & DAX',
    label: 'DAX anti-patterns avoided',
    question: "Do you avoid '/', IFERROR, SEARCH, CONTAINS, INTERSECT and FILTER (using DIVIDE / TREATAS / KEEPFILTERS instead)?",
    type: 'single',
    options: ['Yes', 'Partly', 'No'],
  },
  {
    id: 'reduce-measures',
    category: 'Measures & DAX',
    label: 'Calc groups & field params',
    question: 'Do you reduce the number of measures via calculation groups & field parameters?',
    type: 'single',
    options: ['Yes', 'No', 'Planned'],
  },
  {
    id: 'measure-descriptions',
    category: 'Measures & DAX',
    label: 'Measure descriptions',
    question: 'Do you add descriptions to all measures?',
    type: 'single',
    options: ['Yes', 'Some', 'No'],
  },

  // ---- Relationships, Reports & Governance --------------------------------
  {
    id: 'relationship-policy',
    category: 'Relationships, Reports & Governance',
    label: 'Relationship policy',
    question: 'What is your policy on bi-directional / many-to-many relationships?',
    type: 'single',
    options: [
      'Avoid strictly',
      'Single direction only',
      'Allowed with care (CROSSFILTER + IF)',
    ],
  },
  {
    id: 'multi-date-roles',
    category: 'Relationships, Reports & Governance',
    label: 'Multiple date roles',
    question: 'For multiple date roles, do you use one date dimension with inactive relationships + USERELATIONSHIP?',
    type: 'single',
    options: ['Yes', 'No', 'N/A'],
  },
  {
    id: 'separate-report-model',
    category: 'Relationships, Reports & Governance',
    label: 'Report / model separation',
    question: 'Do you separate the report from the semantic model?',
    type: 'single',
    options: ['Yes', 'No', 'Sometimes'],
  },
  {
    id: 'page-size',
    category: 'Relationships, Reports & Governance',
    label: 'Report page size',
    question: 'What is your preferred report page size?',
    type: 'single',
    options: ['1080×1920 (portrait HD)', '1280×720 (16:9)', '1920×1080'],
    allowOther: true,
  },
  {
    id: 'filter-strategy',
    category: 'Relationships, Reports & Governance',
    label: 'Filter strategy',
    question: 'Do you prefer the Filter Pane or report slicers?',
    type: 'single',
    options: ['Filter pane preferred', 'Slicers', 'Mixed'],
  },
  {
    id: 'ibcs',
    category: 'Relationships, Reports & Governance',
    label: 'IBCS standards',
    question: 'Do you follow IBCS visualization standards?',
    type: 'single',
    options: ['Yes', 'Partly', 'No'],
  },
  {
    id: 'last-refresh',
    category: 'Relationships, Reports & Governance',
    label: 'Last-refresh timestamp',
    question: 'Do you add a last-refresh timestamp (per partition)?',
    type: 'single',
    options: ['Yes', 'No', 'Planned'],
  },
  {
    id: 'gateway',
    category: 'Relationships, Reports & Governance',
    label: 'Data gateway',
    question: 'Do you use an enterprise on-premises data gateway (instead of a personal gateway)?',
    type: 'single',
    options: ['Yes', 'No', 'N/A (cloud only)'],
  },
  {
    id: 'bpa-validation',
    category: 'Relationships, Reports & Governance',
    label: 'BPA validation',
    question: 'Do you validate models with the Tabular Editor Best Practice Analyzer?',
    type: 'single',
    options: ['Yes', 'No', 'Planned'],
  },
  {
    id: 'extra-standards',
    category: 'Relationships, Reports & Governance',
    label: 'Other standards',
    question: "Anything else specific to your team's standards?",
    type: 'text',
    placeholder: 'Free text…',
  },
];

/** Turns a stored answer into a readable value, or null if effectively empty. */
export function formatAnswerValue(q: GuidelineQuestion, a: Answer | undefined): string | null {
  if (!a) return null;
  if (q.type === 'text') {
    const t = a.text?.trim();
    return t ? t : null;
  }
  if (q.type === 'multi') {
    const parts = [...(a.choices ?? [])];
    if (a.other?.trim()) parts.push(a.other.trim());
    return parts.length ? parts.join(', ') : null;
  }
  // single
  const parts: string[] = [];
  if (a.choice) parts.push(a.choice);
  if (a.other?.trim()) parts.push(a.other.trim());
  return parts.length ? parts.join(' · ') : null;
}
