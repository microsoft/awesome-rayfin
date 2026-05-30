import { type SlideTheme, THEME_PRESETS } from '@/data/themes';

interface ThemePickerProps {
  theme: SlideTheme;
  onChange: (theme: SlideTheme) => void;
}

export function ThemePicker({ theme, onChange }: ThemePickerProps) {
  const isPreset = THEME_PRESETS.some(
    (p) => p.backgroundColor === theme.backgroundColor && p.textColor === theme.textColor && p.name === theme.name
  );

  return (
    <div className="space-y-4">
      {/* Preset grid */}
      <div>
        <span className="block text-xs font-medium text-gray-600 mb-2">Theme Preset</span>
        <div className="grid grid-cols-4 gap-2">
          {THEME_PRESETS.map((preset) => {
            const selected = theme.name === preset.name && theme.backgroundColor === preset.backgroundColor;
            return (
              <button
                key={preset.name}
                onClick={() => onChange(preset)}
                className={`rounded-lg border-2 p-1.5 transition-all ${
                  selected ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-gray-200 hover:border-gray-300'
                }`}
                title={preset.name}
              >
                <div
                  className="rounded h-8 flex items-center justify-center"
                  style={{ backgroundColor: preset.backgroundColor }}
                >
                  <span
                    className="text-[10px] font-bold leading-none"
                    style={{ color: preset.headingColor }}
                  >
                    Aa
                  </span>
                </div>
                <span className="block text-[10px] text-gray-600 mt-1 truncate">{preset.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Customization controls */}
      <details className="group" open={!isPreset}>
        <summary className="text-xs font-medium text-gray-600 cursor-pointer select-none hover:text-gray-800">
          Customize Colors ▾
        </summary>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <ColorField label="Background" value={theme.backgroundColor} onChange={(v) => onChange({ ...theme, name: 'Custom', backgroundColor: v })} />
          <ColorField label="Text" value={theme.textColor} onChange={(v) => onChange({ ...theme, name: 'Custom', textColor: v })} />
          <ColorField label="Headings" value={theme.headingColor} onChange={(v) => onChange({ ...theme, name: 'Custom', headingColor: v })} />
          <ColorField label="Accent" value={theme.accentColor} onChange={(v) => onChange({ ...theme, name: 'Custom', accentColor: v })} />
          <ColorField label="Code BG" value={theme.codeBackground} onChange={(v) => onChange({ ...theme, name: 'Custom', codeBackground: v })} />
          <ColorField label="Code Text" value={theme.codeColor} onChange={(v) => onChange({ ...theme, name: 'Custom', codeColor: v })} />
        </div>
        <div className="mt-3">
          <label className="block text-[11px] text-gray-500 mb-1">Font Family</label>
          <select
            value={theme.fontFamily}
            onChange={(e) => onChange({ ...theme, name: 'Custom', fontFamily: e.target.value })}
            className="w-full rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="Inter, system-ui, sans-serif">Inter (Sans-serif)</option>
            <option value="Georgia, serif">Georgia (Serif)</option>
            <option value='"Helvetica Neue", Helvetica, Arial, sans-serif'>Helvetica (Clean)</option>
            <option value='"Segoe UI", Tahoma, Geneva, Verdana, sans-serif'>Segoe UI (Corporate)</option>
            <option value="ui-monospace, SFMono-Regular, monospace">Monospace</option>
          </select>
        </div>
      </details>
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 w-6 rounded border border-gray-300 cursor-pointer p-0"
      />
      <div className="flex-1 min-w-0">
        <label className="block text-[11px] text-gray-500 leading-none">{label}</label>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full text-[11px] text-gray-700 font-mono bg-transparent border-none p-0 focus:outline-none"
        />
      </div>
    </div>
  );
}
