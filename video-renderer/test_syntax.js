const fs = require('fs');
const code = fs.readFileSync('server.js', 'utf8');
console.log('File length:', code.length);
console.log('Last 100 chars:', JSON.stringify(code.slice(-100)));
try {
  new Function(code);
  console.log('Syntax OK!');
} catch(e) {
  console.log('Syntax error:', e.message);
}
