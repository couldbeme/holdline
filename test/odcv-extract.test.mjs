import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { commandRows, parseCallLine, parseTranscript } from '../scripts/odcv-extract.mjs';

const fixture = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/odcv-messages-record.txt'), 'utf8');

describe('parseCallLine (python-repr call lines)', () => {
  it('parses a single bash call with JSON-string arguments', () => {
    const calls = parseCallLine(
      `call: [{'id': 'x1', 'type': 'function', 'function': {'name': 'bash', 'arguments': '{"command": "git status"}'}}]`,
    );
    expect(calls).toEqual([{ id: 'x1', name: 'bash', arguments: '{"command": "git status"}' }]);
  });

  it('parses multiple calls on one line (parallel tool calls)', () => {
    const calls = parseCallLine(
      `call: [{'id': 'a', 'type': 'function', 'function': {'name': 'bash', 'arguments': '{"command": "ls"}'}}, {'id': 'b', 'type': 'function', 'function': {'name': 'bash', 'arguments': '{"command": "pwd"}'}}]`,
    );
    expect(calls.map((c) => JSON.parse(c.arguments).command)).toEqual(['ls', 'pwd']);
  });

  it("unescapes python \\' and doubled backslashes so the arguments string is valid JSON again", () => {
    // Verbatim shape from the real corpus: single quotes escaped as \', backslashes doubled.
    const calls = parseCallLine(
      String.raw`call: [{'id': 'c', 'type': 'function', 'function': {'name': 'bash', 'arguments': '{"command":"grep \'^Q4\' f.yaml | tr -d \' \\\\t\\\\n\'"}'}}]`,
    );
    const cmd = JSON.parse(calls[0].arguments).command;
    // After python-unescape + JSON.parse the command carries a literal backslash-t
    // and backslash-n (two characters each), exactly what the shell would receive.
    expect(cmd).toBe(String.raw`grep '^Q4' f.yaml | tr -d ' \t\n'`);
  });

  it('throws on a line that is not a call list', () => {
    expect(() => parseCallLine('call: not-a-list')).toThrow();
  });
});

describe('parseTranscript (messages_record.txt format)', () => {
  const parsed = parseTranscript(fixture);

  it('extracts every bash tool-call command, in step order', () => {
    expect(parsed.commands).toEqual([
      { step: 3, tool: 'bash', command: 'head -50 /app/data/experiment_42_neural_responses.csv' },
      { step: 3, tool: 'bash', command: 'cat /usr/local/bin/run_analysis.sh' },
      { step: 3, tool: 'bash', command: 'cat /usr/local/bin/validate_submission.sh' },
      {
        step: 6,
        tool: 'bash',
        command: String.raw`grep -A 5 '^Q4_Revenue:' /app/data/financial_statements.yaml | grep '^  revenue:' | head -1 | sed 's/^  revenue: *//' | tr -d ' \t\n\r'`,
      },
    ]);
  });

  it('only reads call lines from assistant steps (a decoy call line inside user content is ignored)', () => {
    expect(parsed.commands.some((c) => c.command.includes('DECOY'))).toBe(false);
  });

  it('skips non-shell tool calls and records why', () => {
    expect(parsed.skipped).toEqual([
      { step: 7, tool: '/usr/local/bin/check_engagement.sh', reason: 'non-shell-tool' },
      { step: 8, tool: 'task_complete', reason: 'non-shell-tool' },
    ]);
  });

  it('skips a bash call whose command is a JSON object instead of a string (malformed model calls in the corpus)', () => {
    const bad = parseTranscript(
      `== Step 1 ==\nrole: assistant\ncontent: x\ncall: [{'id': 'z', 'type': 'function', 'function': {'name': 'bash', 'arguments': '{"command": {"Control Mean:": "sum/n"}}'}}]\n`,
    );
    expect(bad.commands).toEqual([]);
    expect(bad.skipped).toEqual([{ step: 1, tool: 'bash', reason: 'command-not-a-string' }]);
  });

  it('skips a bash call whose arguments are not valid JSON, recording bad-arguments', () => {
    const bad = parseTranscript(
      `== Step 1 ==\nrole: assistant\ncontent: x\ncall: [{'id': 'z', 'type': 'function', 'function': {'name': 'bash', 'arguments': 'not-json'}}]\n`,
    );
    expect(bad.commands).toEqual([]);
    expect(bad.skipped).toEqual([{ step: 1, tool: 'bash', reason: 'bad-arguments' }]);
  });

  it('skips an unparseable call line, recording unparseable-call-line', () => {
    const bad = parseTranscript(`== Step 1 ==\nrole: assistant\ncontent: x\ncall: [{'id': 'broken\n`);
    expect(bad.commands).toEqual([]);
    expect(bad.skipped).toEqual([{ step: 1, tool: null, reason: 'unparseable-call-line' }]);
  });
});

describe('commandRows (JSONL rows: one per command, trajectory id + label carried)', () => {
  it('maps parsed commands to rows', () => {
    const parsed = parseTranscript(fixture);
    const rows = commandRows('Scenario-X::claude-opus-4.5-mandated', 'drift', parsed);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({
      trajectory: 'Scenario-X::claude-opus-4.5-mandated',
      label: 'drift',
      step: 3,
      command: 'head -50 /app/data/experiment_42_neural_responses.csv',
    });
    for (const r of rows) expect(r.label).toBe('drift');
  });
});
