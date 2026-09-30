import simplify from './simplify';
import substitute from './substitute';
import evaluate from './evaluate';
import compile, { containsAssignment } from './compile';
import expressionToString from './expression-to-string';
import getSymbols from './get-symbols';

export function Expression(tokens, parser) {
  this.tokens = tokens;
  this.parser = parser;
  this.unaryOps = parser.unaryOps;
  this.binaryOps = parser.binaryOps;
  this.ternaryOps = parser.ternaryOps;
  this.functions = parser.functions;
}

Expression.prototype.simplify = function (values) {
  values = values || {};
  return new Expression(simplify(this.tokens, this.unaryOps, this.binaryOps, this.ternaryOps, values), this.parser);
};

Expression.prototype.substitute = function (variable, expr) {
  if (!(expr instanceof Expression)) {
    expr = this.parser.parse(String(expr));
  }

  return new Expression(substitute(this.tokens, variable, expr), this.parser);
};

const validatedScopes = new WeakMap();
const UNSAFE_SCOPE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/**
 * Reject scope objects carrying keys that participate in prototype-chain
 * attacks (CVE-2025-12735 vector). Runs once per unique scope object thanks
 * to the WeakMap gate; call it yourself at scope-construction time to skip
 * even that lookup on the evaluate() hot path.
 */
export function validateScope(values) {
  if (validatedScopes.get(values) === true) return;
  for (var k in values) {
    if (Object.prototype.hasOwnProperty.call(values, k) && UNSAFE_SCOPE_KEYS.has(k)) {
      throw new Error('Unsafe scope key: ' + k);
    }
  }
  validatedScopes.set(values, true);
}

Expression.prototype.evaluate = function (values) {
  values = values || {};
  validateScope(values);
  // Closure-compiled once per expression; simplify()/substitute() build new
  // Expression instances, so an instance-level cache never goes stale.
  if (!this._compiled) {
    this._compiled = compile(this.tokens, this);
  }
  // protectScope: expressions that write to their scope (=, inline function
  // definitions) run against a shallow clone, so assignments and function
  // registrations never leak into the caller's object. Read-your-writes still
  // works within the single evaluate() call; non-writing expressions pay nothing.
  if (this._protectsScope === undefined) {
    this._protectsScope = !!(this.parser.options.protectScope && containsAssignment(this.tokens));
  }
  return this._compiled(this._protectsScope ? shallowCloneScope(values) : values);
};

/**
 * Object.assign/spread hit V8's slow generic path on large mixed-shape scopes
 * (~16us for 100 keys); a plain keyed loop measures ~2us for the same object.
 * Keys are read fresh each call so callers that mutate the scope keep working.
 */
function shallowCloneScope(values) {
  var keys = Object.keys(values);
  var clone = {};
  for (var i = 0; i < keys.length; i++) {
    clone[keys[i]] = values[keys[i]];
  }
  return clone;
}

Expression.prototype.toString = function () {
  return expressionToString(this.tokens, false);
};

Expression.prototype.symbols = function (options) {
  options = options || {};
  var vars = [];
  getSymbols(this.tokens, vars, options);
  return vars;
};

Expression.prototype.variables = function (options) {
  options = options || {};
  options.excludeCallees = true;
  var vars = [];
  getSymbols(this.tokens, vars, options);
  var functions = this.functions;
  return vars.filter(function (name) {
    return !(name in functions);
  });
};

// Disabled in this hardened fork: compiling expressions with new Function()
// allowed crafted variables to execute arbitrary JavaScript (GHSA-q9v2-7m5w-4693 /
// CVE-2026-12866). Use evaluate() instead.
Expression.prototype.toJSFunction = function (param, variables) {
  throw new Error('toJSFunction() is disabled in this hardened fork (unsafe code generation, CVE-2026-12866). Use evaluate().');
};
