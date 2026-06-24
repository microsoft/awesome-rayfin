// Safe AI step-commenter for a table's M (Power Query) expression.
//
// The goal is to add ONE inline `//` comment before every M step without ever
// altering the M code itself. To guarantee that, the AI (GitHub Copilot, via
// the `github_comment_m` UDF) is only ever asked to DESCRIBE each step — it
// never rewrites the M. This module:
//   1. parses the `let … in …` block into steps locally (depth/string aware),
//   2. sends only the step snippets to the model and gets one comment each,
//   3. INSERTS each comment as a `//` line before its step, never touching the
//      original lines, and
//   4. verifies — by reconstructing the original from the annotated output —
//      that the M is byte-for-byte unchanged before returning it.
// If anything looks off, the original M is returned unchanged.

import { udf } from './udfClient';
import { getGithubToken } from './githubAuth';

export class GithubAuthRequiredError extends Error {
  constructor() {
    super('GitHub sign-in is required to generate comments.');
    this.name = 'GithubAuthRequiredError';
  }
}

interface MStep {
  /** Index (in the split lines) of the line where the step declaration begins. */
  lineIndex: number;
  /** Leading whitespace of that line, reused so the comment lines up. */
  indent: string;
  /** Step name (for reference/debugging). */
  name: string;
  /** The step's code (declaration line + any continuation lines). */
  code: string;
}

/** Advance bracket depth + string state across one line of M. */
function scanLine(line: string, depthIn: number, inStringIn: boolean): [number, boolean] {
  let depth = depthIn;
  let inString = inStringIn;
  for (let k = 0; k < line.length; k++) {
    const ch = line[k];
    if (inString) {
      if (ch === '"') {
        // M escapes a literal quote by doubling it ("").
        if (line[k + 1] === '"') {
          k++;
          continue;
        }
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '/' && line[k + 1] === '/') break; // line comment — ignore rest
    if (ch === '/' && line[k + 1] === '*') {
      const end = line.indexOf('*/', k + 2);
      if (end >= 0) {
        k = end + 1;
        continue;
      }
      break; // unterminated block comment on this line — ignore rest
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
  }
  return [depth, inString];
}

const STEP_DECL = /^(#"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_.]*)\s*=(?!=)/;

/**
 * Parse the top-level steps of a `let … in …` M expression. A step is an
 * assignment that begins at bracket depth 0 inside the let-block. Continuation
 * lines (inside brackets) are folded into the preceding step's `code`.
 */
export function parseMSteps(m: string): MStep[] {
  const lines = m.split('\n');
  const steps: MStep[] = [];
  let depth = 0;
  let inString = false;
  let inLet = false;
  let pending: MStep | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const startDepth = depth;
    const startInString = inString;
    const trimmed = line.trim();

    if (!startInString && startDepth === 0) {
      if (!inLet) {
        if (/^let\b/.test(trimmed)) inLet = true;
      } else if (/^in\b/.test(trimmed)) {
        if (pending) {
          steps.push(pending);
          pending = null;
        }
        inLet = false;
      } else {
        const mm = STEP_DECL.exec(trimmed);
        if (mm) {
          if (pending) steps.push(pending);
          const indent = line.slice(0, line.length - line.trimStart().length);
          pending = { lineIndex: i, indent, name: mm[1], code: line.trimStart() };
        } else if (pending) {
          pending.code += '\n' + line;
        }
      }
    } else if (inLet && pending) {
      // Continuation line of a multi-line step expression.
      pending.code += '\n' + line;
    }

    [depth, inString] = scanLine(line, depth, inString);
  }
  if (pending) steps.push(pending);
  return steps;
}

/** Collapse an AI comment to a safe single-line `//` body. */
function cleanComment(raw: string): string {
  return raw
    .replace(/[\r\n]+/g, ' ')
    .replace(/^\s*\/+\s*/, '')
    .trim();
}

interface AnnotateResult {
  text: string;
  /** True only when removing the inserted comment lines reproduces the original
   *  M exactly — i.e. nothing but `//` lines were added. */
  safe: boolean;
  inserted: number;
}

/**
 * Insert one `// comment` line before each step. Existing lines are never
 * modified or removed. If a step is already immediately preceded by a comment
 * line, no new comment is added (keeps re-runs from stacking). The result is
 * verified to differ from the original only by the inserted comment lines.
 */
export function buildAnnotatedM(
  original: string,
  annotations: { lineIndex: number; indent: string; comment: string }[]
): AnnotateResult {
  const lines = original.split('\n');
  const byLine = new Map<number, { indent: string; comment: string }>();
  for (const a of annotations) {
    const c = cleanComment(a.comment);
    if (c) byLine.set(a.lineIndex, { indent: a.indent, comment: c });
  }

  const out: string[] = [];
  const insertedIdx = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const a = byLine.get(i);
    const prevIsComment = i > 0 && lines[i - 1].trimStart().startsWith('//');
    if (a && !prevIsComment) {
      insertedIdx.add(out.length);
      out.push(`${a.indent}// ${a.comment}`);
    }
    out.push(lines[i]);
  }

  const reconstructed = out.filter((_, idx) => !insertedIdx.has(idx)).join('\n');
  return { text: out.join('\n'), safe: reconstructed === original, inserted: insertedIdx.size };
}

export interface CommentResult {
  /** The annotated M (or the original unchanged when nothing was added). */
  text: string;
  /** Number of steps detected. */
  stepCount: number;
  /** Number of comment lines actually inserted. */
  inserted: number;
}

/**
 * Generate inline step comments for an M expression and return the annotated
 * text. The original M is guaranteed to be preserved verbatim — only `//`
 * comment lines are added. Throws {@link GithubAuthRequiredError} when no
 * GitHub token is present (the caller drives the device-flow sign-in first).
 */
export async function commentMExpression(m: string): Promise<CommentResult> {
  const token = getGithubToken();
  if (!token) throw new GithubAuthRequiredError();

  const steps = parseMSteps(m);
  if (steps.length === 0) return { text: m, stepCount: 0, inserted: 0 };

  const snippets = steps.map((s) => s.code.slice(0, 2000));
  const { comments } = await udf.githubCommentM(token, snippets);

  const annotations = steps.map((s, i) => ({
    lineIndex: s.lineIndex,
    indent: s.indent,
    comment: comments[i] ?? '',
  }));

  const { text, safe, inserted } = buildAnnotatedM(m, annotations);
  if (!safe) {
    // Should be unreachable — only `//` lines are ever inserted. Never risk
    // returning altered M.
    throw new Error('Safety check failed: the M code would have changed, so it was left unmodified.');
  }
  return { text, stepCount: steps.length, inserted };
}
