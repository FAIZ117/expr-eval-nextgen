/* global describe, it */

'use strict';

var assert = require('assert');
var Parser = require('../dist/bundle').Parser;

describe('protectScope option', function () {
  it('without the option, assignments write the caller scope (legacy behavior)', function () {
    var parser = new Parser({ allowMemberAccess: false });
    var scope = { x: 1 };
    assert.strictEqual(parser.parse('x = 5').evaluate(scope), 5);
    assert.strictEqual(scope.x, 5);
  });

  it('with the option, assignments stay inside the evaluation', function () {
    var parser = new Parser({ allowMemberAccess: false, protectScope: true });
    var scope = { x: 1 };
    assert.strictEqual(parser.parse('x = 5').evaluate(scope), 5);
    assert.strictEqual(scope.x, 1);
  });

  it('read-your-writes works within the call', function () {
    var parser = new Parser({ allowMemberAccess: false, protectScope: true });
    var scope = { x: 3 };
    assert.strictEqual(parser.parse('y = 4 ; z = x < 5 ? x * y : x / y').evaluate(scope), 12);
    assert.deepStrictEqual(Object.keys(scope).sort(), ['x']);
  });

  it('inline function definitions do not leak into the scope', function () {
    var parser = new Parser({ allowMemberAccess: false, protectScope: true });
    var scope = {};
    assert.strictEqual(parser.parse('f(x) = x * 2; f(3) + f(4)').evaluate(scope), 14);
    assert.strictEqual('f' in scope, false);
  });

  it('non-assigning expressions are unaffected', function () {
    var parser = new Parser({ allowMemberAccess: false, protectScope: true });
    assert.strictEqual(parser.parse('x * 2 + 1').evaluate({ x: 4 }), 9);
  });

  it('protects shared scopes from function overwrites', function () {
    var parser = new Parser({ allowMemberAccess: false, protectScope: true });
    var shared = { MIN: function (a, b) { return Math.min(a, b); }, x: 2, y: 3 };
    // a hostile or careless formula tries to replace a scope function
    assert.strictEqual(parser.parse('MIN = 99').evaluate(shared), 99);
    // the shared scope still works for the next formula
    assert.strictEqual(parser.parse('MIN(x, y)').evaluate(shared), 2);
  });
});

describe('variables() excludes callees (upstream #7 residual)', function () {
  var parser = new Parser({ allowMemberAccess: false });

  it('scope-called function names are not variables', function () {
    assert.deepStrictEqual(parser.parse('helper(x) + y').variables().sort(), ['x', 'y']);
  });

  it('a name both called and read stays (per-occurrence exclusion)', function () {
    assert.deepStrictEqual(parser.parse('f(x) + f').variables().sort(), ['f', 'x']);
  });

  it('nested calls exclude only the callee', function () {
    assert.deepStrictEqual(parser.parse('outer(inner(x), y)').variables().sort(), ['x', 'y']);
  });

  it('assignment targets are still variables', function () {
    assert.deepStrictEqual(parser.parse('y = x + 1').variables().sort(), ['x', 'y']);
  });

  it('member-chain arguments survive (withMembers)', function () {
    var memberParser = new Parser({ allowMemberAccess: true });
    var expr = memberParser.parse('max(conf.limits.lower, conf.limits.upper)');
    assert.deepStrictEqual(expr.variables({ withMembers: true }).sort(),
      ['conf.limits.lower', 'conf.limits.upper']);
  });

  it('symbols() still reports everything', function () {
    var expr = parser.parse('helper(x) + y');
    assert.deepStrictEqual(expr.symbols().sort(), ['helper', 'x', 'y']);
  });
});

describe('parse error positions (upstream #247)', function () {
  it('exposes line and column properties', function () {
    var err = null;
    try { Parser.parse('1 +'); } catch (e) { err = e; }
    assert.ok(err instanceof Error);
    assert.strictEqual(err.line, 1);
    assert.strictEqual(err.column, 4);
    assert.ok(/unexpected/.test(err.message)); // message format unchanged from upstream; position is on the properties
  });

  it('tracks the line for multiline formulas', function () {
    var err = null;
    try { Parser.parse('1 +\n2 +'); } catch (e) { err = e; }
    assert.strictEqual(err.line, 2);
    assert.strictEqual(err.column, 4);
  });
});
