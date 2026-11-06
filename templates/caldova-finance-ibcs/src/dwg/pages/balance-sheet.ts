// erzeugt von `dwg app page` aus der App-Spec „Caldova Finance“, nicht von Hand ändern.
import type { DwgPageSpec } from '../dwg-page';

export const page: DwgPageSpec = {
  "name": "Balance sheet",
  "template": "T05A",
  "description": "Caldova GmbH · Balance sheet at the reporting date against the same date one year earlier.",
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
    "'BS Account'[L1]": "string",
    "'BS Account'[L2]": "string",
    "'BS Account'[AccountID]": "string",
    "'BS Account'[Account]": "string",
    "'BS Account'[SortOrder]": "int64",
    "'BS Account'[RowType]": "string",
    "'BS Account'[FormulaDef]": "string",
    "'BS Account'[SignConvention]": "int64",
    "'BS Account'[DisplayInvert]": "string",
    "'BS Account'[VarianceInvert]": "string",
    "'BS Account'[Comment]": "string",
    "'Calendar'[Period]": "string",
    "'Calendar'[Year]": "int64"
  },
  "tiles": [
    {
      "id": "t05a",
      "visual": "pnl",
      "rect": [
        327,
        123,
        1566,
        894
      ],
      "bindings": {
        "levels": [
          "'BS Account'[L1]",
          "'BS Account'[L2]"
        ],
        "account": "'BS Account'[AccountID]",
        "accountName": "'BS Account'[Account]",
        "sortOrder": "'BS Account'[SortOrder]",
        "rowType": "'BS Account'[RowType]",
        "formulaDef": "'BS Account'[FormulaDef]",
        "signConvention": "'BS Account'[SignConvention]",
        "displayInvert": "'BS Account'[DisplayInvert]",
        "varianceInvert": "'BS Account'[VarianceInvert]",
        "comment": "'BS Account'[Comment]",
        "ac": "'BS Fact'[BS AC]",
        "py": "'BS Fact'[BS PY]",
        "period": "'Calendar'[Period]"
      },
      "objects": {
        "titleBlock": {
          "unitLine": "Caldova GmbH (fictional)",
          "measureLine": "Balance sheet · kEUR",
          "periodLine": ""
        },
        "columns": {
          "template": "T05A",
          "templateApplied": "T05A",
          "minuend": "ac",
          "showPY": true,
          "showPL": false,
          "showMinuend": true,
          "valueCascade": false,
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
          "secondBlock": false,
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
          "stockMode": "allStock"
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
