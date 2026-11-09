/**
 * The guideline questions in German.
 *
 * Only what is shown. The ids and the stored choices stay the English ones of
 * `questions.ts`, so answers read the same in both languages and in the Power
 * BI Fixer. `options` follows the order of the English options.
 */
export interface QuestionWords {
  label: string;
  question: string;
  help?: string;
  placeholder?: string;
  options?: string[];
}

export const CATEGORIES_DE: Record<string, string> = {
  'Naming & General': 'Benennung & Allgemeines',
  'Tables & Schema': 'Tabellen & Schema',
  'Calendar & Time': 'Kalender & Zeit',
  'Columns & Keys': 'Spalten & Schlüssel',
  'Measures & DAX': 'Measures & DAX',
  'Relationships, Reports & Governance': 'Beziehungen, Berichte & Governance',
};

const YES_NO = ['Ja', 'Nein'];

export const QUESTIONS_DE: Record<string, QuestionWords> = {
  'naming-casing': { label: 'Schreibweise', question: 'Welche Schreibweise verwenden Sie für sichtbare Objektnamen?', options: ['Title Case', 'PascalCase', 'camelCase', 'snake_case'] },
  'words-spaces': { label: 'Wörter durch Leerzeichen getrennt', question: 'Trennen Sie Wörter in sichtbaren Objektnamen durch Leerzeichen?', options: YES_NO },
  'dim-fact-prefix': {
    label: 'Präfixe Dim / Fact',
    question: 'Stellen Sie Tabellennamen „Dim“ / „Fact“ voran?',
    help: 'Viele Leitfäden empfehlen im Modell klare fachliche Namen ohne technisches Präfix.',
    options: ['Kein Präfix (klare Namen)', 'Präfixe Dim & Fact', 'Nur Fact mit Präfix', 'Eigene Regel'],
  },
  'object-language': { label: 'Sprache der Objektnamen', question: 'In welcher Sprache benennen Sie Objekte?', placeholder: 'z. B. Englisch, Deutsch, …' },
  'special-chars': { label: 'Sonderzeichen', question: 'Sind Sonderzeichen in Objektnamen erlaubt?', options: ['Keine Sonderzeichen', 'Nur Leerzeichen', 'Erlaubt (angeben)'] },
  'measure-table-name': { label: 'Name der Measure-Tabelle', question: 'Wie heißt Ihre Containertabelle für Measures?', placeholder: 'z. B. Measure' },
  'reference-qualification': {
    label: 'Qualifizierung von Verweisen',
    question: 'Wie qualifizieren Sie Verweise in DAX?',
    options: ['Spalten qualifiziert, Measures unqualifiziert', 'Alles qualifiziert', 'Keine feste Regel'],
  },
  'db-layer-casing': {
    label: 'Schreibweise in der Datenbankschicht',
    question: 'Welche Schreibweise verwenden Sie für Objekte der Datenbankschicht (Sichten / Tabellen)?',
    options: ['UPPER_SNAKE_CASE', 'lower_snake_case', 'PascalCase', 'Wie im Modell'],
  },
  'reserved-words': {
    label: 'Verbotene Wörter',
    question: 'Verbieten Sie reservierte oder überflüssige Wörter (Total, Is, Amount, Value, Name)?',
    options: ['Ja, alle', 'Einige davon', 'Nein'],
  },
  'naming-extra': { label: 'Weitere Namensregeln', question: 'Gibt es weitere Namensregeln, die Sie festhalten möchten?', placeholder: 'Freitext…' },

  'schema-approach': {
    label: 'Schemaansatz',
    question: 'Welchen Modellierungsansatz setzen Sie durch?',
    options: ['Striktes Sternschema', 'Sternschema bevorzugt', 'Schneeflocke erlaubt', 'Flache Tabellen erlaubt'],
  },
  'galaxy-schema': { label: 'Galaxy-Schema', question: 'Ziehen Sie mehrere Faktentabellen (Galaxy-Schema) einem großen Stern vor?', options: ['Ja', 'Nein', 'Je nach Anwendungsfall'] },
  'empty-measure-table': {
    label: 'Leere Measure-Tabelle',
    question: 'Nutzen Sie eine eigene (leere) Measure-Tabelle, um Measures zu ordnen?',
    options: ['Ja, eine', 'Ja, eine je Themengebiet', 'Nein'],
  },
  'calc-location': {
    label: 'Ort der Berechnungen',
    question: 'Wo sollen Berechnungen vorrangig liegen?',
    help: 'Bewährt ist, Logik wo möglich in die Datenbank bzw. das Warehouse zu verlagern.',
    options: ['Datenbank / Warehouse', 'Power Query', 'DAX im Modell', 'Gemischt'],
  },
  'source-strategy': {
    label: 'Quellstrategie',
    question: 'Wie holen Sie Tabellen ins Modell?',
    help: 'Eine Sicht mit SELECT * (oder für Direct Query eine per gespeicherter Prozedur befüllte Tabelle) hält das Modell flexibel.',
    options: ['Sichten (SELECT *)', 'Sichten (explizite Spalten)', 'Tabellen per gespeicherter Prozedur', 'Tabellen direkt'],
  },
  'db-type-prefixes': { label: 'Präfixe nach Tabellentyp', question: 'Welche Präfixe für Tabellentypen verwenden Sie in der Datenbank?', options: ['FACT_', 'DIM_', 'BRIDGE_', 'SEC_', 'META_', 'Keine'] },
  'remove-unused': { label: 'Ungenutzte Objekte entfernen', question: 'Entfernen Sie regelmäßig ungenutzte Spalten und Tabellen?', options: ['Ja', 'Bei Gelegenheit', 'Nein'] },
  'tables-extra': { label: 'Weitere Modellierungsregeln', question: 'Gibt es weitere Regeln für Tabellen und Modellierung?', placeholder: 'Freitext…' },

  'has-date-dim': { label: 'Datumsdimension', question: 'Haben Sie eine eigene Datums- bzw. Kalenderdimension?', options: ['Ja', 'Nein', 'Geplant'] },
  'fiscal-usage': { label: 'Geschäftsjahr', question: 'Verwenden Sie ein Geschäftsjahr?', options: ['Nur Kalenderjahr', 'Geschäftsjahr', 'Beides'] },
  'fiscal-start': {
    label: 'Beginn des Geschäftsjahres',
    question: 'Wann beginnt Ihr Geschäftsjahr?',
    help: 'Wählen Sie den Monat, in dem Ihr Geschäftsjahr beginnt (überspringen, wenn Sie nur das Kalenderjahr nutzen).',
    placeholder: 'Anderer Monat…',
    options: ['Januar', 'April', 'Juli', 'Oktober'],
  },
  'auto-datetime': { label: 'Automatisches Datum/Uhrzeit deaktiviert', question: 'Ist „Automatisches Datum/Uhrzeit“ in Ihren Modellen deaktiviert?', options: YES_NO },
  'marked-date-table': { label: 'Als Datumstabelle markiert', question: 'Ist Ihre Datumstabelle als Datumstabelle markiert?', options: YES_NO },
  'date-key-format': { label: 'Format des Datumsschlüssels', question: 'Welches Format hat Ihr Datumsschlüssel?', options: ['INTEGER YYYYMMDD', 'Datentyp Datum', 'Beides'] },
  'split-date-time': { label: 'Datum & Uhrzeit getrennt', question: 'Trennen Sie Datum und Uhrzeit in eigene Spalten?', options: ['Ja', 'Nein', 'Entfällt (keine Uhrzeit)'] },
  'time-intel-cg': { label: 'Berechnungsgruppe Zeitintelligenz', question: 'Nutzen Sie eine Berechnungsgruppe für Zeitintelligenz?', options: ['Ja', 'Nein', 'Geplant'] },

  'flags-format': { label: 'Format von Kennzeichen', question: 'Wie speichern Sie boolesche Kennzeichen?', options: ['Text Yes / No', 'Ganzzahl 0 / 1', 'Y / N'] },
  'pk-format': { label: 'Format des Primärschlüssels', question: 'Welchen Datentyp und welche Konvention hat Ihr Primärschlüssel?', options: ['INTEGER, endet auf „ID“', 'GUID', 'Natürlicher Schlüssel'] },
  'hide-keys': { label: 'Schlüsselspalten ausblenden', question: 'Blenden Sie Fremdschlüssel und Schlüsselspalten aus?', options: YES_NO },
  'mark-pk-key': { label: 'Primärschlüssel als Key markieren', question: 'Setzen Sie Key = True auf Primärschlüsseln?', options: YES_NO },
  'sortby-columns': { label: 'Sortierspalten', question: 'Sind Sortierspalten ganzzahlig und ausgeblendet?', options: YES_NO },
  'nonagg-summarize': { label: 'Nicht aggregierbare Ganzzahlen', question: 'Setzen Sie „Summarize By = None“ auf nicht aggregierbaren Ganzzahlen?', options: YES_NO },
  'weburl-category': { label: 'Datenkategorie für URLs', question: 'Setzen Sie Datenkategorie = WebURL für URL- und Hyperlinkspalten?', options: ['Ja', 'Nein', 'Entfällt'] },

  'currency-format': { label: 'Währungsformat', question: 'Auf welche Formatzeichenfolge für Währung haben Sie sich festgelegt?' },
  'whole-decimals': { label: 'Dezimalstellen ganzer Zahlen', question: 'Wie viele Dezimalstellen haben ganze Zahlen standardmäßig?', options: ['0', '1', '2'] },
  'percent-format': { label: 'Prozentformat', question: 'Welche Formatzeichenfolge verwenden Sie für Prozentwerte?' },
  'measure-suffixes': { label: 'Suffixe von Measures', question: 'Welche Suffixe verwenden Sie für Zeitvergleiche?', options: ['PY / YoY / YTD …', 'Eigene Regel'] },
  'dax-avoid': {
    label: 'DAX-Antimuster vermieden',
    question: 'Vermeiden Sie „/“, IFERROR, SEARCH, CONTAINS, INTERSECT und FILTER (und nutzen stattdessen DIVIDE / TREATAS / KEEPFILTERS)?',
    options: ['Ja', 'Teilweise', 'Nein'],
  },
  'reduce-measures': { label: 'Berechnungsgruppen & Feldparameter', question: 'Verringern Sie die Zahl der Measures mit Berechnungsgruppen und Feldparametern?', options: ['Ja', 'Nein', 'Geplant'] },
  'measure-descriptions': { label: 'Beschreibungen von Measures', question: 'Versehen Sie alle Measures mit Beschreibungen?', options: ['Ja', 'Einige', 'Nein'] },

  'relationship-policy': {
    label: 'Regel für Beziehungen',
    question: 'Wie gehen Sie mit bidirektionalen und m:n-Beziehungen um?',
    options: ['Strikt vermeiden', 'Nur eine Richtung', 'Mit Bedacht erlaubt (CROSSFILTER + IF)'],
  },
  'multi-date-roles': {
    label: 'Mehrere Datumsrollen',
    question: 'Nutzen Sie für mehrere Datumsrollen eine Datumsdimension mit inaktiven Beziehungen und USERELATIONSHIP?',
    options: ['Ja', 'Nein', 'Entfällt'],
  },
  'separate-report-model': { label: 'Trennung Bericht / Modell', question: 'Trennen Sie den Bericht vom semantischen Modell?', options: ['Ja', 'Nein', 'Manchmal'] },
  'page-size': { label: 'Seitengröße im Bericht', question: 'Welche Seitengröße bevorzugen Sie für Berichte?', options: ['1920×1080 (16:9, mehr Pixel)', '1280×720 (16:9, Standard)'] },
  'filter-strategy': { label: 'Filterstrategie', question: 'Bevorzugen Sie den Filterbereich oder Datenschnitte im Bericht?', options: ['Filterbereich bevorzugt', 'Datenschnitte', 'Gemischt'] },
  ibcs: { label: 'IBCS-Standards', question: 'Folgen Sie den IBCS-Standards für Visualisierung?', options: ['Ja', 'Teilweise', 'Nein'] },
  'last-refresh': { label: 'Zeitstempel der letzten Aktualisierung', question: 'Ergänzen Sie einen Zeitstempel der letzten Aktualisierung (je Partition)?', options: ['Ja', 'Nein', 'Geplant'] },
  gateway: {
    label: 'Datengateway',
    question: 'Nutzen Sie ein lokales Datengateway im Standardmodus (statt eines persönlichen Gateways)?',
    options: ['Ja', 'Nein', 'Entfällt (nur Cloud)'],
  },
  'bpa-validation': { label: 'Prüfung mit BPA', question: 'Prüfen Sie Modelle mit dem Best Practice Analyzer von Tabular Editor?', options: ['Ja', 'Nein', 'Geplant'] },
  'extra-standards': { label: 'Weitere Standards', question: 'Gibt es sonst noch etwas, das zu den Standards Ihres Teams gehört?', placeholder: 'Freitext…' },
};
