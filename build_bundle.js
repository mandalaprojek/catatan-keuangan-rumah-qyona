const fs = require('fs');
const path = require('path');

const srcDir = 'C:\\Users\\Administrator\\.gemini\\antigravity\\scratch\\qyona-finance-gas';
const indexHtml = fs.readFileSync(path.join(srcDir, 'Index.html'), 'utf8');
const stylesheetHtml = fs.readFileSync(path.join(srcDir, 'Stylesheet.html'), 'utf8');
const javascriptHtml = fs.readFileSync(path.join(srcDir, 'JavaScript.html'), 'utf8');

// Replace GAS script include tags with inline contents
let standaloneHtml = indexHtml
  .replace(/<\?!=\s*include\('Stylesheet'\);\s*\?>/g, stylesheetHtml)
  .replace(/<\?!=\s*include\('JavaScript'\);\s*\?>/g, javascriptHtml);

// Write to Preview_Standalone.html and index.html
fs.writeFileSync(path.join(srcDir, 'Preview_Standalone.html'), standaloneHtml, 'utf8');
fs.writeFileSync(path.join(srcDir, 'index.html'), standaloneHtml, 'utf8');

console.log('Build completed! Wrote Preview_Standalone.html and index.html (Bytes: ' + standaloneHtml.length + ')');
