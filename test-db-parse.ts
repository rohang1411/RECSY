/* eslint-disable */
import { getDb } from './src/services/db/client';
import { recommendationTurns } from './src/services/db/schema';
import { userRequirementsSchema } from './src/services/recommender/requirements-schema';
import { desc } from 'drizzle-orm';

async function main() {
  const db = getDb();
  const turns = await db
    .select()
    .from(recommendationTurns)
    .orderBy(desc(recommendationTurns.createdAt))
    .limit(10);

  for (const turn of turns) {
    if (!turn.extractedRequirements) continue;

    // Dump raw JSON
    console.log('--- Turn:', turn.turnIndex, 'Intent:', turn.intent, '---');
    console.log('Raw:', JSON.stringify(turn.extractedRequirements, null, 2));

    const parsed = userRequirementsSchema.safeParse(turn.extractedRequirements);
    console.log('Parsed:', parsed.success);
    if (!parsed.success) {
      console.log('Error:', parsed.error.format());
    } else {
      console.log('Promoted Actionable?', hasActionableRecommendationInput(parsed.data));
    }
  }
}

function hasActionableRecommendationInput(requirements: any): boolean {
  const hasBudget = requirements.budget_usd?.max != null || requirements.budget_usd?.min != null;
  const hasPreference =
    requirements.priorities.length > 0 ||
    requirements.use_cases.length > 0 ||
    requirements.must_haves.length > 0 ||
    requirements.brand_preference.liked.length > 0 ||
    requirements.brand_preference.disliked.length > 0 ||
    requirements.form_factor != null;

  return hasBudget && hasPreference;
}

main().catch(console.error);
