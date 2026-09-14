interface KpiProps {
  label: string;
  value: string;
  hint?: string;
}

function Kpi({ label, value, hint }: KpiProps) {
  return (
    <div className="flex flex-col rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
      <span className="text-[10px] font-medium uppercase tracking-wider opacity-60">{label}</span>
      <span className="text-[20px] font-semibold tabular-nums leading-tight">{value}</span>
      {hint ? <span className="text-[10px] opacity-50">{hint}</span> : null}
    </div>
  );
}

interface KpiBarProps {
  vehicles: number;
  moving: number;
  routes: number;
  avgSpeedKmh: number;
  positionsLastHour: number;
  positionsTotal: number;
}

const nf = new Intl.NumberFormat('en-GB');

export function KpiBar(props: KpiBarProps) {
  const movingShare = props.vehicles > 0 ? (props.moving / props.vehicles) * 100 : 0;

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" data-testid="kpi-bar">
      <Kpi label="Vehicles" value={nf.format(props.vehicles)} hint="currently reporting" />
      <Kpi
        label="Moving"
        value={nf.format(props.moving)}
        hint={`${movingShare.toFixed(0)} % of fleet`}
      />
      <Kpi label="Avg speed" value={`${props.avgSpeedKmh.toFixed(1)} km/h`} hint="fleet mean" />
      <Kpi label="Routes" value={nf.format(props.routes)} hint="distinct route ids" />
      <Kpi
        label="Positions / h"
        value={nf.format(Math.round(props.positionsLastHour))}
        hint={`${nf.format(Math.round(props.positionsTotal))} total`}
      />
    </div>
  );
}
