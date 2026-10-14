import * as cheerio from 'cheerio';

/**
 * AdaptorElement wraps a single Cheerio DOM node with convenient, fluent extraction helpers.
 */
export class AdaptorElement {
  constructor(node, $, baseUrl = '') {
    this.rawNode = node;
    this.$ = $;
    this.$el = $(node);
    this.baseUrl = baseUrl;
  }

  /**
   * Element tag name in lowercase.
   */
  get tag() {
    return this.rawNode.name ? this.rawNode.name.toLowerCase() : '';
  }

  /**
   * Inner/trimmed text content.
   */
  get text() {
    return this.$el.text().trim();
  }

  /**
   * Normalized single-line text.
   */
  get cleanText() {
    return this.text.replace(/\s+/g, ' ');
  }

  /**
   * Outer HTML string.
   */
  get html() {
    return this.$.html(this.$el);
  }

  /**
   * Inner HTML string.
   */
  get innerHtml() {
    return this.$el.html() || '';
  }

  /**
   * Get attribute value by name. Automatically resolves href/src to absolute URL if baseUrl is available.
   * @param {string} name 
   * @returns {string|undefined}
   */
  attrib(name) {
    const val = this.$el.attr(name);
    if (!val) return val;
    if ((name === 'href' || name === 'src') && this.baseUrl) {
      try {
        if (!val.startsWith('#') && !val.startsWith('mailto:') && !val.startsWith('tel:') && !val.startsWith('javascript:')) {
          return new URL(val, this.baseUrl).href;
        }
      } catch (e) {}
    }
    return val;
  }

  /**
   * Returns all attributes as an object.
   */
  get attribs() {
    const raw = this.$el.attr() || {};
    const result = { ...raw };
    if (this.baseUrl) {
      if (result.href) {
        try { result.href = new URL(result.href, this.baseUrl).href; } catch (e) {}
      }
      if (result.src) {
        try { result.src = new URL(result.src, this.baseUrl).href; } catch (e) {}
      }
    }
    return result;
  }

  /**
   * Find descendants matching a CSS selector.
   * @param {string} cssSelector 
   * @returns {SelectorList}
   */
  css(cssSelector) {
    const results = [];
    this.$el.find(cssSelector).each((_, node) => {
      results.push(new AdaptorElement(node, this.$, this.baseUrl));
    });
    return new SelectorList(results, this.$, this.baseUrl);
  }

  /**
   * Find direct children matching selector or all children.
   */
  children(cssSelector) {
    const results = [];
    this.$el.children(cssSelector).each((_, node) => {
      results.push(new AdaptorElement(node, this.$, this.baseUrl));
    });
    return new SelectorList(results, this.$, this.baseUrl);
  }

  /**
   * Find immediate parent element.
   */
  parent() {
    const parentNode = this.$el.parent();
    if (parentNode.length === 0) return null;
    return new AdaptorElement(parentNode[0], this.$, this.baseUrl);
  }

  /**
   * Find sibling elements.
   */
  siblings(cssSelector) {
    const results = [];
    this.$el.siblings(cssSelector).each((_, node) => {
      results.push(new AdaptorElement(node, this.$, this.baseUrl));
    });
    return new SelectorList(results, this.$, this.baseUrl);
  }

  /**
   * Simple XPath evaluator supporting common tag / attribute / text predicates.
   * e.g. //div[@class="item"] or //a[contains(text(), "Next")]
   */
  xpath(xpathQuery) {
    return evaluateXPath(this.$el, xpathQuery, this.$, this.baseUrl);
  }

  /**
   * Extract regex matches from element text.
   * @param {RegExp|string} pattern 
   * @returns {Array<string>}
   */
  re(pattern) {
    let regex;
    if (pattern instanceof RegExp) {
      const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
      regex = new RegExp(pattern.source, flags);
    } else {
      regex = new RegExp(String(pattern), 'g');
    }
    const text = this.text;
    const matches = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      matches.push(match[1] !== undefined ? match[1] : match[0]);
    }
    return matches;
  }
}

/**
 * Array wrapper with fluent query methods.
 */
export class SelectorList extends Array {
  static get [Symbol.species]() {
    return Array;
  }

  constructor(items = [], $, baseUrl = '') {
    if (typeof items === 'number') {
      super(items);
    } else if (Array.isArray(items)) {
      super(...items);
    } else {
      super(items);
    }
    this.$ = $;
    this.baseUrl = baseUrl;
  }

  /**
   * Get first element or null.
   */
  first() {
    return this.length > 0 ? this[0] : null;
  }

  /**
   * Get last element or null.
   */
  last() {
    return this.length > 0 ? this[this.length - 1] : null;
  }

  /**
   * Get element at index.
   */
  get(index) {
    return this[index] || null;
  }

  /**
   * Extract array of text contents.
   */
  get texts() {
    return this.map(el => el.text);
  }

  /**
   * Extract array of clean texts.
   */
  get cleanTexts() {
    return this.map(el => el.cleanText);
  }

  /**
   * Extract attribute across all matched elements.
   */
  attribs(name) {
    return this.map(el => el.attrib(name)).filter(val => val !== undefined && val !== null);
  }

  /**
   * Filter elements containing substring or matching regex.
   */
  filterText(query) {
    const isRegex = query instanceof RegExp;
    const filtered = this.filter(el => {
      return isRegex ? query.test(el.text) : el.text.toLowerCase().includes(String(query).toLowerCase());
    });
    return new SelectorList(filtered, this.$, this.baseUrl);
  }

  /**
   * Chain CSS query across all elements in list.
   */
  css(cssSelector) {
    const results = [];
    this.forEach(el => {
      el.$el.find(cssSelector).each((_, node) => {
        results.push(new AdaptorElement(node, this.$, this.baseUrl));
      });
    });
    return new SelectorList(results, this.$, this.baseUrl);
  }

  /**
   * Chain XPath query across all elements.
   */
  xpath(xpathQuery) {
    const results = [];
    this.forEach(el => {
      const sub = el.xpath(xpathQuery);
      results.push(...sub);
    });
    return new SelectorList(results, this.$, this.baseUrl);
  }
}

/**
 * Lightweight XPath emulator for Cheerio/DOM.
 */
export function evaluateXPath($root, xpathQuery, $, baseUrl) {
  const query = xpathQuery.trim();
  const results = [];

  // 1. Simple //tag[@attr="val"]
  const attrMatch = query.match(/^\/\/(?:([a-zA-Z0-9_-]+)|\*)\s*\[\s*@([a-zA-Z0-9_-]+)\s*=\s*['"]([^'"]+)['"]\s*\]$/);
  if (attrMatch) {
    const tag = attrMatch[1] || '*';
    const attr = attrMatch[2];
    const val = attrMatch[3];
    $root.find(`${tag}[${attr}="${val}"]`).each((_, node) => {
      results.push(new AdaptorElement(node, $, baseUrl));
    });
    return new SelectorList(results, $, baseUrl);
  }

  // 2. Simple //tag[contains(@attr, "val")]
  const containsAttrMatch = query.match(/^\/\/(?:([a-zA-Z0-9_-]+)|\*)\s*\[\s*contains\s*\(\s*@([a-zA-Z0-9_-]+)\s*,\s*['"]([^'"]+)['"]\s*\)\s*\]$/);
  if (containsAttrMatch) {
    const tag = containsAttrMatch[1] || '*';
    const attr = containsAttrMatch[2];
    const val = containsAttrMatch[3];
    $root.find(`${tag}[${attr}*="${val}"]`).each((_, node) => {
      results.push(new AdaptorElement(node, $, baseUrl));
    });
    return new SelectorList(results, $, baseUrl);
  }

  // 3. Simple //tag[contains(text(), "val")]
  const containsTextMatch = query.match(/^\/\/(?:([a-zA-Z0-9_-]+)|\*)\s*\[\s*contains\s*\(\s*(?:text\(\)|\.)\s*,\s*['"]([^'"]+)['"]\s*\)\s*\]$/);
  if (containsTextMatch) {
    const tag = containsTextMatch[1] || '*';
    const searchVal = containsTextMatch[2].toLowerCase();
    $root.find(tag).each((_, node) => {
      if ($(node).text().toLowerCase().includes(searchVal)) {
        results.push(new AdaptorElement(node, $, baseUrl));
      }
    });
    return new SelectorList(results, $, baseUrl);
  }

  // 4. Fallback: simple //tag
  const simpleTagMatch = query.match(/^\/\/([a-zA-Z0-9_-]+)$/);
  if (simpleTagMatch) {
    const tag = simpleTagMatch[1];
    $root.find(tag).each((_, node) => {
      results.push(new AdaptorElement(node, $, baseUrl));
    });
    return new SelectorList(results, $, baseUrl);
  }

  // General fallback: try css selector conversion
  try {
    const cssEquivalent = query
      .replace(/\/\//g, ' ')
      .replace(/\/([a-zA-Z0-9_-]+)/g, ' > $1')
      .trim();
    $root.find(cssEquivalent).each((_, node) => {
      results.push(new AdaptorElement(node, $, baseUrl));
    });
  } catch (e) {}

  return new SelectorList(results, $, baseUrl);
}
