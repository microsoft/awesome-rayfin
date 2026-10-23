/**
 * The words of the drawings in German, by their English wording.
 *
 * Names of model objects (tables, measures, columns) and DAX stay as they
 * are, like in the guideline text. A test renders every drawing in German and
 * fails when a wording is missing here.
 */
export const FIGURES_DE: Record<string, string> = {
  Do: 'So',
  Avoid: 'Vermeiden',
  'Avoid where possible': 'Möglichst vermeiden',

  'Three ways to connect': 'Drei Arten der Verbindung',
  'Import first. Direct Lake when Import cannot do the job. Direct Query almost never. The dots are a rough orientation, not a benchmark; more dots are better.':
    'Zuerst Import. Direct Lake, wenn Import nicht reicht. Direct Query fast nie. Die Punkte sind eine grobe Orientierung, kein Benchmark; mehr Punkte sind besser.',
  'The default': 'Der Standard',
  'If needed': 'Bei Bedarf',
  'Almost never': 'Fast nie',
  'A copy in memory, as fresh as the last refresh. Start here.': 'Eine Kopie im Speicher, so aktuell wie die letzte Aktualisierung. Beginnen Sie hier.',
  'For very large data, or data that must be fresher than a refresh allows. Reads Delta tables in OneLake.':
    'Für sehr große Daten oder Daten, die aktueller sein müssen, als eine Aktualisierung erlaubt. Liest Delta-Tabellen in OneLake.',
  'Every visual waits for the source. Only when data cannot be copied or must be live to the second.':
    'Jedes Visual wartet auf die Quelle. Nur wenn Daten nicht kopiert werden dürfen oder sekundengenau aktuell sein müssen.',
  'Freshness of data': 'Aktualität der Daten',
  'Query speed': 'Abfragegeschwindigkeit',
  'Modeling features': 'Modellierungsfunktionen',
  'Ease of setup': 'Einfache Einrichtung',

  'Why date and time are split': 'Warum Datum und Uhrzeit getrennt werden',
  'Distinct values for one year of timestamps to the second. Logarithmic scale. Fewer distinct values compress better.':
    'Eindeutige Werte für ein Jahr sekundengenauer Zeitstempel. Logarithmische Skala. Weniger eindeutige Werte komprimieren besser.',
  'Distinct values: one DateTime column 31,536,000; split into a time column 86,400 and a date column 365':
    'Eindeutige Werte: eine DateTime-Spalte 31.536.000; getrennt in eine Uhrzeitspalte 86.400 und eine Datumsspalte 365',
  'One DateTime column': 'Eine DateTime-Spalte',
  'Split: time column': 'Getrennt: Uhrzeit',
  'Split: date column': 'Getrennt: Datum',

  'Shapes of a model': 'Formen eines Modells',
  'One fact table in the middle, one step to every dimension: fewer joins, simpler DAX, better compression.':
    'Eine Faktentabelle in der Mitte, ein Schritt zu jeder Dimension: weniger Joins, einfacheres DAX, bessere Kompression.',
  'Star schema': 'Sternschema',
  Snowflake: 'Schneeflocke',
  'One flat table': 'Eine flache Tabelle',
  'Star schema: a fact table linked directly to four dimensions': 'Sternschema: eine Faktentabelle, direkt mit vier Dimensionen verbunden',
  'Snowflake schema: dimensions that hang off other dimensions': 'Schneeflockenschema: Dimensionen, die an anderen Dimensionen hängen',
  'Flat table: every attribute repeated in one wide table': 'Flache Tabelle: jedes Attribut wiederholt in einer breiten Tabelle',
  'facts and attributes in every row': 'Fakten und Attribute in jeder Zeile',
  Date: 'Datum',
  Subject: 'Fach',
  University: 'Hochschule',
  Student: 'Student',
  Students: 'Studierende',
  State: 'Bundesland',
  Country: 'Land',
  Group: 'Gruppe',
  Faculty: 'Fakultät',
  'Univ.': 'Hochsch.',

  'Division in DAX': 'Division in DAX',
  'DIVIDE handles a zero or blank denominator itself. It returns blank, or the alternative you name as third argument.':
    'DIVIDE fängt einen Nenner von null oder leer selbst ab. Es liefert leer oder die Alternative, die Sie als drittes Argument angeben.',

  'Where measures live': 'Wo Measures liegen',
  'One measure table on top of the field list, display folders by topic, related measures named alike.':
    'Eine Measure-Tabelle oben in der Feldliste, Anzeigeordner nach Thema, verwandte Measures ähnlich benannt.',
  'Scattered over fact tables': 'Verstreut über Faktentabellen',
  'One container, folders by topic': 'Ein Container, Ordner nach Thema',

  'Three layers of a report': 'Drei Ebenen eines Berichts',
  'From the big picture to the single row: each layer answers a different question, and navigation leads from one to the next.':
    'Vom großen Bild zur einzelnen Zeile: Jede Ebene beantwortet eine andere Frage, und die Navigation führt von einer zur nächsten.',
  Overview: 'Überblick',
  'All KPIs at a glance, with deviations.': 'Alle Kennzahlen auf einen Blick, mit Abweichungen.',
  Analysis: 'Analyse',
  'One KPI or KPI group, visualized.': 'Eine Kennzahl oder Gruppe, visualisiert.',
  Details: 'Details',
  'Tables or small multiples.': 'Tabellen oder Small Multiples.',
  'Overview page: a row of KPI cards above a table': 'Überblicksseite: eine Reihe Kennzahlkarten über einer Tabelle',
  'Analysis page: one large column chart with a small side chart': 'Analyseseite: ein großes Säulendiagramm mit einem kleinen Diagramm daneben',
  'Details page: a dense table': 'Detailseite: eine dichte Tabelle',

  'The three-line title': 'Der dreizeilige Titel',
  'Top left on every page: who, what, when. Built with measures, so it follows the filters.':
    'Oben links auf jeder Seite: wer, was, wann. Mit Measures gebaut, damit er den Filtern folgt.',
  'Beispiel-Universität, Faculty of Engineering': 'Beispiel-Universität, Fakultät für Ingenieurwesen',
  '1 who': '1 wer',
  ' in thousand, actual': ' in Tausend, Ist',
  '2 what': '2 was',
  'Winter semesters 2019/20 to 2024/25': 'Wintersemester 2019/20 bis 2024/25',
  '3 when': '3 wann',
  'Students per winter semester, in thousand': 'Studierende je Wintersemester, in Tausend',

  'Structure lies, time stands': 'Struktur liegt, Zeit steht',
  'Categories read like a list, from top to bottom. Time runs from left to right.': 'Kategorien liest man wie eine Liste, von oben nach unten. Zeit läuft von links nach rechts.',
  'Structure: horizontal bars, sorted': 'Struktur: horizontale Balken, sortiert',
  'Time: vertical columns': 'Zeit: vertikale Säulen',
  'Students by subject group in thousand, horizontal bars sorted by size': 'Studierende nach Fächergruppe in Tausend, horizontale Balken nach Größe sortiert',
  'Students per winter semester in thousand, vertical columns': 'Studierende je Wintersemester in Tausend, vertikale Säulen',
  'Law, Economics, Social Sciences': 'Recht, Wirtschaft, Soziales',
  Engineering: 'Ingenieurwissenschaften',
  'Mathematics, Natural Sciences': 'Mathematik, Naturwiss.',
  Humanities: 'Geisteswissenschaften',
  'Medicine, Health': 'Medizin, Gesundheit',
  Other: 'Sonstige',

  'One pattern per scenario': 'Ein Muster je Szenario',
  'The same fill always means the same thing, and the same order, on every page: outlined for plan, lighter for previous year, solid for actual.':
    'Dieselbe Füllung bedeutet immer dasselbe, in derselben Reihenfolge, auf jeder Seite: umrandet für Plan, heller für Vorjahr, voll für Ist.',
  'Students per winter semester: plan outlined, previous year in a lighter fill, actual solid': 'Studierende je Wintersemester: Plan umrandet, Vorjahr heller gefüllt, Ist voll',
  'PY, previous year': 'PY, Vorjahr',
  'AC, actual': 'AC, Ist',
  'PL, plan': 'PL, Plan',
  'Axis cut at 30 thousand to show the pattern. In a report, start bars at zero.': 'Achse bei 30 Tausend abgeschnitten, um das Muster zu zeigen. Im Bericht beginnen Balken bei null.',

  'Same numbers, more information': 'Dieselben Zahlen, mehr Information',
  'A pie needs a legend and a guess at angles. Sorted bars carry label, value and rank in one line.':
    'Ein Kreisdiagramm braucht eine Legende und das Schätzen von Winkeln. Sortierte Balken zeigen Name, Wert und Rang in einer Zeile.',
  'Pie chart': 'Kreisdiagramm',
  'Sorted bars with values': 'Sortierte Balken mit Werten',
  'Students by subject group as a pie chart with a separate legend': 'Studierende nach Fächergruppe als Kreisdiagramm mit getrennter Legende',
  'Students by subject group in thousand as sorted bars': 'Studierende nach Fächergruppe in Tausend als sortierte Balken',

  'A number needs a reference': 'Eine Zahl braucht einen Bezug',
  'The new card visual shows value, reference label and trend in one visual.': 'Das neue Kartenvisual zeigt Wert, Referenzbezeichnung und Trend in einem Visual.',
  'Big number, no context': 'Große Zahl, kein Bezug',
  'Value, deviation, trend': 'Wert, Abweichung, Trend',
  '37.7k': '37,7 Tsd.',
  'Students, winter semester 2024/25': 'Studierende, Wintersemester 2024/25',
  '▲ +2.2 %': '▲ +2,2 %',
  ' vs. PY 36.9k': ' ggü. PY 36,9 Tsd.',
  '▲ +1.3 %': '▲ +1,3 %',
  ' vs. PL 37.2k': ' ggü. PL 37,2 Tsd.',

  'Color means deviation': 'Farbe bedeutet Abweichung',
  'Students ΔPY in percent by subject group. Everything else stays neutral, so the eye lands on what changed. The sign says the same as the color.':
    'Studierende ΔPY in Prozent nach Fächergruppe. Alles andere bleibt neutral, damit der Blick auf das fällt, was sich geändert hat. Das Vorzeichen sagt dasselbe wie die Farbe.',
  'Deviation to previous year in percent by subject group: positive values green to the right, negative values red to the left':
    'Abweichung zum Vorjahr in Prozent nach Fächergruppe: positive Werte grün nach rechts, negative Werte rot nach links',

  // The drawings added on 2026-10-12.
  'Filters flow one way': 'Filter fließen in eine Richtung',
  'From the dimension to the fact. Both directions let every dimension filter every other one through the fact table, with slow and surprising results.':
    'Von der Dimension zur Faktentabelle. In beide Richtungen filtert jede Dimension über die Faktentabelle jede andere, mit langsamen und überraschenden Ergebnissen.',
  'Single direction': 'Eine Richtung',
  'Both directions': 'Beide Richtungen',
  'Dimensions filter the fact table in one direction': 'Dimensionen filtern die Faktentabelle in eine Richtung',
  'Filters in both directions between dimensions and fact': 'Filter in beide Richtungen zwischen Dimensionen und Faktentabelle',

  'Logic belongs upstream': 'Logik gehört vorgelagert',
  'The further upstream a rule lives, short of the source itself, the more models share it and the less each model has to compute.':
    'Je weiter vorgelagert eine Regel liegt, nur nicht in der Quelle selbst, desto mehr Modelle teilen sie und desto weniger muss jedes Modell rechnen.',
  'as far upstream as possible': 'so weit vorgelagert wie möglich',
  Source: 'Quelle',
  'Raw data. Nothing to maintain here.': 'Rohdaten. Hier ist nichts zu pflegen.',
  Warehouse: 'Warehouse',
  'Joins, keys, business logic, history. Views on top.': 'Joins, Schlüssel, Fachlogik, Historie. Darüber Sichten.',
  'Power Query': 'Power Query',
  'Only steps that fold back to the source.': 'Nur Schritte, die an die Quelle zurückgegeben werden (Query Folding).',
  DAX: 'DAX',
  'Measures. No calculated columns or tables.': 'Measures. Keine berechneten Spalten oder Tabellen.',

  'Names people can read': 'Namen, die Menschen lesen können',
  'A model is part of the front end. Its names are read far more often than they are written.':
    'Ein Modell ist Teil der Oberfläche. Seine Namen werden weit öfter gelesen als geschrieben.',
  Why: 'Warum',
  'No technical prefix': 'Kein technisches Präfix',
  "No 'Is'": 'Kein „Is“',
  "No 'Amount', no 'Total'": 'Kein „Amount“, kein „Total“',
  "No redundant 'Name'": 'Kein überflüssiges „Name“',
  'Title Case, words apart': 'Title Case, Wörter getrennt',

  'Anatomy of a measure name': 'Aufbau eines Measure-Namens',
  'Related measures share the base and differ only in the suffixes, so they sort together and explain themselves.':
    'Verwandte Measures teilen die Basis und unterscheiden sich nur in den Suffixen: Sie stehen beieinander und erklären sich selbst.',
  base: 'Basis',
  'what is measured': 'was gemessen wird',
  'time scope': 'Zeitbezug',
  'over which period': 'über welchen Zeitraum',
  comparison: 'Vergleich',
  'against what': 'womit verglichen',
  unit: 'Einheit',
  'always last': 'immer zuletzt',

  'Filters at the side, not on the page': 'Filter an der Seite, nicht auf der Seite',
  'The filter pane costs no canvas and no extra queries. A wall of slicers costs both.':
    'Der Filterbereich kostet keine Fläche und keine zusätzlichen Abfragen. Eine Wand aus Datenschnitten kostet beides.',
  'A wall of slicers': 'Eine Wand aus Datenschnitten',
  'Filter pane, free canvas': 'Filterbereich, freie Fläche',
  'Report page whose upper third is filled with slicers': 'Berichtsseite, deren oberes Drittel mit Datenschnitten gefüllt ist',
  'Report page with the filter pane at the side and the whole canvas for visuals': 'Berichtsseite mit dem Filterbereich an der Seite und der ganzen Fläche für Visuals',

  'What the page is spent on': 'Wofür die Fläche verbraucht wird',
  'Share of the canvas, made-up numbers. Every slicer is also a visual that sends its own query.':
    'Anteil der Fläche, erfundene Zahlen. Jeder Datenschnitt ist auch ein Visual, das eine eigene Abfrage schickt.',
  'Wall of slicers': 'Wand aus Datenschnitten',
  'Filter pane': 'Filterbereich',
  slicers: 'Datenschnitte',
  visuals: 'Visuals',

  'Time with its deviations': 'Zeit mit ihren Abweichungen',
  'Actual as columns, the deviation to the previous year in percent right above, in the same width and on the same time axis. Months with the year below. Applications in thousand, made-up numbers.':
    'Ist als Säulen, die Abweichung zum Vorjahr in Prozent direkt darüber, in gleicher Breite und auf derselben Zeitachse. Monate mit dem Jahr darunter. Bewerbungen in Tausend, erfundene Zahlen.',
  'Applications per month over two years as columns, with the deviation to the previous year in percent above each column':
    'Bewerbungen je Monat über zwei Jahre als Säulen, mit der Abweichung zum Vorjahr in Prozent über jeder Säule',
  Jan: 'Jan',
  Feb: 'Feb',
  Mar: 'Mär',
  Apr: 'Apr',
  May: 'Mai',
  Jun: 'Jun',
  Jul: 'Jul',
  Aug: 'Aug',
  Sep: 'Sep',
  Oct: 'Okt',
  Nov: 'Nov',
  Dec: 'Dez',

  'A table that shows its deviations': 'Eine Tabelle, die ihre Abweichungen zeigt',
  'Numbers for looking up, bars for seeing. Each deviation bar carries its value, and the deviation column is the one the eye finds first.':
    'Zahlen zum Nachschlagen, Balken zum Sehen. Jeder Abweichungsbalken trägt seinen Wert, und die Abweichungsspalte findet das Auge zuerst.',
  'Students, thousand': 'Studierende, Tausend',

  'As few decimals as the reader needs': 'So wenige Dezimalstellen, wie der Leser braucht',
  'A number without format makes the reader do the rounding. Counts never have decimals.':
    'Eine Zahl ohne Format überlässt das Runden dem Leser. Anzahlen haben nie Dezimalstellen.',
  Revenue: 'Umsatz',
  Customers: 'Kunden',
  Margin: 'Marge',
  // The same numbers as a German reader writes them.
  '32000.4567': '32000,4567',
  '$32,000': '32.000 $',
  '1204.00': '1204,00',
  '1,204': '1.204',
  '0.03214': '0,03214',
  '3.2%': '3,2 %',

  'What a larger page buys': 'Was eine größere Seite bringt',
  'The same report, the same font size on screen: the larger page holds a third row without getting crowded.':
    'Derselbe Bericht, dieselbe Schriftgröße am Bildschirm: Die größere Seite fasst eine dritte Reihe, ohne eng zu werden.',
  '1280×720: six visuals': '1280×720: sechs Visuals',
  '1920×1080: nine visuals': '1920×1080: neun Visuals',
  'Report page with six visuals': 'Berichtsseite mit sechs Visuals',
  'Report page with nine visuals': 'Berichtsseite mit neun Visuals',

  'Several stars, shared dimensions': 'Mehrere Sterne, gemeinsame Dimensionen',
  'Two fact tables at their own grain, both filtered by the same Date and Subject. One model answers questions across both.':
    'Zwei Faktentabellen in ihrer eigenen Granularität, beide gefiltert über dieselben Dimensionen Datum und Fach. Ein Modell beantwortet Fragen über beide.',
  'Two fact tables, students and exams, sharing the date and subject dimensions': 'Zwei Faktentabellen, Studierende und Prüfungen, mit gemeinsamen Dimensionen Datum und Fach',
  'Exam type': 'Prüfungsart',
  Exams: 'Prüfungen',

  'SWITCH instead of nested IF': 'SWITCH statt verschachtelter IF',
  'One condition per line reads from top to bottom, and a new case is one more line.': 'Eine Bedingung je Zeile liest sich von oben nach unten, und ein neuer Fall ist eine weitere Zeile.',
  'Name it once with VAR': 'Einmal benennen mit VAR',
  'A variable is computed once, has a name that explains it, and makes the return line readable.':
    'Eine Variable wird einmal berechnet, hat einen Namen, der sie erklärt, und macht die RETURN-Zeile lesbar.',

  'Show what people need, hide the plumbing': 'Zeigen, was Menschen brauchen, die Technik ausblenden',
  'Keys and raw fact columns stay in the model, hidden. The field list shows names a report author can use.':
    'Schlüssel und rohe Faktenspalten bleiben im Modell, ausgeblendet. Die Feldliste zeigt Namen, mit denen Berichtsautoren arbeiten können.',
  'Everything visible': 'Alles sichtbar',
  'Keys and raw columns hidden': 'Schlüssel und Rohspalten ausgeblendet',
};
