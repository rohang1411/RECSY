export interface GeminiKeyEnvironment {
  readonly GEMINI_API_KEY?: string;
  readonly GEMINI_API_KEY_2?: string;
  readonly GEMINI_API_KEY_3?: string;
  readonly GEMINI_API_KEY_4?: string;
  readonly GEMINI_API_KEY_5?: string;
  readonly GEMINI_API_KEY_6?: string;
  readonly GEMINI_API_KEYS_EXTRA?: string;
  readonly GOOGLE_CLOUD_QUOTA_PROJECT_IDS?: string;
}

export const GEMINI_NUMBERED_KEY_NAMES = [
  'GEMINI_API_KEY',
  'GEMINI_API_KEY_2',
  'GEMINI_API_KEY_3',
  'GEMINI_API_KEY_4',
  'GEMINI_API_KEY_5',
  'GEMINI_API_KEY_6',
] as const;

export function getConfiguredGeminiKeys(config: GeminiKeyEnvironment) {
  // Preserve the original four-slot extra-list mapping until numbered backups are configured.
  const numberedSlotCount = GEMINI_NUMBERED_KEY_NAMES.reduce(
    (count, name, index) => (config[name]?.trim() ? Math.max(count, index + 1) : count),
    4,
  );
  const extra = (config.GEMINI_API_KEYS_EXTRA ?? '').split(',');
  const projects = (config.GOOGLE_CLOUD_QUOTA_PROJECT_IDS ?? '')
    .split(',')
    .map((value) => value.trim());
  const slots = [
    ...GEMINI_NUMBERED_KEY_NAMES.slice(0, numberedSlotCount).map((name) => ({
      name,
      value: config[name],
    })),
    ...extra.map((value, index) => ({ name: `GEMINI_API_KEYS_EXTRA[${index + 1}]`, value })),
  ];
  const seen = new Set<string>();
  return slots.flatMap((slot, slotIndex) => {
    const apiKey = slot.value?.trim();
    if (!apiKey || seen.has(apiKey)) return [];
    seen.add(apiKey);
    return [
      {
        name: slot.name,
        apiKey,
        projectId: projects[slotIndex] || null,
        apiKeyIndex: seen.size - 1,
      },
    ];
  });
}
