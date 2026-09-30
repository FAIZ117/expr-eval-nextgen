/* global describe, it */

'use strict';

var assert = require('assert');
var Parser = require('../dist/bundle').Parser;

describe('equality semantics (upstream #110) and null literal (#228)', function () {
  describe('default parser stays strict', function () {
    var parser = new Parser({ allowMemberAccess: false });

    it('"3" == 3 is false (unchanged default)', function () {
      assert.strictEqual(parser.parse('x == 3').evaluate({ x: '3' }), false);
      assert.strictEqual(parser.parse('x != 3').evaluate({ x: '3' }), true);
    });

    it('number == number works', function () {
      assert.strictEqual(parser.parse('x == 3').evaluate({ x: 3 }), true);
      assert.strictEqual(parser.parse('x == "3"').evaluate({ x: 3 }), false);
    });
  });

  describe('looseEquality option (Excel-style coercion)', function () {
    var parser = new Parser({ allowMemberAccess: false, looseEquality: true });

    it('numeric string equals number', function () {
      assert.strictEqual(parser.parse('x == 3').evaluate({ x: '3' }), true);
      assert.strictEqual(parser.parse('x != 3').evaluate({ x: '3' }), false);
      assert.strictEqual(parser.parse('3 == x').evaluate({ x: '3' }), true);
      assert.strictEqual(parser.parse('x == "3"').evaluate({ x: 3 }), true);
    });

    it('whitespace-padded numeric strings still coerce', function () {
      assert.strictEqual(parser.parse('x == 3').evaluate({ x: ' 3 ' }), true);
    });

    it('non-numeric string never equals a number', function () {
      assert.strictEqual(parser.parse('x == 3').evaluate({ x: 'abc' }), false);
      assert.strictEqual(parser.parse('x != 3').evaluate({ x: 'abc' }), true);
      assert.strictEqual(parser.parse('x == 3').evaluate({ x: '' }), false);
    });

    it('string-to-string stays strict', function () {
      assert.strictEqual(parser.parse('a == b').evaluate({ a: '3', b: '3' }), true);
      assert.strictEqual(parser.parse('a == b').evaluate({ a: '3.0', b: '3' }), false);
      assert.strictEqual(parser.parse('a == b').evaluate({ a: 'x', b: 'y' }), false);
    });

    it('numbers compare exactly as before', function () {
      assert.strictEqual(parser.parse('0.1 + 0.2 == 0.3').evaluate({}), false);
    });

    it('mixes with the rest of the language', function () {
      assert.strictEqual(
        parser.parse('IF(x == 13, 1, 2)').evaluate({ IF: function (c, a, b) { return c ? a : b; }, x: '13' }),
        1
      );
    });

    it('works through the closure compiler after parse caching', function () {
      var expr = parser.parse('x == 13');
      assert.strictEqual(expr.evaluate({ x: '13' }), true);
      assert.strictEqual(expr.evaluate({ x: 13 }), true);
      assert.strictEqual(expr.evaluate({ x: 12 }), false);
      assert.strictEqual(expr.evaluate({ x: 'nope' }), false);
    });
  });

  describe('equalityEpsilon option (upstream #10)', function () {
    var parser = new Parser({ allowMemberAccess: false, equalityEpsilon: 1e-12 });

    it('float rounding no longer flips equality', function () {
      assert.strictEqual(parser.parse('0.1 + 0.2 == 0.3').evaluate({}), true);
      assert.strictEqual(parser.parse('0.1 + 0.2 != 0.3').evaluate({}), false);
    });

    it('real differences are preserved', function () {
      assert.strictEqual(parser.parse('1.0000000001 == 1').evaluate({}), false);
      assert.strictEqual(parser.parse('1.00000000000001 == 1').evaluate({}), true);
    });

    it('relative tolerance scales with magnitude', function () {
      assert.strictEqual(parser.parse('1000000000000000 == 1000000000000100').evaluate({}), true);
      var tight = new Parser({ allowMemberAccess: false, equalityEpsilon: 1e-15 });
      assert.strictEqual(tight.parse('1000000000000000 == 1000000000000100').evaluate({}), false);
    });

    it('tiny non-zero values do not equal zero (relative semantics)', function () {
      assert.strictEqual(parser.parse('x == 0').evaluate({ x: 1e-14 }), false);
      assert.strictEqual(parser.parse('0 == 0').evaluate({}), true);
    });

    it('NaN and strings unaffected', function () {
      assert.strictEqual(parser.parse('0/0 == 0/0').evaluate({}), false);
      assert.strictEqual(parser.parse('a == b').evaluate({ a: 'x', b: 'x' }), true);
    });

    it('composes with looseEquality (coerce, then tolerate)', function () {
      var both = new Parser({ allowMemberAccess: false, looseEquality: true, equalityEpsilon: 1e-12 });
      assert.strictEqual(both.parse('x == 0.3').evaluate({ x: '0.30000000000000004' }), true);
      assert.strictEqual(both.parse('x == 0.3').evaluate({ x: '0.31' }), false);
    });

    it('without the option, equality stays exact', function () {
      var off = new Parser({ allowMemberAccess: false, looseEquality: true });
      assert.strictEqual(off.parse('0.1 + 0.2 == 0.3').evaluate({}), false);
    });
  });

  describe('null literal (upstream #228)', function () {
    var parser = new Parser({ allowMemberAccess: false });

    it('bare null evaluates to null, not 0', function () {
      assert.strictEqual(parser.parse('null').evaluate({}), null);
    });

    it('text != null with text=null is false', function () {
      assert.strictEqual(parser.parse('text != null').evaluate({ text: null }), false);
      assert.strictEqual(parser.parse('text == null').evaluate({ text: null }), true);
    });

    it('text != null with a value is true', function () {
      assert.strictEqual(parser.parse('text != null').evaluate({ text: 'a' }), true);
      assert.strictEqual(parser.parse('text != null').evaluate({ text: 0 }), true);
    });

    it('null flows through ternary and IF-style scopes', function () {
      var expr = parser.parse('v == null ? 0 : v');
      assert.strictEqual(expr.evaluate({ v: null }), 0);
      assert.strictEqual(expr.evaluate({ v: 42 }), 42);
    });

    it('default parser still rejects unknown variables', function () {
      assert.throws(function () { parser.parse('x + 1').evaluate({}); }, /undefined variable/);
    });
  });
});
