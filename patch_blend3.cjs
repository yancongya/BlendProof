const fs = require('fs');
const file = 'src/conversion/browserBlend.ts';
let content = fs.readFileSync(file, 'utf8');

// 强制转换以绕过 TS 错误
content = content.replace(
  'fileName: file instanceof File ? file.name : "unknown.blend",',
  'fileName: (file as any).name || "unknown.blend",'
);
content = content.replace(
  'fileSize: file instanceof File ? file.size : file.byteLength,',
  'fileSize: (file as any).size || (file as any).byteLength || 0,'
);

fs.writeFileSync(file, content);
