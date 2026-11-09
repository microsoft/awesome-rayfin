import info from './info.dax?raw';
import kpis from './kpis.dax?raw';
import maerkte from './maerkte.dax?raw';
import produkte from './produkte.dax?raw';
import szenarien from './szenarien.dax?raw';
import vorjahr from './vorjahr.dax?raw';
import wuerfel from './wuerfel.dax?raw';

/** Connector name from rayfin/rayfin.yml. */
export const connection = 'guv';

/** All queries the cockpit needs; everything else is computed in the browser. */
export const cockpitQueries = { info, kpis, maerkte, produkte, szenarien, wuerfel, vorjahr } as const;
