const fs = require('fs');
const file = 'src/conversion/browserBlend.ts';
let content = fs.readFileSync(file, 'utf8');

// The line is exactly this in the current file:
// fileName: file instanceof File ? file.name : "unknown.blend",
// fileSize: file instanceof File ? file.size : file.byteLength,

content = content.replace(
  'fileName: (file as any).name || "unknown.blend",',
  'fileName: (file as any).name || "unknown.blend",' // Just in case it matched before
);

content = content.replace(
  'fileName: file instanceof File ? file.name : "unknown.blend",',
  'fileName: (file as any).name || "unknown.blend",'
);

content = content.replace(
  'fileSize: file instanceof File ? file.size : file.byteLength,',
  'fileSize: (file as any).size || (file as any).byteLength || 0,'
);

fs.writeFileSync(file, content);
