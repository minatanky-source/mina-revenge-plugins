const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = __dirname;
const wrap = name => '(function(){const module={exports:{}};\n' + fs.readFileSync(path.join(root, 'src', name + '.js'), 'utf8') + '\nreturn module.exports;})()';
const bundle = '(()=>{\nconst core=' + wrap('core') + ';\nreturn ' + wrap('plugin') + ';\n})()';
fs.writeFileSync(path.join(root, 'index.js'), bundle);
fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ name: 'Mina Translator', description: 'Tradução automática de entrada e saída com Gemini e app offline opcional.', authors: [{ name: 'Mina' }], main: 'index.js', version: '0.1.0', hash: crypto.createHash('sha256').update(bundle).digest('hex'), vendetta: { icon: 'LanguageIcon' } }, null, 2) + '\n');
console.log('Plugin compilado sem dependências externas.');
