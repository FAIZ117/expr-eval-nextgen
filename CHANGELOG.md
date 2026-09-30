# Changelog

## [2.3.0] - 2026-09-30

### Performance: operand inlining and constant folding in the closure compiler

Compile-time entries are now tagged (literal / scope-only variable / dynamic)
so hot consumers bake scope reads and constants directly into their closures
instead of calling a sub-closure per operand, the dominant fn(var) call
shapes are specialized end-to-end, the callable check is a single typeof
instead of two property lookups, and pure ops over two literals fold to one
literal at compile time.

Measured vs 2.2.0 (same process, pre-parsed evaluate, Node 24):
- function-dense with function-valued scope: +23%
- variable-heavy arithmetic: +41%
- small expressions: +19%
- constant expressions: +138% (folding)

Cumulative vs upstream expr-eval 2.0.2: ~12x on function-dense, ~6x on small
expressions. Gates: 448 tests; parity run of 7,987 production FP&A formulas
against the pre-closure 2.1.0 stack engine — identical results and error
messages throughout.

### Fixed

- `exports` map now exposes `./package.json` (required by tooling that reads
  installed package versions).

## [2.2.0] - 2026-09-30

### Performance: closure compilation of the expression tree

`evaluate()` no longer walks the RPN instruction stream with a value stack.
Each expression is compiled once (lazily, on first evaluate) into a tree of
nested closures — plain function calls that JIT extremely well. Semantics
are preserved instruction-for-instruction, including short-circuit `and`/`or`,
lazy ternary branches, assignment side effects on the scope object, inline
function definitions, statement discards, and the `-0` -> `0` result
normalization.

Measured vs 2.1.0 / upstream 2.0.2 (Node 24, pre-parsed evaluate):
- function-dense formula with function-valued scope: ~9x faster
- variable-heavy arithmetic: ~3.5x
- small expressions: ~3.25x
- parse + first evaluate (compile cost included): ~7% faster

Verified by: full test suite (448 tests) and a parity run of 7,987
real-world formulas from a production FP&A model — identical results and
identical error messages on every one.

## [2.1.0] - 2026-09-30

First release of expr-eval-nextgen, a hardened continuation of expr-eval 2.0.2
(based on upstream master). Original engine by Matthew Crumley (MIT). Security:

### Security

- Parse-time rejection of `__proto__`/`prototype`/`constructor` as variable,
  member, and function-parameter names (CVE-2025-13204 / GHSA-8gw3-rxh4-v6jx).
  Replaces upstream master's per-evaluation regex check, so evaluation is as
  fast as upstream 2.0.2.
- `evaluate()` rejects scope objects carrying own `__proto__`/`prototype`/
  `constructor` keys, validated once per unique scope object via WeakMap
  (CVE-2025-12735 / GHSA-jc85-fpwf-qm7x). Function-valued scope entries keep
  working — unlike expr-eval-fork and safe-expr-eval.
- `toJSFunction()` disabled: always throws instead of compiling expressions
  with `new Function()` (CVE-2026-12866 / GHSA-q9v2-7m5w-4693).
- New export `validateScope(values)` for app-side pre-validation.

### Changed

- `package.json` now has an `exports` map with types/require/import entries
  (upstream issue #280).
- Published to npm as `expr-eval-nextgen`.

## [2.0.2] - 2019-09-28

### Added

- Added non-default exports when using the ES module format. This allows `import { Parser } from 'expr-eval'` to work in TypeScript. The default export is still available for backward compatibility.


## [2.0.1] - 2019-09-10

### Added

- Added the `if(condition, trueValue, falseValue)` function back. The ternary operator is still recommended if you need to only evaluate one branch, but we're keep this as an option at least for now.


## [2.0.0] - 2019-09-07

### Added

- Better support for arrays, including literals: `[ 1, 2, 3 ]` and indexing: `array[0]`
- New functions for arrays: `join`, `indexOf`, `map`, `filter`, and `fold`
- Variable assignment: `x = 4`
- Custom function definitions: `myfunction(x, y) = x * y`
- Evaluate multiple expressions by separating them with `;`
- New operators: `log2` (base-2 logarithm), `cbrt` (cube root), `expm1` (`e^x - 1`), `log1p` (`log(1 + x)`), `sign` (essentially `x == 0 ? 0 : x / abs x`)

### Changed

- `min` and `max` functions accept either a parameter list or a single array argument
- `in` operator is enabled by default. It can be disabled by passing { operators: `{ 'in': false } }` to the `Parser` constructor.
- `||` (concatenation operator) now supports strings and arrays

### Removed

- Removed the `if(condition, trueValue, falseValue)` function. Use the ternary conditional operator instead: `condition ? trueValue : falseValue`, or you can add it back easily with a custom function.
