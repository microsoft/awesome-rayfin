#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { deriveTemplateData } from './gallery-metadata.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const OUTPUT_PATH = join(ROOT, 'src', 'generated', 'templates.json');

export function generateGalleryData(root = ROOT) {
  const rootManifestPath = join(root, 'rayfin-template.yml');
  const rootManifest = parse(readFileSync(rootManifestPath, 'utf8'));
  const entries = rootManifest.entries;

  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('rayfin-template.yml must contain at least one template entry');
  }

  const outputPath = join(root, relative(ROOT, OUTPUT_PATH));

  const templates = entries.map((entry) => {
    const entryPath = entry.path.split('/').join(sep);
    const templateDirectory = resolve(root, entryPath);
    const templatesRoot = resolve(root, 'templates');
    if (!templateDirectory.startsWith(`${templatesRoot}${sep}`)) {
      throw new Error(`Template path must be inside templates/: ${entry.path}`);
    }

    const directoryName = basename(templateDirectory);
    const pkg = JSON.parse(readFileSync(join(templateDirectory, 'package.json'), 'utf8'));
    const manifest = JSON.parse(readFileSync(join(templateDirectory, 'manifest.json'), 'utf8'));

    return deriveTemplateData({
      directoryName,
      entry,
      pkg,
      manifest,
      hasFabricAssets:
        existsSync(join(templateDirectory, 'fabric')) &&
        statSync(join(templateDirectory, 'fabric')).isDirectory(),
    });
  });

  mkdirSync(resolve(outputPath, '..'), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(templates, null, 2)}\n`);
  return templates;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const templates = generateGalleryData();
  console.log(`Generated gallery metadata for ${templates.length} templates.`);
}
