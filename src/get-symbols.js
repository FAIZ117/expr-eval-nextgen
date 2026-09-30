import { IVAR, IMEMBER, IEXPR, IVARNAME, IFUNCALL, IOP1, IOP2, IOP3, IARRAY, IFUNDEF, IENDSTATEMENT } from './instruction';
import contains from './contains';

export default function getSymbols(tokens, symbols, options) {
  options = options || {};
  var withMembers = !!options.withMembers;
  var prevVar = null;

  // Callee positions (upstream issue #7): a call consumes its arguments and
  // the function name from the evaluation stack. Simulating that discipline
  // finds the callee exactly, including nested calls and member-chain
  // arguments where plain index arithmetic cannot. variables() excludes
  // those occurrences; symbols() keeps everything.
  var calleeIdx = options.excludeCallees ? findCallees(tokens) : null;

  for (var i = 0; i < tokens.length; i++) {
    var item = tokens[i];
    if (item.type === IVAR || item.type === IVARNAME) {
      if (calleeIdx !== null && i in calleeIdx) {
        // consumed as a function callee, not read as a variable
      } else if (!withMembers && !contains(symbols, item.value)) {
        symbols.push(item.value);
      } else if (prevVar !== null) {
        if (!contains(symbols, prevVar)) {
          symbols.push(prevVar);
        }
        prevVar = item.value;
      } else {
        prevVar = item.value;
      }
    } else if (item.type === IMEMBER && withMembers && prevVar !== null) {
      prevVar += '.' + item.value;
    } else if (item.type === IEXPR) {
      getSymbols(item.value, symbols, options);
    } else if (prevVar !== null) {
      if (!contains(symbols, prevVar)) {
        symbols.push(prevVar);
      }
      prevVar = null;
    }
  }

  if (prevVar !== null && !contains(symbols, prevVar)) {
    symbols.push(prevVar);
  }
}

/**
 * Indices of IVAR instructions consumed as function callees. Runs the
 * stream through the same stack discipline the evaluator uses: every
 * instruction type pops a known arity and pushes one result.
 */
function findCallees(tokens) {
  var callees = {};
  var stack = [];
  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    switch (t.type) {
      case IFUNCALL: {
        for (var a = 0; a < t.value; a++) stack.pop();
        var callee = stack.pop();
        if (callee !== undefined && tokens[callee].type === IVAR) {
          callees[callee] = true;
        }
        stack.push(i);
        break;
      }
      case IOP1:
      case IMEMBER:
        stack.pop();
        stack.push(i);
        break;
      case IOP2:
        stack.pop();
        stack.pop();
        stack.push(i);
        break;
      case IOP3:
        stack.pop();
        stack.pop();
        stack.pop();
        stack.push(i);
        break;
      case IARRAY:
        for (var n = 0; n < t.value; n++) stack.pop();
        stack.push(i);
        break;
      case IFUNDEF:
        stack.pop(); // body
        for (var d = 0; d < t.value; d++) stack.pop(); // parameters
        stack.pop(); // function name
        stack.push(i);
        break;
      case IENDSTATEMENT:
        stack.pop();
        break;
      default:
        // INUMBER, IVAR, IVARNAME, IEXPR, IEXPREVAL push a value
        stack.push(i);
    }
  }
  return callees;
}
