import assert from "node:assert/strict";
import { test } from "node:test";
import { BlendProofClient } from "../src/api/blendProofClient.js";

test("typed client sends existing local conversion and review calls to the local bridge", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const client = new BlendProofClient({
    bridgeOrigin: "http://127.0.0.1:8788",
    workerOrigin: "https://api.blendproof.test",
    fetchImplementation: async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
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

  assert.equal(requests[0]?.url, "http://127.0.0.1:8788/api/local/convert");
  assert.equal(requests[0]?.init?.method, "POST");
  assert.ok(requests[0]?.init?.body instanceof FormData);
  assert.equal(project.modelUrl, "http://127.0.0.1:8788/api/local/projects/project-1/assets/model.glb");
  assert.equal(project.manifestUrl, "http://127.0.0.1:8788/api/local/projects/project-1/assets/manifest.json");
  assert.equal(requests[1]?.url, "http://127.0.0.1:8788/api/local/projects/project-1/shares");
  assert.deepEqual(requests[1]?.init?.headers, {
    "content-type": "application/json",
    "x-blendproof-owner": "owner-capability",
  });
});
