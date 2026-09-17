const fs = require('fs');
const file = 'src/workspace/BlenderWorkspace.tsx';
let content = fs.readFileSync(file, 'utf8');

const targetAside2 = `<aside className="right-editors" style={{ position: 'relative' }}>`;
const replaceAside2 = `{rightPanelVisible && (
        <aside className="right-editors" style={{ position: 'relative', overflow: 'hidden' }}>`;

content = content.replace(targetAside2, replaceAside2);

const targetAsideEnd = `</aside>
      </div>`;
const replaceAsideEnd = `</aside>
        )}
      </div>`;

content = content.replace(targetAsideEnd, replaceAsideEnd);

fs.writeFileSync(file, content);
