import { runSpider as executeSpider } from './spiders/index.js';

/**
 * Runs a recursive site spider that crawls page links in parallel, mapping directory structures.
 * @param {string} seedUrl 
 * @param {object} options 
 * @param {function} onProgress 
 */
export async function runSpider(seedUrl, options = {}, onProgress = () => {}) {
  return executeSpider(seedUrl, options, onProgress);
}
