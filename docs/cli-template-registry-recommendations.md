# Rayfin CLI Template Registry — Improvement Recommendations

Recommendations for improvements to the Rayfin CLI's template registry and manifest system,
based on friction encountered while building the awesome-rayfin template gallery.

## 1. Inherit metadata from root manifest entries into leaf resolution

When a root manifest entry already provides `name` and `description`, `resolveEntryPath` could
synthesize a leaf manifest from the parent entry instead of requiring a separate
`rayfin-template.yml` in each template subdirectory. This eliminates the need for gallery
maintainers to keep two manifests in sync per template. The leaf file would remain optional —
if present, it takes precedence.

Currently, `resolveEntryPath()` in `packages/tools/common/src/templates/catalog/resolver.ts`
always calls `parseManifest(realTemplate)` at line 147, which throws if the leaf manifest is
missing. Instead, it could accept an optional `ManifestEntry` parameter and fall back to
constructing a `ResolvedTemplate` from the parent entry's metadata when no leaf file exists.

## 2. Support `inline: true` entries in manifests

Allow root manifest entries to declare `inline: true`, signaling that the entry is a leaf
template (not a nested catalog). The CLI would skip the leaf `parseManifest()` call and use
the root entry's metadata directly, using `sourcePath` as-is for file copying.

```yaml
entries:
  - path: templates/field-engineer
    name: Field Engineer
    description: Field engineer task management app
    inline: true   # no leaf rayfin-template.yml needed
```

This is a more explicit opt-in alternative to recommendation 1, avoiding any ambiguity about
whether a missing leaf manifest is intentional or a mistake.

## 3. Gallery-aware `rayfin init` output

When scaffolding from a multi-template gallery, include the gallery name and source URL in the
scaffolded project's `package.json` (e.g., a `template.source` field). This helps users trace
where their template came from and check for updates.

```json
{
  "template": {
    "name": "field-engineer",
    "displayName": "Field Engineer",
    "description": "...",
    "source": "https://github.com/microsoft/awesome-rayfin",
    "sourceRef": "v1.2.0"
  }
}
```

## 4. `rayfin template validate` command

A dedicated CLI command that validates a template gallery repo: checks manifest structure,
verifies all entries resolve, validates required files exist, and optionally dry-run scaffolds
each template. Gallery maintainers could use this locally and in CI instead of assembling
custom validation scripts.

```bash
rayfin template validate .                     # validate current directory as a gallery
rayfin template validate . --scaffold          # also dry-run scaffold each template
rayfin template validate . --template <name>   # validate a specific template
```

This would replace the custom `validate-templates.yml` CI workflow and
`generate-manifest.mjs --check` script we had to build for awesome-rayfin.

## 5. Template versioning in manifests

Add an optional `version` field to manifest entries and metadata. Enables `rayfin init` to warn
when a newer version of a template is available, and lets galleries publish changelogs per
template.

```yaml
apiVersion: v1
metadata:
  name: awesome-rayfin
  displayName: Awesome Rayfin Templates
  version: 1.2.0
entries:
  - path: templates/field-engineer
    name: Field Engineer
    version: 1.1.0
```
