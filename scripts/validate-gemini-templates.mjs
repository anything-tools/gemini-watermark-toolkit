import { readFile } from 'node:fs/promises';

import {
  OUTPUT_PATH,
  readTemplateAssets,
  renderGeminiTemplates,
  validateTemplateAsset
} from './generate-gemini-templates.mjs';

const templates = await readTemplateAssets();
for (const template of templates) validateTemplateAsset(template);

const expected = renderGeminiTemplates(templates);
const actual = await readFile(OUTPUT_PATH, 'utf8');

if (actual !== expected) {
  throw new Error('src/geminiTemplates.ts is out of date. Run npm run generate:templates.');
}

console.log(`validated ${templates.length} Gemini template assets`);
