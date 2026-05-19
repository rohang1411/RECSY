/**
 * Catalog alias generation.
 *
 * Purpose: produce safe `phone_aliases` suggestions for newly promoted phones
 * without seeding broad aliases that hijack sibling models during ingestion.
 *
 * Used by: catalog promotion and alias tests.
 */
import { normalizeIdentityText } from './identity';

export interface AliasCandidate {
  readonly alias: string;
  readonly priority: number;
  readonly tier: 'A' | 'B' | 'C';
}

export interface ExistingAlias {
  readonly alias: string;
  readonly slug: string;
}

export interface AliasGenerationInput {
  readonly brand: string;
  readonly model: string;
  readonly slug: string;
  readonly labels?: readonly string[];
  readonly existingAliases?: readonly ExistingAlias[];
  readonly siblingModels?: readonly string[];
}

export interface AliasGenerationResult {
  readonly accepted: readonly AliasCandidate[];
  readonly rejected: readonly {
    readonly alias: string;
    readonly reason: 'alias_collision' | 'alias_too_broad' | 'duplicate_candidate';
  }[];
}

export function generateAliasCandidates(input: AliasGenerationInput): AliasGenerationResult {
  const candidates = dedupeCandidates([
    { alias: `${input.brand} ${input.model}`, priority: 100, tier: 'A' },
    { alias: input.model, priority: 95, tier: 'A' },
    ...(input.labels ?? []).map((label) => ({ alias: label, priority: 90, tier: 'A' as const })),
    ...brandFreeVariants(input.model).map((alias) => ({
      alias,
      priority: 60,
      tier: 'B' as const,
    })),
  ]);

  const existingByAlias = new Map(
    (input.existingAliases ?? []).map((a) => [normalizeIdentityText(a.alias), a.slug]),
  );
  const siblingNormalised = new Set(
    (input.siblingModels ?? []).map((model) => normalizeIdentityText(model)),
  );
  const accepted: AliasCandidate[] = [];
  const rejected: Array<{
    alias: string;
    reason: 'alias_collision' | 'alias_too_broad' | 'duplicate_candidate';
  }> = [];

  for (const candidate of candidates) {
    const norm = normalizeIdentityText(candidate.alias);
    const collisionSlug = existingByAlias.get(norm);
    if (collisionSlug && collisionSlug !== input.slug) {
      rejected.push({ alias: candidate.alias, reason: 'alias_collision' });
      continue;
    }
    if (candidate.tier !== 'A' && isBroadAlias(norm, siblingNormalised)) {
      rejected.push({ alias: candidate.alias, reason: 'alias_too_broad' });
      continue;
    }
    if (accepted.some((a) => normalizeIdentityText(a.alias) === norm)) {
      rejected.push({ alias: candidate.alias, reason: 'duplicate_candidate' });
      continue;
    }
    accepted.push(candidate);
  }

  return { accepted, rejected };
}

function dedupeCandidates(candidates: readonly AliasCandidate[]): AliasCandidate[] {
  const seen = new Set<string>();
  const out: AliasCandidate[] = [];
  for (const candidate of candidates) {
    const norm = normalizeIdentityText(candidate.alias);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push({ ...candidate, alias: candidate.alias.trim() });
  }
  return out;
}

function brandFreeVariants(model: string): string[] {
  const variants = new Set<string>();
  const noParens = model.replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
  variants.add(noParens);
  variants.add(noParens.replace(/\bplus\b/i, '+'));
  variants.add(noParens.replace(/\+/g, ' Plus'));
  return [...variants].filter((v) => v.length >= 4);
}

function isBroadAlias(alias: string, siblingModels: ReadonlySet<string>): boolean {
  const tokens = alias.split(' ').filter(Boolean);
  if (tokens.length <= 1) return true;
  if (tokens.length === 2 && /^[a-z]?\d{1,3}$/.test(tokens.at(-1) ?? '')) return true;
  for (const sibling of siblingModels) {
    if (sibling !== alias && (sibling.startsWith(`${alias} `) || alias.startsWith(`${sibling} `))) {
      return true;
    }
  }
  return false;
}
