#!/usr/bin/env node

/**
 * Scans each template's package.json for metadata and generates:
 *   1. rayfin-template.yml (root manifest)
 *   2. Per-template rayfin-template.yml (leaf manifests)
 *   3. Updates the Templates table in README.md
 *
 * Usage:
 *   node scripts/generate-manifest.mjs            # generate files
 *   node scripts/generate-manifest.mjs --check     # CI mode: exit 1 if out of date
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, resolve } from "path";

const ROOT = resolve(import.meta.dirname, "..");
const TEMPLATES_DIR = join(ROOT, "templates");

function toYamlScalar(value) {
  const text = String(value);
  if (/^[\[\{!&*#?|>@`'"]/.test(text)) {
    return `'${text.replace(/'/g, "''")}'`;
  }
  return text;
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
      return {
        dirName,
        name: meta.displayName,
        templateName: meta.name,
        description: meta.description,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.dirName.localeCompare(b.dirName));
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
// 4. Update README.md templates table
// ---------------------------------------------------------------------------

function updateReadmeTable(templates) {
  const readmePath = join(ROOT, "README.md");
  if (!existsSync(readmePath)) return null;

  const readme = readFileSync(readmePath, "utf8");

  // Match the templates table between the header row and the next blank line or section
  const tableHeaderRe =
    /(\| Template\s*\| Description\s*\| Auth\s*\| Data\s*\| Stack\s*\|\n\|[-:|\s]+\|\n)([\s\S]*?)(\n\n)/;
  const match = readme.match(tableHeaderRe);
  if (!match) {
    console.warn("⚠️  Could not find templates table in README.md — skipping table update");
    return null;
  }

  const rows = templates
    .map((t) => {
      // Read manifest.json for auth/data info if available
      let auth = "✅";
      let data = "—";
      const manifestPath = join(TEMPLATES_DIR, t.dirName, "manifest.json");
      if (existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
          auth = manifest.services?.auth ? "✅" : "—";
          data = manifest.services?.data ? "✅" : "—";
        } catch { /* use defaults */ }
      }
      // Infer stack from dependencies
      const pkgPath = join(TEMPLATES_DIR, t.dirName, "package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      const stackParts = [];
      if (allDeps["react"]) stackParts.push("React");
      else if (allDeps["typescript"]) stackParts.push("TypeScript");
      if (allDeps["vite"] || allDeps["@vitejs/plugin-react-swc"] || allDeps["@vitejs/plugin-react"]) {
        stackParts.push("Vite");
      }
      if (allDeps["tailwindcss"] || allDeps["@tailwindcss/vite"]) {
        stackParts.push("Tailwind");
      }
      const stack = stackParts.length > 0 ? stackParts.join(", ") : "—";
      return `| **[${t.name}](./templates/${t.dirName})** | ${t.description} | ${auth} | ${data} | ${stack} |`;
    })
    .join("\n");

  const updated = readme.replace(tableHeaderRe, `$1${rows}\n\n`);
  return updated;
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
if (existingRoot !== rootManifest) {
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
  if (existingLeaf !== leafManifest) {
    if (checkMode) {
      console.error(`❌ templates/${t.dirName}/rayfin-template.yml is out of date.`);
      dirty = true;
    } else {
      writeFileSync(leafPath, leafManifest);
      console.log(`✅ Updated templates/${t.dirName}/rayfin-template.yml`);
    }
  }
}

// README table
const updatedReadme = updateReadmeTable(templates);
if (updatedReadme !== null) {
  const readmePath = join(ROOT, "README.md");
  const existingReadme = readFileSync(readmePath, "utf8");
  if (existingReadme !== updatedReadme) {
    if (checkMode) {
      console.error("❌ README.md templates table is out of date.");
      dirty = true;
    } else {
      writeFileSync(readmePath, updatedReadme);
      console.log("✅ Updated README.md templates table");
    }
  }
}

if (checkMode && dirty) {
  process.exit(1);
} else if (checkMode) {
  console.log("✅ All generated files are up to date.");
}
