// erzeugt von `dwg app page` aus der App-Spec „Caldova Finance“, nicht von Hand ändern.
import type { DwgPageSpec } from '../dwg-page';

export const page: DwgPageSpec = {
  "name": "Income statement",
  "template": "T04B",
  "description": "Caldova GmbH · P&L year to date: actual against plan up to the last closed month, with the ΔPL waterfall.",
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
    "'P&L Account'[L1]": "string",
    "'P&L Account'[L2]": "string",
    "'P&L Account'[AccountID]": "string",
    "'P&L Account'[Account]": "string",
    "'P&L Account'[SortOrder]": "int64",
    "'P&L Account'[RowType]": "string",
    "'P&L Account'[FormulaDef]": "string",
    "'P&L Account'[SignConvention]": "int64",
    "'P&L Account'[DisplayInvert]": "string",
    "'P&L Account'[VarianceInvert]": "string",
    "'P&L Account'[Comment]": "string",
    "'Calendar'[Year]": "int64"
  },
  "tiles": [
    {
      "id": "t04b",
      "visual": "pnl",
      "rect": [
        327,
        123,
        1566,
        894
      ],
      "bindings": {
        "levels": [
          "'P&L Account'[L1]",
          "'P&L Account'[L2]"
        ],
        "account": "'P&L Account'[AccountID]",
        "accountName": "'P&L Account'[Account]",
        "sortOrder": "'P&L Account'[SortOrder]",
        "rowType": "'P&L Account'[RowType]",
        "formulaDef": "'P&L Account'[FormulaDef]",
        "signConvention": "'P&L Account'[SignConvention]",
        "displayInvert": "'P&L Account'[DisplayInvert]",
        "varianceInvert": "'P&L Account'[VarianceInvert]",
        "comment": "'P&L Account'[Comment]",
        "ac": "'P&L Fact'[P&L AC]",
        "pl": "'P&L Fact'[P&L PL to date]"
      },
      "objects": {
        "titleBlock": {
          "unitLine": "Caldova GmbH (fictional)",
          "measureLine": "Income statement · kEUR",
          "periodLine": "",
          "headline": true
        },
        "columns": {
          "template": "T04B",
          "templateApplied": "T04B",
          "minuend": "ac",
          "showPY": false,
          "showPL": true,
          "showMinuend": true,
          "valueCascade": false,
          "dPyAbs": false,
          "dPyBar": false,
          "dPyWaterfall": false,
          "dPyPct": false,
          "dPyPin": false,
          "dPlAbs": false,
          "dPlBar": false,
          "dPlWaterfall": true,
          "dPlPct": false,
          "dPlPin": true,
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
          "leftBlockKind": "month"
        },
        "numbers": {
          "scaling": "k",
          "decimals": 0,
          "pctDecimals": 1,
          "fixedVarMax": "2,5m"
        },
        "hierarchy": {
          "defaultLevel": 1
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
