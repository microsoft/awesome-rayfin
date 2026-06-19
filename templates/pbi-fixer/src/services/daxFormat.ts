// Lightweight, offline DAX pretty-printer.
//
// Heuristic paren / comma / keyword based line breaking with indentation. It
// never inspects the contents of strings, quoted identifiers, bracket
// identifiers or comments, and it re-checks its own output: if the formatted
// text's non-whitespace token stream differs from the input's, it returns the
// original text unchanged. That guard guarantees formatting can never corrupt
// a DAX expression — at worst it is a no-op. No network call.

const INDENT = '    ';

type TokType = 'ws' | 'str' | 'qid' | 'bid' | 'comment' | 'punct' | 'word' | 'op';
interface Tok {
  type: TokType;
  text: string;
}

const MULTI_OPS = ['<=', '>=', '<>', '&&', '||', ':=', '=='];

/** Keywords that should start a fresh line at the current indent. */
const KW_NEWLINE = new Set(['VAR', 'RETURN', 'EVALUATE', 'DEFINE', 'MEASURE', 'ORDER', 'GROUPBY']);

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];

    if (/\s/.test(c)) {
      let j = i + 1;
      while (j < n && /\s/.test(src[j])) j++;
      toks.push({ type: 'ws', text: src.slice(i, j) });
      i = j;
      continue;
    }

    // Line comment: -- … or // …
    if ((c === '-' && src[i + 1] === '-') || (c === '/' && src[i + 1] === '/')) {
      let j = i + 2;
      while (j < n && src[j] !== '\n') j++;
      toks.push({ type: 'comment', text: src.slice(i, j) });
      i = j;
      continue;
    }

    // Block comment: /* … */
    if (c === '/' && src[i + 1] === '*') {
      let j = i + 2;
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
      j = Math.min(n, j + 2);
      toks.push({ type: 'comment', text: src.slice(i, j) });
      i = j;
      continue;
    }

    // String literal: "…" (doubled "" escapes).
    if (c === '"') {
      let j = i + 1;
      while (j < n) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      toks.push({ type: 'str', text: src.slice(i, j) });
      i = j;
      continue;
    }

    // Quoted (table) identifier: '…' (doubled '' escapes).
    if (c === "'") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === "'") {
          if (src[j + 1] === "'") {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      toks.push({ type: 'qid', text: src.slice(i, j) });
      i = j;
      continue;
    }

    // Bracket (column / measure) identifier: [...]
    if (c === '[') {
      let j = i + 1;
      while (j < n && src[j] !== ']') j++;
      j = Math.min(n, j + 1);
      toks.push({ type: 'bid', text: src.slice(i, j) });
      i = j;
      continue;
    }

    // Word: identifier / function / keyword / number.
    if (/[A-Za-z0-9_.]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_.]/.test(src[j])) j++;
      toks.push({ type: 'word', text: src.slice(i, j) });
      i = j;
      continue;
    }

    // Multi-character operators.
    const two = src.substr(i, 2);
    if (MULTI_OPS.includes(two)) {
      toks.push({ type: 'op', text: two });
      i += 2;
      continue;
    }

    // Single punctuation / operator.
    toks.push({ type: c === '(' || c === ')' || c === ',' ? 'punct' : 'op', text: c });
    i++;
  }
  return toks;
}

/** Non-whitespace token signature, used for the round-trip safety check. */
function signature(src: string): string {
  return tokenize(src)
    .filter((t) => t.type !== 'ws' && t.type !== 'comment')
    .map((t) => t.text)
    .join('\u0001');
}

/**
 * Pretty-print a DAX expression. Returns the original string unchanged if it is
 * empty or if the safety re-check fails.
 */
export function formatDax(src: string): string {
  const input = src.trim();
  if (!input) return src;

  let toks: Tok[];
  try {
    toks = tokenize(input).filter((t) => t.type !== 'ws');
  } catch {
    return src;
  }

  let out = '';
  let indent = 0;
  let atLineStart = true;
  const pad = () => INDENT.repeat(Math.max(0, indent));
  const newline = () => {
    out = out.replace(/[ \t]+$/, '');
    out += '\n' + pad();
    atLineStart = true;
  };
  const emit = (s: string) => {
    out += s;
    atLineStart = false;
  };

  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    const prev = toks[k - 1];
    const upper = t.type === 'word' ? t.text.toUpperCase() : '';

    if (t.text === '(') {
      emit('(');
      indent++;
      const next = toks[k + 1];
      if (next && next.text !== ')') newline();
      continue;
    }
    if (t.text === ')') {
      indent--;
      newline();
      emit(')');
      continue;
    }
    if (t.text === ',') {
      out = out.replace(/[ \t]+$/, '');
      emit(',');
      newline();
      continue;
    }

    if (KW_NEWLINE.has(upper) && !atLineStart) newline();

    if (!atLineStart) {
      // No space between a table/word/bracket and a following bracket id
      // (keeps `Sales[Amount]` and `'Date'[Year]` intact).
      const noSpaceBefore =
        t.type === 'bid' && !!prev && (prev.type === 'qid' || prev.type === 'word' || prev.type === 'bid');
      if (!noSpaceBefore) emit(' ');
    }
    emit(t.text);

    if (upper === 'RETURN') newline();
  }

  const formatted = out
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();

  try {
    if (signature(formatted) !== signature(input)) return src;
  } catch {
    return src;
  }
  return formatted;
}
