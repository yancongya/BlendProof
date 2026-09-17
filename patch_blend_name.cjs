const fs = require('fs');
const file = 'src/conversion/browserBlend.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  'fileName: file.name,',
  'fileName: file instanceof File ? file.name : "unknown.blend",'
);
content = content.replace(
  'fileSize: file.size,',
  'fileSize: file instanceof File ? file.size : file.byteLength,'
);

fs.writeFileSync(file, content);
