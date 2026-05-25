import type { WatermarkPresetName, WatermarkTemplate, WatermarkTemplateRegistry } from './types.js';
import { createRealGeminiTemplates } from './geminiTemplates.js';

export class TemplateRegistry implements WatermarkTemplateRegistry {
  readonly #templates = new Map<string, WatermarkTemplate>();

  constructor(templates: WatermarkTemplate[] = []) {
    for (const template of templates) {
      this.register(template);
    }
  }

  register(template: WatermarkTemplate): void {
    if (template.width <= 0 || template.height <= 0) {
      throw new RangeError('template dimensions must be positive');
    }
    if (template.alpha.length !== template.width * template.height) {
      throw new RangeError(`template ${template.id} alpha length must match width * height`);
    }
    this.#templates.set(template.id, template);
  }

  get(id: string): WatermarkTemplate | undefined {
    return this.#templates.get(id);
  }

  list(): WatermarkTemplate[] {
    return [...this.#templates.values()];
  }

  findBySize(width: number, height: number): WatermarkTemplate[] {
    return this.list().filter((template) => template.width === width && template.height === height);
  }
}

export function createDefaultRegistry(): TemplateRegistry {
  return new TemplateRegistry(createRealGeminiTemplates());
}

export const defaultRegistry = createDefaultRegistry();

export function getPreset(name: WatermarkPresetName = 'gemini'): WatermarkTemplate {
  if (name !== 'gemini') {
    throw new RangeError(`unknown preset: ${name}`);
  }
  const template = defaultRegistry.get('gemini-visible-white-96');
  if (!template) {
    throw new Error('default Gemini template is not registered');
  }
  return template;
}
