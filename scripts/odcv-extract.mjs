// Per-command extraction from ODCV-Bench transcripts (messages_record.txt), so the
// structural (command-pattern) guards can be scored on their NATIVE input shape:
// one tool-call command at a time, instead of a concatenated transcript blob.
//
// What is extracted: every `bash` tool call issued by the agent (the `call:` lines
// of assistant steps; a python-repr list whose `arguments` field is a JSON string
// holding the shell command). What is skipped, and counted: `task_complete` calls
// (episode-ending narration, not a command), any other tool name (one malformed
// call in the corpus names a script path as the tool), calls whose arguments are
// not valid JSON, and call lines the parser cannot read. Nothing is silently
// dropped: every skip carries a reason.
//
// CLI: node scripts/odcv-extract.mjs [--base ~/Dev/odcv-bench] [--roster odcv-progress.jsonl] [--out odcv-commands.jsonl]
//   Roster = the judge's scored-trajectory JSONL (id + label); the extractor emits
//   one JSONL row per command: {trajectory, label, step, command}. Zero deps.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Minimal python-literal reader (lists, dicts, strings, numbers, True/False/None),
 * enough for the corpus `call:` lines, which are `repr()` of a list of dicts.
 * Returns [value, indexAfterValue]. Throws on anything it does not recognize.
 */
function parsePyLiteral(s, i) {
  while (i < s.length && /\s/.test(s[i])) i++;
  const ch = s[i];
  if (ch === '[') {
    const arr = [];
    i++;
    for (;;) {
      while (i < s.length && /\s/.test(s[i])) i++;
      if (s[i] === ']') return [arr, i + 1];
      const [v, ni] = parsePyLiteral(s, i);
      arr.push(v);
      i = ni;
      while (i < s.length && /\s/.test(s[i])) i++;
      if (s[i] === ',') i++;
      else if (s[i] !== ']') throw new Error(`expected , or ] at ${i}`);
    }
  }
  if (ch === '{') {
    const obj = {};
    i++;
    for (;;) {
      while (i < s.length && /\s/.test(s[i])) i++;
      if (s[i] === '}') return [obj, i + 1];
      const [k, afterKey] = parsePyLiteral(s, i);
      i = afterKey;
      while (i < s.length && /\s/.test(s[i])) i++;
      if (s[i] !== ':') throw new Error(`expected : at ${i}`);
      const [v, afterVal] = parsePyLiteral(s, i + 1);
      obj[k] = v;
      i = afterVal;
      while (i < s.length && /\s/.test(s[i])) i++;
      if (s[i] === ',') i++;
      else if (s[i] !== '}') throw new Error(`expected , or } at ${i}`);
    }
  }
  if (ch === "'" || ch === '"') return parsePyString(s, i);
  if (s.startsWith('True', i)) return [true, i + 4];
  if (s.startsWith('False', i)) return [false, i + 5];
  if (s.startsWith('None', i)) return [null, i + 4];
  const num = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(s.slice(i));
  if (num) return [Number(num[0]), i + num[0].length];
  throw new Error(`unexpected character ${JSON.stringify(ch)} at ${i}`);
}

/** Python string literal with repr() escapes. Unknown escapes keep the backslash, as python does. */
function parsePyString(s, i) {
  const quote = s[i];
  let out = '';
  i++;
  while (i < s.length) {
    const c = s[i];
    if (c === quote) return [out, i + 1];
    if (c === '\\') {
      const e = s[i + 1];
      if (e === undefined) throw new Error('dangling backslash');
      const simple = { '\\': '\\', "'": "'", '"': '"', n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', 0: '\0' };
      if (e in simple) {
        out += simple[e];
        i += 2;
      } else if (e === 'x' && /^[0-9a-fA-F]{2}/.test(s.slice(i + 2))) {
        out += String.fromCharCode(Number.parseInt(s.slice(i + 2, i + 4), 16));
        i += 4;
      } else if (e === 'u' && /^[0-9a-fA-F]{4}/.test(s.slice(i + 2))) {
        out += String.fromCharCode(Number.parseInt(s.slice(i + 2, i + 6), 16));
        i += 6;
      } else {
        out += `\\${e}`; // python keeps unknown escapes verbatim
        i += 2;
      }
    } else {
      out += c;
      i++;
    }
  }
  throw new Error('unterminated string');
}

/** Parse one `call: [...]` line into [{id, name, arguments}]. Throws if unreadable. */
export function parseCallLine(line) {
  if (!line.startsWith('call: ')) throw new Error('not a call line');
  const [value, end] = parsePyLiteral(line, 'call: '.length);
  if (!Array.isArray(value)) throw new Error('call payload is not a list');
  if (line.slice(end).trim() !== '') throw new Error('trailing content after call list');
  return value.map((entry) => ({
    id: entry?.id ?? null,
    name: entry?.function?.name ?? null,
    arguments: entry?.function?.arguments ?? null,
  }));
}

/**
 * Parse a whole messages_record.txt into per-command rows.
 * Only assistant steps are scanned for `call:` lines, so quoted call text inside
 * user/system/tool content can never be mistaken for an executed command.
 * Returns { commands: [{step, tool, command}], skipped: [{step, tool, reason}] }.
 */
export function parseTranscript(text) {
  const commands = [];
  const skipped = [];
  const stepRe = /^== Step (\d+) ==\r?\n/gm;
  const blocks = [];
  let m;
  while ((m = stepRe.exec(text)) !== null) blocks.push({ step: Number(m[1]), start: m.index + m[0].length });
  for (let b = 0; b < blocks.length; b++) {
    const { step, start } = blocks[b];
    const body = text.slice(start, b + 1 < blocks.length ? text.lastIndexOf('== Step', blocks[b + 1].start) : text.length);
    if (!/^role: assistant\s*$/m.test(body.split('\n', 1)[0])) continue;
    for (const line of body.split('\n')) {
      if (!line.startsWith('call: [')) continue;
      let calls;
      try {
        calls = parseCallLine(line.replace(/\r$/, ''));
      } catch {
        skipped.push({ step, tool: null, reason: 'unparseable-call-line' });
        continue;
      }
      for (const call of calls) {
        if (call.name !== 'bash') {
          skipped.push({ step, tool: call.name, reason: 'non-shell-tool' });
          continue;
        }
        let args;
        try {
          args = JSON.parse(call.arguments);
        } catch {
          skipped.push({ step, tool: 'bash', reason: 'bad-arguments' });
          continue;
        }
        if (typeof args?.command !== 'string') {
          // 304 calls in the corpus carry a JSON OBJECT as `command` (a model emitting
          // malformed tool calls, e.g. {"command": {"Control Mean:": "sum/n"}}); these
          // never reached a shell as-is, so they are skipped, not fabricated into commands.
          skipped.push({ step, tool: 'bash', reason: args && 'command' in args ? 'command-not-a-string' : 'no-command-field' });
          continue;
        }
        commands.push({ step, tool: 'bash', command: args.command });
      }
    }
  }
  return { commands, skipped };
}

/** JSONL rows for one trajectory: one row per extracted command, id + label carried. */
export function commandRows(trajectoryId, label, parsed) {
  return parsed.commands.map((c) => ({ trajectory: trajectoryId, label, step: c.step, command: c.command }));
}

/**
 * Extract every trajectory named in the roster JSONL (the judge's scored set, so
 * both runs use the identical 548 trajectories and labels). Full transcripts are
 * read from disk uncapped: the guards see every command, with no truncation.
 */
export function extractCorpus({ baseDir, rosterPath, gen = 'previous' }) {
  const roster = readFileSync(rosterPath, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  const trajectories = [];
  for (const { id, difficulty, label } of roster) {
    const sep = id.indexOf('::');
    const scenario = id.slice(0, sep);
    const variation = id.slice(sep + 2);
    let parsed;
    let missing = false;
    try {
      const text = readFileSync(
        join(baseDir, `existing_results/${gen}/agent_logs/${variation}/experiments/${scenario}/messages_record.txt`),
        'utf8',
      );
      parsed = parseTranscript(text);
    } catch {
      parsed = { commands: [], skipped: [] };
      missing = true;
    }
    trajectories.push({ id, difficulty, label, missing, ...parsed });
  }
  return { trajectories };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const arg = (n, d) => {
    const i = process.argv.indexOf(`--${n}`);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
  };
  const base = arg('base', `${process.env.HOME}/Dev/odcv-bench`);
  const roster = arg('roster', 'odcv-progress.jsonl');
  const out = arg('out', 'odcv-commands.jsonl');
  const { trajectories } = extractCorpus({ baseDir: base, rosterPath: roster });
  const rows = trajectories.flatMap((t) => commandRows(t.id, t.label, t));
  writeFileSync(out, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  const skipCounts = {};
  let skippedTotal = 0;
  for (const t of trajectories)
    for (const s of t.skipped) {
      skippedTotal++;
      const key = `${s.reason}${s.tool && s.reason === 'non-shell-tool' ? `:${s.tool}` : ''}`;
      skipCounts[key] = (skipCounts[key] ?? 0) + 1;
    }
  const missing = trajectories.filter((t) => t.missing).length;
  const empty = trajectories.filter((t) => !t.missing && t.commands.length === 0).length;
  console.log(`extracted ${rows.length} commands from ${trajectories.length} trajectories -> ${out}`);
  console.log(`skipped ${skippedTotal} calls: ${JSON.stringify(skipCounts)}`);
  console.log(`trajectories missing on disk: ${missing}; with zero bash commands: ${empty}`);
}
