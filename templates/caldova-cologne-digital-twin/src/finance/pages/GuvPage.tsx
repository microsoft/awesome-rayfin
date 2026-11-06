// P&L & Simulation page (former PnL App): KPI strip, trend of the selected line,
// drillable P&L table; year, period, unit and the what-if levers sit in the
// shared control pane. State lives in the route (#/guv?...), the last view is
// remembered per browser as before.

import { useDeferredValue, useEffect, useMemo } from 'react';

import { KpiStrip } from '@finance/components/guv/KpiStrip';
import { OriginalPnl } from '@finance/components/guv/OriginalPnl';
import { PnlTable } from '@finance/components/guv/PnlTable';
import { SimPanel } from '@finance/components/guv/SimPanel';
import { TrendChart } from '@finance/components/guv/TrendChart';
import { ScenarioLabel } from '@finance/components/guv/ibcs';
import { Breadcrumb, type Crumb } from '@finance/components/shell/Breadcrumb';
import { PageLayout } from '@finance/components/shell/ControlPane';
import { ErrorBox, LoadingTiles } from '@finance/components/shell/States';
import { ForecastPanel } from '@finance/components/writeback/ForecastPanel';
import { usePageCommands, useShell, type Command } from '@finance/hooks/shell.context';
import { usePnlData, type PnlData } from '@finance/hooks/use-pnl-data';
import { useWriteback } from '@finance/hooks/use-writeback';
import { applyAdjustments } from '@finance/lib/pnl/adjust';
import type { JahrInfo } from '@finance/lib/pnl/data';
import { bridge, buildPnl, EMPTY_SIM, isSimActive, LINE_EBT, LINE_OPEX, LINE_TAX, type Line, type Mode, type SimParams } from '@finance/lib/pnl/engine';
import { monthLabel, type Unit } from '@finance/lib/pnl/format';
import { DEFAULT_VIEW, fromHash, toHash, type ViewState } from '@finance/lib/pnl/state';
import { cn } from '@finance/lib/utils';

const STORAGE_KEY = 'caldova-fc-pnl-view';

function readView(qs: string): ViewState {
  const fromUrl = fromHash(qs);
  if (fromUrl) return { ...DEFAULT_VIEW, ...fromUrl };
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const s = stored ? fromHash(stored) : null;
    if (s) return { ...DEFAULT_VIEW, ...s };
  } catch {
    /* storage blocked */
  }
  return DEFAULT_VIEW;
}

export function GuvPage() {
  const { qs, setQs, replaceQs } = useShell();
  const view = useMemo(() => readView(qs), [qs]);

  // Entering #/guv without state shows the remembered view: write it into the
  // route (no undo step), so the URL and "Copy link" match what is shown.
  useEffect(() => {
    if (!qs) {
      const h = toHash(view).replace(/^#/, '');
      if (h) replaceQs(h);
    }
  }, [qs, view, replaceQs]);
  const set = useMemo(
    () => (patch: Partial<ViewState>) => {
      const h = toHash({ ...view, ...patch });
      try {
        window.localStorage.setItem(STORAGE_KEY, h);
      } catch {
        /* storage blocked */
      }
      setQs(h.replace(/^#/, ''));
    },
    [view, setQs]
  );
  const { years, data, refetch } = usePnlData(view.year);
  const yearList = useMemo(() => (years.status === 'ready' ? years.value : []), [years]);

  // Default year: the latest one with data, applied without an undo step.
  useEffect(() => {
    if (view.year === null && yearList.length) replaceQs(toHash({ ...view, year: yearList[yearList.length - 1].year }).replace(/^#/, ''));
  }, [view, yearList, replaceQs]);

  if (years.status === 'error') return <ErrorBox title="The P&L could not be loaded" message={years.message} onRetry={() => void refetch()} />;
  if (data.status === 'error') return <ErrorBox title="The P&L could not be loaded" message={data.message} onRetry={() => void refetch()} />;
  if (data.status !== 'ready' || view.year === null) return <LoadingTiles text="Loading the P&L from the semantic model…" />;
  return <Guv data={data.value} view={view} set={set} yearList={yearList} />;
}

function Guv({ data: modelData, view, set, yearList }: { data: PnlData; view: ViewState; set: (p: Partial<ViewState>) => void; yearList: JahrInfo[] }) {
  // Forecast adjustments from the app database on top of the model values.
  const wb = useWriteback();
  const adjusted = useMemo(
    () => applyAdjustments(view.year ?? 0, modelData.konten, modelData.werte, modelData.monate, wb.effective.values()),
    [modelData, view.year, wb.effective]
  );
  const data: PnlData = useMemo(() => ({ ...modelData, werte: adjusted.werte, monate: adjusted.monate }), [modelData, adjusted]);
  const blocks = useMemo(() => [...new Set(modelData.konten.filter((k) => k.rowType === 'Account' && k.l1).map((k) => k.l1))].sort(), [modelData.konten]);
  const yearInfo = yearList.find((y) => y.year === view.year);
  const lastActual = yearInfo?.lastActual ?? '';
  const hasOpenMonths = !!lastActual && !lastActual.endsWith('-12');
  const openFrom = useMemo(() => {
    if (!hasOpenMonths) return '';
    const m = Number(lastActual.slice(5, 7)) + 1;
    return monthLabel(`${lastActual.slice(0, 4)}-${String(m).padStart(2, '0')}`);
  }, [lastActual, hasOpenMonths]);

  // Closed years have no forecast part: the lever always acts on the whole year.
  const sim: SimParams = hasOpenMonths ? view.sim : { ...view.sim, scope: 'fy' };
  const deferredSim = useDeferredValue(sim);
  const simEnabled = view.mode === 'fy';
  const simActive = simEnabled && isSimActive(deferredSim);

  const model = useMemo(
    () => buildPnl({ konten: data.konten, werte: data.werte, mode: view.mode, sim: simEnabled ? deferredSim : EMPTY_SIM }),
    [data, view.mode, deferredSim, simEnabled]
  );
  const steps = useMemo(() => (simEnabled ? bridge({ konten: data.konten, werte: data.werte, sim: deferredSim }) : []), [data, deferredSim, simEnabled]);
  const opexBlocks = useMemo(() => {
    const s = new Set<string>();
    for (const k of data.konten) if (k.rowType === 'Account' && k.l1 === LINE_OPEX && k.l2) s.add(k.l2);
    return [...s].sort();
  }, [data.konten]);

  const byName = new Map<string, Line>();
  for (const l of model.lines.values()) if (l.depth === 0) byName.set(l.name, l);
  const ebt = byName.get(LINE_EBT);
  const tax = byName.get(LINE_TAX);
  const baseTaxRate = ebt && tax && ebt.cols.base ? -tax.cols.base / ebt.cols.base : 0;
  const selected = model.lines.get(view.line) ?? model.lines.get(model.top[0])!;
  const pnlSwitch = (
    <div className="w-[220px] shrink-0 whitespace-nowrap">
      <Segmented label="P&L display" value={view.pv} onChange={(pv) => set({ pv })} options={[{ id: 'table', label: 'Table' }, { id: 'visual', label: 'Original visual' }]} />
    </div>
  );

  const crumbs: Crumb[] = [
    { key: 'year', label: 'Year', value: String(view.year) },
    { key: 'mode', label: 'Period', value: view.mode === 'fy' ? 'Fiscal year (AC + FC)' : `YTD to ${lastActual ? monthLabel(lastActual) : '–'}` },
    { key: 'unit', label: 'Unit', value: view.unit === 'mio' ? 'mEUR' : 'kEUR' },
    ...(selected ? [{ key: 'line', label: 'Line', value: selected.name }] : []),
    ...(adjusted.applied
      ? [{ key: 'adj', label: 'FC adjustments', value: `${adjusted.applied} active (Δ ${Math.round(adjusted.delta / 1e3).toLocaleString('en-GB')} kEUR)`, title: 'From the app database, log in the controls' }]
      : []),
    ...(simActive
      ? [{ key: 'sim', label: 'Simulation', value: 'active', title: 'Reset simulation', onRemove: () => set({ sim: { ...EMPTY_SIM, scope: view.sim.scope } }) }]
      : []),
  ];

  const commands = useMemo<Command[]>(() => {
    const out: Command[] = [];
    for (const id of model.top) {
      const l = model.lines.get(id);
      if (l && l.rowType !== 'Separator') out.push({ id: `line:${id}`, group: 'P&L line', label: l.name, keywords: id, run: () => set({ line: id }) });
    }
    for (const y of yearList) out.push({ id: `year:${y.year}`, group: 'Year', label: String(y.year), run: () => set({ year: y.year }) });
    out.push(
      { id: 'mode:fy', group: 'Period', label: 'Fiscal year (AC + FC)', keywords: 'fy year', run: () => set({ mode: 'fy' }) },
      { id: 'mode:ytd', group: 'Period', label: 'YTD', keywords: 'year to date', run: () => set({ mode: 'ytd' }) },
      { id: 'unit:mio', group: 'Unit', label: 'mEUR', run: () => set({ unit: 'mio' }) },
      { id: 'unit:tsd', group: 'Unit', label: 'kEUR', run: () => set({ unit: 'tsd' }) },
      { id: 'sim:reset', group: 'Simulation', label: 'Reset simulation', keywords: 'what if', run: () => set({ sim: { ...EMPTY_SIM, scope: view.sim.scope } }) }
    );
    return out;
  }, [model, yearList, set, view.sim.scope]);
  usePageCommands('guv', commands);

  const pane = (
    <div className="flex flex-col gap-300">
      <div className="flex flex-col gap-300 rounded-xl bg-secondary p-400">
        <label className="flex items-center justify-between gap-200 text-200 text-muted-foreground">
          Year
          <select
            value={view.year ?? ''}
            onChange={(e) => set({ year: Number(e.target.value) })}
            className="h-[32px] rounded-md border border-input bg-background px-200 text-300 text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            {yearList.map((y) => (
              <option key={y.year} value={y.year}>
                {y.year}
              </option>
            ))}
          </select>
        </label>
        <Segmented<Mode>
          label="Period"
          value={view.mode}
          onChange={(mode) => set({ mode })}
          options={[
            { id: 'fy', label: 'Fiscal year' },
            { id: 'ytd', label: lastActual ? `YTD to ${monthLabel(lastActual)}` : 'YTD' },
          ]}
        />
        <Segmented<Unit>
          label="Unit"
          value={view.unit}
          onChange={(unit) => set({ unit })}
          options={[
            { id: 'mio', label: 'mEUR' },
            { id: 'tsd', label: 'kEUR' },
          ]}
        />
      </div>
      <ForecastPanel year={view.year ?? 0} blocks={blocks} hasOpenMonths={hasOpenMonths} />
      <SimPanel
        model={model}
        sim={sim}
        onChange={(s) => set({ sim: s })}
        onReset={() => set({ sim: { ...EMPTY_SIM, scope: view.sim.scope } })}
        steps={steps}
        unit={view.unit}
        simActive={simActive}
        enabled={simEnabled}
        hasOpenMonths={hasOpenMonths}
        openFrom={openFrom}
        opexBlocks={opexBlocks}
        baseTaxRate={baseTaxRate}
      />
    </div>
  );

  return (
    <>
      <Breadcrumb crumbs={crumbs} />
      <div className="mx-auto w-full max-w-[1920px] px-400 py-400 md:px-600 md:py-600">
        <PageLayout pane={pane} paneWidth={360}>
          <div className="flex flex-wrap items-center gap-x-400 gap-y-100 text-200 text-muted-foreground">
            <span>
              Actuals to <strong className="text-foreground">{lastActual ? monthLabel(lastActual) : '–'} {lastActual.slice(0, 4)}</strong>
              {hasOpenMonths && view.mode === 'fy' ? ', forecast after that' : ''}
            </span>
            <span className="flex flex-wrap gap-300">
              <ScenarioLabel s="PL" label="Plan" />
              <ScenarioLabel s="PY" label="Prior year" />
              <ScenarioLabel s="AC" label="Actual" />
              <ScenarioLabel s="FC" label="Forecast" />
              <ScenarioLabel s="SIM" label="Simulation" />
            </span>
          </div>
          <KpiStrip model={model} mode={view.mode} unit={view.unit} simActive={simActive} />
          {selected && selected.depth === 0 && selected.rowType !== 'KPI' && (
            <TrendChart line={selected} konten={data.konten} monate={data.monate} lastActual={lastActual} unit={view.unit} />
          )}
          {view.pv === 'visual' ? (
            <OriginalPnl year={view.year ?? 0} lastActual={lastActual} toolbar={pnlSwitch} />
          ) : (
            <PnlTable model={model} mode={view.mode} unit={view.unit} simActive={simActive} selectedLine={selected?.id ?? ''} onSelectLine={(line) => set({ line })} toolbar={pnlSwitch} />
          )}
          <p className="text-100 text-muted-foreground">
            Source: semantic model "caldova-cologne-finance", tables fact-pnl and dim-account · simulations are model calculations and change no data.
          </p>
        </PageLayout>
      </div>
    </>
  );
}

function Segmented<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: { id: T; label: string }[] }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-md bg-muted p-100">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            'flex-1 rounded-sm px-300 py-100 text-200 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring',
            value === o.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
