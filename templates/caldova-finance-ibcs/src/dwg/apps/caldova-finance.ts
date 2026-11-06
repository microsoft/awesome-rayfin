// erzeugt von `dwg app page` aus der App-Spec „Caldova Finance“, nicht von Hand ändern.
// Einbinden: <DwgShell app={app} connection="statements" isDark={isDark} />
import type { DwgAppSpec } from '../dwg-page';
import { page as p0 } from '../pages/income-statement';
import { page as p1 } from '../pages/balance-sheet';
import { page as p2 } from '../pages/cash-flow';

export const app: DwgAppSpec = {
  "name": "Caldova Finance",
  "about": "The three statements of Caldova GmbH (fictional) with the original P&L Statement byDatenWG visual, built with dwg cli by Michael Tenner (Daten-WG).",
  "footer": "Fictional data · IBCS notation, not certified · Visuals: P&L Statement byDatenWG (Michael Tenner)",
  "resolution": "fullhd",
  "visualHeaders": true,
  "chrome": {
    "header": {
      "on": true,
      "h": 64
    },
    "nav": {
      "on": false,
      "w": 64
    },
    "filter": {
      "on": true,
      "side": "left",
      "w": 200,
      "topH": 56
    },
    "footer": {
      "on": true,
      "h": 24
    }
  },
  "slicers": [
    {
      "column": "'Calendar'[Year]",
      "label": "Year",
      "default": [
        2026
      ],
      "multi": false
    }
  ],
  "columnTypes": {
    "'Calendar'[Year]": "int64"
  },
  "pages": [p0, p1, p2]
};
