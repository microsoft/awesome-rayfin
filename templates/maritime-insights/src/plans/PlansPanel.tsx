import { useCallback, useEffect, useState } from "react";
import {
  commitPlan, deletePlan, listPlans, loadPlan, planLine, planSites, writebackConfigured,
  type PlanSummary,
} from "./api";
import type { ReportModel } from "../twin3d/report";

/**
 * Committing a sensor plan to Fabric.
 *
 * 🔴 This is the step that turns a demo into a tool. A GIS also draws a viewshed; what none of
 * them does is let a planner **commit the decision** — the sites, the mast heights, who decided
 * and when — into a governed store the rest of the estate can query. Everything this panel sits
 * beside lived in browser memory and died with the tab.
 */

export interface PlansPanelProps {
  aoi: string;
  /** Null until a network exists — there is no plan to commit without one. */
  report: ReportModel | null;
  /** Restore a committed plan onto the map. */
  onRestore: (sites: { col: number; row: number; mastM: number }[]) => void;
}

export function PlansPanel({ aoi, report, onRestore }: PlansPanelProps) {
  const [open, setOpen] = useState(false);
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [warn, setWarn] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setPlans(await listPlans(aoi));
    } catch (error) {
      // ⚠️ Not fatal. A listing that cannot load must not stop someone committing — and the
      // reason (usually a missing workspace role) is worth showing rather than an empty list
      // that reads as "no plans yet".
      setPlans([]);
      setWarn(true);
      setMessage(error instanceof Error ? error.message : "Pläne konnten nicht geladen werden");
    }
  }, [aoi]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  // The feature is absent rather than broken when no backend is configured.
  if (!writebackConfigured()) return null;

  const commit = async () => {
    if (!report || busy) return;
    setBusy(true);
    setWarn(false);
    setMessage(null);
    try {
      const result = await commitPlan({
        aoi,
        name: name.trim(),
        note: note.trim(),
        // ⚠️ Asserted by the browser, never verified by the backend — the app's Entra gate
        // authenticates the user to the *app*, and the plan service never sees that token. The
        // stored field is named `authorAsserted` for exactly this reason.
        author: "App-Nutzer",
        report,
      });
      setMessage(`Gesichert als ${result.id}`);
      setName("");
      setNote("");
      await refresh();
    } catch (error) {
      setWarn(true);
      setMessage(error instanceof Error ? error.message : "Plan konnte nicht gesichert werden");
    } finally {
      setBusy(false);
    }
  };

  const restore = async (plan: PlanSummary) => {
    setBusy(true);
    setMessage(null);
    setWarn(false);
    try {
      const doc = await loadPlan(plan.aoi, plan.id);
      const sites = planSites(doc);
      if (!sites.length) {
        setWarn(true);
        setMessage("Dieser Plan enthält keine Rasterzellen und lässt sich nicht wiederherstellen.");
        return;
      }
      onRestore(sites);
      setMessage(`${plan.name} wiederhergestellt`);
    } catch (error) {
      setWarn(true);
      setMessage(error instanceof Error ? error.message : "Plan konnte nicht geladen werden");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (plan: PlanSummary) => {
    setBusy(true);
    setMessage(null);
    setWarn(false);
    try {
      const result = await deletePlan(plan.aoi, plan.id);
      // 🔴 The backend's caveat is repeated, not swallowed: the Delta tables Power BI reads are a
      // projection refreshed by a separate script, so "deleted" is true of one store and not yet
      // of the other. Reporting a clean success would be a half-truth in a governed system.
      setWarn(true);
      setMessage(result.note ?? `${plan.name} gelöscht`);
      await refresh();
    } catch (error) {
      setWarn(true);
      setMessage(error instanceof Error ? error.message : "Plan konnte nicht gelöscht werden");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        data-testid="twin3d-plans-open"
        onClick={() => setOpen(true)}
        title="Standort-Pläne in Fabric sichern und wiederherstellen"
        style={{ background: "var(--mi-line05)", color: "var(--mi-text-muted)", border: "1px solid var(--mi-line13)",
                 borderRadius: 6, padding: "7px 10px", cursor: "pointer", fontSize: 12 }}
      >
        Pläne in Fabric …
      </button>
    );
  }

  return (
    <div data-testid="twin3d-plans"
         style={{ display: "flex", flexDirection: "column", gap: 7,
                  border: "1px solid var(--mi-line13)", borderRadius: 7, padding: "9px 10px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <strong style={{ fontSize: 12.5 }}>Pläne in Fabric</strong>
        <button
          data-testid="twin3d-plans-close"
          onClick={() => setOpen(false)}
          style={{ marginLeft: "auto", background: "transparent", color: "var(--mi-text-muted)",
                   border: "1px solid var(--mi-line20)", borderRadius: 5, padding: "1px 7px",
                   cursor: "pointer", fontSize: 10.5 }}
        >
          Schließen
        </button>
      </div>

      {report ? (
        <>
          <input
            data-testid="twin3d-plan-name"
            value={name}
            placeholder="Name des Plans"
            aria-label="Name des Plans"
            onChange={(event) => setName(event.target.value)}
            style={{ background: "var(--mi-bg)", color: "var(--mi-text)", border: "1px solid var(--mi-line13)",
                     borderRadius: 5, padding: "5px 7px", fontSize: 11.5, fontFamily: "inherit" }}
          />
          <input
            data-testid="twin3d-plan-note"
            value={note}
            placeholder="Notiz (optional)"
            aria-label="Notiz zum Plan"
            onChange={(event) => setNote(event.target.value)}
            style={{ background: "var(--mi-bg)", color: "var(--mi-text)", border: "1px solid var(--mi-line13)",
                     borderRadius: 5, padding: "5px 7px", fontSize: 11.5, fontFamily: "inherit" }}
          />
          <button
            data-testid="twin3d-plan-commit"
            disabled={busy}
            onClick={() => void commit()}
            style={{ background: "var(--mi-accent13)", color: "var(--mi-text)", border: "1px solid var(--mi-accent33)",
                     borderRadius: 6, padding: "6px 9px", cursor: busy ? "default" : "pointer",
                     fontSize: 11.5 }}
          >
            {busy ? "…" : "Diesen Stand sichern"}
          </button>
        </>
      ) : (
        <div style={{ fontSize: 10.5, opacity: 0.6, lineHeight: 1.45 }}>
          Noch kein Standort gesetzt — es gibt nichts zu sichern. Ein Plan hält die Masten, die
          Messwerte und die Vorbehalte fest, nicht die Karte.
        </div>
      )}

      {message && (
        <div data-testid="twin3d-plan-message"
             style={{ fontSize: 10.5, lineHeight: 1.45,
                      color: warn ? "var(--mi-warn)" : "var(--mi-good)" }}>
          {message}
        </div>
      )}

      {plans && plans.length > 0 && (
        <div data-testid="twin3d-plan-list"
             style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 190,
                      overflowY: "auto", scrollbarWidth: "thin" }}>
          {plans.map((plan) => (
            <div key={plan.id} data-testid="twin3d-plan-row"
                 style={{ display: "flex", flexDirection: "column", gap: 1,
                          border: "1px solid var(--mi-line08)", borderRadius: 5, padding: "4px 6px" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis",
                               whiteSpace: "nowrap" }}>{plan.name}</span>
                <button
                  data-testid="twin3d-plan-restore"
                  disabled={busy}
                  onClick={() => void restore(plan)}
                  style={{ marginLeft: "auto", background: "transparent", color: "var(--mi-accent)",
                           border: "none", cursor: busy ? "default" : "pointer", fontSize: 10.5,
                           fontFamily: "inherit" }}
                >
                  laden
                </button>
                <button
                  data-testid="twin3d-plan-delete"
                  disabled={busy}
                  onClick={() => void remove(plan)}
                  style={{ background: "transparent", color: "var(--mi-warn)", border: "none",
                           cursor: busy ? "default" : "pointer", fontSize: 10.5,
                           fontFamily: "inherit" }}
                >
                  löschen
                </button>
              </div>
              {/*
                The figures and the caveat that qualifies them, on the same row. A share quoted
                without its denominator is what the annex work concluded must never circulate, and
                a ledger is read out of context far more often than a document is.
              */}
              <span style={{ fontSize: 10, opacity: 0.6 }}>{planLine(plan)}</span>
              <span style={{ fontSize: 9.5, opacity: 0.45 }}>
                {plan.committedUtc.slice(0, 16).replace("T", " ")} UTC · {plan.authorAsserted}
                {plan.includesVegetation === false ? " · ohne Bewuchs (Obergrenze)" : ""}
              </span>
            </div>
          ))}
        </div>
      )}

      {plans && plans.length === 0 && !warn && (
        <div style={{ fontSize: 10.5, opacity: 0.55 }}>Noch keine Pläne für dieses Gebiet.</div>
      )}
    </div>
  );
}
