const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const dir = 'C:\\Users\\Administrator\\.gemini\\antigravity\\scratch\\qyona-finance-gas';
const preview = fs.readFileSync(path.join(dir, 'Preview_Standalone.html'), 'utf8');
const stylesheet = fs.readFileSync(path.join(dir, 'Stylesheet.html'), 'utf8');
const javascript = fs.readFileSync(path.join(dir, 'JavaScript.html'), 'utf8');

// The GAS template has include('Stylesheet') and include('JavaScript')
const gasTemplate = preview
  .replace(stylesheet, "<?!= include('Stylesheet'); ?>")
  .replace(javascript, "<?!= include('JavaScript'); ?>");

// Write Index.html (GAS template)
fs.writeFileSync(path.join(dir, 'Index.html'), gasTemplate, 'utf8');
console.log('Index.html written as GAS template. Length:', gasTemplate.length);

// Compute git hash-object for both
const gasHash = cp.execSync(`git hash-object -w "${path.join(dir, 'Index.html')}"`, { cwd: dir }).toString().trim();
const pwaHash = cp.execSync(`git hash-object -w "${path.join(dir, 'Preview_Standalone.html')}"`, { cwd: dir }).toString().trim();

console.log('GAS Index hash:', gasHash);
console.log('PWA index hash:', pwaHash);

// Stage all regular files
cp.execSync('git add Stylesheet.html JavaScript.html Preview_Standalone.html sw.js manifest.json appsscript.json build_bundle.js', { cwd: dir });

// Explicitly register both Index.html and index.html in git index
cp.execSync(`git update-index --add --cacheinfo 100644 ${gasHash} Index.html`, { cwd: dir });
cp.execSync(`git update-index --add --cacheinfo 100644 ${pwaHash} index.html`, { cwd: dir });

console.log('Git index successfully configured with dual index!');
