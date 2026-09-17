const fs = require('fs');
const file = 'src/workspace/BlenderWorkspace.tsx';
let content = fs.readFileSync(file, 'utf8');

const targetStr = `  const [outlinerHeight, setOutlinerHeight] = useState(280);`;
const replacementStr = `  const [rightPanelWidth, setRightPanelWidth] = useState(282);
  const [rightPanelVisible, setRightPanelVisible] = useState(true);

  const startResizing = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = rightPanelWidth;
    const onPointerMove = (moveEvent) => {
      const delta = startX - moveEvent.clientX;
      let newWidth = startWidth + delta;
      if (newWidth < 180) newWidth = 180;
      if (newWidth > 800) newWidth = 800;
      setRightPanelWidth(newWidth);
    };
    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }, [rightPanelWidth]);

  const [outlinerHeight, setOutlinerHeight] = useState(280);`;

content = content.replace(targetStr, replacementStr);
fs.writeFileSync(file, content);
