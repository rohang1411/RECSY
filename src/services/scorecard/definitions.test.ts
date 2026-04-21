import { describe, expect, it } from 'vitest';

import type { AspectDefinitionRow } from './types';

import { latestAspectDefinitionsByAspect } from './definitions';

function def(
  aspect: AspectDefinitionRow['aspect'],
  version: number,
  id: string,
): AspectDefinitionRow {
  return {
    id,
    aspect,
    version,
    description: '',
    queryPrompts: [],
    defaultWeight: '0.15',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

describe('latestAspectDefinitionsByAspect', () => {
  it('keeps the highest version per aspect', () => {
    const map = latestAspectDefinitionsByAspect([
      def('camera', 1, '11111111-1111-4111-8111-111111111101'),
      def('camera', 3, '11111111-1111-4111-8111-111111111103'),
      def('camera', 2, '11111111-1111-4111-8111-111111111102'),
      def('battery', 1, '22222222-2222-4222-8222-222222222201'),
    ]);
    expect(map.get('camera')?.version).toBe(3);
    expect(map.get('battery')?.version).toBe(1);
  });

  it('returns an empty map for an empty input', () => {
    expect(latestAspectDefinitionsByAspect([]).size).toBe(0);
  });
});
