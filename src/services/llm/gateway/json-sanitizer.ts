/**
 * Zero-dependency resilient JSON sanitizer and extractor.
 *
 * Open-weights and small LLMs (e.g. Llama 3.1 8B, Cerebras) frequently emit:
 * 1. Markdown code fences: ```json ... ``` or ``` ... ```
 * 2. Preambles or closing conversational remarks ("Here is your JSON:")
 * 3. Trailing commas before closing braces/brackets (`{ "a": 1, }`)
 * 4. Unescaped control characters or unclosed brackets
 *
 * This utility cleans, isolates, and parses the outermost valid JSON structure.
 */

export function sanitizeAndParseJson(text: string): unknown {
  if (!text || typeof text !== 'string') {
    throw new Error('sanitizeAndParseJson: input must be a non-empty string');
  }

  let cleaned = text.trim();

  // 1. Strip markdown fences if wrapping the entire string
  const fullFenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(cleaned);
  if (fullFenceMatch && fullFenceMatch[1]) {
    cleaned = fullFenceMatch[1].trim();
  }

  // 2. If embedded fence exists inside text (e.g. preamble before ```json ... ```), extract it
  const embeddedFenceMatch = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(cleaned);
  if (embeddedFenceMatch && embeddedFenceMatch[1]) {
    const candidateInsideFence = embeddedFenceMatch[1].trim();
    if (candidateInsideFence.startsWith('{') || candidateInsideFence.startsWith('[')) {
      cleaned = candidateInsideFence;
    }
  }

  // 3. Locate the outermost JSON structure ({ ... } or [ ... ])
  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');
  let startIndex = -1;
  let isObject = false;

  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIndex = firstBrace;
    isObject = true;
  } else if (firstBracket !== -1) {
    startIndex = firstBracket;
    isObject = false;
  }

  if (startIndex === -1) {
    throw new Error(
      `No JSON object or array found in model response: "${cleaned.slice(0, 100)}..."`,
    );
  }

  const lastIndex = isObject ? cleaned.lastIndexOf('}') : cleaned.lastIndexOf(']');
  if (lastIndex === -1 || lastIndex < startIndex) {
    throw new Error(`Unbalanced JSON structure in model response: "${cleaned.slice(0, 100)}..."`);
  }

  cleaned = cleaned.slice(startIndex, lastIndex + 1);

  // 4. Remove trailing commas before closing braces/brackets: `, }` -> `}` and `, ]` -> `]`
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');

  // 5. Attempt direct parse
  try {
    return JSON.parse(cleaned);
  } catch (initialErr) {
    // 6. Secondary repair: strip invalid control characters (except standard whitespace \n, \r, \t)
    try {
      const sanitizedControl = cleaned.replace(
        /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g,
        '',
      );
      return JSON.parse(sanitizedControl);
    } catch {
      throw new Error(
        `Failed to parse sanitized JSON: ${(initialErr as Error).message}. Raw chunk: "${cleaned.slice(0, 150)}..."`,
      );
    }
  }
}
