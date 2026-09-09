import { Filter } from "lucide-react";
import { Select } from "../primitives";

export interface FilterDef {
  id: string;
  label: string;
  options: string[];
  /** Pinned filters show in the always-visible top bar. */
  pinned?: boolean;
  /** Section heading inside the "More filters" drawer. */
  group?: string;
}

export interface FilterBarProps {
  filters: FilterDef[];
  value: Record<string, string>;
  onChange: (id: string, value: string) => void;
}

/** Standardized filter bar — controlled, consistent across every app. */
export function FilterBar({ filters, value, onChange }: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card/60 p-3">
      <Filter size={15} className="text-muted-foreground" />
      {filters.map((f) => (
        <label key={f.id} className="flex items-center gap-1.5 text-sm">
          <span className="text-muted-foreground">{f.label}</span>
          <Select
            aria-label={f.label}
            value={value[f.id] ?? ""}
            onChange={(v) => onChange(f.id, v)}
            options={[{ value: "", label: "All" }, ...f.options.map((o) => ({ value: o, label: o }))]}
          />
        </label>
      ))}
    </div>
  );
}
