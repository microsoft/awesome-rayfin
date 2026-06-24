// Prep-for-AI service (PKG-12 / C10).
//
// Power BI's "prep data for AI" Copilot instructions are stored inside the
// model's culture file (`definition/cultures/<culture>.tmdl`) as a single-line
// JSON blob assigned to `linguisticMetadata`. The `CustomInstructions` key of
// that JSON holds the free-text guidance Copilot uses when answering questions
// about the model. This module reads and writes that one key, leaving every
// other linguistic-metadata entry (entities, terms, agents …) untouched.

import { loadDefinitionParts, saveDefinitionParts } from './fabricRest';

export interface PrepForAIState {
  /** Culture whose file holds (or will hold) the instructions, e.g. `en-US`. */
  culture: string;
  /** Current CustomInstructions text ('' when none configured). */
  customInstructions: string;
  /** True when a culture file with a linguisticMetadata blob already exists. */
  hasLinguisticMetadata: boolean;
}

const LING_RE = /^(\s*)linguisticMetadata\s*=\s*(\{.*\})\s*$/;

/** Default model culture from model.tmdl's `culture:` line (fallback en-US). */
function modelCulture(parts: { path: string; text: string; binary: boolean }[]): string {
  const mp = parts.find((p) => p.path === 'definition/model.tmdl');
  if (mp) {
    for (const line of mp.text.split('\n')) {
      const m = /^\s*culture:\s*(\S+)\s*$/.exec(line);
      if (m) return m[1].trim();
    }
  }
  return 'en-US';
}

/** Pick the culture file to operate on: model culture first, else any culture. */
function pickCultureFile(
  parts: { path: string; text: string; binary: boolean }[]
): { culture: string; path: string; text: string } {
  const culture = modelCulture(parts);
  const preferredPath = `definition/cultures/${culture}.tmdl`;
  const preferred = parts.find((p) => p.path === preferredPath && !p.binary);
  if (preferred) return { culture, path: preferredPath, text: preferred.text };
  const any = parts.find(
    (p) => /^definition\/cultures\/.+\.tmdl$/.test(p.path) && !p.binary
  );
  if (any) {
    const m = /cultures\/(.+)\.tmdl$/.exec(any.path);
    return { culture: m ? m[1] : culture, path: any.path, text: any.text };
  }
  return { culture, path: preferredPath, text: '' };
}

/** Read the CustomInstructions configured for AI prep (best effort). */
export async function readPrepForAI(
  workspaceId: string,
  datasetId: string
): Promise<PrepForAIState> {
  const parts = await loadDefinitionParts('model', workspaceId, datasetId);
  const file = pickCultureFile(parts);
  if (!file.text) {
    return { culture: file.culture, customInstructions: '', hasLinguisticMetadata: false };
  }
  for (const line of file.text.split('\n')) {
    const m = LING_RE.exec(line);
    if (!m) continue;
    try {
      const json = JSON.parse(m[2]) as Record<string, unknown>;
      const ci = json.CustomInstructions;
      return {
        culture: file.culture,
        customInstructions: typeof ci === 'string' ? ci : '',
        hasLinguisticMetadata: true,
      };
    } catch {
      return { culture: file.culture, customInstructions: '', hasLinguisticMetadata: true };
    }
  }
  return { culture: file.culture, customInstructions: '', hasLinguisticMetadata: false };
}

export interface PrepWriteResult {
  changed: number;
  culture: string;
  detail: string;
}

/**
 * Set the CustomInstructions for AI prep. Merges into the existing
 * linguisticMetadata JSON when present (preserving all other keys), creates the
 * blob when the culture file exists without one, or writes a minimal culture
 * file when none exists. An empty `instructions` removes the key.
 */
export async function writePrepForAI(
  workspaceId: string,
  datasetId: string,
  instructions: string
): Promise<PrepWriteResult> {
  const parts = await loadDefinitionParts('model', workspaceId, datasetId);
  const file = pickCultureFile(parts);
  const value = instructions.replace(/\r\n/g, '\n').trim();

  let newText: string;

  if (!file.text) {
    // No culture file at all — create a minimal one.
    const json: Record<string, unknown> = { Version: '4.2.0', Language: file.culture };
    if (value) json.CustomInstructions = value;
    newText =
      `cultureInfo ${file.culture}\n\n` +
      `\tlinguisticMetadata = ${JSON.stringify(json)}\n` +
      `\t\tcontentType: json\n`;
  } else {
    const lines = file.text.split('\n');
    const idx = lines.findIndex((l) => LING_RE.test(l));
    if (idx >= 0) {
      // Merge into the existing blob.
      const m = LING_RE.exec(lines[idx])!;
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(m[2]) as Record<string, unknown>;
      } catch {
        json = { Version: '4.2.0', Language: file.culture };
      }
      if (value) json.CustomInstructions = value;
      else delete json.CustomInstructions;
      lines[idx] = `${m[1]}linguisticMetadata = ${JSON.stringify(json)}`;
      newText = lines.join('\n');
    } else {
      // Culture file exists but has no linguisticMetadata — append one.
      const json: Record<string, unknown> = { Version: '4.2.0', Language: file.culture };
      if (value) json.CustomInstructions = value;
      const block = `\n\tlinguisticMetadata = ${JSON.stringify(json)}\n\t\tcontentType: json`;
      newText = file.text.replace(/\s*$/, '') + '\n' + block + '\n';
    }
  }

  if (newText === file.text) {
    return { changed: 0, culture: file.culture, detail: 'Custom instructions already up to date.' };
  }
  const changed = await saveDefinitionParts('model', workspaceId, datasetId, {
    [file.path]: newText,
  });
  return {
    changed,
    culture: file.culture,
    detail: value
      ? `Saved custom instructions to ${file.culture} culture.`
      : `Cleared custom instructions from ${file.culture} culture.`,
  };
}
