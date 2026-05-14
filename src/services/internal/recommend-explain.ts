import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface RecommendationDemo {
  readonly id: string;
  readonly title: string;
  readonly userMessage: string;
  readonly generatedAt: string;
  readonly latencyMs: number;
  readonly intent: string;
  readonly requirements: {
    readonly budgetUsd: number;
    readonly priorities: readonly string[];
    readonly mustHaves: readonly string[];
    readonly tradeoffs: readonly string[];
  };
  readonly funnel: readonly {
    readonly label: string;
    readonly count: number;
    readonly detail: string;
  }[];
  readonly picks: readonly RecommendationPickDemo[];
}

export interface RecommendationPickDemo {
  readonly rank: number;
  readonly phoneSlug: string;
  readonly label: string;
  readonly score: number;
  readonly priceUsd: number;
  readonly explanation: string;
  readonly contributions: readonly {
    readonly label: string;
    readonly value: number;
    readonly color: string;
  }[];
  readonly citations: readonly string[];
}

export async function getRecommendationDemo(): Promise<RecommendationDemo> {
  const filePath = path.join(
    process.cwd(),
    'fixtures',
    'internal-demos',
    'recommend-camera-phone.json',
  );
  return JSON.parse(await readFile(filePath, 'utf8')) as RecommendationDemo;
}
