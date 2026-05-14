import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface RetrievalDemo {
  readonly id: string;
  readonly phoneSlug: string;
  readonly title: string;
  readonly question: string;
  readonly generatedAt: string;
  readonly latencyMs: number;
  readonly stages: readonly RetrievalStage[];
  readonly sourceMix: readonly {
    readonly type: string;
    readonly count: number;
    readonly color: string;
  }[];
  readonly finalChunks: readonly RetrievedChunkDemo[];
}

export interface RetrievalStage {
  readonly id: string;
  readonly label: string;
  readonly count: number;
  readonly detail: string;
  readonly color: string;
}

export interface RetrievedChunkDemo {
  readonly rank: number;
  readonly sourceTitle: string;
  readonly sourceType: string;
  readonly score: number;
  readonly excerpt: string;
  readonly reason: string;
}

export async function getRetrievalDemo(
  phoneSlug = 'google-pixel-9-pro-xl',
): Promise<RetrievalDemo> {
  const filePath = path.join(
    process.cwd(),
    'fixtures',
    'internal-demos',
    'retrieval-pixel-9-pro-xl.json',
  );
  const parsed = JSON.parse(await readFile(filePath, 'utf8')) as RetrievalDemo;
  return parsed.phoneSlug === phoneSlug ? parsed : parsed;
}
