"""Write the TMDL of the dwg contract tables into fabric/caldova-finance.SemanticModel.

English names; the dwg spec binds them explicitly. Run after changing the contract shape:
    python tools/contract_tmdl.py
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TABLES = ROOT / "fabric" / "caldova-finance.SemanticModel" / "definition" / "tables"
MODEL = ROOT / "fabric" / "caldova-finance.SemanticModel" / "definition" / "model.tmdl"


def col(name, dtype, src=None, hidden=False, key=False, sort_by=None, fmt=None):
    q = f"'{name}'" if " " in name or "&" in name else name
    lines = [f"\tcolumn {q}", f"\t\tdataType: {dtype}"]
    if fmt:
        lines.append(f"\t\tformatString: {fmt}")
    if key:
        lines.append("\t\tisKey")
    if hidden:
        lines.append("\t\tisHidden")
    lines.append(f"\t\tsummarizeBy: {'sum' if dtype == 'double' else 'none'}")
    lines.append(f"\t\tsourceColumn: {src or name}")
    if sort_by:
        sb = f"'{sort_by}'" if " " in sort_by else sort_by
        lines.append(f"\t\tsortByColumn: {sb}")
    return "\n".join(lines) + "\n"


def table(name, entity, doc, columns, measures=()):
    q = f"'{name}'" if " " in name or "&" in name else name
    out = [f"/// {doc}", f"table {q}", ""]
    for m in measures:
        out.append(m)
    for c in columns:
        out.append(c)
    out += [f"\tpartition {q} = entity", "\t\tmode: directLake", "\t\tsource", f"\t\t\tentityName: {entity}", "\t\t\texpressionSource: DatabaseQuery", ""]
    return "\n".join(out)


def measure(name, expr, fmt="#,##0", folder=None):
    lines = [f"\tmeasure '{name}' = {expr}", f"\t\tformatString: {fmt}"]
    if folder:
        lines.append(f"\t\tdisplayFolder: {folder}")
    return "\n".join(lines) + "\n"


def account_columns():
    return [
        col("AccountID", "string", key=True),
        col("ParentID", "string"),
        col("Account", "string", sort_by="SortOrder"),
        col("L1", "string", sort_by="L1 Sort"),
        col("L1 Sort", "int64", src="L1_Sort", hidden=True),
        col("L2", "string", sort_by="SortOrder"),
        col("SortOrder", "int64", hidden=True),
        col("RowType", "string"),
        col("FormulaDef", "string"),
        col("SignConvention", "int64"),
        col("DisplayInvert", "string"),
        col("VarianceInvert", "string"),
        col("Comment", "string"),
    ]


def fact_columns(extra=()):
    return [col("Date", "dateTime", hidden=True, fmt="General Date"), col("AccountID", "string", hidden=True),
            *[col(s, "double", hidden=True) for s in ("AC", "PY", "PL", "FC")], *extra]


def main() -> None:
    files = {
        "Calendar.tmdl": table("Calendar", "fin_calendar", "dwg contract: one row per month; Period drives the P&L visual's stock logic.", [
            col("Date", "dateTime", key=True, fmt="General Date"), col("Year", "int64"), col("Month", "int64", hidden=True),
            col("MonthName", "string", sort_by="Month"), col("Period", "string"), col("Quarter", "string"),
            col("Closed", "boolean")]),
        "P&L Account.tmdl": table("P&L Account", "fin_pl_account", "dwg contract: P&L accounts, two levels, signed by SignConvention.", account_columns()),
        "P&L Fact.tmdl": table("P&L Fact", "fin_pl_fact", "dwg contract: P&L per account and month, values positive (sign in P&L Account).", fact_columns(), [
            measure("P&L AC", "SUM ( 'P&L Fact'[AC] )", folder="P&L"),
            measure("P&L PY", "SUM ( 'P&L Fact'[PY] )", folder="P&L"),
            measure("P&L PL", "SUM ( 'P&L Fact'[PL] )", folder="P&L"),
            measure("P&L FC", "SUM ( 'P&L Fact'[FC] )", folder="P&L"),
            measure("P&L PL to date", "CALCULATE ( [P&L PL], 'Calendar'[Closed] = TRUE () )", folder="P&L"),
            measure("P&L PY to date", "CALCULATE ( [P&L PY], 'Calendar'[Closed] = TRUE () )", folder="P&L"),
        ]),
        "BS Account.tmdl": table("BS Account", "fin_bs_account", "dwg contract: balance sheet accounts (row type tokens 'Account stock', 'Formula stock').", account_columns()),
        "BS Fact.tmdl": table("BS Fact", "fin_bs_fact", "dwg contract: month-end balances; ReportingDate marks the last closed month of each year.",
                              fact_columns([col("ReportingDate", "boolean", hidden=True)]), [
            measure("BS AC", "SUM ( 'BS Fact'[AC] )", folder="Balance sheet"),
            measure("BS PY", "SUM ( 'BS Fact'[PY] )", folder="Balance sheet"),
            measure("BS PL", "SUM ( 'BS Fact'[PL] )", folder="Balance sheet"),
            measure("BS FC", "SUM ( 'BS Fact'[FC] )", folder="Balance sheet"),
            measure("BS reporting date AC", "CALCULATE ( [BS AC], 'BS Fact'[ReportingDate] = TRUE () )", folder="Balance sheet"),
            measure("BS reporting date PY", "CALCULATE ( [BS PY], 'BS Fact'[ReportingDate] = TRUE () )", folder="Balance sheet"),
        ]),
        "CF Account.tmdl": table("CF Account", "fin_cf_account", "dwg contract: cash-flow accounts (opening, flows, closing as 'Formula stock').", account_columns()),
        "CF Fact.tmdl": table("CF Fact", "fin_cf_fact", "dwg contract: monthly flows; the opening row holds the cash at the start of the month.", fact_columns(), [
            measure("CF AC", "SUM ( 'CF Fact'[AC] )", folder="Cash flow"),
            measure("CF PY", "SUM ( 'CF Fact'[PY] )", folder="Cash flow"),
            measure("CF PL", "SUM ( 'CF Fact'[PL] )", folder="Cash flow"),
            measure("CF FC", "SUM ( 'CF Fact'[FC] )", folder="Cash flow"),
            measure("CF PY to date", "CALCULATE ( [CF PY], 'Calendar'[Closed] = TRUE () )", folder="Cash flow"),
        ]),
    }
    for name, text in files.items():
        (TABLES / name).write_text(text, encoding="utf-8")
    model = MODEL.read_text(encoding="utf-8")
    refs = "".join(f"ref table '{n}'\n" if (" " in n or "&" in n) else f"ref table {n}\n"
                   for n in ["Calendar", "P&L Account", "P&L Fact", "BS Account", "BS Fact", "CF Account", "CF Fact"])
    rels = ""
    for fact, acc, tag in (("P&L Fact", "P&L Account", "PL"), ("BS Fact", "BS Account", "BS"), ("CF Fact", "CF Account", "CF")):
        rels += f"\nrelationship {tag}FactToCalendar\n\tfromColumn: '{fact}'.Date\n\ttoColumn: Calendar.Date\n"
        rels += f"\nrelationship {tag}FactToAccount\n\tfromColumn: '{fact}'.AccountID\n\ttoColumn: '{acc}'.AccountID\n"
    # The contract block is appended last; a rerun cuts it off at its first line and writes it again.
    if "ref table Calendar" in model:
        model = model[: model.index("ref table Calendar")]
    model = model.rstrip("\n") + "\n\n" + refs + rels
    MODEL.write_text(model, encoding="utf-8")
    print(f"wrote {len(files)} tables and 6 relationships into the model definition")


if __name__ == "__main__":
    main()
