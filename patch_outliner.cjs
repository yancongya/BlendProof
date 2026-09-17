const fs = require('fs');
const file = 'src/features/viewer/components/ObjectOutliner.tsx';
let content = fs.readFileSync(file, 'utf8');

const targetStr = `<div className="tree-children">
          {objects.map((object) => (
            <div
              className={\`tree-row \${selected.has(object.name) ? "selected" : ""}\`}
              key={object.name}`;

const replacementStr = `<div className="tree-children" ref={parentRef} style={{ overflowY: 'auto' }}>
          <div style={{ height: \`\${rowVirtualizer.getTotalSize()}px\`, width: '100%', position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map((virtualItem) => {
            const object = objects[virtualItem.index];
            return (
            <div
              className={\`tree-row \${selected.has(object.name) ? "selected" : ""}\`}
              key={virtualItem.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: \`\${virtualItem.size}px\`,
                transform: \`translateY(\${virtualItem.start}px)\`
              }}`;

content = content.replace(targetStr, replacementStr);

const endTargetStr = `              </button>
            </div>
          ))}
          {manifest && objects.length === 0 && (
            <p className="outliner-empty">{t("没有匹配对象")}</p>
          )}
        </div>`;

const endReplacementStr = `              </button>
            </div>
          );
          })}
          </div>
          {manifest && objects.length === 0 && (
            <p className="outliner-empty">{t("没有匹配对象")}</p>
          )}
        </div>`;

content = content.replace(endTargetStr, endReplacementStr);

fs.writeFileSync(file, content);
