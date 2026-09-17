const fs = require('fs');
const file = 'src/workspace/BlenderWorkspace.tsx';
let content = fs.readFileSync(file, 'utf8');

const targetMain = `<div className="blender-main">`;
const replaceMain = `<div className="blender-main" style={{ gridTemplateColumns: \`minmax(0, 1fr) \${rightPanelVisible ? rightPanelWidth : 0}px\` }}>`;

content = content.replace(targetMain, replaceMain);

const targetAside = `<aside className="right-editors">`;
const replaceAside = `<aside className="right-editors" style={{ position: 'relative' }}>
          <div 
            className="panel-resizer" 
            onPointerDown={startResizing}
            style={{
              position: "absolute",
              left: -4,
              top: 0,
              bottom: 0,
              width: 8,
              cursor: "ew-resize",
              zIndex: 10
            }}
          />`;

content = content.replace(targetAside, replaceAside);

const targetControls = `<div className="icon-group camera-group" aria-label="镜头预设">`;
const replaceControls = `<div className="icon-group" aria-label="面板控制">
                  <button
                    title="显示/隐藏侧边栏"
                    onClick={() => setRightPanelVisible(v => !v)}
                  >
                    {rightPanelVisible ? <PanelRightClose /> : <PanelRightOpen />}
                  </button>
                </div>
                <div className="icon-group camera-group" aria-label="镜头预设">`;

content = content.replace(targetControls, replaceControls);

fs.writeFileSync(file, content);
