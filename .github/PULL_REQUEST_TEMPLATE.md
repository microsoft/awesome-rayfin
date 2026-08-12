## Description

<!-- Brief summary of the change and motivation -->

## Type of change

- [ ] New template
- [ ] Template update
- [ ] Gallery infrastructure (CI, scripts, docs)
- [ ] Other

## Template checklist

If adding or modifying a template, confirm:

- [ ] `package.json` includes `template.name`, `template.displayName`, `template.description`, and `template.category`
- [ ] `manifest.json` has correct `templateId` and `services` flags
- [ ] `rayfin/rayfin.yml` has correct `id` and `name` matching the directory name
- [ ] `README.md` includes Getting Started, Project Structure, and Scripts sections
- [ ] Preview image added at `docs/previews/<template>.webp` (1280x800, under 200 KB)
- [ ] Ran `node scripts/generate-manifest.mjs` to update manifests and the README gallery
- [ ] Tested scaffolding: `rayfin init -t . --template-name "<name>"` succeeds
- [ ] Ran `npm run lint`, `npm run build`, and `npm test` in the template directory

## Gallery checklist

- [ ] `rayfin-template.yml` is up to date (`node scripts/generate-manifest.mjs --check` passes)
- [ ] README gallery reflects current templates and shows the template in the right category

## AI disclosure

<!-- If AI tools assisted this contribution, briefly describe how -->
