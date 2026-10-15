import { describe, expect, it } from 'vitest';
import { sanitizeAndParseJson } from './json-sanitizer';

describe('sanitizeAndParseJson', () => {
  it('parses clean valid JSON directly', () => {
    const raw = '{"name": "Pixel 9", "battery": 4700}';
    expect(sanitizeAndParseJson(raw)).toEqual({ name: 'Pixel 9', battery: 4700 });
  });

  it('strips markdown ```json ... ``` code fences', () => {
    const raw = '```json\n{"name": "Galaxy S24", "ram": 8}\n```';
    expect(sanitizeAndParseJson(raw)).toEqual({ name: 'Galaxy S24', ram: 8 });
  });

  it('strips generic markdown ``` ... ``` code fences', () => {
    const raw = '```\n{"name": "iPhone 16", "screen": 6.1}\n```';
    expect(sanitizeAndParseJson(raw)).toEqual({ name: 'iPhone 16', screen: 6.1 });
  });

  it('extracts JSON surrounded by conversational preamble and postscript', () => {
    const raw = `Here is the extracted specification for the phone:
\`\`\`json
{
  "brand": "OnePlus",
  "model": "13"
}
\`\`\`
Let me know if you need any other fields!`;
    expect(sanitizeAndParseJson(raw)).toEqual({ brand: 'OnePlus', model: '13' });
  });

  it('fixes trailing commas in objects and arrays', () => {
    const raw = `{
      "brand": "Apple",
      "options": [128, 256, 512, ],
      "dimensions": { "height": 147.6, "width": 71.6, },
    }`;
    expect(sanitizeAndParseJson(raw)).toEqual({
      brand: 'Apple',
      options: [128, 256, 512],
      dimensions: { height: 147.6, width: 71.6 },
    });
  });

  it('parses arrays correctly', () => {
    const raw = '["chunk-1", "chunk-2", "chunk-3"]';
    expect(sanitizeAndParseJson(raw)).toEqual(['chunk-1', 'chunk-2', 'chunk-3']);
  });

  it('throws informative error when no JSON structure is found', () => {
    expect(() => sanitizeAndParseJson('I cannot find any specs for this device.')).toThrow(
      /No JSON object or array found/,
    );
  });

  it('throws on empty string', () => {
    expect(() => sanitizeAndParseJson('')).toThrow(/must be a non-empty string/);
  });
});
