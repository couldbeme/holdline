import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpJudgeGuard, invinoveritasGuard } from '../src/guards.js';

const CASE = { id: 'a', difficulty: 'literal', commitments: ['never touch prod on Friday'], action: 'deploy to prod' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('httpJudgeGuard (generic, no vendor hardcoded)', () => {
  it('sends mapCaseToBody(c) as the POST body and parses the response via parseBlock', async () => {
    let sentBody: unknown = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        sentBody = JSON.parse(String(init.body));
        return { ok: true, json: async () => ({ someField: 'block-please' }) };
      }),
    );
    const g = httpJudgeGuard({
      name: 'test-guard',
      kind: 'real',
      note: 'test',
      endpoint: 'https://example.test/judge',
      mapCaseToBody: (c) => ({ thing: c.action, rules: c.commitments }),
      parseBlock: (body) => (body as { someField?: string }).someField === 'block-please',
      meta: { transport: 'http', model: null, temperature: null, live: true },
    });
    const blocked = await g.block(CASE);
    expect(sentBody).toEqual({ thing: 'deploy to prod', rules: ['never touch prod on Friday'] });
    expect(blocked).toBe(true);
  });

  it('throws (fails closed) on a non-OK response instead of returning false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
    const g = httpJudgeGuard({
      name: 'test-guard',
      kind: 'real',
      note: 'test',
      endpoint: 'https://example.test/judge',
      mapCaseToBody: (c) => ({ action: c.action }),
      parseBlock: () => false,
      meta: { transport: 'http', model: null, temperature: null, live: true },
    });
    await expect(g.block(CASE)).rejects.toThrow();
  });

  it('throws (fails closed) on a transport error instead of returning false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('simulated network failure');
      }),
    );
    const g = httpJudgeGuard({
      name: 'test-guard',
      kind: 'real',
      note: 'test',
      endpoint: 'https://example.test/judge',
      mapCaseToBody: (c) => ({ action: c.action }),
      parseBlock: () => false,
      meta: { transport: 'http', model: null, temperature: null, live: true },
    });
    await expect(g.block(CASE)).rejects.toThrow('simulated network failure');
  });
});

describe('invinoveritasGuard (labeled configuration of httpJudgeGuard)', () => {
  it('declares transport: http, live: true, no model/temperature claim', () => {
    const g = invinoveritasGuard('fake-key');
    expect(g.meta).toEqual({ transport: 'http', model: null, temperature: null, live: true });
  });

  it("maps the case to invinoveritas's real /review request shape and treats verdict:'reject' as block", async () => {
    let sentBody: unknown = null;
    let sentHeaders: Record<string, string> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        sentBody = JSON.parse(String(init.body));
        sentHeaders = init.headers;
        return { ok: true, json: async () => ({ verdict: 'reject' }) };
      }),
    );
    const g = invinoveritasGuard('fake-key');
    const blocked = await g.block(CASE);
    expect(sentHeaders.Authorization).toBe('Bearer fake-key');
    expect(sentBody).toMatchObject({ artifact: 'deploy to prod', artifact_type: 'general' });
    expect((sentBody as { context: string }).context).toContain('never touch prod on Friday');
    expect(blocked).toBe(true);
  });

  it('a verdict other than "reject" does not block', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ verdict: 'approve' }) })));
    const g = invinoveritasGuard('fake-key');
    expect(await g.block(CASE)).toBe(false);
  });

  it('fails closed (throws, does not resolve false) when fetch itself rejects -- the exact loader probe from GUARD-INTERFACE.md', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('simulated network failure');
      }),
    );
    const g = invinoveritasGuard('fake-key');
    await expect(g.block(CASE)).rejects.toThrow();
  });
});
