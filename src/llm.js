import dotenv from 'dotenv';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';

dotenv.config();

// Predefined Zod Schemas
export const schemas = {
  article: z.object({
    title: z.string().default(''),
    author: z.string().nullable().default(null),
    date: z.string().nullable().default(null),
    summary: z.string().default(''),
    tags: z.array(z.string()).default([]),
    body: z.string().default('')
  }),
  
  product: z.object({
    name: z.string().default(''),
    price: z.string().nullable().default(null),
    currency: z.string().nullable().default(null),
    description: z.string().default(''),
    specs: z.record(z.string()).default({}),
    availability: z.string().nullable().default(null)
  }),

  event: z.object({
    name: z.string().default(''),
    date: z.string().nullable().default(null),
    location: z.string().nullable().default(null),
    description: z.string().default(''),
    url: z.string().nullable().default(null),
    price: z.string().nullable().default(null)
  }),

  contact: z.object({
    name: z.string().default(''),
    email: z.string().nullable().default(null),
    phone: z.string().nullable().default(null),
    address: z.string().nullable().default(null),
    organization: z.string().nullable().default(null)
  }),

  custom: z.record(z.any())
};

/**
 * Normalizes and validates the extracted object against Zod schema.
 * @param {object} data 
 * @param {string} schemaName 
 * @returns {object}
 */
function validateSchema(data, schemaName) {
  const schema = schemas[schemaName] || schemas.custom;
  try {
    return schema.parse(data);
  } catch (err) {
    console.warn(`⚠️ Zod validation warning: some fields did not match. Using defaults.`);
    // Safe fallback parse
    return data;
  }
}

/**
 * HEURISTIC RULE-BASED EXTRACTOR
 * Falls back to this if no LLM APIs are accessible.
 * @param {string} markdown 
 * @param {string} url 
 * @param {string} schemaName 
 * @param {string} instruction 
 * @returns {object}
 */
export function extractUsingRules(markdown, url, schemaName, instruction = '') {
  console.log(`ℹ️ Using local rule-based extractor (LLM API keys not found).`);
  
  const titleMatch = markdown.match(/^#\s+(.+)$/m);
  const firstHeading = titleMatch ? titleMatch[1].trim() : '';

  const data = {};

  if (schemaName === 'article') {
    data.title = firstHeading || 'Article Title';
    data.author = 'Unknown';
    data.date = new Date().toISOString().split('T')[0];
    
    // Grab first paragraph as summary
    const paragraphs = markdown.split('\n\n').filter(p => p.trim() && !p.startsWith('#') && !p.startsWith('>'));
    data.summary = paragraphs[0] ? paragraphs[0].substring(0, 150).trim() + '...' : 'No summary available.';
    data.tags = [];
    data.body = markdown;
  } 
  else if (schemaName === 'product') {
    data.name = firstHeading || 'Product Name';
    
    // Simple heuristic search for pricing formats like $49.99 or 49.99 USD
    const priceRegex = /(?:\$|£|€)\s*\d+(?:\.\d{2})?|\d+(?:\.\d{2})?\s*(?:USD|EUR|GBP)/i;
    const match = markdown.match(priceRegex);
    data.price = match ? match[0] : null;
    data.currency = match ? (match[0].includes('$') ? 'USD' : match[0].includes('€') ? 'EUR' : 'Local') : null;
    data.description = markdown.substring(0, 200).trim() + '...';
    data.specs = {};
    data.availability = markdown.toLowerCase().includes('in stock') ? 'In Stock' : 'Unknown';
  } 
  else if (schemaName === 'event') {
    data.name = firstHeading || 'Event Title';
    // Simple date regex lookup
    const dateRegex = /\b\d{4}[-/]\d{2}[-/]\d{2}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}(?:,\s+\d{4})?\b/i;
    const match = markdown.match(dateRegex);
    data.date = match ? match[0] : null;
    data.location = markdown.toLowerCase().includes('zoom') ? 'Online/Zoom' : 'TBD';
    data.description = markdown.substring(0, 200).trim() + '...';
    data.url = url;
    data.price = null;
  }
  else if (schemaName === 'contact') {
    // Look for emails
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/;
    const emailMatch = markdown.match(emailRegex);
    data.email = emailMatch ? emailMatch[0] : null;
    
    // Look for phone
    const phoneRegex = /\+?\d{1,4}?[-.\s]?\(?\d{1,3}?\)?[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9}/;
    const phoneMatch = markdown.match(phoneRegex);
    data.phone = phoneMatch ? phoneMatch[0] : null;
    
    data.name = firstHeading || 'Contact Name';
    data.address = null;
    data.organization = null;
  }
  else {
    // Custom/generic schema
    data.title = firstHeading || 'Generic Title';
    data.extracted_at = new Date().toISOString();
    data.url = url;
    if (instruction) {
      data.note = `Extracted offline using instruction: "${instruction}"`;
    }
  }

  return validateSchema(data, schemaName);
}

/**
 * Call Local OpenAI-compatible endpoint (like Ollama or LM Studio)
 * @param {string} prompt 
 * @param {string} schemaJsonString 
 * @returns {Promise<object>}
 */
async function queryLocalLlm(prompt, schemaJsonString) {
  const endpoint = process.env.LOCAL_LLM_ENDPOINT || 'http://localhost:11434/v1';
  const model = process.env.LOCAL_LLM_MODEL || 'llama3';

  console.log(`🤖 Attempting Local LLM completion at ${endpoint} using model: ${model}...`);
  
  const response = await axios.post(`${endpoint}/chat/completions`, {
    model,
    messages: [
      {
        role: 'system',
        content: `You are an expert structured data extractor. You return ONLY a valid JSON object matching this schema: ${schemaJsonString}. Do not return any other text, markdown blocks, or conversational introductions.`
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' }
  }, { timeout: 45000 });

  const content = response.data.choices[0].message.content.trim();
  return JSON.parse(content);
}

/**
 * Orchestrates structured data extraction from Markdown page contents.
 * Graces fallbacks in order: Anthropic API -> Local LLM (Ollama) -> Rules based extractor.
 * @param {string} markdown 
 * @param {string} url 
 * @param {string} schemaName 
 * @param {object} options 
 * @returns {Promise<object>}
 */
export async function extractData(markdown, url, schemaName = 'custom', options = {}) {
  const instruction = options.instruction || 'Extract all key information from this document.';
  const schemaObj = schemas[schemaName] || schemas.custom;
  const schemaStr = JSON.stringify(schemaObj.shape || {});

  const prompt = `
Extract structured data from the following markdown scraped from this URL: ${url}
User Instruction: "${instruction}"

Page Markdown Content:
---
${markdown.substring(0, 15000)}
---

Extract the values matching this JSON schema: ${schemaStr}. Ensure all keys are populated or set to null if not found. Return only the raw JSON.
`;

  // 1. Try Anthropic SDK if API key is present
  if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'your_key_here') {
    try {
      console.log(`🧠 Querying Anthropic Claude API for data extraction...`);
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const response = await anthropic.messages.create({
        model: 'claude-3-haiku-20240307', // fast, cheap, perfect for structuring
        max_tokens: 1500,
        temperature: 0.1,
        system: `You are a data extraction bot. You return ONLY a raw JSON object matching the following structure: ${schemaStr}. Do not wrap the JSON in \`\`\`json markdown blocks, just return the raw JSON text.`,
        messages: [{ role: 'user', content: prompt }]
      });

      const responseText = response.content[0].text.trim();
      const jsonData = JSON.parse(responseText);
      return validateSchema(jsonData, schemaName);
    } catch (err) {
      console.warn(`⚠️ Anthropic API call failed: ${err.message}. Trying local fallback...`);
    }
  }

  // 2. Try Local LLM Endpoint if configured
  if (process.env.LOCAL_LLM_ENDPOINT) {
    try {
      const jsonData = await queryLocalLlm(prompt, schemaStr);
      return validateSchema(jsonData, schemaName);
    } catch (err) {
      console.warn(`⚠️ Local LLM API call failed: ${err.message}.`);
    }
  }

  // 3. Absolute Fallback: Rule-Based / Heuristic parsing
  return extractUsingRules(markdown, url, schemaName, instruction);
}

/**
 * Summarizes the scraped markdown.
 * @param {string} markdown 
 * @returns {Promise<string>}
 */
export async function summarizeContent(markdown) {
  const instruction = "Provide a concise 3-4 bullet-point summary of this content.";
  
  if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'your_key_here') {
    try {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const response = await anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 500,
        temperature: 0.2,
        messages: [{ role: 'user', content: `Summarize the following content in 3-4 bullet points:\n\n${markdown.substring(0, 10000)}` }]
      });
      return response.content[0].text.trim();
    } catch (err) {
      console.warn(`⚠️ Summarization failed using Anthropic: ${err.message}`);
    }
  }

  // Local rule-based summary
  const lines = markdown.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#') && !l.startsWith('>'));
  const summaryLines = lines.slice(0, 3).map(line => `• ${line.substring(0, 120)}...`);
  return `[Offline Summary Fallback]\n${summaryLines.join('\n')}`;
}

/**
 * Clusters multiple scraped pages by topic or theme.
 * Graces fallback: Anthropic Claude -> Local LLM -> Offline Keyword/Domain rule-based grouper.
 * @param {Array<object>} scrapes - List of { url, title, markdown }
 * @returns {Promise<object>} Map of categories to lists of URLs
 */
export async function groupScrapes(scrapes) {
  if (scrapes.length === 0) return {};

  const itemsDescription = scrapes.map((s, idx) => {
    const snippet = s.markdown ? s.markdown.substring(0, 300).replace(/\n/g, ' ') : '';
    return `[Item #${idx}] URL: ${s.url}\nTitle: ${s.title || 'Unknown'}\nSnippet: ${snippet}\n`;
  }).join('\n');

  const prompt = `
We have scraped a batch of pages. Please group them into logical categories based on their titles and content snippets.
Return a single JSON object where keys are category names (short, descriptive) and values are arrays of URLs belonging to that category.

Scraped Pages:
${itemsDescription}

Return only the raw JSON mapping.
`;

  const schemaStr = `{"CategoryName": ["url1", "url2"]}`;

  // 1. Try Anthropic SDK
  if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'your_key_here') {
    try {
      console.log(`🧠 Querying Anthropic Claude to group and categorize batch scrapes...`);
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const response = await anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1000,
        temperature: 0.1,
        system: `You are an analytics assistant. You return ONLY a valid JSON object mapping category strings to arrays of matching page URLs. Example: ${schemaStr}`,
        messages: [{ role: 'user', content: prompt }]
      });

      return JSON.parse(response.content[0].text.trim());
    } catch (err) {
      console.warn(`⚠️ Anthropic batch grouping failed: ${err.message}. Trying local fallback...`);
    }
  }

  // 2. Try Local LLM
  if (process.env.LOCAL_LLM_ENDPOINT) {
    try {
      const response = await queryLocalLlm(prompt, schemaStr);
      return response;
    } catch (err) {
      console.warn(`⚠️ Local LLM batch grouping failed: ${err.message}.`);
    }
  }

  // 3. Fallback: Rule-Based Categorizer (by Domain or Heuristics)
  console.log(`ℹ️ Grouping batch scrapes offline using domain-based categorization.`);
  const groups = {};
  scrapes.forEach(s => {
    let category = 'General';
    try {
      const hostname = new URL(s.url).hostname;
      // Clean domain name (e.g. news.ycombinator.com -> ycombinator.com)
      const parts = hostname.split('.');
      if (parts.length >= 2) {
        category = parts.slice(-2).join('.');
      } else {
        category = hostname;
      }
      category = category.charAt(0).toUpperCase() + category.slice(1);
    } catch (e) {
      category = 'Local/Unstructured';
    }

    if (!groups[category]) {
      groups[category] = [];
    }
    groups[category].push(s.url);
  });

  return groups;
}
