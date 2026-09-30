import { INUMBER, IOP1, IOP2, IOP3, IVAR, IVARNAME, IFUNCALL, IFUNDEF, IEXPR, IEXPREVAL, IMEMBER, IENDSTATEMENT, IARRAY } from './instruction';

/**
 * Closure compiler: converts an Expression's RPN instruction stream into a
 * tree of nested closures, evaluated as plain function calls instead of a
 * stack machine. Compiled once per expression; every evaluate() afterwards
 * skips the dispatch switch, the value stack, and repeated hash lookups.
 *
 * Mirrors src/evaluate.js instruction-for-instruction, including the lazy
 * and/or and ternary branches, assignment side effects on the scope object,
 * inline function definitions, statement discards (side effects kept,
 * values dropped), and the -0 -> 0 normalization of the final result.
 *
 * Compile-time entries are tagged so hot consumers inline the common cases
 * instead of calling a sub-closure per operand:
 *   { tag: 'lit', v }    — literal, baked into the consumer (pure ops on two
 *                          literals fold to a single literal)
 *   { tag: 'var', name } — scope-only variable, compiled to a direct
 *                          values[name] read with the undefined check inline
 *   { tag: 'dyn', f }    — everything else, a (values) => value closure
 */
export default function compile(tokens, expr) {
  return compileSequence(tokens, expr);
}

function compileSequence(tokens, expr) {
  var stack = []; // tagged entries, in RPN order
  var discarded = []; // statement results dropped by IENDSTATEMENT (side effects still run)

  for (var i = 0; i < tokens.length; i++) {
    var item = tokens[i];
    switch (item.type) {
      case INUMBER:
      case IVARNAME:
        stack.push({ tag: 'lit', v: item.value });
        break;

      case IVAR:
        stack.push(compileVar(item.value, expr));
        break;

      case IOP2:
        compileOp2(item.value, stack, expr);
        break;

      case IOP3: {
        var c = stack.pop(), b = stack.pop(), a = stack.pop();
        if (item.value === '?') {
          stack.push(dyn((function (a, b, c) {
            return function (values) {
              return a(values) ? b(values) : c(values);
            };
          })(asDyn(a), asDyn(b), asDyn(c))));
        } else {
          var f = expr.ternaryOps[item.value];
          stack.push(dyn((function (a, b, c, f) {
            return function (values) {
              return f(a(values), b(values), c(values));
            };
          })(asDyn(a), asDyn(b), asDyn(c), f)));
        }
        break;
      }

      case IOP1: {
        var a1 = stack.pop();
        var op = expr.unaryOps[item.value];
        if (a1.tag === 'lit' && PURE_UNARY.has(item.value)) {
          stack.push({ tag: 'lit', v: op(a1.v) }); // constant fold
        } else if (a1.tag === 'var') {
          stack.push(dyn((function (name, op) {
            return function (values) {
              var v = values[name];
              if (v === undefined) throw new Error('undefined variable: ' + name);
              return op(v);
            };
          })(a1.name, op)));
        } else {
          var af = asDyn(a1);
          stack.push(dyn((function (a, op) {
            return function (values) {
              return op(a(values));
            };
          })(af, op)));
        }
        break;
      }

      case IFUNCALL:
        compileFuncall(item.value, stack);
        break;

      case IFUNDEF: {
        var body = asDyn(stack.pop());
        var paramCount = item.value;
        var params = [];
        while (paramCount-- > 0) {
          params.unshift(asDyn(stack.pop())({}));
        }
        var fnName = asDyn(stack.pop())({});
        stack.push(dyn((function (body, params, fnName) {
          return function (values) {
            var f = function () {
              var scope = Object.assign({}, values);
              for (var j = 0; j < params.length; j++) {
                scope[params[j]] = arguments[j];
              }
              return body(scope);
            };
            Object.defineProperty(f, 'name', {
              value: fnName,
              writable: false
            });
            values[fnName] = f;
            return f;
          };
        })(body, params, fnName)));
        break;
      }

      case IEXPR:
        stack.push(dyn(compileSequence(item.value, expr)));
        break;

      case IEXPREVAL:
        stack.push(dyn((function (evaluator) {
          return function (values) {
            return evaluator.value(values);
          };
        })(item)));
        break;

      case IMEMBER: {
        var target = stack.pop();
        var memberName = item.value;
        if (target.tag === 'var') {
          stack.push(dyn((function (name, memberName) {
            return function (values) {
              var v = values[name];
              if (v === undefined) throw new Error('undefined variable: ' + name);
              return v[memberName];
            };
          })(target.name, memberName)));
        } else {
          var tf = asDyn(target);
          stack.push(dyn((function (target, memberName) {
            return function (values) {
              return target(values)[memberName];
            };
          })(tf, memberName)));
        }
        break;
      }

      case IENDSTATEMENT:
        // Original pops the value but has already run the instructions:
        // keep the closure for its side effects, drop its result.
        discarded.push(asDyn(stack.pop()));
        break;

      case IARRAY: {
        var n = item.value;
        var elems = [];
        while (n-- > 0) {
          elems.unshift(asDyn(stack.pop()));
        }
        stack.push(dyn((function (elems) {
          return function (values) {
            var arr = new Array(elems.length);
            for (var j = 0; j < elems.length; j++) {
              arr[j] = elems[j](values);
            }
            return arr;
          };
        })(elems)));
        break;
      }

      default:
        throw new Error('invalid Expression');
    }
  }

  if (stack.length > 1) {
    return function () {
      throw new Error('invalid Expression (parity)');
    };
  }
  var top = stack.length === 1 ? stack[0] : null;
  var pending = discarded;
  if (top === null) {
    if (pending.length === 0) return function () { return undefined; };
    return function (values) {
      for (var j = 0; j < pending.length; j++) pending[j](values);
      return undefined;
    };
  }
  if (top.tag === 'lit') {
    var lit = top.v;
    if (pending.length === 0) {
      return function () {
        return lit === 0 ? 0 : lit;
      };
    }
    return function (values) {
      for (var j = 0; j < pending.length; j++) pending[j](values);
      return lit === 0 ? 0 : lit;
    };
  }
  var topFn = asDyn(top);
  if (pending.length === 0) {
    return (function (topFn) {
      return function (values) {
        // Explicitly return zero to avoid test issues caused by -0
        var result = topFn(values);
        return result === 0 ? 0 : result;
      };
    })(topFn);
  }
  return (function (topFn, pending) {
    return function (values) {
      for (var j = 0; j < pending.length; j++) pending[j](values);
      var result = topFn(values);
      return result === 0 ? 0 : result;
    };
  })(topFn, pending);
}

/** Pure-by-construction unary ops eligible for constant folding. */
var PURE_UNARY = new Set(['negate', 'factorial', 'not', 'abs', 'sqrt', 'sin', 'cos', 'tan', 'log', 'log10', 'log2', 'exp', 'ceil', 'floor', 'round']);

/** Pure-by-construction binary ops eligible for constant folding. */
var PURE_BINARY = new Set(['+', '-', '*', '/', '%', '^', '<', '<=', '>', '>=', '==', '!=', 'and', 'or']);

function dyn(f) {
  return { tag: 'dyn', f: f };
}

function asDyn(entry) {
  if (entry.tag === 'lit') {
    var v = entry.v;
    return function () {
      return v;
    };
  }
  if (entry.tag === 'var') {
    return (function (name) {
      return function (values) {
        var v = values[name];
        if (v !== undefined) return v;
        throw new Error('undefined variable: ' + name);
      };
    })(entry.name);
  }
  return entry.f;
}

/**
 * Variable resolution. Names that are provably neither a parser function nor
 * a unary operator at compile time get a scope-only fast path (this is where
 * host applications that pass their function library through the scope — the
 * pattern expr-eval-fork and safe-expr-eval break — get their win).
 */
function compileVar(name, expr) {
  var isFunction = name in expr.functions;
  var isOperator = name in expr.unaryOps && expr.parser.isOperatorEnabled(name);
  if (!isFunction && !isOperator) {
    return { tag: 'var', name: name };
  }
  return dyn((function (name, functions, unaryOps, parser) {
    return function (values) {
      if (name in functions) return functions[name];
      if (name in unaryOps && parser.isOperatorEnabled(name)) return unaryOps[name];
      var v = values[name];
      if (v !== undefined) return v;
      throw new Error('undefined variable: ' + name);
    };
  })(name, expr.functions, expr.unaryOps, expr.parser));
}

function undefinedVarError(name) {
  return new Error('undefined variable: ' + name);
}

function compileOp2(op, stack, expr) {
  var b = stack.pop();
  var a = stack.pop();

  if (op === 'and') {
    stack.push(dyn((function (a, b) {
      return function (values) {
        return a(values) ? !!b(values) : false;
      };
    })(asDyn(a), asDyn(b))));
    return;
  }
  if (op === 'or') {
    stack.push(dyn((function (a, b) {
      return function (values) {
        return a(values) ? true : !!b(values);
      };
    })(asDyn(a), asDyn(b))));
    return;
  }
  if (op === '=') {
    var setVar = expr.binaryOps['='];
    stack.push(dyn((function (a, b, setVar) {
      return function (values) {
        return setVar(a(values), b(values), values);
      };
    })(asDyn(a), asDyn(b), setVar)));
    return;
  }

  var f = expr.binaryOps[op];

  // Constant folding for pure ops over two literals.
  if (a.tag === 'lit' && b.tag === 'lit' && PURE_BINARY.has(op)) {
    stack.push({ tag: 'lit', v: f(a.v, b.v) });
    return;
  }

  // Inline the dominant operand shapes; everything else composes closures.
  if (a.tag === 'var' && b.tag === 'var') {
    stack.push(dyn((function (na, nb, f) {
      return function (values) {
        var va = values[na];
        if (va === undefined) throw undefinedVarError(na);
        var vb = values[nb];
        if (vb === undefined) throw undefinedVarError(nb);
        return f(va, vb);
      };
    })(a.name, b.name, f)));
    return;
  }
  if (a.tag === 'var' && b.tag === 'lit') {
    stack.push(dyn((function (na, vb, f) {
      return function (values) {
        var va = values[na];
        if (va === undefined) throw undefinedVarError(na);
        return f(va, vb);
      };
    })(a.name, b.v, f)));
    return;
  }
  if (a.tag === 'lit' && b.tag === 'var') {
    stack.push(dyn((function (va, nb, f) {
      return function (values) {
        var vb = values[nb];
        if (vb === undefined) throw undefinedVarError(nb);
        return f(va, vb);
      };
    })(a.v, b.name, f)));
    return;
  }
  if (a.tag === 'var') {
    stack.push(dyn((function (na, bf, f) {
      return function (values) {
        var va = values[na];
        if (va === undefined) throw undefinedVarError(na);
        return f(va, bf(values));
      };
    })(a.name, asDyn(b), f)));
    return;
  }
  if (b.tag === 'var') {
    stack.push(dyn((function (af, nb, f) {
      return function (values) {
        var vb = values[nb];
        if (vb === undefined) throw undefinedVarError(nb);
        return f(af(values), vb);
      };
    })(asDyn(a), b.name, f)));
    return;
  }
  stack.push(dyn((function (a, b, f) {
    return function (values) {
      return f(a(values), b(values));
    };
  })(asDyn(a), asDyn(b), f)));
}

/**
 * Function calls. The callee and every argument are inlined when they are
 * compile-time-known scope reads (the host-app pattern: fn(var, var)), and
 * the callable check is a single typeof instead of two property lookups.
 */
function compileFuncall(argCount, stack) {
  var args = [];
  for (var k = 0; k < argCount; k++) {
    args.unshift(stack.pop());
  }
  var fcEntry = stack.pop();

  var fcVar = fcEntry.tag === 'var' ? fcEntry.name : null;
  var fcFn = fcVar === null ? asDyn(fcEntry) : null;

  function notAFunction(f) {
    return new Error(f + ' is not a function');
  }

  if (argCount === 0) {
    if (fcVar !== null) {
      stack.push(dyn((function (name, notAFunction) {
        return function (values) {
          var f = values[name];
          if (f === undefined) throw undefinedVarError(name);
          if (typeof f !== 'function') throw notAFunction(f);
          return f();
        };
      })(fcVar, notAFunction)));
    } else {
      stack.push(dyn((function (fc, notAFunction) {
        return function (values) {
          var f = fc(values);
          if (typeof f !== 'function') throw notAFunction(f);
          return f();
        };
      })(fcFn, notAFunction)));
    }
    return;
  }

  // Inline shape: every argument is a scope read or a literal.
  var allInline = true;
  for (k = 0; k < argCount; k++) {
    if (args[k].tag === 'dyn') { allInline = false; break; }
  }

  if (allInline && argCount === 1) {
    var a0 = args[0];
    if (fcVar !== null) {
      if (a0.tag === 'var') {
        stack.push(dyn((function (nf, n0, notAFunction) {
          return function (values) {
            var f = values[nf];
            if (f === undefined) throw undefinedVarError(nf);
            if (typeof f !== 'function') throw notAFunction(f);
            var v0 = values[n0];
            if (v0 === undefined) throw undefinedVarError(n0);
            return f(v0);
          };
        })(fcVar, a0.name, notAFunction)));
      } else {
        stack.push(dyn((function (nf, v0, notAFunction) {
          return function (values) {
            var f = values[nf];
            if (f === undefined) throw undefinedVarError(nf);
            if (typeof f !== 'function') throw notAFunction(f);
            return f(v0);
          };
        })(fcVar, a0.v, notAFunction)));
      }
    } else {
      stack.push(dyn((function (fc, a, notAFunction) {
        return function (values) {
          var f = fc(values);
          if (typeof f !== 'function') throw notAFunction(f);
          return f(a(values));
        };
      })(fcFn, asDyn(a0), notAFunction)));
    }
    return;
  }

  if (allInline && argCount === 2) {
    var a1e = args[0], a2e = args[1];
    // Inline two scope reads; literals/dyn fall back to the generic path.
    if (fcVar !== null && a1e.tag === 'var' && a2e.tag === 'var') {
      stack.push(dyn((function (nf, n1, n2, notAFunction) {
        return function (values) {
          var f = values[nf];
          if (f === undefined) throw undefinedVarError(nf);
          if (typeof f !== 'function') throw notAFunction(f);
          var v1 = values[n1];
          if (v1 === undefined) throw undefinedVarError(n1);
          var v2 = values[n2];
          if (v2 === undefined) throw undefinedVarError(n2);
          return f(v1, v2);
        };
      })(fcVar, a1e.name, a2e.name, notAFunction)));
      return;
    }
  }

  // Generic path: inlined callee when known, closure per argument.
  var argFns = args.map(asDyn);
  if (fcVar !== null) {
    stack.push(dyn((function (nf, argFns, notAFunction) {
      return function (values) {
        var f = values[nf];
        if (f === undefined) throw undefinedVarError(nf);
        if (typeof f !== 'function') throw notAFunction(f);
        switch (argFns.length) {
          case 1: return f(argFns[0](values));
          case 2: return f(argFns[0](values), argFns[1](values));
          case 3: return f(argFns[0](values), argFns[1](values), argFns[2](values));
          default: {
            var argv = new Array(argFns.length);
            for (var j = 0; j < argFns.length; j++) argv[j] = argFns[j](values);
            return f.apply(undefined, argv);
          }
        }
      };
    })(fcVar, argFns, notAFunction)));
  } else {
    stack.push(dyn((function (fc, argFns, notAFunction) {
      return function (values) {
        var f = fc(values);
        if (typeof f !== 'function') throw notAFunction(f);
        switch (argFns.length) {
          case 1: return f(argFns[0](values));
          case 2: return f(argFns[0](values), argFns[1](values));
          case 3: return f(argFns[0](values), argFns[1](values), argFns[2](values));
          default: {
            var argv = new Array(argFns.length);
            for (var j = 0; j < argFns.length; j++) argv[j] = argFns[j](values);
            return f.apply(undefined, argv);
          }
        }
      };
    })(fcFn, argFns, notAFunction)));
  }
}
