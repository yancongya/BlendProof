/**
 * 视图域纯逻辑单测。
 *
 * 这些模块在 4.3 拆分中从 1400 行的 BlenderWorkspace / 500 行的 Model 里抽出来，
 * 抽出的意义就是它们终于可以脱离浏览器被验证 —— 之前只能靠点鼠标冒烟。
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BoxGeometry, Group, Mesh, Object3D, PerspectiveCamera, Vector3 } from "three";
import {
  collectIsolationHierarchy,
  collectSelectedInScene,
  hasRenderableMesh,
} from "../src/features/viewer/modelIsolation";
import { belongsToAnySelected, objectIdentity, selectableAncestorName } from "../src/features/viewer/modelPicking";
import { cameraStateFromCamera, surfaceHitFromEvent } from "../src/features/viewer/modelInteraction";
import { frameScene } from "../src/features/viewer/cameraPresets";

/** 造一棵 scene → group → mesh 的树，名字走 userData（与 Blender 导出路径一致）。 */
function buildScene() {
  const scene = new Group();
  scene.name = "Scene";
  const group = new Group();
  group.name = "Collection";
  const mesh = new Mesh();
  mesh.userData = { name: "Cube" };
  group.add(mesh);
  const other = new Mesh();
  other.userData = { name: "Sphere" };
  scene.add(group, other);
  return { scene, group, mesh, other };
}

describe("viewer/modelPicking", () => {
  test("objectIdentity 优先用 userData.name，回退到 name", () => {
    const mesh = new Mesh();
    mesh.name = "fromObjectName";
    assert.equal(objectIdentity(mesh), "fromObjectName");
    mesh.userData = { name: "fromUserData" };
    assert.equal(objectIdentity(mesh), "fromUserData");
    // 空字符串视为未设置，否则 outliner 里会出现无名行
    mesh.userData = { name: "" };
    assert.equal(objectIdentity(mesh), "fromObjectName");
  });

  test("selectableAncestorName 向上找到第一个可选中祖先", () => {
    const { scene, group, mesh } = buildScene();
    const selectable = new Set(["Collection"]);
    assert.equal(selectableAncestorName(mesh, selectable), "Collection");
    assert.equal(selectableAncestorName(group, selectable), "Collection");
    assert.equal(selectableAncestorName(scene, selectable), null);
    // 自身可选中时直接返回自身，不应跳到父级
    assert.equal(selectableAncestorName(mesh, new Set(["Cube"])), "Cube");
  });

  test("belongsToAnySelected 沿父链判定", () => {
    const { mesh, other } = buildScene();
    assert.equal(belongsToAnySelected(mesh, new Set(["Collection"])), true);
    assert.equal(belongsToAnySelected(mesh, new Set(["Sphere"])), false);
    assert.equal(belongsToAnySelected(other, new Set(["Sphere"])), true);
  });
});

describe("viewer/modelIsolation", () => {
  test("独显集合同时包含选中节点子树与其父链", () => {
    const { scene, group, mesh } = buildScene();
    const selected = new Set(["Cube"]);
    const inScene = collectSelectedInScene(scene, selected);
    assert.deepEqual([...inScene], ["Cube"]);

    const nodes = collectIsolationHierarchy(scene, selected, inScene);
    // 子树：mesh 自身
    assert.ok(nodes.has(mesh));
    // 父链：group 与 scene 必须保留，否则 mesh 再可见也画不出来
    assert.ok(nodes.has(group));
    assert.ok(nodes.has(scene));
    // 未被选中的兄弟节点不应进入集合
    assert.equal(nodes.has(scene.children[1]), false);
    assert.equal(hasRenderableMesh(nodes), true);
  });

  test("无选中项时集合为空，且不会被误判为可渲染", () => {
    const { scene } = buildScene();
    const nodes = collectIsolationHierarchy(scene, new Set(), new Set());
    assert.equal(nodes.size, 0);
    assert.equal(hasRenderableMesh(nodes), false);
  });

  test("过期的 outliner 名字不会产生可渲染的独显结果", () => {
    const { scene } = buildScene();
    // 模型被替换后，旧名字仍在 outliner 里但场景中已不存在
    const stale = new Set(["DeletedObject"]);
    const inScene = collectSelectedInScene(scene, stale);
    assert.equal(inScene.size, 0);
    // 这正是 hasRenderableMesh 兜底要拦的情况：不能让视口变空
    assert.equal(hasRenderableMesh(collectIsolationHierarchy(scene, stale, inScene)), false);
  });
});

describe("viewer/modelInteraction", () => {
  const resolveToCube = (node: Object3D | null) => node;

  test("法线朝向相机：背面的法线会被翻转", () => {
    const camera = new PerspectiveCamera();
    camera.position.set(0, 0, 5);
    const hit = surfaceHitFromEvent(
      {
        point: new Vector3(0, 0, 0),
        // 指向相机反方向的法线，必须被翻转为朝向相机
        face: { normal: new Vector3(0, 0, -1) },
        object: new Object3D(),
      },
      camera,
      resolveToCube,
    );
    assert.ok(hit);
    assert.ok(hit!.normal[2] > 0, "法线应朝向相机一侧，否则落点提示会埋进模型里");
  });

  test("没有面法线时用「命中点指向相机」兜底", () => {
    const camera = new PerspectiveCamera();
    camera.position.set(0, 0, 5);
    const hit = surfaceHitFromEvent(
      { point: new Vector3(0, 0, 0), object: new Object3D() },
      camera,
      resolveToCube,
    );
    assert.ok(hit);
    assert.ok(hit!.normal[2] > 0);
  });

  test("缺少命中点或无法解析节点时给出明确结果", () => {
    const camera = new PerspectiveCamera();
    assert.equal(surfaceHitFromEvent({ object: new Object3D() }, camera, resolveToCube), null);
    const orphan = surfaceHitFromEvent(
      { point: new Vector3(1, 2, 3), object: new Object3D() },
      camera,
      () => null,
    );
    assert.equal(orphan?.objectName, null);
    assert.deepEqual(orphan?.position, [1, 2, 3]);
  });

  test("相机快照区分透视与正交，并保留导航目标", () => {
    const perspective = new PerspectiveCamera(45, 1, 0.1, 100);
    perspective.position.set(1, 2, 3);
    const snapshot = cameraStateFromCamera(perspective, [0, 0, 0]);
    assert.equal(snapshot.projection, "perspective");
    assert.deepEqual(snapshot.position, [1, 2, 3]);
    assert.deepEqual(snapshot.target, [0, 0, 0]);
    assert.equal(snapshot.fov, 45);
  });
});

describe("viewer/cameraPresets", () => {
  test("取景距离随模型尺寸缩放，而非固定值", () => {
    // 必须有真实几何体：空 Mesh 的包围盒为空，会落到同一个兜底视距，
    // 那样测的就不是「随尺寸缩放」了。
    const near = frameScene(new Mesh(new BoxGeometry(1, 1, 1)), "perspective").position;
    const far = frameScene(new Mesh(new BoxGeometry(10, 10, 10)), "perspective").position;
    const distance = (p: [number, number, number]) => Math.hypot(p[0], p[1], p[2]);
    assert.ok(
      distance(far) > distance(near),
      "大模型必须比小模型退得更远，否则会糊在镜头上",
    );
  });

  test("空场景回退到固定视距，不会算出 NaN", () => {
    const { position } = frameScene(null, "front");
    assert.ok(position.every((value) => Number.isFinite(value)));
  });

  test("各预置机位落在预期的轴上", () => {
    const { position } = frameScene(null, "top");
    // 顶视图：水平面内不偏移，只在 Z 轴（Blender 的上下方向）拉开距离
    assert.equal(position[0], 0);
    assert.equal(position[1], 0);
    assert.notEqual(position[2], 0);
  });
});
