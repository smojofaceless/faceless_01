const fs = require('fs');
const code = fs.readFileSync('server.js', 'utf8');

// Track opening/closing pairs with context
let depth = 0;
let maxDepthInfo = { depth: 0, line: 0, context: '' };
let unclosed = [];

const lines = code.split('\n');
for (let lineNum = 0; lineNum < lines.length; lineNum++) {
  const line = lines[lineNum];
  
  // Skip string literals and comments (simple heuristic)
  let inString = false;
  let stringChar = '';
  let escaped = false;
  
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const prev = i > 0 ? line[i-1] : '';
    
    // Handle escapes
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    
    // Handle strings
    if (!inString && (ch === '"' || ch === "'" || ch === '`')) {
      inString = true;
      stringChar = ch;
      continue;
    }
    if (inString && ch === stringChar) {
      inString = false;
      continue;
    }
    if (inString) continue;
    
    // Handle single-line comments
    if (ch === '/' && line[i+1] === '/') break;
    
    // Track braces
    if (ch === '{') {
      depth++;
      unclosed.push({ type: '{', line: lineNum + 1, context: line.trim().substring(0, 60) });
      if (depth > maxDepthInfo.depth) {
        maxDepthInfo = { depth, line: lineNum + 1, context: line.trim().substring(0, 40) };
      }
    }
    if (ch === '}') {
      depth--;
      if (unclosed.length > 0) unclosed.pop();
    }
  }
}

console.log('Final brace depth:', depth);
console.log('Max depth:', maxDepthInfo.depth, 'at line', maxDepthInfo.line, ':', maxDepthInfo.context);

if (depth !== 0) {
  console.log('\nUnclosed blocks (last 10):');
  unclosed.slice(-10).forEach(u => {
    console.log(`  Line ${u.line}: ${u.context}`);
  });
}

// Also check parentheses
let parenDepth = 0;
for (const line of lines) {
  for (const ch of line) {
    if (ch === '(') parenDepth++;
    if (ch === ')') parenDepth--;
  }
}
console.log('\nFinal paren depth:', parenDepth);
