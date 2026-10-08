import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import postgres from 'postgres';
type StreamEvent = { type: string; model?: string; code?: string };

async function main() {
  const stage = JSON.parse(await readFile('output/eval/current-stage.json', 'utf8'));
  if (!/^eval_[a-z0-9_]+$/.test(stage.namespace)) throw new Error('Invalid isolated schema');
  const base = process.env.EVAL_HTTP_URL ?? 'http://127.0.0.1:3100';
  if (new URL(base).hostname !== '127.0.0.1')
    throw new Error('Controlled HTTP campaign requires loopback');
  const token = process.env.EVAL_CONTROLLED_PROVIDER_TOKEN;
  if (!token) throw new Error('Missing controlled provider token');
  const db = postgres(process.env.DATABASE_URL!, {
    max: 1,
    prepare: false,
    connection: { search_path: `${stage.namespace},extensions` },
  });
  const results: Array<Record<string, unknown>> = [];
  let ipIndex = 1;
  async function fault(mode: string) {
    const r = await fetch('http://127.0.0.1:3210/control', {
      method: 'POST',
      headers: { 'x-eval-token': token!, 'content-type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    if (!r.ok) throw new Error(`Fault controller failed: ${r.status}`);
  }
  async function request(path: string, body: unknown, cookie?: string, raw = false, ip?: string) {
    const started = performance.now();
    const r = await fetch(base + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': ip ?? `198.18.${Math.floor(ipIndex / 250)}.${(ipIndex++ % 250) + 1}`,
        ...(cookie ? { cookie } : {}),
      },
      body: raw ? String(body) : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const text = await r.text();
    const data = r.headers.get('content-type')?.includes('ndjson')
      ? text
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : JSON.parse(text);
    return {
      status: r.status,
      trace: r.headers.get('x-trace-id'),
      cookie: r.headers.get('set-cookie')?.split(';')[0],
      data,
      ms: performance.now() - started,
    };
  }
  function requireCheck(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
  }
  async function check(name: string, run: () => Promise<unknown>) {
    const start = performance.now();
    try {
      const evidence = await run();
      results.push({ name, status: 'passed', ms: performance.now() - start, evidence });
    } catch (error) {
      results.push({
        name,
        status: 'failed',
        ms: performance.now() - start,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    console.log(`${results.at(-1)!.status}: ${name}`);
  }
  try {
    await fault('normal');
    let sessionCookie: string | undefined;
    await check('new-session ownership and continuation', async () => {
      const first = await request('/api/recommend', {
        message: 'Recommend an Android under $700 with good battery',
      });
      requireCheck(
        first.status === 200 && first.cookie && first.trace,
        `New session failed: ${JSON.stringify(first.data)}`,
      );
      sessionCookie = first.cookie;
      const second = await request(
        '/api/recommend',
        { message: 'Focus more on camera' },
        sessionCookie,
      );
      requireCheck(second.status === 200 && !second.cookie, 'Session did not continue');
      const rows =
        await db`select s.id, s.client_id, c.client_token=s.session_cookie as owned, count(t.id)::int as turns from recommendation_sessions s join recommendation_clients c on c.id=s.client_id join recommendation_turns t on t.session_id=s.id where s.session_cookie=${sessionCookie!.split('=')[1]!} group by s.id,c.client_token`;
      requireCheck(
        rows.length === 1 && rows[0]?.owned && rows[0]?.turns === 2,
        `Persistence mismatch: ${JSON.stringify(rows)}`,
      );
      return {
        first: first.data,
        second: second.data,
        rows,
        cookieHash: createHash('sha256').update(sessionCookie!).digest('hex'),
      };
    });
    await check('same-session concurrent turns persist uniquely', async () => {
      requireCheck(sessionCookie, 'Initial session unavailable');
      const responses = await Promise.all(
        Array.from({ length: 4 }, (_, i) =>
          request(
            '/api/recommend',
            { message: `Camera priority with budget $${650 + i * 10}` },
            sessionCookie,
          ),
        ),
      );
      requireCheck(
        responses.every((r) => r.status === 200),
        `Concurrent failures: ${JSON.stringify(responses.map((r) => ({ status: r.status, data: r.data })))}`,
      );
      const rows =
        await db`select t.turn_index from recommendation_turns t join recommendation_sessions s on s.id=t.session_id where s.session_cookie=${sessionCookie!.split('=')[1]!} order by t.turn_index`;
      requireCheck(
        rows.length === 6 && new Set(rows.map((r) => r.turn_index)).size === 6,
        `Missing or duplicate turns: ${JSON.stringify(rows)}`,
      );
      return { statuses: responses.map((r) => r.status), indices: rows.map((r) => r.turn_index) };
    });
    await check('independent clients remain isolated', async () => {
      const other = await request('/api/recommend', { message: 'I want an iPhone under $1000' });
      requireCheck(
        other.status === 200 && other.cookie !== sessionCookie,
        'Independent client did not get a separate session',
      );
      return { status: other.status, kind: other.data.kind };
    });
    for (const path of ['/api/recommend', '/api/ask']) {
      await check(`${path} malformed JSON is a client error without internal details`, async () => {
        const r = await request(path, '{broken', undefined, true);
        requireCheck(
          r.status === 400 &&
            r.data.code === 'VALIDATION' &&
            !JSON.stringify(r.data).includes('CAUSE'),
          `Unexpected response: ${JSON.stringify(r.data)} (${r.status})`,
        );
        return { status: r.status, data: r.data, trace: r.trace };
      });
      await check(`${path} oversized field rejected`, async () => {
        const r = await request(
          path,
          path.endsWith('ask')
            ? { phoneSlug: 'apple-iphone-16-pro', query: 'a'.repeat(50000) }
            : { message: 'a'.repeat(50000) },
        );
        requireCheck(r.status === 400, `Oversized input: ${r.status}`);
        return { status: r.status };
      });
    }
    await check('unknown phone returns 404', async () => {
      const r = await request('/api/ask', { phoneSlug: 'not-a-real-phone', query: 'battery' });
      requireCheck(r.status === 404, 'Unknown phone accepted');
      return r.data;
    });
    await check('Q&A emits one terminal done with persisted record', async () => {
      const query = `battery campaign ${Date.now()}`;
      const r = await request('/api/ask', { phoneSlug: 'apple-iphone-16-pro', query });
      requireCheck(
        r.status === 200 &&
          r.trace &&
          r.data.filter((e: StreamEvent) => e.type === 'done').length === 1 &&
          !r.data.some((e: StreamEvent) => e.type === 'error'),
        `Bad stream: ${JSON.stringify(r.data)}`,
      );
      const rows =
        await db`select id,model,tokens_in,tokens_out from chat_queries where query=${query}`;
      requireCheck(rows.length === 1, 'Successful stream completed before persistence');
      return { events: r.data.map((e: StreamEvent) => e.type), rows };
    });
    await check('empty corpus abstains without generation', async () => {
      const [empty] =
        await db`select p.slug from phones p where p.status='active' and not exists(select 1 from chunks c join sources s on s.id=c.source_id where c.phone_id=p.id and s.status='active') limit 1`;
      requireCheck(empty, 'No empty-corpus cohort in snapshot');
      const r = await request('/api/ask', { phoneSlug: empty.slug, query: 'battery corpus check' });
      requireCheck(
        r.data.some((e: StreamEvent) => e.type === 'done' && e.model === 'no-context@v1'),
        `Missing abstention: ${JSON.stringify(r.data)}`,
      );
      return { phone: empty.slug, terminal: r.data.at(-1) };
    });
    for (const mode of ['chat-fail', 'invalid-citations', 'timeout', 'embed-fail']) {
      await fault(mode);
      await check(`Q&A ${mode} is terminal error`, async () => {
        const r = await request('/api/ask', {
          phoneSlug: 'apple-iphone-16-pro',
          query: `camera fault ${mode} ${Date.now()}`,
        });
        requireCheck(
          r.data.some((e: StreamEvent) => e.type === 'error') &&
            !r.data.some((e: StreamEvent) => e.type === 'done'),
          `Failure treated as success: ${JSON.stringify(r.data)}`,
        );
        return { terminal: r.data.at(-1), trace: r.trace, ms: r.ms };
      });
    }
    await fault('structured-fail');
    await check('recommendation provider throttle is a server error', async () => {
      const r = await request(
        '/api/recommend',
        { message: 'An Android under $500' },
        sessionCookie,
      );
      requireCheck(
        r.status === 502 && r.data.code === 'LLM_ERROR',
        `Unexpected provider failure: ${JSON.stringify(r)}`,
      );
      return { status: r.status, data: r.data };
    });
    await fault('normal');
    await check('inactive session cannot be continued with old cookie', async () => {
      requireCheck(sessionCookie, 'Initial session unavailable');
      await db`update recommendation_sessions set status='archived' where session_cookie=${sessionCookie.split('=')[1]!}`;
      const r = await request('/api/recommend', { message: 'Android under $600' }, sessionCookie);
      requireCheck(
        r.status === 200 && r.cookie && r.cookie !== sessionCookie,
        'Archived session reused',
      );
      return { status: r.status, newSession: true };
    });
    await check('inactive phone is rejected', async () => {
      const [phone] = await db`select id,status,slug from phones where slug='apple-iphone-16-pro'`;
      requireCheck(phone, 'Phone unavailable');
      try {
        await db`update phones set status='discontinued' where id=${phone.id}`;
        const r = await request('/api/ask', { phoneSlug: phone.slug, query: 'battery' });
        requireCheck(r.status === 404, 'Inactive phone accepted');
        return { status: r.status };
      } finally {
        await db`update phones set status=${phone.status} where id=${phone.id}`;
      }
    });
    await check('retrieval database failure is not empty-corpus success', async () => {
      await db.unsafe(`ALTER TABLE "${stage.namespace}".chunks RENAME TO chunks_fault_injection`);
      try {
        const r = await request('/api/ask', {
          phoneSlug: 'apple-iphone-16-pro',
          query: `battery db failure ${Date.now()}`,
        });
        requireCheck(
          r.data.some((e: StreamEvent) => e.type === 'error' && e.code === 'INTEGRATION_ERROR') &&
            !r.data.some((e: StreamEvent) => e.type === 'done'),
          `DB fault became success: ${JSON.stringify(r.data)}`,
        );
        requireCheck(
          !JSON.stringify(r.data).includes('chunks_fault') &&
            !JSON.stringify(r.data).includes('select '),
          'Internal SQL leaked',
        );
        return { terminal: r.data.at(-1), trace: r.trace };
      } finally {
        await db.unsafe(`ALTER TABLE "${stage.namespace}".chunks_fault_injection RENAME TO chunks`);
      }
    });
    await check('known false source assertion is excluded before Q&A generation', async () => {
      const r = await request('/api/ask', {
        phoneSlug: 'apple-iphone-16-pro',
        query: 'Thunderbolt',
      });
      const done = r.data.find((e: StreamEvent) => e.type === 'done');
      requireCheck(
        done?.retrievalTrace?.excludedSourceChunkIds?.includes(
          '8ffc6cee-7841-4ca0-a440-38c4247661eb',
        ),
        'The known conflicting chunk was not reported as quarantined',
      );
      requireCheck(
        !JSON.stringify(done?.citations ?? []).includes('8ffc6cee-7841-4ca0-a440-38c4247661eb'),
        'A quarantined chunk was cited',
      );
      return { excludedChunkIds: done.retrievalTrace.excludedSourceChunkIds, trace: r.trace };
    });
    await check('rate limit admits 30 of 31 requests within one fixed window', async () => {
      const remainingMs = 60_000 - (Date.now() % 60_000);
      // Avoid a boundary crossing; record the bucket rather than assuming 31 arrivals share it.
      if (remainingMs < 20_000) await new Promise((r) => setTimeout(r, remainingMs + 100));
      const ip = `198.19.${Math.floor(Date.now() / 1000) % 250}.1`;
      const expectedWindow = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
      const key =
        'ask:v1:' + createHash('sha256').update(`recsy|ask|v1|${ip}`).digest('hex').slice(0, 32);
      const statuses = await Promise.all(
        Array.from(
          { length: 31 },
          async () =>
            (
              await request(
                '/api/ask',
                { phoneSlug: 'not-a-real-phone', query: 'battery' },
                undefined,
                false,
                ip,
              )
            ).status,
        ),
      );
      const buckets =
        await db`select count,window_start from rate_limits where key=${key} and window_start >= ${expectedWindow}::timestamptz order by window_start`;
      requireCheck(
        buckets.length === 1 &&
          buckets[0]?.count === 31 &&
          statuses.filter((status) => status === 404).length === 30 &&
          statuses.filter((status) => status === 429).length === 1,
        `Rate limit mismatch: ${JSON.stringify({ statuses, buckets })}; expected a single fixed window, 30 admitted and one throttled request`,
      );
      return { statuses, buckets };
    });
    await check('recovery after provider faults', async () => {
      const r = await request('/api/ask', {
        phoneSlug: 'apple-iphone-16-pro',
        query: `battery recovery ${Date.now()}`,
      });
      requireCheck(
        r.data.some((e: StreamEvent) => e.type === 'done'),
        `Recovery failed: ${JSON.stringify(r.data)}`,
      );
      return { ms: r.ms, trace: r.trace };
    });
  } finally {
    await fault('normal');
    await db.end();
    const dir = resolve(stage.outputDir, 'http');
    await mkdir(dir, { recursive: true });
    const artifact = {
      at: new Date().toISOString(),
      base,
      schema: stage.namespace,
      provider: 'controlled-test-no-quality',
      qualityClaim: false,
      productionCapacityClaim: false,
      results,
      passed: results.filter((r) => r.status === 'passed').length,
      failed: results.filter((r) => r.status === 'failed').length,
    };
    const path = resolve(dir, `${Date.now()}-functional.json`);
    await writeFile(path, JSON.stringify(artifact, null, 2));
    console.log(`Artifact: ${path}`);
    if (artifact.failed) process.exitCode = 1;
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
