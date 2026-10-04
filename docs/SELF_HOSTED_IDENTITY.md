# 开源部署与账号体系

BlendProof 源码公开不代表官方 Orbit 账号平台开放。官方托管与社区自托管是两种独立模式：自托管部署默认使用 BlendProof 自带的本地账号、邀请码和会话，不依赖 Orbit。

> `UNIVERSAL_*` 是已发布协议的兼容性技术标识，不是当前用户可见品牌。为避免破坏现有会话、D1 数据和部署变量，内部命名暂不迁移。

## 官方托管版

官方站点使用：

- `UNIVERSAL_AUTH_MODE=required`
- `IDENTITY_PROVIDER_NAME=Orbit`
- `IDENTITY_ACCOUNT_ORIGIN=https://orbit.itycon.cn`
- `ENABLE_DEMO_ACCOUNT=true`
- Cloudflare Service Binding `UNIVERSAL_OIDC_SERVICE`

OIDC issuer 仍为 `https://adobesync.itycon.cn`，这是现有协议的稳定技术地址；注册、资料与管理页面通过 `IDENTITY_ACCOUNT_ORIGIN` 跳转到 Orbit 的新品牌域名。

OIDC issuer、Client ID、产品 ID 和回调路径是公开协议元数据。OIDC 签名私钥、Cloudflare Token、管理员凭据、`UNIVERSAL_SESSION_SECRET`、refresh token 和 `.dev.vars` 不得进入 Git。第三方 fork 即使复制公开 Client ID，也无法从未登记的域名完成回调。

## 社区自托管（推荐）

1. 复制 `wrangler.self-host.example.jsonc` 为自己的部署配置。
2. 替换 D1、R2 和 `APP_ORIGIN` 占位值。
3. 保持 `UNIVERSAL_AUTH_MODE=off` 与 `ENABLE_DEMO_ACCOUNT=false`。
4. 通过 Cloudflare Secret 配置上传、分享与首位管理员所需密钥。
5. 执行 migration、构建并使用自己的配置部署。

```sh
npx wrangler d1 migrations apply <database> --remote --config wrangler.self-host.jsonc
npm run build
npx wrangler deploy --config wrangler.self-host.jsonc
```

`off` 模式启用仓库自带的账号、邀请码和管理员 bootstrap 接口。官方公共体验账号不会自动出现，也不会被 Worker 接受。

## 外部身份适配（高级）

如果自托管者需要外部账号，可接入自己的兼容服务，并配置独立 Client ID、精确 HTTPS 回调地址和会话 Secret。适配器除标准 OIDC `/oauth2/*`、JWKS 和 refresh token 外，还必须实现 BlendProof 使用的 `/v1/me` 产品资格契约：

- `productId=blendproof`
- `permissions.login=true`
- 可选 `permissions.product_admin=true`

因此，任意通用 OIDC Provider 不能在没有适配层的情况下直接替换官方服务。`optional` 仅用于迁移或人工回退，不是长期双轨模式。

## 配置开关

| 变量 | 作用 | 自托管默认 |
|---|---|---|
| `UNIVERSAL_AUTH_MODE` | `off` / `optional` / `required` | `off` |
| `IDENTITY_PROVIDER_NAME` | 启动页上的账号品牌名 | `Local account` |
| `IDENTITY_ACCOUNT_ORIGIN` | 注册、资料和管理页跳转域名 | 不配置 |
| `ENABLE_DEMO_ACCOUNT` | 是否显示并接受官方体验账号 | `false` |

## 外部服务不可用策略

- 每 5 分钟刷新 token 并重新检查产品资格。
- `400/401/403`、资格撤销、subject 不一致或 `login!=true`：立即撤销本地 BFF 会话。
- 网络异常、`429` 或 `5xx`：使用最近成功校验结果，最多宽限 `UNIVERSAL_AUTH_GRACE_SECONDS`。
- 宽限期间强制降为普通用户，不保留产品管理员权限。

公开演示账号和演示分享口令不是秘密，但必须保持无管理员权限、数据隔离、限流和小配额；不得复用为真实账号凭据。
