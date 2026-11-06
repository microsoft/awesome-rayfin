// erzeugt von `dwg app page` aus der App-Spec „Caldova Finance“, nicht von Hand ändern.
import type { DwgPageSpec } from '../dwg-page';

export const page: DwgPageSpec = {
  "name": "Cash flow",
  "template": "T05B",
  "description": "Caldova GmbH · Cash flow from opening to closing cash, month and year to date, against the prior year.",
  "width": 1920,
  "height": 1080,
  "background": "#F4F4F1",
  "zones": {
    "header": {
      "x": 0,
      "y": 0,
      "w": 1920,
      "h": 96
    },
    "filter": {
      "x": 0,
      "y": 96,
      "w": 300,
      "h": 948
    },
    "footer": {
      "x": 0,
      "y": 1044,
      "w": 1920,
      "h": 36
    },
    "content": {
      "x": 327,
      "y": 123,
      "w": 1566,
      "h": 894
    }
  },
  "filters": [],
  "columnTypes": {
    "'CF Account'[L1]": "string",
    "'CF Account'[L2]": "string",
    "'CF Account'[AccountID]": "string",
    "'CF Account'[Account]": "string",
    "'CF Account'[SortOrder]": "int64",
    "'CF Account'[RowType]": "string",
    "'CF Account'[FormulaDef]": "string",
    "'CF Account'[SignConvention]": "int64",
    "'CF Account'[DisplayInvert]": "string",
    "'CF Account'[VarianceInvert]": "string",
    "'CF Account'[Comment]": "string",
    "'Calendar'[Period]": "string",
    "'Calendar'[Year]": "int64"
  },
  "tiles": [
    {
      "id": "t05b",
      "visual": "pnl",
      "rect": [
        327,
        123,
        1566,
        894
      ],
      "bindings": {
        "levels": [
          "'CF Account'[L1]",
          "'CF Account'[L2]"
        ],
        "account": "'CF Account'[AccountID]",
        "accountName": "'CF Account'[Account]",
        "sortOrder": "'CF Account'[SortOrder]",
        "rowType": "'CF Account'[RowType]",
        "formulaDef": "'CF Account'[FormulaDef]",
        "signConvention": "'CF Account'[SignConvention]",
        "displayInvert": "'CF Account'[DisplayInvert]",
        "varianceInvert": "'CF Account'[VarianceInvert]",
        "comment": "'CF Account'[Comment]",
        "ac": "'CF Fact'[CF AC]",
        "py": "'CF Fact'[CF PY]",
        "period": "'Calendar'[Period]"
      },
      "objects": {
        "titleBlock": {
          "unitLine": "Caldova GmbH (fictional)",
          "measureLine": "Cash flow · kEUR",
          "periodLine": ""
        },
        "columns": {
          "template": "T05B",
          "templateApplied": "T05B",
          "minuend": "ac",
          "showPY": true,
          "showPL": false,
          "showMinuend": true,
          "valueCascade": true,
          "dPyAbs": true,
          "dPyBar": false,
          "dPyWaterfall": false,
          "dPyPct": true,
          "dPyPin": false,
          "dPlAbs": false,
          "dPlBar": false,
          "dPlWaterfall": false,
          "dPlPct": false,
          "dPlPin": false,
          "secondBlock": true,
          "structureSubtotals": true,
          "showPctRows": true,
          "thresholds": false,
          "scenarioMarks": true,
          "chartLabels": true,
          "capBars": false,
          "sort": "cat",
          "sortBlock": "ytd",
          "blockKind": "ytd",
          "leftBlockKind": "month",
          "pctRevenue": false
        },
        "numbers": {
          "scaling": "k",
          "decimals": 0,
          "pctDecimals": 1
        },
        "statement": {
          "stockMode": "auto"
        },
        "hierarchy": {
          "defaultLevel": 2
        },
        "toolbar": {
          "show": true,
          "showLegend": true,
          "foldable": true,
          "startFolded": true
        },
        "style": {
          "fontPreset": "fullhd",
          "density": "compact",
          "colorMode": "ibcs",
          "goodColor": {
            "solid": {
              "color": "#5DBB2C"
            }
          },
          "badColor": {
            "solid": {
              "color": "#FF0000"
            }
          }
        }
      },
      "showItemsWithNoData": true
    }
  ]
};
