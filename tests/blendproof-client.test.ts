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
