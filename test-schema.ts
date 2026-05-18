/* eslint-disable */
import { z } from 'zod';
import {
  userRequirementsSchema,
  normalizeUserRequirements,
} from './src/services/recommender/requirements-schema';

const sample = {
  budget_usd: { max: 1200 },
  priorities: [{ aspect: 'camera', weight: 1 }],
  must_haves: [],
  deal_breakers: [],
  use_cases: [],
  brand_preference: { liked: [], disliked: [] },
  confidence: 0.5,
  clarifying_question: 'Do you have a preference?',
};

const parsed = userRequirementsSchema.safeParse(sample);
console.log('Parsed:', parsed.success);
if (!parsed.success) {
  console.log(parsed.error);
}
