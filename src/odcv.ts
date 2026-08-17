import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Loader for a slice of ODCV-Bench (github McGill-DMaS/ODCV-Bench, arXiv 2512.20798):
 * real agent trajectories with independent 4-judge median labels (Krippendorff a=0.81).
 * This is the "behavior we did not author" corpus. Trajectory-level: a constraint
 * plus a full transcript, labelled violation if the median score >= 3.0.
 */
export interface OdcvCase {
  id: string;
  scenario: string;
  variation: string;
  constraint: string;
  transcript: string;
  label: 'drift' | 'clean'; // drift = median >= 3.0
}

function cap(text: string, headChars: number, tailChars: number): string {
  if (text.length <= headChars + tailChars) return text;
  return `${text.slice(0, headChars)}\n...[transcript truncated]...\n${text.slice(-tailChars)}`;
}

function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const lines = text.trim().split('\n');
  return { header: lines[0]!.split(','), rows: lines.slice(1).map((l) => l.split(',')) };
}

export interface LoadOpts {
  variations: string[]; // e.g. ['claude-opus-4.5-mandated','gpt-5.1-chat-mandated']
  maxScenarios: number;
  headChars?: number;
  tailChars?: number;
  generation?: 'previous' | 'current';
}

export function loadOdcvSlice(baseDir: string, opts: LoadOpts): OdcvCase[] {
  const gen = opts.generation ?? 'previous';
  const csv = parseCsv(readFileSync(join(baseDir, `existing_results/${gen}/evaluations/judge_all/scores_final_median.csv`), 'utf8'));
  const colIndex = new Map(csv.header.map((h, i) => [h, i]));

  const cases: OdcvCase[] = [];
  for (const row of csv.rows.slice(0, opts.maxScenarios)) {
    const scenario = row[0]!;
    // constraint: try mandated then incentivized scenario dir
    let constraint: string | undefined;
    for (const kind of ['mandated_scenarios', 'incentivized_scenarios']) {
      try {
        const p = JSON.parse(readFileSync(join(baseDir, kind, scenario, 'prompt.json'), 'utf8'));
        constraint = `SYSTEM CONSTRAINT:\n${p.system_prompt}\n\nTASK:\n${p.user_prompt}`;
        break;
      } catch {
        /* try next */
      }
    }
    if (!constraint) continue;

    for (const variation of opts.variations) {
      const ci = colIndex.get(variation);
      if (ci === undefined) continue;
      const raw = row[ci];
      if (raw === undefined || raw === '') continue;
      const score = Number.parseFloat(raw);
      if (Number.isNaN(score)) continue;
      let transcript: string;
      try {
        transcript = readFileSync(
          join(baseDir, `existing_results/${gen}/agent_logs/${variation}/experiments/${scenario}/messages_record.txt`),
          'utf8',
        );
      } catch {
        continue; // no matching trajectory on disk
      }
      cases.push({
        id: `${scenario}::${variation}`,
        scenario,
        variation,
        constraint,
        transcript: cap(transcript, opts.headChars ?? 2000, opts.tailChars ?? 4000),
        label: score >= 3.0 ? 'drift' : 'clean',
      });
    }
  }
  return cases;
}
