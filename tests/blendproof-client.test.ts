import assert from "node:assert/strict";
import { test } from "node:test";
import { LocalBridgePairing } from "../server/local-pairing.js";
import { BlendProofClient, LOCAL_BRIDGE_NONCE_HEADER } from "../src/api/blendProofClient.js";

function installSessionStorage() {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key) { return values.get(key) ?? null; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) { values.set(key, String(value)); },
  };
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: storage });
  return {
    storage,
    restore() {
      if (previous) Object.defineProperty(globalThis, "sessionStorage", previous);
      else delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
    },
  };
}

test("typed client sends existing local conversion and review calls to the local bridge", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const client = new BlendProofClient({
    bridgeOrigin: "http://127.0.0.1:8788",
    workerOrigin: "https://api.blendproof.test",
    bridgePairingCode: "test-pairing-code",
    fetchImplementation: async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith("/api/local/pair")) {
        return Response.json({
          nonce: "a".repeat(43),
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
          nextPairingCode: "next-test-pairing-code",
        }, { status: 201 });
      }
      if (url.endsWith("/api/local/convert")) {
        return Response.json({
          id: "project-1",
          name: "Local scene",
          modelUrl: "/api/local/projects/project-1/assets/model.glb",
          manifestUrl: "/api/local/projects/project-1/assets/manifest.json",
          ownerCapability: "owner-capability",
        });
      }
      return Response.json({
        id: "share-1",
        shareUrl: "https://app.blendproof.test/s/token",
        expiresAt: null,
        commentsPermission: "read_only",
      });
    },
  });

  const project = await client.convertLocal(new File(["blend bytes"], "source.blend"));
  await client.createShare(project.id, project.ownerCapability, { commentsPermission: "read_only" });
  await client.loadJson("http://127.0.0.1:8788/api/local/projects/project-1/assets/manifest.json");
  await client.fetchLocal("/api/local/projects/project-1/assets/model.glb");

  assert.equal(requests[0]?.url, "http://127.0.0.1:8788/api/local/pair");
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), { pairingCode: "test-pairing-code" });
  assert.equal(new Headers(requests[0]?.init?.headers).has(LOCAL_BRIDGE_NONCE_HEADER), false);
  assert.equal(requests[1]?.url, "http://127.0.0.1:8788/api/local/convert");
  assert.equal(requests[1]?.init?.method, "POST");
  assert.ok(requests[1]?.init?.body instanceof FormData);
  assert.equal(new Headers(requests[1]?.init?.headers).get(LOCAL_BRIDGE_NONCE_HEADER), "a".repeat(43));
  assert.equal(project.modelUrl, "http://127.0.0.1:8788/api/local/projects/project-1/assets/model.glb");
  assert.equal(project.manifestUrl, "http://127.0.0.1:8788/api/local/projects/project-1/assets/manifest.json");
  assert.equal(requests[2]?.url, "http://127.0.0.1:8788/api/local/projects/project-1/shares");
  const shareHeaders = new Headers(requests[2]?.init?.headers);
  assert.equal(shareHeaders.get("content-type"), "application/json");
  assert.equal(shareHeaders.get("x-blendproof-owner"), "owner-capability");
  assert.equal(shareHeaders.get(LOCAL_BRIDGE_NONCE_HEADER), "a".repeat(43));
  assert.equal(new Headers(requests[3]?.init?.headers).get(LOCAL_BRIDGE_NONCE_HEADER), "a".repeat(43));
  assert.equal(new Headers(requests[4]?.init?.headers).get(LOCAL_BRIDGE_NONCE_HEADER), "a".repeat(43));
  assert.deepEqual(client.assetRequestHeaders(project.modelUrl), {
    [LOCAL_BRIDGE_NONCE_HEADER]: "a".repeat(43),
  });
});

test("local pairing issues origin-bound sessions and keeps the bootstrap code usable across tabs", () => {
  const pairing = new LocalBridgePairing({ pairingCode: "first-code", ttlSeconds: 30 });
  const first = pairing.pair("first-code", "http://localhost:5173");
  assert.ok(first);
  assert.ok(pairing.isValid(first.nonce, "http://localhost:5173"));
  assert.equal(pairing.isValid(first.nonce, "http://127.0.0.1:5173"), false);

  const second = pairing.pair("first-code", "http://localhost:5173");
  assert.ok(second);
  assert.notEqual(second.nonce, first.nonce);
  assert.ok(pairing.isValid(second.nonce, "http://localhost:5173"));
});

test("typed client restores a paired bridge session from sessionStorage", async () => {
  const session = installSessionStorage();
  try {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImplementation: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith("/api/local/pair")) {
        return Response.json({
          nonce: "c".repeat(43),
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        }, { status: 201 });
      }
      return new Response("model", { status: 200 });
    };

    const firstClient = new BlendProofClient({ bridgeOrigin: "http://127.0.0.1:8788", bridgePairingCode: "first-code", fetchImplementation });
    await firstClient.fetchLocal("/api/local/projects/project-1/assets/model.glb");
    const stored = JSON.parse(session.storage.getItem("blendproof:bridge-session") ?? "null") as Record<string, unknown>;
    assert.equal(stored.nonce, "c".repeat(43));
    assert.equal(stored.bridgeOrigin, "http://127.0.0.1:8788");

    const secondClient = new BlendProofClient({ bridgeOrigin: "http://127.0.0.1:8788", bridgePairingCode: "unused-code", fetchImplementation });
    await secondClient.fetchLocal("/api/local/projects/project-1/assets/model.glb");
    assert.equal(requests.filter((request) => request.url.endsWith("/api/local/pair")).length, 1);
    assert.equal(new Headers(requests.at(-1)?.init?.headers).get(LOCAL_BRIDGE_NONCE_HEADER), "c".repeat(43));
  } finally {
    session.restore();
  }
});

test("typed client retries once with the bootstrap pairing code after an invalid-session 401", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  let assetAttempt = 0;
  const fetchImplementation: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.endsWith("/api/local/pair")) {
      const isRetry = requests.filter((request) => request.url.endsWith("/api/local/pair")).length === 2;
      return Response.json({
        nonce: isRetry ? "e".repeat(43) : "d".repeat(43),
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      }, { status: 201 });
    }
    assetAttempt += 1;
    if (assetAttempt === 1) return new Response(null, {
      status: 401,
      headers: { "x-blendproof-bridge-session": "invalid" },
    });
    return new Response("model", { status: 200 });
  };

  const client = new BlendProofClient({ bridgeOrigin: "http://127.0.0.1:8788", bridgePairingCode: "first-code", fetchImplementation });
  const response = await client.fetchLocal("/api/local/projects/project-1/assets/model.glb");
  assert.equal(response.status, 200);
  assert.equal(requests.filter((request) => request.url.endsWith("/api/local/pair")).length, 2);
  assert.deepEqual(JSON.parse(String(requests[2]?.init?.body)), { pairingCode: "first-code" });
  assert.equal(new Headers(requests[1]?.init?.headers).get(LOCAL_BRIDGE_NONCE_HEADER), "d".repeat(43));
  assert.equal(new Headers(requests[3]?.init?.headers).get(LOCAL_BRIDGE_NONCE_HEADER), "e".repeat(43));
  assert.deepEqual(client.assetRequestHeaders("http://127.0.0.1:8788/api/local/projects/project-1/assets/model.glb"), {
    [LOCAL_BRIDGE_NONCE_HEADER]: "e".repeat(43),
  });
});

test("cloud publish uploads only bridge-derived assets with a sanitized manifest and finalizes the Worker project", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const model = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 12, 0, 0, 0]);
  const sourceOnlyMarker = "source.blend::must-never-leave-loopback";
  const sourceManifest = {
    scene: "source.blend",
    camera: null,
    cameras: [{ name: "Camera", projection: "PERSP", r2Key: "do-not-upload" }],
    objects: [{ name: "Body", type: "MESH", collections: ["Scene"], sourcePath: sourceOnlyMarker }],
    collections: ["Scene"],
    materials: ["Steel"],
    export: { sourceBytes: 987_654, glbBytes: model.byteLength, objectCount: 1, sourceHash: sourceOnlyMarker },
    sourceFileName: sourceOnlyMarker,
    sourceBytes: 987_654,
    r2Key: "do-not-upload",
  };
  const fetchImplementation: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.endsWith("/api/local/pair")) {
      return Response.json({
        nonce: "f".repeat(43),
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      }, { status: 201 });
    }
    if (url.endsWith("/api/local/projects/local-1/assets/model.glb")) return new Response(model, { status: 200 });
    if (url.endsWith("/api/local/projects/local-1/assets/manifest.json")) return Response.json(sourceManifest);
    if (url === "https://worker.blendproof.test/api/projects") {
      return Response.json({
        id: "1".repeat(32), name: "Cloud review", ownerCapability: "2".repeat(64), status: "pending",
      }, { status: 201 });
    }
    if (url.endsWith("/upload-intents")) {
      return Response.json({
        intentToken: "3".repeat(64),
        assets: [
          { name: "model.glb", method: "PUT", url: `/api/projects/${"1".repeat(32)}/assets/model.glb` },
          { name: "manifest.json", method: "PUT", url: `/api/projects/${"1".repeat(32)}/assets/manifest.json` },
        ],
      });
    }
    if (url.endsWith("/assets/model.glb") || url.endsWith("/assets/manifest.json")) return new Response(null, { status: 204 });
    if (url.endsWith("/finalize")) return Response.json({ id: "1".repeat(32), status: "ready" });
    throw new Error(`Unexpected request: ${url}`);
  };
  const client = new BlendProofClient({
    bridgeOrigin: "http://127.0.0.1:8788",
    workerOrigin: "https://worker.blendproof.test",
    bridgePairingCode: "pairing-code",
    fetchImplementation,
  });

  const project = await client.publishCloud({
    name: "Cloud review",
    modelUrl: "/api/local/projects/local-1/assets/model.glb",
    manifestUrl: "/api/local/projects/local-1/assets/manifest.json",
    idempotencyKey: "publish-cloud-review-0001",
  });

  assert.deepEqual(project, {
    id: "1".repeat(32),
    name: "Cloud review",
    ownerCapability: "2".repeat(64),
    transport: "cloud",
    status: "ready",
  });

  const localAssetRequests = requests.filter((request) => request.url.startsWith("http://127.0.0.1:8788/api/local/projects/"));
  assert.equal(localAssetRequests.length, 2);
  for (const request of localAssetRequests) {
    assert.equal(new Headers(request.init?.headers).get(LOCAL_BRIDGE_NONCE_HEADER), "f".repeat(43));
  }
  const workerRequests = requests.filter((request) => request.url.startsWith("https://worker.blendproof.test/"));
  assert.equal(workerRequests.length, 5);
  assert.equal(workerRequests[0]?.url, "https://worker.blendproof.test/api/projects");
  assert.deepEqual(JSON.parse(String(workerRequests[0]?.init?.body)), { name: "Cloud review" });
  assert.equal(workerRequests[1]?.url, `https://worker.blendproof.test/api/projects/${"1".repeat(32)}/upload-intents`);
  const intentRequest = JSON.parse(String(workerRequests[1]?.init?.body)) as {
    idempotencyKey: string;
    assets: Array<{ name: string; contentType: string; byteSize: number; sha256: string }>;
  };
  assert.equal(intentRequest.idempotencyKey, "publish-cloud-review-0001");
  assert.deepEqual(intentRequest.assets.map(({ name, contentType, byteSize }) => ({ name, contentType, byteSize })), [
    { name: "model.glb", contentType: "model/gltf-binary", byteSize: model.byteLength },
    { name: "manifest.json", contentType: "application/json", byteSize: JSON.stringify({
      scene: "Cloud review", collections: ["Scene"], objects: [{ name: "Body", type: "MESH", collections: ["Scene"] }],
      camera: null, cameras: [{ name: "Camera", projection: "PERSP" }], materials: ["Steel"], export: { glbBytes: model.byteLength, objectCount: 1 },
    }).length },
  ]);
  const expectedManifestText = JSON.stringify({
    scene: "Cloud review", collections: ["Scene"], objects: [{ name: "Body", type: "MESH", collections: ["Scene"] }],
    camera: null, cameras: [{ name: "Camera", projection: "PERSP" }], materials: ["Steel"], export: { glbBytes: model.byteLength, objectCount: 1 },
  });
  assert.equal(intentRequest.assets[0]!.sha256, await sha256Hex(model));
  assert.equal(intentRequest.assets[1]!.sha256, await sha256Hex(new TextEncoder().encode(expectedManifestText)));

  const uploads = workerRequests.slice(2, 4);
  assert.equal(uploads.length, 2);
  for (const upload of uploads) {
    assert.equal(new Headers(upload.init?.headers).get("authorization"), `Bearer ${"3".repeat(64)}`);
    assert.ok(["model/gltf-binary", "application/json"].includes(new Headers(upload.init?.headers).get("content-type") ?? ""));
  }
  const manifestUpload = uploads.find((request) => request.url.endsWith("manifest.json"));
  assert.deepEqual(JSON.parse(new TextDecoder().decode(manifestUpload?.init?.body as Uint8Array)), {
    scene: "Cloud review", collections: ["Scene"], objects: [{ name: "Body", type: "MESH", collections: ["Scene"] }],
    camera: null, cameras: [{ name: "Camera", projection: "PERSP" }], materials: ["Steel"], export: { glbBytes: model.byteLength, objectCount: 1 },
  });
  assert.equal(workerRequests[4]?.url, `https://worker.blendproof.test/api/projects/${"1".repeat(32)}/finalize`);
  assert.deepEqual(JSON.parse(String(workerRequests[4]?.init?.body)), { idempotencyKey: "publish-cloud-review-0001" });
  assert.ok(workerRequests.every((request) => !String(request.init?.body).includes(sourceOnlyMarker)));
  assert.ok(workerRequests.every((request) => !String(request.init?.body).includes("sourceBytes")));
  assert.ok(workerRequests.every((request) => !request.url.includes("source.blend")));
});

test("cloud transport routes owner review and share calls to the Worker without bridge session credentials", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const client = new BlendProofClient({
    bridgeOrigin: "http://127.0.0.1:8788",
    workerOrigin: "https://worker.blendproof.test",
    fetchImplementation: async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith("/shares")) return Response.json({ id: "share-1", shareUrl: "/s/token", expiresAt: null, commentsPermission: "comment" });
      if (url.endsWith("/comments")) return Response.json({ comments: [] });
      throw new Error(`Unexpected request: ${url}`);
    },
  });

  const share = await client.createShare("cloud-project", "owner-capability", { commentsPermission: "comment" }, "cloud");
  const comments = await client.listOwnerComments("cloud-project", "owner-capability", "cloud");

  assert.equal(share.shareUrl, "/s/token");
  assert.deepEqual(comments, []);
  assert.equal(requests[0]?.url, "https://worker.blendproof.test/api/projects/cloud-project/shares");
  assert.equal(requests[1]?.url, "https://worker.blendproof.test/api/projects/cloud-project/comments");
  assert.equal(new Headers(requests[0]?.init?.headers).get(LOCAL_BRIDGE_NONCE_HEADER), null);
  assert.equal(new Headers(requests[0]?.init?.headers).get("x-blendproof-owner"), "owner-capability");
  assert.equal(requests.some((request) => request.url.includes("/api/local/")), false);
});

test("cloud publish resumes the same project and intent after a partial asset failure", async () => {
  const session = installSessionStorage();
  let projectCreates = 0;
  let finalizeCalls = 0;
  let manifestUploads = 0;
  let intentCalls = 0;
  const intentKeys: string[] = [];
  const model = new Uint8Array([1, 2, 3]);
  const fetchImplementation: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api/local/pair")) return Response.json({ nonce: "g".repeat(43), expiresAt: new Date(Date.now() + 300_000).toISOString() });
    if (url === "https://local.test/api/local/model.glb") return new Response(model);
    if (url === "https://local.test/api/local/manifest.json") return Response.json({ scene: "Retry", objects: [], collections: [] });
    if (url.endsWith("/api/projects")) {
      projectCreates += 1;
      return Response.json({ id: "4".repeat(32), name: "Retry", ownerCapability: "5".repeat(64), status: "pending" });
    }
    if (url.endsWith("/upload-intents")) {
      intentCalls += 1;
      intentKeys.push((JSON.parse(String(init?.body)) as { idempotencyKey: string }).idempotencyKey);
      if (intentCalls === 2) return Response.json({ error: "旧上传意图已过期，请使用新的幂等键重试。" }, { status: 409 });
      return Response.json({ intentToken: "6".repeat(64), assets: [
        { name: "model.glb", method: "PUT", url: `/api/projects/${"4".repeat(32)}/assets/model.glb` },
        { name: "manifest.json", method: "PUT", url: `/api/projects/${"4".repeat(32)}/assets/manifest.json` },
      ] });
    }
    if (url.endsWith("/assets/manifest.json")) {
      manifestUploads += 1;
      if (manifestUploads === 1) return Response.json({ error: "temporary failure" }, { status: 503 });
      return new Response(null, { status: 204 });
    }
    if (url.includes("/assets/")) return new Response(null, { status: 204 });
    if (url.endsWith("/finalize")) {
      finalizeCalls += 1;
      if (finalizeCalls === 1) return Response.json({ error: "派生资源尚未完整上传。" }, { status: 409 });
      return Response.json({ id: "4".repeat(32), status: "ready" });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const input = { name: "Retry", modelUrl: "https://local.test/api/local/model.glb", manifestUrl: "https://local.test/api/local/manifest.json" };
  const clientOptions = { bridgeOrigin: "https://local.test", bridgePairingCode: "pairing-code", workerOrigin: "https://worker.test", fetchImplementation };
  const client = new BlendProofClient(clientOptions);
  await assert.rejects(client.publishCloud(input), /temporary failure/);
  const recovered = await new BlendProofClient(clientOptions)
    .publishCloud(input);
  assert.equal(recovered.id, "4".repeat(32));
  assert.equal(projectCreates, 1);
  assert.equal(finalizeCalls, 2);
  assert.equal(intentCalls, 3);
  assert.equal(intentKeys[0], intentKeys[1]);
  assert.notEqual(intentKeys[1], intentKeys[2]);
  session.restore();
});

async function sha256Hex(bytes: Uint8Array) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
