/** Experimental browser-side .blend conversion for the small, static MVP scope.
 *  Runs in a Worker-friendly module and deliberately does not execute Blender
 *  Python, plugins, animation, or simulation data.
 */
import {
  evaluateAllMeshes,
  extractCameras,
  extractCollections,
  extractMaterials,
  extractObjects,
  extractScenes,
  parseBlend,
  type Material,
} from "jsblender";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Matrix4,
  Object3D,
  Color,
} from "three";

export type BrowserBlendResult = {
  glb: Blob;
  manifest: {
    scene: string;
    camera: string | null;
    cameras: Array<{ name: string; projection: string }>;
    objects: Array<{ name: string; type: string; collections: string[] }>;
    collections: string[];
    materials: string[];
    export: { sourceBytes: number; glbBytes: number; objectCount: number };
  };
};

const objectType = (type: number) => ({ 1: "MESH", 10: "LIGHT", 11: "CAMERA", 25: "ARMATURE" } as Record<number, string>)[type] ?? "OTHER";

/** Converts the supported static subset without sending the source file anywhere. */
export async function convertBlendInBrowser(file: File | ArrayBuffer): Promise<BrowserBlendResult> {
  const isBuffer = file instanceof ArrayBuffer;
  const bytes = new Uint8Array(isBuffer ? file : await file.arrayBuffer());
  // Worker 路径只传 ArrayBuffer，拿不到文件名与体积，退回占位名与缓冲区长度。
  const fileName = isBuffer ? "scene.blend" : file.name;
  const sourceBytes = isBuffer ? file.byteLength : file.size;
  const blend = parseBlend(bytes);
  const scenes = extractScenes(blend);
  const objects = extractObjects(blend);
  const collections = extractCollections(blend);
  const materials = extractMaterials(blend);
  const cameras = extractCameras(blend);
  const meshes = evaluateAllMeshes(blend);
  const root = new Group();
  // Blender stores scenes Z-up, while glTF/Three.js scenes are Y-up. The
  // native Blender glTF exporter applies this basis change to vertex data;
  // apply the same conversion to browser-converted scenes so both paths show
  // the model with the same orientation.
  root.rotation.x = -Math.PI / 2;
  const material = (materials[0] ? toMaterial(materials[0]) : new MeshStandardMaterial({ color: 0xb8bec4 }));

  let meshCount = 0;
  for (const object of objects) {
    if (object.type !== 1) continue;
    const source = meshes.get(object.name);
    if (!source) continue;
    meshCount += 1;
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(source.vertices, 3));
    if (source.vertexNormals?.length) geometry.setAttribute("normal", new BufferAttribute(source.vertexNormals, 3));
    if (source.uvMaps && Object.keys(source.uvMaps).length) geometry.setAttribute("uv", new BufferAttribute(source.uvMaps[Object.keys(source.uvMaps)[0]]!, 2));
    geometry.setIndex(new BufferAttribute(source.triangles, 1));
    if (!source.vertexNormals?.length) geometry.computeVertexNormals();
    const mesh = new Mesh(geometry, material.clone());
    mesh.name = object.name;
    // jsblender's composed transform uses the same column-major layout as
    // Three.js Matrix4 (despite the package's older README wording).
    mesh.matrix.copy(new Matrix4().fromArray(object.worldMatrix));
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
  }

  // 没有任何网格时不要返回「成功的空模型」：调用方需要靠这个失败回退本机 Blender，
  // 静默产出空 GLB 会让用户以为文件只有一个空场景。
  if (meshCount === 0) {
    throw new Error("浏览器转换不支持该文件：没有可导出的网格对象。");
  }

  const glb = await new Promise<Blob>((resolve, reject) => new GLTFExporter().parse(root, (result) => resolve(new Blob([result as ArrayBuffer], { type: "model/gltf-binary" })), reject, { binary: true }));
  const activeScene = scenes[0];
  return {
    glb,
    manifest: {
      scene: activeScene?.name ?? fileName.replace(/\.blend$/i, ""),
      camera: activeScene?.cameraObject ?? null,
      cameras: cameras.map((camera) => ({ name: camera.name, projection: camera.type })),
      objects: objects.map((object) => ({ name: object.name, type: objectType(object.type), collections: [] })),
      collections: collections.map((collection) => collection.name),
      materials: materials.map((entry) => entry.name),
      export: { sourceBytes, glbBytes: glb.size, objectCount: objects.length },
    },
  };
}

function toMaterial(source: Material) {
  const shader = source.shader?.principled;
  const rgb = shader?.baseColor ?? source.diffuse;
  const color = new Color(rgb[0], rgb[1], rgb[2]);
  return new MeshStandardMaterial({
    color,
    metalness: shader?.metallic ?? source.metallic,
    roughness: shader?.roughness ?? source.roughness,
    transparent: (shader?.alpha ?? source.diffuse[3]) < 1,
    opacity: shader?.alpha ?? source.diffuse[3],
  });
}

export function disposeBrowserBlendResult(result: BrowserBlendResult) {
  result.glb = new Blob();
}
