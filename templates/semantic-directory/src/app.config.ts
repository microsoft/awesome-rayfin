//-----------------------------------------------------------------------
// Semantic Directory — central app branding & copy.
//
// Everything a template adopter is likely to rename lives here: the app name,
// short name, tagline, search placeholder, and hero copy. Point the app at your
// own semantic model in `fabric.yaml`, then customize these strings to taste.
// Model-agnostic and brand-neutral — safe to ship and reskin.
//-----------------------------------------------------------------------

export interface AppConfig {
    /**
     * Full product name — the error screen title and the hero's fallback when
     * no connected model name is available.
     */
    name: string;
    /**
     * Landing hero title template. The `{model}` token is replaced with the
     * connected model's name — the demo bundle's name in demo mode, or
     * `modelName` (below) once a live model is wired up — e.g.
     * "Contoso Sales Directory". Falls back to `name` when no model name is
     * known. Keep the product noun (e.g. "Directory") so the swap reads well.
     */
    nameTemplate: string;
    /** Short name — shown in the compact top-bar badge. */
    shortName: string;
    /**
     * One-line hero subtitle under the app name. The `{model}` token is
     * replaced at runtime with the connected model's name — the demo bundle's
     * name in demo mode, or `modelName` (below) once a live model is wired up.
     */
    tagline: string;
    /** Accessible label / placeholder hint for the model search box. */
    searchLabel: string;
    /**
     * Display name of YOUR connected semantic model, shown in the hero tagline
     * once the app is live. Leave blank to fall back to a neutral phrase; the
     * demo experience derives its own name ("Contoso Sales") automatically.
     */
    modelName: string;
    /** localStorage key for the light/dark theme preference. */
    themeStorageKey: string;
    /** Copy shown in the demo-data banner when no model is connected. */
    demoBanner: {
        title: string;
        body: string;
    };
}

export const appConfig: AppConfig = {
    name: "Semantic Directory",
    nameTemplate: "{model} Directory",
    shortName: "Directory",
    tagline:
        "Search {model} — measures, columns, tables, and how they connect.",
    searchLabel: "Search the model",
    modelName: "",
    themeStorageKey: "semantic-directory.theme",
    demoBanner: {
        title: "Demo data",
        body: "You're exploring a sample Contoso Sales model. Connect your own Fabric workspace and semantic model to go live.",
    },
};
