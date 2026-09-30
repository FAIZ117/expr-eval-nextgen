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
 */
export default function compile(tokens, expr) {
  return compileSequence(tokens, expr);
}

function compileSequence(tokens, expr) {
  var stack = []; // closures (values) => value, in RPN order
  var discarded = []; // statement results dropped by IENDSTATEMENT (side effects still run)

  for (var i = 0; i < tokens.length; i++) {
    var item = tokens[i];
    switch (item.type) {
      case INUMBER:
      case IVARNAME:
        stack.push(literal(item.value));
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
          stack.push((function (a, b, c) {
            return function (values) {
              return a(values) ? b(values) : c(values);
            };
          })(a, b, c));
        } else {
          var f = expr.ternaryOps[item.value];
          stack.push((function (a, b, c, f) {
            return function (values) {
              return f(a(values), b(values), c(values));
            };
          })(a, b, c, f));
        }
        break;
      }

      case IOP1: {
        var a1 = stack.pop();
        var op = expr.unaryOps[item.value];
        stack.push((function (a, op) {
          return function (values) {
            return op(a(values));
          };
        })(a1, op));
        break;
      }

      case IFUNCALL:
        compileFuncall(item.value, stack);
        break;

      case IFUNDEF: {
        var body = stack.pop();
        var paramCount = item.value;
        var params = [];
        while (paramCount-- > 0) {
          params.unshift(stack.pop()({}));
        }
        var fnName = stack.pop()({});
        stack.push((function (body, params, fnName) {
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
        })(body, params, fnName));
        break;
      }

      case IEXPR:
        stack.push(compileSequence(item.value, expr));
        break;

      case IEXPREVAL:
        stack.push((function (evaluator) {
          return function (values) {
            return evaluator.value(values);
          };
        })(item));
        break;

      case IMEMBER: {
        var target = stack.pop();
        var memberName = item.value;
        stack.push((function (target, memberName) {
          return function (values) {
            return target(values)[memberName];
          };
        })(target, memberName));
        break;
      }

      case IENDSTATEMENT:
        // Original pops the value but has already run the instructions:
        // keep the closure for its side effects, drop its result.
        discarded.push(stack.pop());
        break;

      case IARRAY: {
        var n = item.value;
        var elems = [];
        while (n-- > 0) {
          elems.unshift(stack.pop());
        }
        stack.push((function (elems) {
          return function (values) {
            var arr = new Array(elems.length);
            for (var j = 0; j < elems.length; j++) {
              arr[j] = elems[j](values);
            }
            return arr;
          };
        })(elems));
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
    return function (values) {
      for (var j = 0; j < pending.length; j++) pending[j](values);
      return undefined;
    };
  }
  return function (values) {
    for (var j = 0; j < pending.length; j++) pending[j](values);
    var result = top(values);
    // Explicitly return zero to avoid test issues caused by -0
    return result === 0 ? 0 : result;
  };
}

function literal(value) {
  return function () {
    return value;
  };
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
    return (function (name) {
      return function (values) {
        var v = values[name];
        if (v !== undefined) return v;
        throw new Error('undefined variable: ' + name);
      };
    })(name);
  }
  return (function (name, functions, unaryOps, parser) {
    return function (values) {
      if (name in functions) return functions[name];
      if (name in unaryOps && parser.isOperatorEnabled(name)) return unaryOps[name];
      var v = values[name];
      if (v !== undefined) return v;
      throw new Error('undefined variable: ' + name);
    };
  })(name, expr.functions, expr.unaryOps, expr.parser);
}

function compileOp2(op, stack, expr) {
  var b = stack.pop();
  var a = stack.pop();
  if (op === 'and') {
    stack.push((function (a, b) {
      return function (values) {
        return a(values) ? !!b(values) : false;
      };
    })(a, b));
  } else if (op === 'or') {
    stack.push((function (a, b) {
      return function (values) {
        return a(values) ? true : !!b(values);
      };
    })(a, b));
  } else if (op === '=') {
    var setVar = expr.binaryOps['='];
    stack.push((function (a, b, setVar) {
      return function (values) {
        return setVar(a(values), b(values), values);
      };
    })(a, b, setVar));
  } else {
    var f = expr.binaryOps[op];
    stack.push((function (a, b, f) {
      return function (values) {
        return f(a(values), b(values));
      };
    })(a, b, f));
  }
}

function compileFuncall(argCount, stack) {
  var args = [];
  for (var k = 0; k < argCount; k++) {
    args.unshift(stack.pop());
  }
  var fc = stack.pop();
  switch (argCount) {
    case 0:
      stack.push((function (fc) {
        return function (values) {
          var f = fc(values);
          if (f.apply && f.call) return f();
          throw new Error(f + ' is not a function');
        };
      })(fc));
      break;
    case 1:
      stack.push((function (fc, a) {
        return function (values) {
          var f = fc(values);
          if (f.apply && f.call) return f(a(values));
          throw new Error(f + ' is not a function');
        };
      })(fc, args[0]));
      break;
    case 2:
      stack.push((function (fc, a, b) {
        return function (values) {
          var f = fc(values);
          if (f.apply && f.call) return f(a(values), b(values));
          throw new Error(f + ' is not a function');
        };
      })(fc, args[0], args[1]));
      break;
    case 3:
      stack.push((function (fc, a, b, c) {
        return function (values) {
          var f = fc(values);
          if (f.apply && f.call) return f(a(values), b(values), c(values));
          throw new Error(f + ' is not a function');
        };
      })(fc, args[0], args[1], args[2]));
      break;
    default:
      stack.push((function (fc, args) {
        return function (values) {
          var f = fc(values);
          if (f.apply && f.call) {
            var argv = new Array(args.length);
            for (var j = 0; j < args.length; j++) argv[j] = args[j](values);
            return f.apply(undefined, argv);
          }
          throw new Error(f + ' is not a function');
        };
      })(fc, args));
  }
}
