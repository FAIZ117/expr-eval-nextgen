/**
 * Security regressions for the hardened fork.
 *
 * Each block pins one of the advisories filed against upstream expr-eval:
 *   - GHSA-8gw3-rxh4-v6jx / CVE-2025-13204 (prototype pollution)
 *   - GHSA-jc85-fpwf-qm7x / CVE-2025-12735 (crafted variables object)
 *   - GHSA-q9v2-7m5w-4693 / CVE-2026-12866 (code execution via toJSFunction)
 */
/* global describe, it */

'use strict';

var assert = require('assert');
var Parser = require('../dist/bundle').Parser;
var validateScope = require('../dist/bundle').validateScope;

describe('security', function () {
  describe('parse-time unsafe-name ban (CVE-2025-13204)', function () {
    var parser = new Parser({ allowMemberAccess: false });

    it('rejects __proto__ as a variable name', function () {
      assert.throws(function () { parser.parse('__proto__'); }, /Unsafe variable name/);
    });

    it('rejects prototype as a variable name', function () {
      assert.throws(function () { parser.parse('prototype + 1'); }, /Unsafe variable name/);
    });

    it('rejects constructor as a variable name', function () {
      assert.throws(function () { parser.parse('constructor'); }, /Unsafe variable name/);
    });

    it('rejects unsafe names in assignments', function () {
      assert.throws(function () { parser.parse('__proto__.polluted = 1'); }, Error);
      assert.throws(function () { new Parser({ operators: { assignment: true } }).parse('constructor.x = 1'); }, Error);
    });

    it('rejects unsafe member names even when member access is enabled', function () {
      // 'constructor' is rejected either by the unsafe-name guard or by the
      // tokenizer itself depending on path — both are parse-time rejections.
      assert.throws(function () { new Parser({ allowMemberAccess: true }).parse('a.constructor'); }, Error);
      assert.throws(function () { new Parser({ allowMemberAccess: true }).parse('a.__proto__.x'); }, /Unsafe member name/);
    });

    it('rejects unsafe function-definition parameter names', function () {
      assert.throws(function () { new Parser().parse('f(__proto__) = 1'); }, Error);
    });

    it('leaves normal names untouched', function () {
      assert.strictEqual(parser.parse('x * 2 + 1').evaluate({ x: 4 }), 9);
    });
  });

  describe('scope gate at evaluate() (CVE-2025-12735)', function () {
    var parser = new Parser({ allowMemberAccess: false });

    it('rejects scope objects with an own __proto__ key', function () {
      var scope = Object.fromEntries([['__proto__', { polluted: true }], ['x', 1]]);
      assert.throws(function () { parser.parse('x + 1').evaluate(scope); }, /Unsafe scope key/);
    });

    it('rejects scope objects with own prototype/constructor keys', function () {
      assert.throws(function () { parser.parse('x + 1').evaluate({ x: 1, constructor: function () {} }); }, /Unsafe scope key/);
      assert.throws(function () { parser.parse('x + 1').evaluate({ x: 1, prototype: 2 }); }, /Unsafe scope key/);
    });

    it('does not mutate or pollute the global prototype', function () {
      assert.strictEqual(({}).polluted, undefined);
      assert.strictEqual(Object.prototype.polluted, undefined);
    });

    it('still supports function-valued scope entries (host application pattern)', function () {
      var expr = parser.parse('helper(x) + IF(x > 2, 10, 20)');
      var scope = {
        x: 4,
        helper: function (v) { return v * 2; },
        IF: function (c, a, b) { return c ? a : b; }
      };
      assert.strictEqual(expr.evaluate(scope), 18);
    });

    it('a repeated scope object validates once and keeps working', function () {
      var expr = parser.parse('x * 2');
      var scope = { x: 3 };
      for (var i = 0; i < 100; i++) assert.strictEqual(expr.evaluate(scope), 6);
    });

    it('exposes validateScope() for app-side pre-validation', function () {
      var scope = { x: 1 };
      validateScope(scope);
      assert.strictEqual(parser.parse('x + 1').evaluate(scope), 2);
      assert.throws(function () { validateScope(Object.fromEntries([['__proto__', 1]])); }, /Unsafe scope key/);
    });
  });

  describe('toJSFunction disabled (CVE-2026-12866)', function () {
    it('always throws, never generates code', function () {
      assert.throws(function () { new Parser().parse('x + 1').toJSFunction('x'); }, /disabled/);
    });
  });
});
