/**
 * Browser-side PII detection that mirrors rust/tokenizer/src/regex.rs:
 * the same 7 MENA-oriented patterns, matched in the same priority order,
 * with non-overlapping spans. Used by the "Try it" panel and the Simulate
 * Request pipeline. This is a demo reimplementation of the Rust detector.
 */

export interface PiiMatch {
  type: string;
  value: string;
  start: number;
  end: number;
}

// Same order as the Rust PATTERNS slice (priority = first match wins).
const PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'iban', re: /\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b/g },
  { name: 'email', re: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g },
  { name: 'phone', re: /\+\d{1,3}[\s\-]?\d{1,4}[\s\-]?\d{3,4}[\s\-]?\d{3,4}/g },
  { name: 'emirates_id', re: /\b784-?\d{4}-?\d{7}-?\d\b/g },
  { name: 'card', re: /\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{1,7}\b/g },
  { name: 'ksa_nid', re: /\b[12]\d{9}\b/g },
  { name: 'morocco_cin', re: /\b[A-Z]{1,2}\d{5,7}\b/g },
];

export const PII_LABELS: Record<string, string> = {
  iban: 'IBAN',
  email: 'Email',
  phone: 'Phone',
  emirates_id: 'Emirates ID',
  card: 'Card',
  ksa_nid: 'KSA National ID',
  morocco_cin: 'Morocco CIN',
};

/** Detect PII spans, keeping only non-overlapping matches (priority order). */
export function detectPii(text: string): PiiMatch[] {
  const occupied = new Array(text.length).fill(false);
  const matches: PiiMatch[] = [];
  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      const start = m.index;
      const end = start + m[0].length;
      let free = true;
      for (let i = start; i < end; i++) {
        if (occupied[i]) {
          free = false;
          break;
        }
      }
      if (!free) continue;
      for (let i = start; i < end; i++) occupied[i] = true;
      matches.push({ type: name, value: m[0], start, end });
    }
  }
  matches.sort((a, b) => a.start - b.start);
  return matches;
}

function tokenFor(type: string, seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  const hex = Math.abs(h).toString(16).padStart(8, '0');
  return `<${type}:${hex}${hex.slice(0, 4)}>`;
}

export interface TokenizeResult {
  output: string;
  matches: PiiMatch[];
  tokens: { type: string; value: string; token: string }[];
}

/** Replace each detected span with a scoped UUID-style token. */
export function tokenizePii(text: string): TokenizeResult {
  const matches = detectPii(text);
  const tokens: { type: string; value: string; token: string }[] = [];
  let output = '';
  let cursor = 0;
  matches.forEach((mt, idx) => {
    output += text.slice(cursor, mt.start);
    const token = tokenFor(mt.type, mt.value + idx);
    output += token;
    tokens.push({ type: mt.type, value: mt.value, token });
    cursor = mt.end;
  });
  output += text.slice(cursor);
  return { output, matches, tokens };
}
