/**
 * 64-Bit SimHash Locality-Sensitive Hashing (LSH) for DOM Structural Fingerprinting
 * ────────────────────────────────────────────────────────────────────────────────
 * Provides O(1) Hamming-distance comparisons for self-healing element locators,
 * enabling resilient recovery even when classes, IDs, and positions are mutated
 * by modern frontend bundlers (e.g. CSS Modules, styled-components, randomized hashes).
 */

const FNV64_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/**
 * Computes 64-bit Fowler-Noll-Vo (FNV-1a) hash of a string.
 * @param {string} str 
 * @returns {bigint} 64-bit unsigned BigInt hash
 */
export function fnv1a64(str) {
  let hash = FNV64_OFFSET_BASIS;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    hash ^= BigInt(s.charCodeAt(i));
    hash = (hash * FNV64_PRIME) & MASK_64;
  }
  return hash;
}

/**
 * Computes a 64-bit SimHash fingerprint from weighted tokens.
 * @param {Array<{ token: string, weight?: number }> | Record<string, number>} tokens 
 * @returns {string} 16-character hexadecimal SimHash representation
 */
export function computeSimHash(tokens) {
  const v = new Array(64).fill(0);

  const tokenList = Array.isArray(tokens)
    ? tokens
    : Object.entries(tokens).map(([token, weight]) => ({ token, weight }));

  for (const item of tokenList) {
    const token = typeof item === 'string' ? item : item.token;
    const weight = (typeof item === 'object' && item.weight !== undefined) ? item.weight : 1;
    if (!token) continue;

    const hash = fnv1a64(token);

    for (let i = 0; i < 64; i++) {
      const bit = (hash >> BigInt(i)) & 1n;
      if (bit === 1n) {
        v[i] += weight;
      } else {
        v[i] -= weight;
      }
    }
  }

  let simhash = 0n;
  for (let i = 0; i < 64; i++) {
    if (v[i] > 0) {
      simhash |= (1n << BigInt(i));
    }
  }

  return simhash.toString(16).padStart(16, '0');
}

/**
 * Computes the Hamming distance (number of bitwise differences) between two 64-bit SimHashes.
 * @param {string|bigint} hashA 
 * @param {string|bigint} hashB 
 * @returns {number} Hamming distance in range [0, 64]
 */
export function hammingDistance(hashA, hashB) {
  const a = typeof hashA === 'bigint' ? hashA : BigInt('0x' + String(hashA));
  const b = typeof hashB === 'bigint' ? hashB : BigInt('0x' + String(hashB));
  let xor = (a ^ b) & MASK_64;

  // Kernighan's bit-counting algorithm for popcount
  let count = 0;
  while (xor > 0n) {
    xor &= (xor - 1n);
    count++;
  }
  return count;
}

/**
 * Computes normalized similarity between two 64-bit SimHashes.
 * @param {string|bigint} hashA 
 * @param {string|bigint} hashB 
 * @returns {number} Similarity score in range [0.0, 1.0]
 */
export function simHashSimilarity(hashA, hashB) {
  const dist = hammingDistance(hashA, hashB);
  return parseFloat((1.0 - (dist / 64)).toFixed(4));
}

/**
 * Extracts structural and semantic feature tokens from a Cheerio DOM element.
 * @param {object} $ - Cheerio instance
 * @param {object} elem - Cheerio element
 * @returns {Array<{ token: string, weight: number }>}
 */
export function extractElementTokens($, elem) {
  const $el = $(elem);
  const tokens = [];

  const tag = elem.name ? elem.name.toLowerCase() : '*';
  tokens.push({ token: `tag:${tag}`, weight: 4 });

  // Parent tag & role
  const parent = $el.parent();
  if (parent.length > 0 && parent[0].name) {
    tokens.push({ token: `ptag:${parent[0].name.toLowerCase()}`, weight: 3 });
    const pRole = parent.attr('role');
    if (pRole) tokens.push({ token: `prole:${pRole.toLowerCase()}`, weight: 2 });
  }

  // Element role & semantic attributes
  const role = $el.attr('role');
  if (role) tokens.push({ token: `role:${role.toLowerCase()}`, weight: 3 });

  const itemprop = $el.attr('itemprop');
  if (itemprop) tokens.push({ token: `itemprop:${itemprop.toLowerCase()}`, weight: 3 });

  // Direct children composition
  const childTags = [];
  $el.children().each((_, child) => {
    if (child.name) childTags.push(child.name.toLowerCase());
  });
  if (childTags.length > 0) {
    tokens.push({ token: `children:${childTags.slice(0, 8).join(',')}`, weight: 3 });
    tokens.push({ token: `childCount:${childTags.length}`, weight: 2 });
  }

  // Structural depth bucket
  let depth = 0;
  let cur = elem.parent;
  while (cur && cur.type === 'tag') {
    depth++;
    cur = cur.parent;
  }
  tokens.push({ token: `depthBucket:${Math.min(10, Math.floor(depth / 2))}`, weight: 2 });

  // Text characteristics
  const text = $el.text().trim();
  const textLen = text.length;
  tokens.push({ token: `textLenBucket:${Math.min(10, Math.floor(Math.log2(Math.max(1, textLen))))}`, weight: 2 });

  // Word shingles (2-word bi-grams from first 80 chars for lexical anchoring)
  const words = text.slice(0, 80).toLowerCase().split(/\s+/).filter(w => w.length > 2);
  for (let i = 0; i < words.length - 1; i++) {
    tokens.push({ token: `shingle:${words[i]}_${words[i + 1]}`, weight: 1 });
  }

  // Stable class tokens (strip dynamic build hashes e.g. .css-1a2b3c, .sc-xyz)
  const classAttr = $el.attr('class') || '';
  const classes = classAttr.split(/\s+/).filter(Boolean);
  for (const c of classes) {
    // If class looks like a stable semantic name (not an 8+ hex hash or base64)
    if (!/^[a-z]{1,3}-[a-f0-9]{6,}$/i.test(c) && !/^[a-f0-9]{8,}$/i.test(c)) {
      tokens.push({ token: `class:${c}`, weight: 2 });
    }
  }

  return tokens;
}

/**
 * Computes the 64-bit SimHash of a Cheerio DOM element.
 * @param {object} $ 
 * @param {object} elem 
 * @returns {string} 16-character hex SimHash
 */
export function computeElementSimHash($, elem) {
  const tokens = extractElementTokens($, elem);
  return computeSimHash(tokens);
}
