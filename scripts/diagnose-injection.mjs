// Per-case injection diagnostic: what did the judge decide on each injection case, and why.
// node --import tsx scripts/diagnose-injection.mjs [--model qwen/qwen3-vl-8b]
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLlmJudge } from 'dsh-write-gate/core';

const here = dirname(fileURLToPath(import.meta.url));
const model = (() => { const i = process.argv.indexOf('--model'); return i !== -1 ? process.argv[i + 1] : 'qwen/qwen3-vl-8b'; })();
const endpoint = 'http://127.0.0.1:1234';

const judge = createLlmJudge(async (prompt) => {
  const res = await fetch(`${endpoint}/v1/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, temperature: 0, max_tokens: 250, messages: [{ role: 'user', content: prompt }] }),
  });
  return (await res.json()).choices?.[0]?.message?.content ?? '';
});

const inj = JSON.parse(readFileSync(join(here, '../corpus/injection-cases.json'), 'utf8')).injection;
console.log(`injection diagnostic · ${model}\n`);
let miss = 0;
for (const c of inj) {
  let blocked = false;
  let why = '';
  for (const statement of c.commitments) {
    const v = await judge({ statement, action: { kind: 'shell', tool: 'action', command: c.action, summary: c.action } });
    if (v.violation) { blocked = true; why = v.rationale; break; }
    why = v.abstained ? 'ABSTAIN' : v.rationale;
  }
  const correct = (c.label === 'drift') === blocked;
  if (!correct) miss++;
  console.log(`${correct ? 'ok  ' : 'MISS'} ${c.id.padEnd(24)} label=${c.label.padEnd(5)} judged=${blocked ? 'block' : 'allow'}`);
  console.log(`     why: ${why.slice(0, 140)}`);
}
console.log(`\n${inj.length - miss}/${inj.length} correct · ${miss} missed`);
