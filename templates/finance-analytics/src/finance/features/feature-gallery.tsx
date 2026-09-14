import { useState } from "react";
import { Check, Plus, Zap, FlaskConical } from "lucide-react";
import {
  FEATURES, type FeatureCategory, type FeatureDescriptor, type PerfCost,
} from "../feature-registry";

export interface FeatureGalleryProps {
  /** Currently enabled feature ids (shown as "Added"). */
  enabled?: string[];
  /** Optional toggle handler — omit for a read-only catalog. */
  onToggle?: (id: string) => void;
}

const CATEGORIES: FeatureCategory[] = ["Visualization", "Data", "Export", "Intelligence", "Interaction"];

const PERF_LABEL: Record<PerfCost, { label: string; cls: string }> = {
  minimal: { label: "minimal", cls: "text-success" },
  light: { label: "light", cls: "text-primary" },
  "lazy-heavy": { label: "lazy on use", cls: "text-muted-foreground" },
};

function FeatureCard({ f, isOn, onToggle }: { f: FeatureDescriptor; isOn: boolean; onToggle?: (id: string) => void }) {
  const perf = PERF_LABEL[f.perfCost];
  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
      <div className="flex items-start justify-between">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-primary">
          <f.icon size={18} />
        </span>
        {f.status === "preview" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-foreground/10 px-2 py-0.5 text-[10px] font-medium text-brand-foreground">
            <FlaskConical size={11} /> Preview
          </span>
        ) : null}
      </div>
      <h3 className="mt-3 text-sm font-semibold">{f.name}</h3>
      <p className="mt-1 flex-1 text-xs text-muted-foreground">{f.description}</p>
      <div className="mt-3 flex items-center justify-between">
        <span className={"inline-flex items-center gap-1 text-[11px] " + perf.cls}>
          <Zap size={12} /> {perf.label}
        </span>
        {onToggle ? (
          <button
            onClick={() => onToggle(f.id)}
            className={
              "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors " +
              (isOn
                ? "bg-success/10 text-success hover:bg-success/20"
                : "bg-primary/10 text-primary hover:bg-primary/20")
            }
          >
            {isOn ? <><Check size={13} /> Added</> : <><Plus size={13} /> Add</>}
          </button>
        ) : (
          <span className="text-[11px] text-muted-foreground">{isOn ? "enabled" : ""}</span>
        )}
      </div>
    </div>
  );
}

/** Browsable catalog of standardized features teams can add out of the box. */
export function FeatureGallery({ enabled = [], onToggle }: FeatureGalleryProps) {
  const [filter, setFilter] = useState<FeatureCategory | "All">("All");
  const cats: (FeatureCategory | "All")[] = ["All", ...CATEGORIES];
  const visible = FEATURES.filter((f) => filter === "All" || f.category === filter);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2">
        {cats.map((c) => (
          <button
            key={c}
            onClick={() => setFilter(c)}
            className={
              "rounded-full px-3 py-1 text-sm transition-colors " +
              (filter === c ? "bg-primary text-primary-foreground" : "bg-secondary/60 text-secondary-foreground hover:bg-accent")
            }
          >
            {c}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((f) => (
          <FeatureCard key={f.id} f={f} isOn={enabled.includes(f.id)} onToggle={onToggle} />
        ))}
      </div>
    </div>
  );
}
