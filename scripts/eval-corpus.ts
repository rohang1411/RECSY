import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import postgres from 'postgres';

async function main() {
  const stage = JSON.parse(await readFile('output/eval/current-stage.json', 'utf8'));
  if (!/^eval_[a-z0-9_]+$/.test(stage.namespace)) throw new Error('Invalid stage namespace');
  const db = postgres(process.env.DATABASE_URL!, {
    max: 1,
    prepare: false,
    connection: { search_path: `${stage.namespace},extensions` },
  });
  try {
    const phones = await db`select id,slug,brand,model,status from phones order by id`;
    const chunks =
      await db`select c.id,c.phone_id,c.source_id,c.text,c.start_ts,c.anchor,s.title,s.url,s.type,s.status,s.content_hash,s.published_at from chunks c join sources s on s.id=c.source_id order by c.id`;
    const sourceMappings =
      await db`select s.id,s.title,s.url,array_agg(distinct p.slug order by p.slug) as phone_slugs from sources s join chunks c on c.source_id=s.id join phones p on p.id=c.phone_id group by s.id having count(distinct c.phone_id)>1`;
    const snapshot = {
      schema: stage.namespace,
      at: new Date().toISOString(),
      phones,
      chunks: chunks.map((c) => ({
        ...c,
        textHash: createHash('sha256').update(c.text).digest('hex'),
      })),
      multiplePhoneSources: sourceMappings,
    };
    const canonical = JSON.stringify({ phones: snapshot.phones, chunks: snapshot.chunks });
    const hash = createHash('sha256').update(canonical).digest('hex');
    await writeFile(
      resolve(stage.outputDir, 'corpus.json'),
      JSON.stringify({ ...snapshot, sha256: hash }, null, 2),
    );
    const evidence =
      await db`select p.slug,c.id,c.text,s.title,s.url from chunks c join sources s on s.id=c.source_id join phones p on p.id=c.phone_id where s.status='active' and s.type='article' and p.slug in ('apple-iphone-16-pro','google-pixel-9-pro','samsung-galaxy-s25-ultra','oneplus-13','nothing-phone-3a','samsung-galaxy-z-fold6','apple-iphone-16','google-pixel-9') and c.text ~* '(battery|charging|camera|display)' order by p.slug,c.id`;
    const groups = new Map<string, Array<(typeof evidence)[number]>>();
    for (const row of evidence) {
      const group = groups.get(row.slug) ?? [];
      if (group.length < 4) group.push(row);
      groups.set(row.slug, group);
    }
    console.log(
      JSON.stringify(
        {
          sha256: hash,
          phones: phones.length,
          chunks: chunks.length,
          multiplePhoneSources: sourceMappings,
          ...(process.argv.includes('--inspect') ? { evidence: [...groups.values()].flat() } : {}),
        },
        null,
        2,
      ),
    );
  } finally {
    await db.end();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
