/**
 * Reference information for the AIS ship-type classes present in the data.
 *
 * 🔴 **This describes a class, never a vessel.** The app cannot identify the ship you clicked —
 * MMSI, name, call sign, IMO and destination were dropped at ingest in Phase 3 and have never
 * existed in anything the browser downloads. So there is no photograph of *that* ship to show,
 * and fetching one would require exactly the identifier the pipeline exists to destroy.
 *
 * What is shown instead is honest about what it is: a silhouette of the class, drawn here rather
 * than sourced, and a description of what that class means. The class itself is real — it is the
 * ship-type field the vessel broadcasts under ITU-R M.1371, reported by the Danish feed.
 *
 * The silhouettes are deliberately schematic. A photorealistic image beside a specific vessel's
 * measured track would imply the app knows which ship it is, which is the one thing it must not
 * imply.
 */

export interface VesselClass {
  label: string;
  description: string;
  typicalLength: string;
  /** SVG path in a 0 0 120 44 viewBox, waterline at y = 34. */
  silhouette: string;
}

const HULL_CARGO =
  "M6 34 L114 34 L110 26 L14 26 Z M22 26 L22 20 L34 20 L34 26 Z M86 26 L86 14 L104 14 L104 26 Z"
  + " M44 26 L44 12 L47 12 L47 26 Z M64 26 L64 12 L67 12 L67 26 Z";

const HULL_TANKER =
  "M6 34 L114 34 L110 25 L14 25 Z M84 25 L84 12 L104 12 L104 25 Z"
  + " M30 25 L30 21 L38 21 L38 25 Z M50 25 L50 21 L58 21 L58 25 Z M70 25 L70 21 L78 21 L78 25 Z";

const HULL_PASSENGER =
  "M8 34 L112 34 L108 27 L16 27 Z M20 27 L20 20 L100 20 L100 27 Z"
  + " M28 20 L28 13 L92 13 L92 20 Z M40 13 L40 8 L78 8 L78 13 Z M56 8 L56 3 L60 3 L60 8 Z";

const HULL_SAILING =
  "M26 34 L94 34 L90 28 L32 28 Z M59 28 L59 2 L61 2 L61 28 Z"
  + " M62 6 L62 26 L86 26 Z M58 8 L58 26 L40 26 Z";

const HULL_SMALL =
  "M34 34 L86 34 L82 29 L38 29 Z M52 29 L52 22 L70 22 L70 29 Z M60 22 L60 17 L62 17 L62 22 Z";

const HULL_TUG =
  "M28 34 L92 34 L88 27 L32 27 Z M46 27 L46 17 L70 17 L70 27 Z"
  + " M54 17 L54 11 L64 11 L64 17 Z M59 11 L59 5 L61 5 L61 11 Z";

const HULL_PATROL =
  "M24 34 L96 34 L92 28 L28 28 Z M44 28 L44 21 L76 21 L76 28 Z"
  + " M54 21 L54 15 L66 15 L66 21 Z M59 15 L59 6 L61 6 L61 15 Z";

const HULL_WORK =
  "M20 34 L100 34 L96 27 L26 27 Z M32 27 L32 18 L52 18 L52 27 Z"
  + " M70 27 L70 8 L74 8 L74 27 Z M74 10 L92 10 L92 13 L74 13 Z M86 13 L86 22 L88 22 L88 13 Z";

const GENERIC =
  "M14 34 L106 34 L102 27 L18 27 Z M50 27 L50 18 L74 18 L74 27 Z M61 18 L61 11 L63 11 L63 18 Z";

/**
 * Descriptions state what the class is and what it is doing in a fjord like this one. Lengths are
 * typical ranges for the class, not a measurement of the selected vessel — the feed's dimension
 * fields are not exported for private craft and are not used here at all.
 */
export const VESSEL_CLASSES: Record<string, VesselClass> = {
  Cargo: {
    label: "Frachtschiff",
    description: "Stückgut-, Container- oder Massengutschiff. In der Kieler Förde meist auf dem "
      + "Weg zum oder vom Nord-Ostsee-Kanal, der meistbefahrenen künstlichen Wasserstraße der Welt.",
    typicalLength: "80–200 m",
    silhouette: HULL_CARGO,
  },
  Tanker: {
    label: "Tankschiff",
    description: "Transportiert flüssige Ladung — Mineralöl, Chemikalien oder Flüssiggas. "
      + "Unterliegt in der Ostsee besonderen Melde- und Routenvorgaben.",
    typicalLength: "90–250 m",
    silhouette: HULL_TANKER,
  },
  Passenger: {
    label: "Fahrgastschiff",
    description: "Fähre oder Kreuzfahrtschiff. Kiel ist Fährhafen nach Skandinavien und Baltikum; "
      + "die abendliche Verkehrsspitze in den Daten sind im Wesentlichen diese Abfahrten.",
    typicalLength: "50–330 m",
    silhouette: HULL_PASSENGER,
  },
  Sailing: {
    label: "Segelyacht",
    description: "Segelfahrzeug unter Maschine oder Segel. Die Förde ist ein Segelrevier von "
      + "internationalem Rang — daher der hohe Anteil an dieser Klasse.",
    typicalLength: "8–25 m",
    silhouette: HULL_SAILING,
  },
  Pleasure: {
    label: "Sportboot",
    description: "Privates Motorboot. Für diese Klasse werden bewusst keine Abmessungen "
      + "übertragen: Länge und Breite neben einer Fahrtspur grenzen ein Boot auf einen "
      + "bestimmten Rumpf ein.",
    typicalLength: "6–20 m",
    silhouette: HULL_SMALL,
  },
  Tug: {
    label: "Schlepper",
    description: "Assistiert beim An- und Ablegen und in den Schleusen Holtenau. Kurze, sehr "
      + "leistungsstarke Fahrzeuge; im Hafenbereich an langsamen, engen Manövern erkennbar.",
    typicalLength: "20–40 m",
    silhouette: HULL_TUG,
  },
  Pilot: {
    label: "Lotsenversetzboot",
    description: "Bringt Lotsen an und von Bord. Fährt wiederkehrende kurze Wege zwischen "
      + "Lotsenstation und Fahrwasser — im Tagesverlauf gut an den Mustern erkennbar.",
    typicalLength: "15–30 m",
    silhouette: HULL_PATROL,
  },
  SAR: {
    label: "Such- und Rettungsfahrzeug",
    description: "Seenotrettungseinheit. Liegt überwiegend in Bereitschaft; Fahrten sind selten "
      + "und dann zielgerichtet.",
    typicalLength: "10–46 m",
    silhouette: HULL_PATROL,
  },
  Military: {
    label: "Behördenfahrzeug (militärisch gemeldet)",
    description: "Fahrzeug, das sich selbst als militärisch meldet. Klasse und Kennung stammen "
      + "aus dieser Selbstmeldung; die App ist eine Sichtbarkeitsstudie und ausdrücklich kein "
      + "Werkzeug zur Verfolgung eines bestimmten Schiffs.",
    typicalLength: "—",
    silhouette: HULL_PATROL,
  },
  "Law enforcement": {
    label: "Polizei- oder Zollboot",
    description: "Behördliches Streifenboot. Klasse und Kennung stammen aus der Selbstmeldung "
      + "des Fahrzeugs — was nicht gesendet wird, kann die App auch nicht zeigen.",
    typicalLength: "15–40 m",
    silhouette: HULL_PATROL,
  },
  Dredging: {
    label: "Bagger- oder Arbeitsfahrzeug",
    description: "Nassbagger oder Fahrzeug mit eingeschränkter Manövrierfähigkeit. Hält die "
      + "Fahrwassertiefen — in der Förde regelmäßig im Einsatz.",
    typicalLength: "30–120 m",
    silhouette: HULL_WORK,
  },
  Other: {
    label: "Sonstiges Fahrzeug",
    description: "Das Fahrzeug meldet eine Klasse, die keiner der Standardkategorien entspricht.",
    typicalLength: "—",
    silhouette: GENERIC,
  },
  Undefined: {
    label: "Ohne Klassenangabe",
    description: "Das Fahrzeug hat keinen Schiffstyp gesendet. Das ist ein häufiger und völlig "
      + "normaler Zustand — es ist eine Lücke in der Meldung, kein Hinweis auf irgendetwas.",
    typicalLength: "—",
    silhouette: GENERIC,
  },
};

export function vesselClass(type: string): VesselClass {
  return VESSEL_CLASSES[type] ?? VESSEL_CLASSES.Undefined;
}
