import type { PhoneSpec } from '@/features/phones/schema';

import type { UserRequirements } from './requirements-schema';

/**
 * One English paragraph describing the device for `phones.spec_embedding`.
 * Kept in sync with what we want retrieval to match — not the full JSON blob.
 */
export function buildSpecDocumentForEmbedding(input: {
  readonly brand: string;
  readonly model: string;
  readonly tagline: string | null;
  readonly spec: PhoneSpec;
}): string {
  const s = input.spec;
  const cam = s.rear_cameras.map((c) => `${c.mp}MP ${c.type}`).join(', ');
  const parts = [
    `${input.brand} ${input.model}.`,
    input.tagline ? input.tagline : null,
    `${s.display.size_in}" ${s.display.panel_type} display, ${s.chipset}, ${s.ram_gb}GB RAM.`,
    `Cameras: ${cam}. ${s.battery_mah}mAh battery.`,
    s.foldable ? 'Foldable form factor.' : null,
    s.highlights.length ? `Highlights: ${s.highlights.join('; ')}.` : null,
  ];
  return parts.filter((p): p is string => Boolean(p && p.trim())).join(' ');
}

/**
 * Query string embedded at recommend time; should overlap conceptually with
 * {@link buildSpecDocumentForEmbedding} so cosine similarity is meaningful.
 */
export function buildRecommenderQueryText(requirements: UserRequirements): string {
  const parts: string[] = [];
  for (const u of requirements.use_cases) {
    const t = u.trim();
    if (t) parts.push(t);
  }
  for (const p of requirements.priorities) {
    parts.push(`${p.aspect} is a priority`);
  }
  for (const m of requirements.must_haves) {
    const t = m.trim();
    if (t) parts.push(`must have: ${t}`);
  }
  if (requirements.form_factor?.foldable === true) {
    parts.push('foldable phone');
  }
  if (requirements.budget_usd?.max != null) {
    parts.push(`budget around $${Math.round(requirements.budget_usd.max)}`);
  }
  if (parts.length === 0) {
    return 'smartphone research and purchase';
  }
  return parts.join('. ');
}
