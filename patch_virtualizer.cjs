const fs = require('fs');
const file = 'src/features/viewer/components/ObjectOutliner.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  '<div className="panel-body">',
  '<div className="panel-body" style={{ display: "flex", flexDirection: "column" }}>'
);

content = content.replace(
  '<div className="tree-children" ref={parentRef} style={{ overflowY: \'auto\' }}>',
  '<div className="tree-children" ref={parentRef} style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>'
);

fs.writeFileSync(file, content);
