import { AdaptorElement, SelectorList } from './selector.js';

/**
 * AdaptiveEngine handles fingerprinting elements and self-healing broken selectors.
 */
export class AdaptiveEngine {
  /**
   * Generates a multi-anchor fingerprint for a given DOM element.
   * @param {object} $ - Cheerio instance
   * @param {object} elem - DOM node
   * @returns {object} Fingerprint signature
   */
  static generateFingerprint($, elem) {
    const $el = $(elem);
    const text = $el.text().trim();
    const snippet = text.slice(0, 120);

    const classAttr = $el.attr('class') || '';
    const classes = classAttr.split(/\s+/).filter(c => c && !c.startsWith('scrapi-') && /^[a-zA-Z0-9_-]+$/.test(c));

    const id = $el.attr('id') || null;
    const tagName = elem.name ? elem.name.toLowerCase() : '*';

    // Parent signature
    const parent = $el.parent();
    const parentTag = parent.length > 0 && parent[0].name ? parent[0].name.toLowerCase() : null;
    const parentId = parent.attr('id') || null;

    // Structural path
    const path = [];
    let cur = elem;
    while (cur && cur.type === 'tag' && cur.name !== 'html' && cur.name !== 'body') {
      let segment = cur.name.toLowerCase();
      if ($(cur).attr('id')) {
        segment += `#${$(cur).attr('id')}`;
        path.unshift(segment);
        break;
      }
      path.unshift(segment);
      cur = cur.parent;
    }

    return {
      tagName,
      id,
      classes,
      textSnippet: snippet,
      parentTagName: parentTag,
      parentId,
      path: path.join(' > '),
      createdAt: new Date().toISOString()
    };
  }

  /**
   * Attempts to locate the element using the fingerprint signature when standard selector fails.
   * @param {object} $ - Cheerio instance
   * @param {object} signature - Fingerprint signature
   * @param {string} [baseUrl='']
   * @returns {{ element: AdaptorElement|null, confidence: number, healedSelector: string|null }}
   */
  static relocate($, signature, baseUrl = '') {
    if (!signature) return { element: null, confidence: 0, healedSelector: null };

    let candidates = $(signature.tagName || '*');
    if (candidates.length === 0) {
      candidates = $('article, section, main, div, li, tr, p, [role="article"], [role="main"], body *');
    }
    if (candidates.length === 0) {
      return { element: null, confidence: 0, healedSelector: null };
    }

    let bestCandidate = null;
    let maxScore = -1;

    candidates.each((_, elem) => {
      let score = 0;
      const $elem = $(elem);

      // 1. Text snippet similarity (weight: 0.45)
      const text = $elem.text().trim();
      if (signature.textSnippet && text) {
        if (text.includes(signature.textSnippet) || signature.textSnippet.includes(text)) {
          score += 0.45;
        } else {
          const sigWords = new Set(signature.textSnippet.toLowerCase().split(/\s+/).filter(Boolean));
          const candWords = new Set(text.toLowerCase().split(/\s+/).filter(Boolean));
          const intersection = [...sigWords].filter(w => candWords.has(w));
          if (sigWords.size > 0) {
            score += (intersection.length / sigWords.size) * 0.35;
          }
        }
      }

      // 2. Class overlap (weight: 0.25)
      if (signature.classes && signature.classes.length > 0) {
        const classAttr = $elem.attr('class') || '';
        const candClasses = classAttr.split(/\s+/).filter(Boolean);
        const matched = signature.classes.filter(c => candClasses.includes(c));
        score += (matched.length / signature.classes.length) * 0.25;
      }

      // 3. Parent alignment (weight: 0.15)
      if (signature.parentTagName) {
        const parent = $elem.parent();
        if (parent.length > 0 && parent[0].name && parent[0].name.toLowerCase() === signature.parentTagName.toLowerCase()) {
          score += 0.15;
        }
      }

      // 4. ID match (weight: 0.15)
      if (signature.id && $elem.attr('id') === signature.id) {
        score += 0.15;
      }

      if (score > maxScore) {
        maxScore = score;
        bestCandidate = elem;
      }
    });

    const confidence = Math.min(1.0, maxScore);

    if (bestCandidate && confidence >= 0.35) {
      const healedSelector = this.generateSelectorForNode($, bestCandidate);
      return {
        element: new AdaptorElement(bestCandidate, $, baseUrl),
        confidence,
        healedSelector
      };
    }

    return { element: null, confidence: 0, healedSelector: null };
  }

  /**
   * Generates a minimal, robust selector for a healed node.
   */
  static generateSelectorForNode($, elem) {
    let path = [];
    let current = elem;
    while (current && current.type === 'tag') {
      let tag = current.name ? current.name.toLowerCase() : 'div';
      const id = $(current).attr('id');
      if (id) {
        path.unshift(`#${id}`);
        break;
      }
      const classAttr = $(current).attr('class');
      if (classAttr) {
        const classes = classAttr.trim().split(/\s+/).filter(c => c && !c.startsWith('scrapi-') && /^[a-zA-Z0-9_-]+$/.test(c));
        if (classes.length > 0) {
          tag += '.' + classes[0];
        }
      }
      path.unshift(tag);
      current = current.parent;
    }
    return path.join(' > ');
  }
}
