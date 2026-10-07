import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const escape = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
async function main() {
  const stage = JSON.parse(await readFile('output/eval/current-stage.json', 'utf8'));
  const quality = JSON.parse(
    await readFile(resolve(stage.outputDir, 'current-quality.json'), 'utf8'),
  );
  const raw = await readFile(resolve(quality.dir, 'results.json'), 'utf8');
  const run = JSON.parse(raw);
  const questions = JSON.parse(
    await readFile(resolve(quality.dir, 'questions.json'), 'utf8'),
  ).cases;
  const corpus = JSON.parse(await readFile(resolve(stage.outputDir, 'corpus.json'), 'utf8'));
  const previousMapRaw = await readFile(
    resolve(quality.dir, 'blind-map.private.json'),
    'utf8',
  ).catch(() => null);
  const previousMap = previousMapRaw ? JSON.parse(previousMapRaw) : null;
  if (previousMap?.some((m: { blindId: string }) => /^A\d{3}$/.test(m.blindId))) {
    await writeFile(resolve(quality.dir, 'blind-map.v1.private.json'), previousMapRaw!, {
      flag: 'wx',
    }).catch((error) => {
      if (error.code !== 'EEXIST') throw error;
    });
    const oldHtml = await readFile(resolve(quality.dir, 'review.html'), 'utf8');
    await writeFile(resolve(quality.dir, 'review.v1.html'), oldHtml, { flag: 'wx' }).catch(
      (error) => {
        if (error.code !== 'EEXIST') throw error;
      },
    );
  }
  const mapping = run.results.map((result: Record<string, unknown>, index: number) => ({
    blindId: previousMap?.[index]?.blindId?.startsWith('A-')
      ? previousMap[index].blindId
      : `A-${randomUUID()}`,
    caseId: result.caseId,
    variant: result.variant,
    status: result.status,
  }));
  const order = mapping
    .map((m: { blindId: string; caseId: string; variant: string }) => ({
      ...m,
      sort: createHash('sha256')
        .update(quality.runId + m.blindId)
        .digest('hex'),
    }))
    .sort((a: { sort: string }, b: { sort: string }) => a.sort.localeCompare(b.sort));
  const resultHash = createHash('sha256').update(raw).digest('hex');
  const sections = questions
    .map(
      (q: {
        id: string;
        phoneSlug: string;
        query: string;
        supportingChunkIds: string[];
        candidateFacts: string[];
      }) => {
        const sources = q.supportingChunkIds.map((id) =>
          corpus.chunks.find((c: { id: string }) => c.id === id),
        );
        return `<section data-question="${escape(q.id)}"><h2>${escape(q.id)} — ${escape(q.phoneSlug)}</h2><p>${escape(q.query)}</p><p>Candidate facts to verify, not established gold:</p><ul>${q.candidateFacts.map((f) => `<li>${escape(f)}</li>`).join('')}</ul>${sources.map((c: { id: string; title: string; url: string; text: string; textHash: string }) => `<details open><summary>${escape(c.title)} · ${escape(c.id)}</summary><p>${escape(c.url)}</p><pre>${escape(c.text)}</pre><small>Text SHA-256: ${escape(c.textHash)}</small></details>`).join('')}<label>Does this question have a sufficient, correctly attributed answer in the frozen evidence? <select data-field="answerability"><option value="">Choose</option><option>answerable</option><option>unanswerable</option><option>ambiguous</option></select></label><label>Are every candidate fact and its phone attribution accurate? <select data-field="candidateFactsValid"><option value="">Choose</option><option>yes</option><option>no</option><option>uncertain</option></select></label><label>Corrections, supporting IDs, conflicts, missing facts <textarea data-field="notes"></textarea></label></section>`;
      },
    )
    .join('');
  const answers = order
    .map((m: { blindId: string; caseId: string; variant: string }) => {
      const r = run.results.find(
        (r: { caseId: string; variant: string }) =>
          r.caseId === m.caseId && r.variant === m.variant,
      );
      return `<section data-answer="${escape(m.blindId)}"><h2>Answer ${escape(m.blindId)} · question ${escape(m.caseId)}</h2><p>${escape(r.query)}</p><pre>${escape(r.answer ?? 'No answer was produced: execution failed.')}</pre><p>Citation IDs identify excerpts below. Check each factual claim, attribution, scope, and whether the question was answered fully.</p>${(r.retrieval?.chunks ?? []).map((c: { chunkId: string; text: string; source: { title: string; url: string } }) => `<details><summary>${escape(c.chunkId)} — ${escape(c.source.title)}</summary><p>${escape(c.source.url)}</p><pre>${escape(c.text)}</pre></details>`).join('')}${['allClaimsSupported', 'allClaimsFactuallyCorrect', 'complete', 'citationsCorrect', 'phoneAttributionCorrect'].map((field) => `<label>${escape(field)} <select data-field="${field}"><option value="">Choose</option><option>yes</option><option>no</option><option>uncertain</option></select></label>`).join('')}<label>Unsupported claims, omissions and supporting evidence IDs <textarea data-field="notes"></textarea></label></section>`;
    })
    .join('');
  const planned = questions.length * 3;
  const review = {
    reviewVersion: 2,
    runId: quality.runId,
    resultSha256: resultHash,
    corpusSha256: corpus.sha256,
    reviewer: '',
    reviewedAt: null,
    questions: questions.map((q: { id: string }) => ({
      caseId: q.id,
      answerability: '',
      candidateFactsValid: '',
      notes: '',
    })),
    answers: mapping.map((m: { blindId: string }) => ({
      blindId: m.blindId,
      allClaimsSupported: '',
      allClaimsFactuallyCorrect: '',
      complete: '',
      citationsCorrect: '',
      phoneAttributionCorrect: '',
      notes: '',
    })),
  };
  const payload = JSON.stringify(review).replace(/</g, '\\u003c');
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>RECSY blinded review</title><style>body{font:16px/1.5 system-ui;max-width:1000px;margin:30px auto;padding:20px;background:#f4f6f8;color:#14202b}section{background:white;border:1px solid #cad3dc;border-radius:8px;padding:24px;margin:24px 0}pre{white-space:pre-wrap;font:15px/1.5 system-ui}label{display:block;margin:16px 0}textarea{display:block;width:95%;min-height:90px}select,input,button{font:inherit;padding:8px}small{overflow-wrap:anywhere}summary{cursor:pointer}</style><h1>RECSY independent blinded review</h1><p>This is a six-question diagnostic candidate pilot. It is not reviewed gold or representative production accuracy. ${planned} variant outcomes were planned; ${run.results.length} were executed. Unexecuted cases remain untested. Source-backed questions were authored by the implementation agent; validate the evidence before grading the answers. Variant names, model identity and scores are hidden.</p><p>Review question answerability first, without opening answers. Then assess every substantive claim against its cited excerpts, including facts about other phones, regional differences, dated claims and missing qualifications. A valid citation ID does not establish factual support. A cited source can itself be wrong or outdated: grade factual correctness separately, check authoritative specifications and time/region scope, and use uncertain when truth cannot be established. Use “uncertain” when evidence conflicts. Record IDs and reasons. Do not consult the implementation agent's scores.</p><label>Reviewer name or ID <input id="reviewer"></label><p>Export is local; nothing is sent to a server. Save the JSON and return it for validation. All fields are required; uncertain labels prevent a definitive accuracy score. A second independent review and adjudication are recommended for contested cases.</p><button id="export">Export review JSON</button><p id="validation-error" role="alert" style="color:#a51212"></p><h1>Part 1: validate candidate questions</h1>${sections}<details><summary><h1>Part 2: blinded answers</h1></summary>${answers}</details><script>const template=${payload};document.getElementById('export').onclick=()=>{const out=structuredClone(template);out.reviewer=document.getElementById('reviewer').value.trim();out.reviewedAt=new Date().toISOString();for(const [selector,list,key] of [['[data-question]',out.questions,'caseId'],['[data-answer]',out.answers,'blindId']])for(const el of document.querySelectorAll(selector)){const id=el.getAttribute(selector==='[data-question]'?'data-question':'data-answer');const item=list.find(x=>x[key]===id);for(const field of el.querySelectorAll('[data-field]'))item[field.dataset.field]=field.value;}if(!out.reviewer||[...out.questions,...out.answers].some(x=>Object.entries(x).some(([k,v])=>k!=='notes'&&!v))){document.getElementById('validation-error').textContent='Enter a reviewer ID and complete all selections. Use uncertain when necessary.';return;}document.getElementById('validation-error').textContent='';const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([JSON.stringify(out,null,2)],{type:'application/json'}));link.download='recsy-review-'+out.runId+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);};</script></html>`;
  await writeFile(resolve(quality.dir, 'review.html'), html);
  await writeFile(resolve(quality.dir, 'review-template.json'), JSON.stringify(review, null, 2));
  await writeFile(resolve(quality.dir, 'blind-map.private.json'), JSON.stringify(mapping, null, 2));
  const summary = {
    runId: quality.runId,
    resultSha256: resultHash,
    questionCount: questions.length,
    plannedOutcomes: planned,
    executedOutcomes: run.results.length,
    unexecutedOutcomes: planned - run.results.length,
    generationRequests: run.budget.generationRequests,
    embeddingRequests: run.budget.embeddingRequests,
    quotaStopped: run.budget.quotaStopped,
    independentReview: 'pending',
    fullySupportedAnswerRate: null,
    reviewFile: resolve(quality.dir, 'review.html'),
  };
  await writeFile(
    resolve(stage.outputDir, 'campaign-summary.json'),
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary, null, 2));
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
