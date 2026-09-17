const fs = require('fs');
const file = 'src/api/blendProofClient.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  'worker.postMessage(file);',
  'file.arrayBuffer().then(buf => worker.postMessage(buf));'
);

fs.writeFileSync(file, content);
