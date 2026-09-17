const fs = require('fs');
const file = 'src/api/blendProofClient.ts';
let content = fs.readFileSync(file, 'utf8');

const targetStr = `  async convertInBrowser(file: File): Promise<OwnerProject> {
    const result = await convertBlendInBrowser(file);
    const id = \`browser-\${crypto.randomUUID().replaceAll("-", "")}\`;
    const modelUrl = URL.createObjectURL(result.glb);
    const manifestUrl = URL.createObjectURL(new Blob([JSON.stringify(result.manifest)], { type: "application/json" }));
    return { id, name: file.name, modelUrl, manifestUrl, ownerCapability: \`browser-\${crypto.randomUUID()}\`, transport: "local", status: "ready" };
  }`;

const replacementStr = `  async convertInBrowser(file: File): Promise<OwnerProject> {
    const result = await new Promise<BrowserBlendResult>((resolve, reject) => {
      // Create Vite worker dynamically
      const worker = new Worker(new URL('../conversion/browserBlend.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        if (e.data.type === 'success') {
          resolve(e.data.result);
        } else {
          reject(new Error(e.data.error || "Web Worker 解析失败"));
        }
        worker.terminate();
      };
      worker.onerror = (err) => {
        reject(new Error("Worker error: " + err.message));
        worker.terminate();
      };
      worker.postMessage(file);
    });

    const id = \`browser-\${crypto.randomUUID().replaceAll("-", "")}\`;
    const modelUrl = URL.createObjectURL(result.glb);
    const manifestUrl = URL.createObjectURL(new Blob([JSON.stringify(result.manifest)], { type: "application/json" }));
    return { id, name: file.name, modelUrl, manifestUrl, ownerCapability: \`browser-\${crypto.randomUUID()}\`, transport: "local", status: "ready" };
  }`;

content = content.replace(targetStr, replacementStr);
fs.writeFileSync(file, content);
