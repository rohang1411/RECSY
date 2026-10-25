/**
 * Use case: Grounded phone Q&A execution (`/api/ask`) (Plan 26 WP-09).
 *
 * Encapsulates phone target validation, reasoning mode resolution, streaming/buffered
 * synthesis with citation guards, query persistence, lease settlement and stream serialization.
 */
import type { Logger } from 'pino';
import type { NextRequest } from 'next/server';

import { env } from '@/env';
import { IntegrationError, publicErrorMessage, toAppError } from '@/lib/errors';
import { buildAskRetrievalTrace } from '@/lib/ask-retrieval-trace';
import { deferOrRun } from '@/lib/defer';
import { shouldEmitServerTiming } from '@/lib/server-timing';
import type { StageTimer } from '@/lib/stage-timer';
import type { AppQueryDb } from '@/services/db/client';
import type { AskPhoneTarget } from '@/services/chat/phone-target';
import {
  NO_CONTEXT_MODEL,
  chunkTextForStream,
  persistChatQuery,
  runPhoneQna,
  type PhoneQnaResult,
} from '@/services/chat/answer';
import { runPhoneQnaStream } from '@/services/chat/answer-stream';
import { CitationStreamGuard } from '@/services/chat/citation-stream-guard';
import type { ChatCapable } from '@/services/llm/types';
import type { HybridRetriever } from '@/services/retrieval/retriever';
import type { AdmittedRequest } from '@/services/metering/admission';
import type { QueryLease } from '@/services/metering/lease';
import { resolveReasoningMode } from '@/services/metering/mode';
import { emitMeteredRequestSummary } from '@/services/metering/summary';
import type { MeteredRequestOutcome } from '@/services/metering/types';

export interface AskUseCaseDeps {
  readonly db: AppQueryDb;
  readonly llm: ChatCapable;
  readonly retriever: HybridRetriever;
  readonly log: Logger;
  readonly timer: StageTimer;
}

export interface AskQuestionInput {
  readonly request: NextRequest;
  readonly phone: AskPhoneTarget;
  readonly query: string;
  readonly admitted: AdmittedRequest;
  readonly lease: QueryLease;
  readonly traceId: string;
  readonly requestId: string;
  readonly t0: number;
  readonly reserveMs: number;
  readonly shouldStream: boolean;
}

export class AskQuestionUseCase {
  constructor(private readonly deps: AskUseCaseDeps) {}

  async execute(input: AskQuestionInput): Promise<Response> {
    const { db, llm, retriever, log, timer } = this.deps;
    const {
      request,
      phone,
      query,
      admitted,
      lease,
      traceId,
      requestId,
      t0,
      reserveMs,
      shouldStream,
    } = input;
    const { identity, byok, isByok, platform, config } = admitted;

    const ttfbMs = Math.round(performance.now() - t0);
    const enc = new TextEncoder();
    let cancelled = false;
    let streamOutcome: MeteredRequestOutcome = 'committed';
    let settleMs = 0;

    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
      async start(controller) {
        const write = (obj: unknown) => {
          if (cancelled || request.signal.aborted) return;
          controller.enqueue(enc.encode(`${JSON.stringify(obj)}\n`));
        };

        const tStreamStart = performance.now();
        write({ type: 'status', stage: 'retrieving' });

        try {
          const rawRequestedMode = request.headers
            .get('x-recsy-user-mode')
            ?.trim()
            .toLowerCase() as 'fast' | 'deep' | undefined;
          const requestedMode = rawRequestedMode === 'deep' ? 'deep' : byok?.userMode;
          const serverMode = await timer.time('mode', () =>
            resolveReasoningMode(identity, lease, requestedMode, db),
          );
          const isSubscriber = lease.chargeSource === 'subscription' || serverMode === 'deep';

          if (shouldStream) {
            let finalResult: (PhoneQnaResult & { streamed: true; citationRepairs: number }) | null =
              null;
            let firstDeltaRecorded = false;

            for await (const ev of runPhoneQnaStream({
              phoneId: phone.id,
              query,
              retriever,
              llm,
              log: log.child({ phoneId: phone.id }),
              signal: request.signal,
              retrievalOptions: {
                rerank: env.RETRIEVAL_LLM_RERANK ? 'llm' : 'off',
              },
              phoneMeta: {
                brand: phone.brand,
                model: phone.model,
                lastIngestAt: phone.lastIngestAt,
                nextIngestAt: phone.nextIngestAt,
              },
              byok,
              serverMode,
              isSubscriber,
              timer,
              thinking: platform.perf.grounded_thinking,
            })) {
              if (ev.type === 'final') {
                finalResult = ev.result;
                break;
              }
              if (ev.type === 'delta' && !firstDeltaRecorded) {
                firstDeltaRecorded = true;
                timer.mark('firstDelta');
              }
              write(ev);
            }

            if (!finalResult) {
              if (cancelled || request.signal.aborted) {
                const tSettleStart = performance.now();
                await timer.time('settle', () => lease.noCharge('client_abort'));
                settleMs = Math.round(performance.now() - tSettleStart);
                streamOutcome = 'no_charge';
                return;
              }
              throw new IntegrationError('Stream closed unexpectedly without final result', {
                phoneId: phone.id,
              });
            }

            const latencyMs = Math.round(performance.now() - tStreamStart);
            const leaseIdForDb = lease.isNoop || lease.id === 'off' ? null : lease.id;

            const persistenceStart = performance.now();
            await timer.time('persist', () =>
              persistChatQuery({
                phoneId: phone.id,
                query,
                answer: finalResult!.text,
                citations: finalResult!.citations,
                retrievedChunkIds: finalResult!.retrieval.chunks.map((c) => c.chunkId),
                latencyMs,
                tokensIn: finalResult!.generationAccounting.tokensIn,
                tokensOut: finalResult!.generationAccounting.tokensOut,
                model: finalResult!.model,
                userId: identity.userId,
                leaseId: leaseIdForDb,
              }),
            );
            const persistenceMs = performance.now() - persistenceStart;

            const meta = {
              model: finalResult.model,
              tokensIn: finalResult.generationAccounting.tokensIn,
              tokensOut: finalResult.generationAccounting.tokensOut,
              latencyMs,
              cacheHit: finalResult.generationAccounting.cacheHits > 0,
            };

            const tSettleStart = performance.now();
            let outcome: 'commit' | 'no_charge';
            await timer.time('settle', async () => {
              if (finalResult!.model === NO_CONTEXT_MODEL) {
                await lease.noCharge('no_context');
                outcome = 'no_charge';
                streamOutcome = 'no_charge';
              } else {
                await lease.commit(meta);
                outcome = 'commit';
                streamOutcome = 'committed';
              }
            });
            settleMs = Math.round(performance.now() - tSettleStart);

            write({
              type: 'done',
              citations: finalResult.citations,
              usage: finalResult.usage,
              generationAccounting: finalResult.generationAccounting,
              model: finalResult.model,
              streamed: true,
              citationRepairs: finalResult.citationRepairs,
              persistenceMs,
              retrievalMs: finalResult.retrieval.debug.totalMs,
              retrievalTrace: buildAskRetrievalTrace(finalResult.retrieval),
              quota: lease.projectedQuota(outcome!),
            });

            const totalMs = Math.round(performance.now() - t0);
            const ttfvtMs = Math.round(performance.now() - t0);
            emitMeteredRequestSummary({
              traceId,
              route: 'POST /api/ask',
              quotaMode: config.mode,
              byok: isByok,
              userId: identity.userId,
              deviceId: identity.deviceId,
              chargeSource: lease.chargeSource,
              outcome: streamOutcome,
              reserveMs,
              settleMs,
              totalMs,
              model: finalResult.model,
              tokensIn: finalResult.generationAccounting.tokensIn,
              tokensOut: finalResult.generationAccounting.tokensOut,
              cacheHit: finalResult.generationAccounting.cacheHits > 0,
              httpStatus: 200,
              stages: timer.snapshot(),
              ttfbMs,
              ttfvtMs,
            });
          } else {
            // Buffered path
            const result = await runPhoneQna({
              phoneId: phone.id,
              query,
              retriever,
              llm,
              log: log.child({ phoneId: phone.id }),
              signal: request.signal,
              retrievalOptions: {
                rerank: env.RETRIEVAL_LLM_RERANK ? 'llm' : 'off',
              },
              phoneMeta: {
                brand: phone.brand,
                model: phone.model,
                lastIngestAt: phone.lastIngestAt,
                nextIngestAt: phone.nextIngestAt,
              },
              byok,
              serverMode,
              isSubscriber,
              timer,
              thinking: platform.perf.grounded_thinking,
              onStage: (stage) => write({ type: 'status', stage }),
            });

            if (platform.perf.ask_streaming === 'shadow') {
              void deferOrRun('shadow-citation-guard', async () => {
                const allowed = new Set(
                  result.retrieval.chunks.map((c) => c.chunkId.toLowerCase()),
                );
                const shadowGuard = new CitationStreamGuard(allowed);
                shadowGuard.push(result.text);
                shadowGuard.flush();
                if (shadowGuard.stats.strippedTags > 0) {
                  log.warn(
                    { stripped: shadowGuard.stats.strippedTags, phoneId: phone.id },
                    'shadow_streaming_stripped_tags',
                  );
                }
              });
            }

            const latencyMs = Math.round(performance.now() - tStreamStart);
            const leaseIdForDb = lease.isNoop || lease.id === 'off' ? null : lease.id;

            const persistenceStart = performance.now();
            await timer.time('persist', () =>
              persistChatQuery({
                phoneId: phone.id,
                query,
                answer: result.text,
                citations: result.citations,
                retrievedChunkIds: result.retrieval.chunks.map((c) => c.chunkId),
                latencyMs,
                tokensIn: result.generationAccounting.tokensIn,
                tokensOut: result.generationAccounting.tokensOut,
                model: result.model,
                userId: identity.userId,
                leaseId: leaseIdForDb,
              }),
            );
            const persistenceMs = performance.now() - persistenceStart;

            const meta = {
              model: result.model,
              tokensIn: result.generationAccounting.tokensIn,
              tokensOut: result.generationAccounting.tokensOut,
              latencyMs,
              cacheHit: result.generationAccounting.cacheHits > 0,
            };

            const tSettleStart = performance.now();
            let outcome: 'commit' | 'no_charge';
            await timer.time('settle', async () => {
              if (result.model === NO_CONTEXT_MODEL) {
                await lease.noCharge('no_context');
                outcome = 'no_charge';
                streamOutcome = 'no_charge';
              } else if (cancelled || request.signal.aborted) {
                await lease.noCharge('client_abort');
                outcome = 'no_charge';
                streamOutcome = 'no_charge';
              } else {
                await lease.commit(meta);
                outcome = 'commit';
                streamOutcome = 'committed';
              }
            });
            settleMs = Math.round(performance.now() - tSettleStart);

            write({
              type: 'meta',
              phoneId: phone.id,
              retrievedChunkIds: result.retrieval.chunks.map((c) => c.chunkId),
            });

            timer.mark('firstDelta');
            const ttfvtMs = Math.round(performance.now() - t0);

            for (const piece of chunkTextForStream(result.text)) {
              write({ type: 'delta', text: piece });
            }

            write({
              type: 'done',
              citations: result.citations,
              usage: result.usage,
              generationAccounting: result.generationAccounting,
              model: result.model,
              streamed: false,
              citationRepairs: 0,
              persistenceMs,
              retrievalMs: result.retrieval.debug.totalMs,
              retrievalTrace: buildAskRetrievalTrace(result.retrieval),
              quota: lease.projectedQuota(outcome!),
            });

            const totalMs = Math.round(performance.now() - t0);
            emitMeteredRequestSummary({
              traceId,
              route: 'POST /api/ask',
              quotaMode: config.mode,
              byok: isByok,
              userId: identity.userId,
              deviceId: identity.deviceId,
              chargeSource: lease.chargeSource,
              outcome: streamOutcome,
              reserveMs,
              settleMs,
              totalMs,
              model: result.model,
              tokensIn: result.generationAccounting.tokensIn,
              tokensOut: result.generationAccounting.tokensOut,
              cacheHit: result.generationAccounting.cacheHits > 0,
              httpStatus: 200,
              stages: timer.snapshot(),
              ttfbMs,
              ttfvtMs,
            });
          }
        } catch (err) {
          const app = toAppError(err);
          log.error({ err, code: app.code }, 'Q&A request failed');

          const tRefundStart = performance.now();
          await lease.refund(app.code).catch(() => undefined);
          settleMs = Math.round(performance.now() - tRefundStart);
          streamOutcome = 'refunded';

          write({
            type: 'error',
            code: app.code,
            message: publicErrorMessage(app),
            quota: lease.projectedQuota('refund'),
          });

          const totalMs = Math.round(performance.now() - t0);
          emitMeteredRequestSummary({
            traceId,
            route: 'POST /api/ask',
            quotaMode: config.mode,
            byok: isByok,
            userId: identity.userId,
            deviceId: identity.deviceId,
            chargeSource: lease.chargeSource,
            outcome: 'refunded',
            denial: app.code,
            reserveMs,
            settleMs,
            totalMs,
            httpStatus: app.status,
            stages: timer.snapshot(),
            ttfbMs,
          });
        } finally {
          if (!cancelled) controller.close();
        }
      },
    });

    const streamHeaders: Record<string, string> = {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      'X-Trace-Id': traceId,
      'X-Request-Id': requestId,
    };
    if (shouldEmitServerTiming(request)) {
      streamHeaders['Server-Timing'] = timer.serverTiming();
    }

    return new Response(stream, {
      headers: streamHeaders,
    });
  }
}
