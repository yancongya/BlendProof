const fs = require('fs');
const file = 'src/conversion/browserBlend.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  'export async function convertBlendInBrowser(file: File): Promise<BrowserBlendResult> {',
  'export async function convertBlendInBrowser(file: File | ArrayBuffer): Promise<BrowserBlendResult> {'
);
content = content.replace(
  'const bytes = new Uint8Array(await file.arrayBuffer());',
  'const bytes = new Uint8Array(file instanceof ArrayBuffer ? file : await file.arrayBuffer());'
);

fs.writeFileSync(file, content);
