/**
 * The Power BI guidelines in German.
 *
 * Generated from content.ts and a numbered list of German texts: the same
 * structure, markers, question links, drawings and addresses, only the words
 * differ. A test holds the two files to the same shape. Change the English
 * file first, then this one in the same place.
 */
import type { GuideSection } from './content';

export const SECTIONS_DE: GuideSection[] = [
  {
    id: "data-integration",
    num: "1",
    title: "Datenintegration",
    icon: "integration",
    subs: [
      {
        num: "1.1",
        title: "Die Verbindung wählen",
        items: [
          {
            marker: "1.",
            title: "Import",
            text: "Der Standard. Schnellste Abfragen und alle Modellierungsfunktionen. Beginnen Sie hier und weichen Sie nur mit Grund ab."
          },
          {
            marker: "2.",
            title: "Direct Lake",
            text: "Bei Bedarf: für sehr große Daten oder Daten, die aktueller sein müssen, als eine geplante Aktualisierung erlaubt, wenn die Daten in OneLake liegen."
          },
          {
            marker: "3.",
            title: "Direct Query",
            text: "Fast nie. Jedes Visual schickt eine Abfrage an die Quelle: Berichte werden langsam und die Quelle trägt die Last. Nur wenn Daten nicht kopiert werden dürfen oder sekundengenau aktuell sein müssen."
          }
        ]
      },
      {
        num: "1.2",
        title: "Nur laden, was gebraucht wird",
        items: [
          {
            marker: "1.",
            title: "Datenmenge reduzieren",
            text: "Laden Sie keine Zeilen oder Spalten, die für die Fragen des Berichts nicht nötig sind."
          },
          {
            marker: "2.",
            title: "Lange Spalten mit hoher Kardinalität reduzieren",
            text: "Vermeiden Sie lange Textspalten (mehr als 100 Zeichen), besonders mit vielen eindeutigen Werten: Sie verlängern die Verarbeitung, blähen das Modell auf und verlangsamen Abfragen."
          },
          {
            q: "split-date-time",
            marker: "3.",
            title: "Datum und Uhrzeit trennen",
            text: "Trennen Sie bei DateTime-Spalten, deren Werte nicht auf Mitternacht liegen, die Uhrzeit vom Datum (oder runden Sie auf Mitternacht), um die Kardinalität der Spalte zu senken."
          },
          {
            marker: "4.",
            title: "Datentypen optimieren",
            text: "Wählen Sie den kleinsten Datentyp, der die Werte fasst."
          },
          {
            marker: "5.",
            title: "Redundante Spalten in verbundenen Tabellen entfernen",
            text: "Wird nur eine benötigt, löschen Sie die anderen aus dem Modell."
          },
          {
            marker: "6.",
            title: "Ungenutzte Quellen entfernen",
            text: "Entfernen Sie Quellen, die im Bericht nicht verwendet oder referenziert werden."
          }
        ]
      },
      {
        num: "1.3",
        title: "Daten vorgelagert aufbereiten",
        items: [
          {
            marker: "1.",
            title: "Power Query-Transformationen minimieren",
            text: "Verlagern Sie Transformationen wo möglich ins Data Warehouse, damit das Modell schneller verarbeitet wird, und prüfen Sie, ob Query Folding stattfindet."
          },
          {
            q: "source-strategy",
            marker: "2.",
            title: "Sichten als Quelle nutzen",
            text: "Eine Sicht schirmt den Bericht gegen Änderungen an den zugrunde liegenden Tabellen ab."
          },
          {
            q: "calc-location",
            marker: "3.",
            title: "Berechnete Spalten und berechnete Tabellen vermeiden",
            text: "Diese Logik gehört ins Backend.",
            children: [
              {
                marker: "a.",
                text: "Reduzieren Sie die Zahl berechneter Spalten: Sie komprimieren schlechter als Datenspalten, brauchen mehr Speicher und verlangsamen die Verarbeitung. Verlagern Sie die Logik ins Warehouse."
              },
              {
                marker: "b.",
                text: "Reduzieren Sie den Einsatz berechneter Tabellen: Verlagern Sie die Logik ins Warehouse, um technische Schulden und Abweichungen zwischen Modellen zu vermeiden."
              },
              {
                marker: "c.",
                text: "Das gilt besonders für berechnete Spalten mit RELATED."
              }
            ]
          }
        ]
      },
      {
        num: "1.4",
        title: "Direct Lake: wann und was zu erwarten ist",
        intro: "Wählen Sie Direct Lake, wenn:",
        items: [
          {
            marker: "•",
            text: "Daten nahezu in Echtzeit aktuell sein müssen."
          },
          {
            marker: "•",
            text: "Sehr große Modelle teuer zu aktualisieren sind oder sich nur inkrementell oder je Partition aktualisieren lassen."
          },
          {
            marker: "",
            title: "Überlegungen & Einschränkungen",
            children: [
              {
                marker: "a.",
                text: "Die Einrichtung ist etwas aufwendiger."
              },
              {
                marker: "b.",
                text: "Nicht alle Datenquellen werden unterstützt."
              },
              {
                marker: "c.",
                text: "„Hilfstabellen“ lassen sich nur über Lakehouse und Verknüpfung (Shortcut) zum Power BI-Warehouse ergänzen."
              },
              {
                marker: "d.",
                text: "Berechnete Tabellen und berechnete Spalten sind nicht möglich."
              },
              {
                marker: "e.",
                text: "Feldparameter lassen sich nur mit Tabular Editor ergänzen und machen dort mehr Aufwand."
              },
              {
                marker: "f.",
                text: "Das Entwerfen von Direct Lake-Modellen in Power BI Desktop hat eigene Einschränkungen. Prüfen Sie sie vorab oder bauen Sie das Modell im Power BI-Dienst.",
                link: {
                  label: "Direct Lake in Power BI Desktop: Überlegungen und Einschränkungen",
                  href: "https://learn.microsoft.com/en-us/fabric/get-started/direct-lake-power-bi-desktop#considerations-and-limitations"
                }
              },
              {
                marker: "g.",
                text: "Für Direct Lake gibt es eine längere Liste weiterer Überlegungen und Einschränkungen, die sich mit der Zeit ändert.",
                link: {
                  label: "Direct Lake im Überblick: Überlegungen und Einschränkungen",
                  href: "https://learn.microsoft.com/en-us/fabric/get-started/direct-lake-overview#considerations-and-limitations"
                }
              }
            ]
          }
        ]
      },
      {
        num: "1.5",
        title: "Gateway und Werkzeuge",
        items: [
          {
            q: "gateway",
            marker: "1.",
            title: "Lokales Datengateway statt persönlichem Gateway verwenden",
            text: "Das Standardgateway wird zentral verwaltet, kann von vielen gemeinsam genutzt werden und bedient auch Direct Query und Liveverbindungen. Der persönliche Modus bedient nur Import und gehört einer Person (gilt, wenn die Quelle lokal liegt)."
          },
          {
            marker: "2.",
            title: "Updates von Power BI Desktop",
            text: "Arbeiten Sie mit der aktuellen Version, um Abweichungen zur Live-Version oder zu Kolleginnen und Kollegen zu vermeiden."
          }
        ]
      }
    ]
  },
  {
    id: "data-modeling",
    num: "2",
    title: "Datenmodellierung",
    icon: "modeling",
    subs: [
      {
        num: "2.1",
        title: "Schema",
        items: [
          {
            q: "schema-approach",
            marker: "1.",
            title: "Ein Sternschema bauen",
            text: "Ziehen Sie wo möglich ein Sternschema einem Schneeflockenschema vor: Es ist für tabellarische Modelle optimal. Vermeiden Sie auch flache Tabellen."
          },
          {
            q: "galaxy-schema",
            marker: "2.",
            title: "Mehrere Sterne, gemeinsame Dimensionen",
            text: "Ziehen Sie ein Galaxy-Schema (mehrere Sterne) einem einzigen großen Sternschema vor: Das erlaubt unterschiedliche Granularität und ist auch für die Leistung optimal."
          },
          {
            marker: "3.",
            title: "Kennzahlen in Spalten",
            text: "Kennzahlen gehören in Spalten, nicht in Zeilen: Anders als andere BI-Werkzeuge arbeitet Power BI am besten mit Kennzahlen in getrennten Spalten."
          },
          {
            q: "separate-report-model",
            marker: "4.",
            title: "Bericht und semantisches Modell trennen",
            text: "Tun Sie das, wenn mehr als ein Bericht das Modell als Quelle nutzt."
          }
        ]
      },
      {
        num: "2.2",
        title: "Beziehungen",
        items: [
          {
            marker: "1.",
            title: "1:n bevorzugen",
            text: "Ziehen Sie „1:n“ den „m:n“-Beziehungen vor, um die Leistung zu steigern: Brückentabellen helfen, m:n zu vermeiden."
          },
          {
            q: "relationship-policy",
            marker: "2.",
            title: "Eine Richtung",
            text: "Filtern Sie in eine Richtung, auch bei m:n-Beziehungen."
          },
          {
            marker: "3.",
            title: "Ausnahmen prüfen",
            text: "Prüfen Sie, ob bidirektionale und m:n-Beziehungen berechtigt sind: Sie können die Leistung verschlechtern oder unbeabsichtigte Folgen haben."
          },
          {
            marker: "4.",
            title: "Verletzungen der referenziellen Integrität beheben",
            text: "Stellen Sie sicher, dass die Primärschlüsselspalte der Zieltabelle alle Werte der Fremdschlüsselspalte der Ausgangstabelle enthält: Verletzungen erzeugen außerdem einen leeren Eintrag in Datenschnitten."
          }
        ]
      },
      {
        num: "2.3",
        title: "Datum und Zeit",
        items: [
          {
            q: "has-date-dim",
            marker: "1.",
            title: "Eine Datumstabelle in jedem Modell",
            text: "Modelle sollten mindestens eine Datumstabelle haben, um Funktionen wie Zeitintelligenz und eine saubere Struktur zu nutzen."
          },
          {
            q: "marked-date-table",
            marker: "2.",
            title: "Als Datumstabelle markieren",
            text: "Datums- und Kalendertabellen sollten als Datumstabelle markiert sein."
          },
          {
            q: "auto-datetime",
            marker: "3.",
            title: "Automatisches Datum/Uhrzeit ausschalten",
            text: "Deaktivieren Sie „Automatisches Datum/Uhrzeit“ in den Einstellungen von Power BI Desktop und entfernen Sie automatisch erzeugte Datumstabellen, um Speicher zu sparen."
          }
        ]
      },
      {
        num: "2.4",
        title: "Spalten und Schlüssel",
        items: [
          {
            q: "hide-keys",
            marker: "1.",
            title: "Fremdschlüssel ausblenden",
            text: "Fremdschlüssel sollten immer ausgeblendet sein."
          },
          {
            marker: "2.",
            title: "Spalten der Faktentabelle ausblenden",
            text: "Blenden Sie Spalten der Faktentabelle aus, die in Measures aggregiert werden."
          },
          {
            q: "mark-pk-key",
            marker: "3.",
            title: "Primärschlüssel kennzeichnen",
            text: "Setzen Sie für Primärschlüsselspalten die Eigenschaft „Key“ auf „True“."
          },
          {
            q: "remove-unused",
            marker: "4.",
            title: "Unnötige Spalten entfernen",
            text: "Ausgeblendete Spalten, auf die kein DAX-Ausdruck, keine Beziehung, keine Hierarchieebene und keine Sortierspalte verweist, sollten entfernt werden."
          },
          {
            q: "flags-format",
            marker: "5.",
            title: "Kennzeichenspalten als Yes/No formatieren",
            text: "Yes/No liest sich leichter als 0/1."
          }
        ]
      },
      {
        num: "2.5",
        title: "Measures",
        items: [
          {
            marker: "1.",
            title: "Explizite Measures erstellen",
            text: "Verlassen Sie sich nicht auf die automatische Aggregation einer Spalte."
          },
          {
            q: "empty-measure-table",
            marker: "2.",
            title: "Measure-Tabellen als Container verwenden",
            text: "Halten Sie Measures in einer Containertabelle mit dem Namen „{{measure-table-name}}“.",
            children: [
              {
                marker: "a.",
                text: "Eine Measure-Tabelle ist theoretisch nicht nötig, wenn alle Spalten der Faktentabelle ausgeblendet sind (vollständig denormalisiert)."
              },
              {
                marker: "b.",
                text: "In allen anderen Fällen legen Sie unbedingt eine Measure-Tabelle an: Das hilft auch während der Entwicklung."
              },
              {
                marker: "c.",
                title: "Vorteile",
                children: [
                  {
                    marker: "i.",
                    text: "Measures sind leicht zu finden: ganz oben, mit einheitlichem Namen."
                  },
                  {
                    marker: "ii.",
                    text: "Measures aus mehreren Faktentabellen lassen sich zusammen gruppieren (z. B. Ist gegen Plan)."
                  }
                ]
              }
            ]
          },
          {
            marker: "3.",
            title: "Anzeigeordner verwenden",
            children: [
              {
                marker: "a.",
                text: "Gruppieren Sie Measures und andere Felder in Ordnern und Unterordnern."
              },
              {
                marker: "b.",
                text: "Geben Sie Ordnern und Unterordnern sprechende Namen."
              },
              {
                marker: "c.",
                text: "Ordner legen Sie an über Modell → Measure auswählen → Eigenschaften → Anzeigeordner. Derselbe Name gruppiert Measures zusammen."
              }
            ]
          },
          {
            marker: "4.",
            title: "Unnötige Measures entfernen",
            text: "Ausgeblendete Measures, auf die kein DAX-Ausdruck verweist, sollten der Wartbarkeit wegen entfernt werden."
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
            title: "DIVIDE für Divisionen verwenden",
            text: "Verwenden Sie DIVIDE statt des Operators „/“: Das fängt Divisionen durch null ab und vermeidet Fehler."
          },
          {
            marker: "2.",
            title: "DAX-Variablen verwenden",
            text: "Verwenden Sie VAR in einem DAX-Ausdruck, wenn Sie innerhalb einer Funktion auf etwas verweisen müssen."
          },
          {
            marker: "3.",
            title: "SWITCH statt verschachtelter IF verwenden",
            text: "SWITCH(TRUE(), …) ist effizienter als verschachtelte IF/ELSE."
          },
          {
            marker: "4.",
            title: "IFERROR vermeiden",
            text: "Es kann die Leistung verschlechtern. Für Divisionen durch null verwenden Sie DIVIDE."
          },
          {
            marker: "5.",
            title: "TREATAS statt INTERSECT verwenden",
            text: "TREATAS ist für virtuelle Beziehungen effizienter."
          }
        ]
      },
      {
        num: "2.7",
        title: "Formate",
        intro: "Aus dem Tabular Style Guide.",
        items: [
          {
            q: "currency-format",
            marker: "1.",
            text: "Währung, keine Dezimalstellen ($32,000): \\$#,0;(\\$#,0);\\$#,0"
          },
          {
            q: "whole-decimals",
            marker: "2.",
            text: "Ganze Zahl, keine Dezimalstellen, Tausendertrennzeichen (32,000): #,0. Eine Dezimalstelle (#,0.0) nur wenn nötig, nie beim Zählen (z. B. Kunden)."
          },
          {
            q: "percent-format",
            marker: "3.",
            text: "Prozent, eine Dezimalstelle, Tausendertrennzeichen (3,200.1%): #,0.0%;-#,0.0%;#,0.0%. So wenige Dezimalstellen wie möglich."
          }
        ]
      },
      {
        num: "2.8",
        title: "Sicherheit und Leistung",
        items: [
          {
            marker: "1.",
            title: "Daten mit RLS oder OLS absichern",
            text: "Sicherheit auf Zeilenebene schränkt Zeilen ein, Sicherheit auf Objektebene Tabellen und Spalten; beides wird über Rollen definiert. Ausblenden, private Tabellen und Perspektiven sind keine Sicherheit. Jeder Benutzer gehört in eine Rolle: Mitgliedschaft in mehreren Rollen kombiniert deren Filter, und wer zugleich in einer RLS- und einer OLS-Rolle ist, erhält Fehler."
          },
          {
            marker: "2.",
            title: "Prüfen, ob dynamische RLS nötig ist",
            text: "Dynamische Sicherheit auf Zeilenebene kostet Speicher und Leistung: Wägen Sie Nutzen und Aufwand ab."
          },
          {
            marker: "3.",
            title: "Aggregationen mit Direct Query erwägen",
            text: "Bei Direct Query in Power BI Premium können Aggregationen die Leistung steigern."
          }
        ]
      },
      {
        num: "2.9",
        title: "Bausteine wiederverwenden",
        intro: "Halten Sie diese Bausteine in einer gemeinsamen Snippet-Sammlung und fügen Sie sie über die TMDL-Ansicht ein:",
        items: [
          {
            marker: "•",
            text: "Kalendertabelle."
          },
          {
            q: "time-intel-cg",
            marker: "•",
            text: "Berechnungsgruppen (Zeitintelligenz, Einheiten)."
          },
          {
            marker: "•",
            text: "Parameter."
          },
          {
            q: "last-refresh",
            marker: "•",
            text: "Fußzeile: Zeitstempel der letzten Aktualisierung; Parametertabelle und Measure für die Datenquelle."
          },
          {
            q: "measure-descriptions",
            marker: "•",
            text: "Beschreibungen für alle Measures."
          },
          {
            marker: "•",
            text: "Detailzeilenausdrücke für alle Anzeigeordner (Gruppen von Measures)."
          }
        ]
      },
      {
        num: "2.10",
        title: "Benennung: das Wichtigste",
        items: [
          {
            marker: "1.",
            text: "Verwenden Sie {{naming-casing}} für sichtbare Objekte; Tabellenpräfixe: {{dim-fact-prefix}}."
          },
          {
            marker: "2.",
            text: "Objektnamen sollten nicht mit einem Leerzeichen beginnen oder enden."
          },
          {
            marker: "3.",
            text: "Sonderzeichen in Objektnamen: {{special-chars}}."
          },
          {
            marker: "4.",
            text: "Qualifizierung von Verweisen: {{reference-qualification}} (z. B. TableName[Column Name], [Measure Name])."
          },
          {
            marker: "5.",
            text: "Verweise auf Measures sollten unqualifiziert sein, z. B. [Measure Name]."
          },
          {
            marker: "6.",
            text: "Geben Sie Tabellen, Spalten und Measures sprechende fachliche Namen ohne allzu kurze Abkürzungen."
          },
          {
            marker: "7.",
            title: "Verwandte Measures ähnlich benennen",
            text: "z. B. Target Frequency, Target Coverage, …",
            children: [
              {
                marker: "a.",
                text: "AC, PY, PM, PL, YTD, MTD, ΔPY, ΔPY %, ΔPL, ΔPL %."
              },
              {
                marker: "b.",
                text: "avg. (vermeiden Sie „Ø“ im internationalen Umfeld)."
              },
              {
                marker: "c.",
                text: "Mio., k (vermeiden Sie „billion“ im deutschen Umfeld)."
              }
            ]
          }
        ]
      },
      {
        num: "2.11",
        title: "Tabular Style Guide",
        intro: "Ein weit verbreiteter Standard für Namen und Formate in tabellarischen Modellen von Michael Kovalsky (Elegant BI). Ein Modell ist Teil der Oberfläche: Menschen sehen seine Tabellen, Spalten und Measures, also sollten Namen und Formate für sie gemacht sein. Viele dieser Regeln lassen sich mit dem Best Practice Analyzer automatisch prüfen. Wo Ihre Organisation anders entschieden hat, steht ihre Antwort neben der Regel.",
        link: {
          label: "elegantbi.com: Tabular Style Guide",
          href: "https://www.elegantbi.com/post/tabularstyleguide"
        },
        items: [
          {
            marker: "",
            title: "Allgemeine Regeln (alle Objekte)",
            children: [
              {
                q: "words-spaces",
                marker: "•",
                text: "Trennen Sie Wörter in allen sichtbaren Objekten immer durch Leerzeichen."
              },
              {
                q: "naming-casing",
                marker: "•",
                text: "Verwenden Sie immer Title Case."
              },
              {
                marker: "•",
                text: "Vermeiden Sie diese Zeichen: [ ] { } ' \" = & * : ; . / \\ # @ ! _ = ^."
              },
              {
                q: "reserved-words",
                marker: "•",
                title: "Diese Wörter vermeiden",
                children: [
                  {
                    marker: "•",
                    text: "Reservierte Wörter (Table, Measure, Column, KPI): außer einer Hierarchie namens „Hierarchy“."
                  },
                  {
                    marker: "•",
                    text: "„Total“: vermeidet Zwischen- und Gesamtsummen der Art „Total Total…“."
                  },
                  {
                    marker: "•",
                    text: "„Is“: vermeidet Spalten wie „IsActive“ statt „Active Flag“."
                  },
                  {
                    marker: "•",
                    text: "„Amount“, „Value“: oft überflüssig (ein Measure „Sales Amount“ kann einfach „Sales“ heißen)."
                  },
                  {
                    marker: "•",
                    text: "„Name“: manchmal zulässig („Customer Name“), aber oft überflüssig („Region Name“ → „Region“)."
                  }
                ]
              }
            ]
          },
          {
            marker: "",
            title: "Tabellen",
            children: [
              {
                marker: "•",
                text: "Vermeiden Sie das Wort „Hierarchy“ in Tabellennamen."
              },
              {
                q: "db-type-prefixes",
                marker: "•",
                title: "Fünf Tabellentypen",
                text: "Name im Modell → Name der Sicht in der Datenbank:",
                children: [
                  {
                    marker: "•",
                    text: "Fakten: Revenue → FACT_Revenue."
                  },
                  {
                    marker: "•",
                    text: "Dimension: Geography → DIM_Geography."
                  },
                  {
                    marker: "•",
                    text: "Brücke: GeographyBridge → BRIDGE_Geography."
                  },
                  {
                    marker: "•",
                    text: "Sicherheit: UserGeography → SEC_UserGeography."
                  },
                  {
                    marker: "•",
                    text: "Metadaten: Data Dictionary → META_DataDictionary."
                  },
                  {
                    marker: "•",
                    text: "Hinweis: GeographyBridge und UserGeography haben keine Leerzeichen: zulässig, weil sie ausgeblendet sind."
                  }
                ]
              },
              {
                marker: "•",
                title: "Ausgeblendete und private Tabellen",
                text: "Ausgeblendete Tabellen lassen sich mit der Eigenschaft „private“ in Tabular Editor vollständig aus dem semantischen Modell nehmen. Das darf nicht zum Absichern von Tabellen dienen: IntelliSense greift dort nicht, aber Benutzer könnten trotzdem Measures darauf schreiben. Nutzen Sie es für Brücken- oder Benutzerrollentabellen, nie für ausgeblendete Faktentabellen (die nicht privat bleiben sollten, damit berichtsspezifische Measures möglich sind)."
              }
            ]
          },
          {
            marker: "",
            title: "Kalenderdimension",
            children: [
              {
                marker: "•",
                text: "Immer als Datumstabelle markieren."
              },
              {
                q: "date-key-format",
                marker: "•",
                text: "Der Primärschlüssel (DateId) muss vom Datentyp INTEGER im Format YYYYMMDD sein."
              },
              {
                marker: "•",
                text: "Datum und Uhrzeit immer trennen (Kalender mit Granularität „Tag“; Uhrzeit feiner, z. B. Stunde oder Minute)."
              }
            ]
          },
          {
            marker: "",
            title: "Partitionen und Sichten",
            children: [
              {
                marker: "•",
                title: "Bei Tabellen mit einer Partition muss die Partition wie die Tabelle heißen",
                children: [
                  {
                    marker: "•",
                    text: "Nutzen Sie immer einfache Sichten (SELECT * FROM [Schema].[View]). Sichten entkoppeln die Datenbankschicht vom Modell, erlauben schnelle Änderungen, lassen mehrere Modelle dieselbe Tabelle abfragen und beschleunigen die Entwicklung deutlich: besonders in Tabular Editor."
                  },
                  {
                    marker: "•",
                    text: "Sichten sollten keine Logik enthalten: Sämtliche Logik gehört in gespeicherte Prozeduren bzw. die Datenbankschicht."
                  },
                  {
                    marker: "•",
                    text: "Das Schema der Sichten sollte der (abgekürzte) Modellname mit angehängtem „View“ sein (z. B. WWIView für das Modell Worldwide Importers)."
                  }
                ]
              },
              {
                marker: "•",
                title: "Bei Tabellen mit mehreren Partitionen müssen die Partitionsnamen mit dem Tabellennamen beginnen",
                children: [
                  {
                    marker: "•",
                    text: "Beispiele (Tabelle = Revenue): Revenue FY19, Revenue FY20; Revenue FY19-Q1, Revenue FY19-Q2; Revenue FY19-M01, Revenue FY19-M02."
                  },
                  {
                    marker: "•",
                    text: "Partitionieren Sie auch in der Datenbankschicht: Das erlaubt paralleles Erstellen (spart Zeit) und einfache Abfragen mit SELECT *, oder den Aufruf einer gespeicherten Prozedur mit Parameterfilter."
                  }
                ]
              }
            ]
          },
          {
            marker: "",
            title: "Spalten",
            children: [
              {
                marker: "•",
                title: "Kennzeichen",
                children: [
                  {
                    marker: "•",
                    text: "Müssen vom Datentyp STRING sein."
                  },
                  {
                    marker: "•",
                    text: "Gültige Werte: Yes, No, N/A, Unknown."
                  },
                  {
                    marker: "•",
                    text: "Nie 0/1 oder Y/N verwenden."
                  },
                  {
                    marker: "•",
                    text: "Müssen als Kennzeichen benannt sein (z. B. „Active Flag“)."
                  }
                ]
              },
              {
                q: "pk-format",
                marker: "•",
                title: "Primärschlüssel",
                children: [
                  {
                    marker: "•",
                    text: "Datentyp INTEGER, enden auf „ID“, Key = True in den Eigenschaften, in der Regel ausgeblendet, außer Endbenutzer brauchen sie."
                  }
                ]
              },
              {
                marker: "•",
                title: "Fremdschlüssel",
                children: [
                  {
                    marker: "•",
                    text: "Datentyp INTEGER, enden auf „ID“, immer ausgeblendet, heißen wie der zugehörige Primärschlüssel."
                  }
                ]
              },
              {
                q: "sortby-columns",
                marker: "•",
                title: "Sortierspalten",
                text: "Datentyp INTEGER, müssen ausgeblendet sein."
              },
              {
                marker: "•",
                title: "Aggregierbare Spalten",
                text: "INTEGER, CURRENCY oder DECIMAL; ausgeblendet, mit einem Measure auf der Spalte; keine Leerzeichen im Spaltennamen."
              },
              {
                q: "nonagg-summarize",
                marker: "•",
                title: "Nicht aggregierbare Ganzzahlspalten",
                text: "Setzen Sie „Summarize By“ auf „None“ bzw. „Nicht zusammenfassen“, damit sie nie versehentlich aggregiert werden."
              },
              {
                marker: "•",
                text: "Spalten in der Datenbankschicht (einschließlich Sichten) sollten keine Leerzeichen enthalten: Leerzeichen kommen in der Eigenschaft „Name“ des Modells hinzu."
              },
              {
                marker: "•",
                title: "Verweise",
                text: "Spalten, auf die Measures verweisen, tragen immer das Tabellenpräfix."
              },
              {
                marker: "•",
                text: "Primärschlüssel der Dimensionstabellen sollten alle Werte der Fremdschlüssel jeder verbundenen Faktentabelle enthalten: keine leeren Einträge."
              },
              {
                q: "weburl-category",
                marker: "•",
                text: "Kennzeichnen Sie URLs und Hyperlinks in den Spalteneigenschaften mit Datenkategorie = WebURL."
              }
            ]
          },
          {
            marker: "",
            title: "Measures",
            children: [
              {
                marker: "•",
                title: "Benennung",
                children: [
                  {
                    marker: "•",
                    text: "Sprechend, aber so kurz wie möglich."
                  },
                  {
                    marker: "•",
                    text: "Präfixe: Avg; Produktangaben (z. B. Azure …)."
                  },
                  {
                    q: "measure-suffixes",
                    marker: "•",
                    text: "Suffixe: YoY, QoQ, MoM, YTD, QTD, MTD, PY, PQ, PM, TTM, VTB, VTF; YoY %, QoQ %, MoM %. Das %-Zeichen steht immer am Ende."
                  },
                  {
                    marker: "•",
                    text: "Beispiele: Billed Revenue · Billed Revenue PM · Billed Revenue MoM % · Billed Revenue YoY · Billed Revenue YTD PY · Billed Revenue YTD YoY % · Azure Billed Revenue Customer Count TTM."
                  }
                ]
              },
              {
                marker: "•",
                title: "Verweise",
                text: "Measures, auf die andere Measures verweisen, tragen nie das Tabellenpräfix."
              },
              {
                marker: "•",
                title: "Abkürzungen im Überblick",
                text: "YoY = Jahr gegen Vorjahr · QoQ = Quartal gegen Vorquartal · MoM = Monat gegen Vormonat · YTD/QTD/MTD = seit Jahres-, Quartals-, Monatsbeginn · PY/PQ/PM = Vorjahr, Vorquartal, Vormonat · TTM = letzte 12 Monate · VTB = Abweichung zum Budget · VTF = Abweichung zur Prognose."
              },
              {
                marker: "•",
                text: "Statt PY für das Vorjahr ist auch Y-1 zulässig: wichtig, wenn Y-2 eine fachlich relevante Kennzahl ist."
              },
              {
                marker: "•",
                text: "Für Ziel- und Budgetwerte wird oft „PL“ statt BUD bevorzugt (BU könnte mit Business Unit verwechselt werden, und ein dreistelliges BUD passt schlecht zum zweistelligen PY)."
              }
            ]
          },
          {
            marker: "",
            title: "Hierarchien",
            children: [
              {
                marker: "•",
                text: "Müssen das Suffix „Hierarchy“ tragen (z. B. „Geography Hierarchy“)."
              },
              {
                marker: "•",
                text: "Attribute der Hierarchie müssen wie die jeweiligen Spalten außerhalb der Hierarchie heißen."
              },
              {
                marker: "•",
                text: "Die Reihenfolge muss der natürlichen Ordnung der Hierarchie entsprechen (Granularität, Drilldown)."
              },
              {
                marker: "•",
                text: "Das erleichtert die Arbeit mit externen Werkzeugen wie Tabular Editor."
              }
            ]
          },
          {
            marker: "",
            title: "Anzeigeordner",
            children: [
              {
                marker: "•",
                text: "Ordner können zwei oder mehr Measures oder Spalten derselben Tabelle gruppieren."
              },
              {
                marker: "•",
                text: "Bei mehreren Ordnerebenen (Drill) gliedern Sie so, wie Ihre Benutzer diese Measures und Spalten einteilen."
              }
            ]
          },
          {
            marker: "",
            title: "Beziehungen, Datenquellen und Perspektiven",
            children: [
              {
                marker: "•",
                title: "Beziehungen",
                text: "Werden automatisch benannt: keine Namensregeln nötig."
              },
              {
                marker: "•",
                title: "Datenquellen",
                text: "Drei Bestandteile: Provider, Data Source, Initial Catalog (z. B. „SqlServer ServerName DatabaseName“)."
              },
              {
                marker: "•",
                title: "Perspektiven",
                text: "Keine zusätzlichen Regeln über die allgemeinen hinaus."
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
    title: "Datenvisualisierung",
    icon: "report",
    subs: [
      {
        num: "3.1",
        title: "Seite und Layout",
        items: [
          {
            marker: "1.",
            title: "Drei-Ebenen-Konzept",
            text: "Gliedern Sie den Bericht in zwei, besser drei Ebenen:",
            children: [
              {
                marker: "a.",
                text: "Überblick: alle Kennzahlen als Kacheln oder Karten, oder besser eine Tabelle mit prozentualen Abweichungen zum Ziel."
              },
              {
                marker: "b.",
                text: "Analyse: einzelne Kennzahl (oder Gruppe) mit Visualisierung."
              },
              {
                marker: "c.",
                text: "Details: Tabellen oder Small Multiples."
              }
            ]
          },
          {
            marker: "2.",
            title: "Dreizeiligen Titel verwenden (oben links auf jeder Seite)",
            text: "Machen Sie ihn wo möglich mit SELECTEDVALUE dynamisch.",
            children: [
              {
                marker: "a.",
                text: "Unternehmen + Bereich."
              },
              {
                marker: "b.",
                text: "Kennzahlen fett, mit Einheit und Währung."
              },
              {
                marker: "c.",
                text: "Zeitraum."
              }
            ]
          },
          {
            marker: "3.",
            title: "Eine Seitengröße für alle Berichte verwenden: {{page-size}}",
            text: "Eine größere 16:9-Seite behält das Seitenverhältnis des Standards und bietet mehr Pixel.",
            children: [
              {
                marker: "a.",
                text: "Kein Nachteil: Der Bericht kann fast gleich aussehen; das Standarddesign gleicht mit größerer Schrift aus."
              },
              {
                marker: "b.",
                text: "Nur Vorteile: Visuals können etwas kleiner werden, für mehr Informationsdichte ohne Verlust an Klarheit."
              }
            ]
          },
          {
            marker: "4.",
            text: "Verwenden Sie die Vorlage und das Design mit eingebettetem Hintergrund. Bauen Sie den Hintergrund nicht in Power BI aus Formen und Einzelelementen."
          },
          {
            marker: "5.",
            title: "Seiten zum Scrollen vermeiden",
            text: "Nutzen Sie ein Navigationskonzept über mehrere Seiten; bei Visuals mit Scrollbalken fassen Sie kleine Segmente zu „Sonstige“ zusammen."
          }
        ]
      },
      {
        num: "3.2",
        title: "Filter und Navigation",
        items: [
          {
            q: "filter-strategy",
            marker: "1.",
            title: "Filterbereich statt Datenschnitten im Bericht verwenden",
            children: [
              {
                marker: "a.",
                text: "Ausnahme: Datenschnitte, die für die richtige Aussage entscheidend sind. Sie sollten wie ein Visualtitel wirken oder eng eingebunden sein (z. B. Feldparameter in einem transparenten Datenschnitt über Karten)."
              },
              {
                marker: "b.",
                text: "Setzen Sie Datenschnitte sparsam ein: Zu viele verlangsamen den Bericht drastisch."
              }
            ]
          },
          {
            marker: "2.",
            text: "Verwenden Sie eine Navigation im Bericht statt der eingebauten Navigation."
          },
          {
            marker: "3.",
            title: "Power BI-Lesezeichen für Berichtsfunktionen vermeiden",
            children: [
              {
                marker: "a.",
                text: "Verwenden Sie die Aktion „Seitennavigation“ auf Schaltflächen."
              },
              {
                q: "reduce-measures",
                marker: "b.",
                text: "Verwenden Sie Feldparameter für Kennzahlen und Attribute."
              }
            ]
          },
          {
            marker: "4.",
            text: "Verwenden Sie Kreuzfilterung statt Kreuzhervorhebung."
          },
          {
            marker: "5.",
            title: "QuickInfos verwenden",
            text: "Berichts-QuickInfos zeigen zusätzliche Information auf wenig Raum und erhöhen die Informationsdichte."
          },
          {
            marker: "6.",
            title: "Unnötige Interaktionen zwischen Visuals entfernen",
            text: "Das verringert die Zahl der Abfragen an das Backend und verbessert die Leistung."
          }
        ]
      },
      {
        num: "3.3",
        title: "Diagramme und Farbe",
        intro: "Steigern Sie Effizienz und Wirkung von Berichten durch einheitliche visuelle Muster.",
        items: [
          {
            q: "ibcs",
            marker: "1.",
            title: "Abweichungen in den Mittelpunkt stellen",
            text: "Zu Plan, Vorperiode und/oder Prognose."
          },
          {
            marker: "2.",
            title: "Ausrichtung von Diagrammen",
            children: [
              {
                marker: "a.",
                title: "Struktur → horizontale Diagramme",
                children: [
                  {
                    marker: "i.",
                    text: "Horizontale Balkendiagramme (keine Säulendiagramme) mit mehreren Ebenen."
                  },
                  {
                    marker: "ii.",
                    text: "Tabellen."
                  }
                ]
              },
              {
                marker: "b.",
                title: "Zeit → vertikale Diagramme",
                children: [
                  {
                    marker: "i.",
                    text: "Vertikale Säulendiagramme (mit integrierten Abweichungen)."
                  },
                  {
                    marker: "ii.",
                    text: "Liniendiagramme."
                  }
                ]
              }
            ]
          },
          {
            marker: "3.",
            title: "Muster der Balken",
            children: [
              {
                marker: "a.",
                text: "Umrandeter Balken: Planwerte = PL."
              },
              {
                marker: "b.",
                text: "Hellere Füllung: Vorjahreswerte = PY."
              },
              {
                marker: "c.",
                text: "Gefüllte Farbe: Ist-Werte = AC."
              }
            ]
          },
          {
            marker: "4.",
            title: "Farben sollen etwas bedeuten",
            children: [
              {
                marker: "a.",
                text: "Setzen Sie Farbe gezielt ein."
              },
              {
                marker: "b.",
                text: "Reservieren Sie Rot und Grün für Abweichungen und färben Sie nach Wirkung, nicht nach Vorzeichen: Kosten, die gegenüber dem Vorjahr gestiegen sind, sind rot."
              }
            ]
          },
          {
            marker: "5.",
            title: "Visuals mit geringer Informationsdichte vermeiden",
            text: "Vor allem Kreisdiagramme und Messgeräte (Gauges), aber auch Ringdiagramme, Treemaps, Mekko, Bullet Charts und Flächenkartogramme (wenn eine Karte wirklich nötig ist, setzen Sie darauf „proportionale Kreisdiagramme“)."
          },
          {
            marker: "6.",
            title: "Die „neue Karte“ verwenden",
            children: [
              {
                marker: "a.",
                text: "Ein Visual statt vieler einzelner alter Karten."
              },
              {
                marker: "b.",
                text: "Vermeiden Sie „große Zahlen“ ohne Bezug: Ergänzen Sie Referenzbezeichnungen, besser Sparklines."
              }
            ]
          },
          {
            marker: "7.",
            title: "Leistung benutzerdefinierter Visuals vor dem Einsatz testen",
            text: "Nicht zertifizierte benutzerdefinierte Visuals werden vom Power BI-Team nicht getestet: Testen Sie sie in Desktop und im Dienst."
          }
        ]
      }
    ]
  }
];
