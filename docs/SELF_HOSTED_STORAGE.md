---
关联文档:
  - README.md
  - PHASE_4D_DEPLOYMENT_RECOVERY.md
涉及文件:
  - worker/object-storage.ts
  - worker/r2-storage.ts
  - worker/s3-storage.ts
  - worker/storage-key.ts
  - worker/uploads.ts
  - worker/shares.ts
  - worker/cleanup.ts
依赖服务:
  - Cloudflare R2 or S3-compatible object storage
  - Cloudflare D1
---

# 自托管对象存储

BlendProof 的云端资源只包含 `model.glb`、裁剪后的 `manifest.json` 和可选的
`thumbnail.webp`。原始 `.blend` 不允许进入 Worker 或对象存储。

## 统一边界

所有上传、HEAD 完整性校验、分享读取和定时精确删除都必须经过
`worker/object-storage.ts` 的 `ObjectStorage`。业务模块不得直接调用 R2 binding
或厂商 SDK。

对象键由 `worker/storage-key.ts` 统一生成并持久化到 D1。清理任务只删除 D1
记录的精确 key，不允许根据用户输入拼接 key，也不允许在清理阶段扫描整个 bucket。

当前适配器：

| Provider | 配置值 | 适用范围 |
|---|---|---|
| Cloudflare R2 | `STORAGE_PROVIDER=r2` 或省略 | 官方部署与本地 Wrangler |
| S3 compatible | `STORAGE_PROVIDER=s3` | AWS S3、MinIO 及兼容 AWS SigV4 的服务 |

阿里云 OSS、腾讯 COS 等只有在所选 endpoint 提供 AWS S3 SigV4 兼容接口时才能直接
使用 `s3` 适配器。厂商专有签名协议需要新增独立适配器，并在
`objectStorage()` 这个唯一组合入口注册；不能在上传、分享或清理模块中加入特例。

## R2 配置

默认使用 Wrangler 的 `ASSETS` R2 binding：

```jsonc
{
  "r2_buckets": [
    { "binding": "ASSETS", "bucket_name": "your-private-bucket" }
  ],
  "vars": { "STORAGE_PROVIDER": "r2" }
}
```

bucket 必须保持私有，资源只通过 Worker 的分享鉴权接口返回。

## S3 兼容配置

非敏感变量：

```env
STORAGE_PROVIDER=s3
S3_ENDPOINT=https://s3.example.com/my-private-bucket
S3_REGION=us-east-1
```

`S3_ENDPOINT` 必须指向 bucket 根地址，可以包含路径，但不能携带查询参数或凭据。

凭据必须作为 Worker Secret 配置，不得写入仓库：

```sh
npx wrangler secret put S3_ACCESS_KEY_ID
npx wrangler secret put S3_SECRET_ACCESS_KEY
# 仅临时凭据需要：
npx wrangler secret put S3_SESSION_TOKEN
```

对象存储账号最少需要该私有 bucket 的读取、写入、HEAD、按精确 key 删除，以及按
`projects/` 前缀分页列举权限。禁止授予公开读取权限。

## 健康检查

`GET /api/health` 返回当前组合结果，不暴露 endpoint 或凭据：

```json
{
  "runtime": "cloudflare-worker",
  "database": { "provider": "d1", "bound": true },
  "objectStorage": { "provider": "r2", "bound": true }
}
```

`bound: true` 只表示必要 binding/配置存在；发布前仍须执行真实上传、分享读取和清理
验收。

## 新适配器验收

新 provider 必须完整实现 `ObjectStorage`，并通过以下行为：

1. PUT 后 HEAD 返回一致的字节数、ETag、Content-Type 和 `sha256` 自定义元数据。
2. GET 返回私有对象流，不重定向到公开 bucket URL。
3. `deleteObject` 精确删除单个或多个 key。
4. `deleteVersion` 与 `deleteProject` 只能在对应 namespace 前缀内分页处理。
5. 上传失败、校验失败和删除失败仍由现有 D1 账本重试，不绕过配额状态机。
6. `.blend`、任意对象名和非法 namespace 在存储写入前即被拒绝。

完成后运行：

```sh
npm run check
npm run check:worker
npm run test:backend
npm run test:worker
npm run worker:dry-run
```
