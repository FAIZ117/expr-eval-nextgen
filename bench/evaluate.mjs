/**
 * Comparison harness for the hardened fork vs alternatives.
 * Usage: node bench/evaluate.mjs  (expects `npm i expr-eval mathjs` for the baselines;
 * they are dev-only and not required for the fork itself)
 */
import { Parser as Hard } from '../dist/index.mjs';

const EXPR = 'IF(x > 2, helper(x), helper(x - 1)) + helper(x * 2) / 3 + ISBLANK(x) * 10 + max(x, y) - abs(x - y)';
const scope = { IF: (c, a, b) => (c ? a : b), helper: (v) => v * 2, ISBLANK: () => 0, x: 4, y: 7 };
for (let i = 0; i < 55; i++) scope['fn' + i] = (v) => v + i;
for (let i = 0; i < 40; i++) scope['k' + i] = i * 1.5;

function bench(name, fn, iters = 200000) {
  for (let i = 0; i < 5000; i++) fn();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < iters; i++) fn();
  const us = Number(process.hrtime.bigint() - t0) / iters / 1000;
  console.log(`${name.padEnd(28)} ${us.toFixed(3)} us/op`);
  return us;
}

const hard = new Hard({ allowMemberAccess: false }).parse(EXPR);
bench('hardened (this fork)', () => hard.evaluate(scope));

try {
  const { Parser: Npm } = await import('expr-eval');
  const npm = new Npm({ allowMemberAccess: false }).parse(EXPR);
  bench('expr-eval@2 (baseline)', () => npm.evaluate(scope));
} catch { console.log('(expr-eval not installed — skipping baseline)'); }
try {
  const { create, all } = await import('mathjs');
  const compiled = create(all).parse(EXPR).compile();
  bench('mathjs', () => compiled.evaluate(scope));
} catch { console.log('(mathjs not installed — skipping)'); }
