#!/usr/bin/env node

/**
 * Scans each template's package.json for metadata and generates:
 *   1. rayfin-template.yml (root manifest)
 *   2. Per-template rayfin-template.yml (leaf manifests)
 *   3. The categorised template gallery in README.md
 *
 * Usage:
 *   node scripts/generate-manifest.mjs            # generate files
 *   node scripts/generate-manifest.mjs --check     # CI mode: exit 1 if out of date
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, resolve } from "path";

const ROOT = resolve(import.meta.dirname, "..");
const TEMPLATES_DIR = join(ROOT, "templates");
const PREVIEWS_DIR = join(ROOT, "docs", "previews");

/**
 * Gallery categories, in the order they appear in README.md.
 * A template opts into one via `template.category` in its package.json.
 * Categories with no templates are omitted from the README.
 */
const CATEGORIES = [
  {
    id: "starters",
    emoji: "🚀",
    title: "Starter Templates",
    blurb: "Minimal scaffolds to build on — auth wired up, nothing else in the way.",
  },
  {
    id: "business",
    emoji: "🏢",
    title: "Business Apps",
    blurb: "Everyday operational apps: dashboards, field work, and presenting.",
  },
  {
    id: "analytics",
    emoji: "📊",
    title: "Analytical Apps",
    blurb: "Apps that put data and insight in front of an end user.",
  },
  {
    id: "fabric-tools",
    emoji: "🧰",
    title: "Fabric and Power BI Tools",
    blurb: "Apps that inspect, document, or administer the data platform itself.",
  },
  {
    id: "digital-twins",
    emoji: "🌍",
    title: "Digital Twins and Geospatial",
    blurb: "3D, map, and live-operations views of real-world systems.",
  },
  {
    id: "games",
    emoji: "🎮",
    title: "Games and Interactive Learning",
    blurb: "Canvas and game-engine apps — proof there is no UI ceiling.",
  },
  {
    id: "other",
    emoji: "📦",
    title: "More Templates",
    blurb: "Templates that have not picked a category yet.",
  },
];

const FALLBACK_CATEGORY = "other";
const PREVIEW_EXTENSIONS = ["webp", "png", "jpg", "jpeg", "gif"];
const PLACEHOLDER_PREVIEW = "docs/previews/_placeholder.webp";
const PREVIEW_WIDTH = 220;
const PREVIEW_COLUMN = 240;
const GALLERY_START = "<!-- TEMPLATES:START -->";
const GALLERY_END = "<!-- TEMPLATES:END -->";

function toYamlScalar(value) {
  const text = String(value);
  if (/^[\[\{!&*#?|>@`'"]/.test(text)) {
    return `'${text.replace(/'/g, "''")}'`;
  }
  return text;
}

/** Reproduces GitHub's heading-anchor slug so the category nav links resolve. */
function slugify(heading) {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9 _-]/g, "")
    .replace(/ /g, "-");
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Compare generated content with what is on disk, ignoring line endings.
 * Git checkouts on Windows (core.autocrlf=true) hand back CRLF, which would
 * otherwise make --check fail on a clean clone even when nothing is stale.
 */
function isUnchanged(existing, generated) {
  return existing.replace(/\r\n/g, "\n") === generated.replace(/\r\n/g, "\n");
}

/** Preview images live at docs/previews/<dirName>.<ext> — no metadata needed. */
function findPreview(dirName) {
  for (const ext of PREVIEW_EXTENSIONS) {
    if (existsSync(join(PREVIEWS_DIR, `${dirName}.${ext}`))) {
      return `docs/previews/${dirName}.${ext}`;
    }
  }
  return PLACEHOLDER_PREVIEW;
}

// ---------------------------------------------------------------------------
// 1. Discover templates
// ---------------------------------------------------------------------------

function discoverTemplates() {
  if (!existsSync(TEMPLATES_DIR)) return [];

  return readdirSync(TEMPLATES_DIR)
    .filter((name) => {
      const dir = join(TEMPLATES_DIR, name);
      return (
        statSync(dir).isDirectory() &&
        existsSync(join(dir, "package.json"))
      );
    })
    .map((dirName) => {
      const pkg = JSON.parse(
        readFileSync(join(TEMPLATES_DIR, dirName, "package.json"), "utf8")
      );
      const meta = pkg.template;
      if (!meta?.name || !meta?.displayName || !meta?.description) {
        console.warn(
          `⚠️  templates/${dirName}/package.json missing template.name, template.displayName, or template.description — skipping`
        );
        return null;
      }

      let category = meta.category;
      if (!category) {
        console.warn(
          `⚠️  templates/${dirName}/package.json has no template.category — filed under "${FALLBACK_CATEGORY}"`
        );
        category = FALLBACK_CATEGORY;
      } else if (!CATEGORIES.some((c) => c.id === category)) {
        console.warn(
          `⚠️  templates/${dirName}/package.json has unknown template.category "${category}" — filed under "${FALLBACK_CATEGORY}". Valid: ${CATEGORIES.map((c) => c.id).join(", ")}`
        );
        category = FALLBACK_CATEGORY;
      }

      return {
        dirName,
        name: meta.displayName,
        templateName: meta.name,
        description: meta.description,
        category,
        preview: findPreview(dirName),
        ...readTemplateFacts(dirName),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.dirName.localeCompare(b.dirName));
}

/** Auth/Data come from manifest.json; the stack is inferred from dependencies. */
function readTemplateFacts(dirName) {
  let auth = "✅";
  let data = "—";
  const manifestPath = join(TEMPLATES_DIR, dirName, "manifest.json");
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      auth = manifest.services?.auth ? "✅" : "—";
      data = manifest.services?.data ? "✅" : "—";
    } catch {
      /* use defaults */
    }
  }

  const pkg = JSON.parse(
    readFileSync(join(TEMPLATES_DIR, dirName, "package.json"), "utf8")
  );
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  const stackParts = [];
  if (allDeps["@angular/core"]) stackParts.push("Angular");
  else if (allDeps["react"]) stackParts.push("React");
  else if (allDeps["typescript"]) stackParts.push("TypeScript");
  if (allDeps["@angular/material"]) stackParts.push("Material");
  if (allDeps["vite"] || allDeps["@vitejs/plugin-react-swc"] || allDeps["@vitejs/plugin-react"]) {
    stackParts.push("Vite");
  }
  if (allDeps["tailwindcss"] || allDeps["@tailwindcss/vite"]) {
    stackParts.push("Tailwind");
  }

  return { auth, data, stack: stackParts.length > 0 ? stackParts.join(", ") : "—" };
}

// ---------------------------------------------------------------------------
// 2. Generate root rayfin-template.yml
// ---------------------------------------------------------------------------

function generateRootManifest(templates) {
  const entries = templates
    .map(
      (t) =>
        `  - path: templates/${t.dirName}\n    name: ${toYamlScalar(t.name)}\n    description: ${toYamlScalar(t.description)}`
    )
    .join("\n");

  return `apiVersion: v1
metadata:
  name: awesome-rayfin
  displayName: Awesome Rayfin Templates
  description: Community-curated template gallery for Project Rayfin
entries:
${entries}
`;
}

// ---------------------------------------------------------------------------
// 3. Generate leaf rayfin-template.yml per template
// ---------------------------------------------------------------------------

function generateLeafManifest(template) {
  return `apiVersion: v1
metadata:
  name: ${toYamlScalar(template.templateName)}
  displayName: ${toYamlScalar(template.name)}
  description: ${toYamlScalar(template.description)}
entries:
  - path: .
    name: ${toYamlScalar(template.name)}
`;
}

// ---------------------------------------------------------------------------
// 4. Render the categorised gallery into README.md
// ---------------------------------------------------------------------------

function renderRow(template) {
  const href = `./templates/${template.dirName}`;
  return [
    "<tr>",
    `<td width="${PREVIEW_COLUMN}"><a href="${href}"><img src="${template.preview}" alt="${escapeHtml(template.name)} preview" width="${PREVIEW_WIDTH}"></a></td>`,
    `<td><b><a href="${href}">${escapeHtml(template.name)}</a></b></td>`,
    `<td>${escapeHtml(template.description)}</td>`,
    `<td align="center">${template.auth}</td>`,
    `<td align="center">${template.data}</td>`,
    `<td>${escapeHtml(template.stack)}</td>`,
    "</tr>",
  ].join("\n");
}

function renderCategory(category, templates) {
  const lines = [`### ${category.emoji} ${category.title}`, "", category.blurb, ""];

  if (templates.length === 0) {
    lines.push(
      `_No templates here yet._ Building one? Set \`"category": "${category.id}"\` in your template's \`package.json\` — see the [Contributing Guide](CONTRIBUTING.md).`
    );
    return lines.join("\n");
  }

  // Written as raw HTML rather than a Markdown table so the preview column can
  // carry a width. GitHub's CSS sets max-width:100% on images, so in a plain
  // Markdown table the column collapses and the thumbnail shrinks to ~half size.
  lines.push(
    "<table>",
    "<thead>",
    `<tr><th width="${PREVIEW_COLUMN}">Preview</th><th>Template</th><th>Description</th><th align="center">Auth</th><th align="center">Data</th><th>Stack</th></tr>`,
    "</thead>",
    "<tbody>",
    ...templates.map(renderRow),
    "</tbody>",
    "</table>"
  );
  return lines.join("\n");
}

function renderGallery(templates) {
  const groups = CATEGORIES.map((category) => ({
    category,
    items: templates.filter((t) => t.category === category.id),
  })).filter(
    // Keep every real category, even when empty, so contributors can see where
    // their template belongs. The "other" fallback only shows when it is used.
    (group) => group.items.length > 0 || group.category.id !== FALLBACK_CATEGORY
  );

  const nav = groups
    .map(
      ({ category, items }) =>
        `[${category.emoji} ${category.title}](#${slugify(`${category.emoji} ${category.title}`)}) (${items.length})`
    )
    .join(" · ");

  const sections = groups.map(({ category, items }) => renderCategory(category, items));

  return [GALLERY_START, "", nav, "", sections.join("\n\n"), "", GALLERY_END].join("\n");
}

function updateReadmeGallery(templates) {
  const readmePath = join(ROOT, "README.md");
  if (!existsSync(readmePath)) return null;

  const readme = readFileSync(readmePath, "utf8");
  const start = readme.indexOf(GALLERY_START);
  const end = readme.indexOf(GALLERY_END);
  if (start === -1 || end === -1 || end < start) {
    console.warn(
      `⚠️  Could not find ${GALLERY_START} / ${GALLERY_END} markers in README.md — skipping gallery update`
    );
    return null;
  }

  return (
    readme.slice(0, start) +
    renderGallery(templates) +
    readme.slice(end + GALLERY_END.length)
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const checkMode = process.argv.includes("--check");
const templates = discoverTemplates();

if (templates.length === 0) {
  console.error("❌ No valid templates found in templates/");
  process.exit(1);
}

console.log(`Found ${templates.length} template(s): ${templates.map((t) => t.dirName).join(", ")}`);

let dirty = false;

// Root manifest
const rootManifestPath = join(ROOT, "rayfin-template.yml");
const rootManifest = generateRootManifest(templates);
const existingRoot = existsSync(rootManifestPath) ? readFileSync(rootManifestPath, "utf8") : "";
if (!isUnchanged(existingRoot, rootManifest)) {
  if (checkMode) {
    console.error("❌ rayfin-template.yml is out of date. Run: node scripts/generate-manifest.mjs");
    dirty = true;
  } else {
    writeFileSync(rootManifestPath, rootManifest);
    console.log("✅ Updated rayfin-template.yml");
  }
}

// Leaf manifests
for (const t of templates) {
  const leafPath = join(TEMPLATES_DIR, t.dirName, "rayfin-template.yml");
  const leafManifest = generateLeafManifest(t);
  const existingLeaf = existsSync(leafPath) ? readFileSync(leafPath, "utf8") : "";
  if (!isUnchanged(existingLeaf, leafManifest)) {
    if (checkMode) {
      console.error(`❌ templates/${t.dirName}/rayfin-template.yml is out of date.`);
      dirty = true;
    } else {
      writeFileSync(leafPath, leafManifest);
      console.log(`✅ Updated templates/${t.dirName}/rayfin-template.yml`);
    }
  }
}

// README gallery
const updatedReadme = updateReadmeGallery(templates);
if (updatedReadme !== null) {
  const readmePath = join(ROOT, "README.md");
  const existingReadme = readFileSync(readmePath, "utf8");
  if (!isUnchanged(existingReadme, updatedReadme)) {
    if (checkMode) {
      console.error("❌ README.md template gallery is out of date.");
      dirty = true;
    } else {
      writeFileSync(readmePath, updatedReadme);
      console.log("✅ Updated README.md template gallery");
    }
  }
}

const missingPreviews = templates.filter((t) => t.preview === PLACEHOLDER_PREVIEW);
if (missingPreviews.length > 0) {
  console.warn(
    `⚠️  Using the placeholder preview for: ${missingPreviews.map((t) => t.dirName).join(", ")}. Add docs/previews/<template>.webp to replace it.`
  );
}

if (checkMode && dirty) {
  process.exit(1);
} else if (checkMode) {
  console.log("✅ All generated files are up to date.");
}
