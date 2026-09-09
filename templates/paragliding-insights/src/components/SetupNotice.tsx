import { useI18n } from '@/i18n';

/**
 * Shown when the generated geodata is not present.
 *
 * The pipeline output — a terrain heightmap, a land-cover raster, a LoD2 building mesh and the
 * tree instances — runs to tens of megabytes and is not committed. A freshly cloned copy therefore
 * has no terrain on first run. That is expected, so the app explains how to produce it rather than
 * failing with a fetch error.
 */
export function SetupNotice() {
  const { t } = useI18n();

  return (
    <div
      data-testid="setup-notice"
      className="absolute inset-0 flex items-center justify-center bg-stone-100 px-6"
    >
      <div className="max-w-lg">
        <p className="text-xs uppercase tracking-[0.2em] text-stone-500">{t('setup.eyebrow')}</p>
        <h2 className="mt-3 text-lg font-semibold text-stone-900">{t('setup.heading')}</h2>
        <p className="mt-3 text-sm leading-relaxed text-stone-600">{t('setup.body')}</p>

        <pre className="mt-5 overflow-x-auto rounded border border-stone-300 bg-stone-50 p-4 text-xs leading-relaxed text-stone-700">
          {`pip install -r tools/requirements.txt
npm run data:build`}
        </pre>

        <p className="mt-4 text-xs leading-relaxed text-stone-500">{t('setup.note')}</p>
      </div>
    </div>
  );
}
