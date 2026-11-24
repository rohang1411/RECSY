import { describe, it, expect } from 'vitest';
import { loadEvaluationFixtures } from './preflight';

describe('Evaluation Fixtures Preflight Validation', () => {
  it('loads and validates all expanded golden benchmark fixtures without error', async () => {
    const fixtures = await loadEvaluationFixtures();

    expect(fixtures).toBeDefined();
    expect(fixtures.golden.version).toBe('3.0-comprehensive');

    // Personas: 30 original + 15 expanded edge cases = 45 total
    expect(fixtures.golden.recommenderPersonas.length).toBe(45);

    // QA queries: 20 original + 10 expanded = 30 total
    expect(fixtures.golden.attributedQaQueries.length).toBe(30);

    // Unanswerable / Hallucination-trap queries: 10 original + 10 expanded = 20 total
    expect(fixtures.unanswerableCount).toBe(20);

    // Check specific new personas
    const impossibleFoldable = fixtures.golden.recommenderPersonas.find((p) => p.id === 'rec-033');
    expect(impossibleFoldable).toBeDefined();
    expect(impossibleFoldable?.expectNoResults).toBe(true);

    const promptInjection = fixtures.golden.recommenderPersonas.find((p) => p.id === 'rec-031');
    expect(promptInjection).toBeDefined();
    expect(promptInjection?.category).toBe('adversarial-injection');

    const pwmMigraine = fixtures.golden.recommenderPersonas.find((p) => p.id === 'rec-034');
    expect(pwmMigraine).toBeDefined();
    expect(pwmMigraine?.requirements.must_haves).toContain('PWM eye comfort');

    // Check specific new QA queries
    const falsePremise = fixtures.golden.attributedQaQueries.find((q) => q.id === 'rag-021');
    expect(falsePremise).toBeDefined();
    expect(falsePremise?.category).toBe('false-premise-refutation');
    expect(falsePremise?.phoneSlug).toBe('apple-iphone-16-pro');

    const nonexistentSolar = fixtures.golden.attributedQaQueries.find((q) => q.id === 'rag-022');
    expect(nonexistentSolar).toBeDefined();
    expect(nonexistentSolar?.category).toBe('nonexistent-feature-abstention');
    expect(nonexistentSolar?.phoneSlug).toBe('samsung-galaxy-s24-ultra');

    // Hashes verified
    expect(fixtures.hashes['golden-benchmark-dataset.json']).toHaveLength(64);
    expect(fixtures.hashes['qa-unanswerable-dataset.json']).toHaveLength(64);
    expect(fixtures.hashes['multi-turn-trajectories.json']).toHaveLength(64);
  });
});
