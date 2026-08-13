// This app has no Rayfin data entities: everything it shows is either derived offline into
// `public/terrain/` by the geodata pipeline, streamed live from the OGN relay, or read from a
// Direct Lake snapshot in `public/day/`. Rayfin provides Fabric authentication and static hosting
// here, and the schema stays deliberately empty rather than modelling something the app never
// writes.
export type ParaglidingInsightsSchema = Record<string, never>;

export const schema = [];
