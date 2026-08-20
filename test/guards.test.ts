import { describe, expect, it } from 'vitest';
import type { Guard, GuardMeta } from '../src/guards.js';
import { allowAll, barricadeGuard, blockAll, denylistGuard, guardianGuard, judgeGuard, safeguardGuard } from '../src/guards.js';

const STATIC_META: GuardMeta = { transport: 'in-process', model: null, temperature: null, live: false };

describe('GuardMeta', () => {
  it('every commitment-blind in-tree guard declares in-process / no model / no temperature / not live', () => {
    const makers = { denylistGuard, barricadeGuard, safeguardGuard, guardianGuard, allowAll, blockAll };
    for (const [label, make] of Object.entries(makers)) {
      expect(make().meta, label).toEqual(STATIC_META);
    }
  });

  it('judgeGuard declares local-model transport, the passed model, temperature 0, and live true', () => {
    const g = judgeGuard('http://127.0.0.1:1234', 'qwen/qwen3-vl-8b');
    expect(g.meta).toEqual({ transport: 'local-model', model: 'qwen/qwen3-vl-8b', temperature: 0, live: true });
  });

  it("Guard['kind'] accepts 'external', reserved for loader-supplied guards (compile-time contract)", () => {
    const external: Guard = {
      name: 'some-external-guard',
      kind: 'external',
      note: 'loader-supplied, next round',
      meta: { transport: 'http', model: null, temperature: null, live: true },
      block: async () => false,
    };
    expect(external.kind).toBe('external');
  });
});
