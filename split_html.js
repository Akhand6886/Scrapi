import fs from 'fs';
import path from 'path';

const indexPath = path.resolve('src/ui/index.html');
const appPath = path.resolve('src/ui/app.jsx');

let html = fs.readFileSync(indexPath, 'utf-8');

// The react code starts from `<script type="text/babel">` and ends at `</script>` just before `</body>`.
const startIdx = html.indexOf('<script type="text/babel">');
const endIdx = html.lastIndexOf('</script>', html.lastIndexOf('</body>'));

if (startIdx === -1 || endIdx === -1) {
  console.error('Could not find script bounds');
  process.exit(1);
}

const reactCode = html.substring(startIdx + '<script type="text/babel">'.length, endIdx).trim();

// Now replace that whole block in HTML with `<script src="/app.js"></script>`
// And also remove the babel CDN script tags
let newHtml = html.substring(0, startIdx) + '<script src="/app.js"></script>\n' + html.substring(endIdx + '</script>'.length);

newHtml = newHtml.replace('<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>', '');

fs.writeFileSync(appPath, reactCode);
fs.writeFileSync(indexPath, newHtml);

console.log('Successfully split index.html into index.html and app.jsx');
