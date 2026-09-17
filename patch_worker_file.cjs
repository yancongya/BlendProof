const fs = require('fs');
const file = 'src/conversion/browserBlend.worker.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  'self.onmessage = async (event: MessageEvent<File>) => {',
  'self.onmessage = async (event: MessageEvent<File | ArrayBuffer>) => {'
);

fs.writeFileSync(file, content);
