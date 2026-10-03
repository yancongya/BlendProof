# 开源部署与统一身份

BlendProof 源码公开不代表官方账号中心开放。部署者必须明确选择身份模式，并把密钥留在自己的运行环境中。

## 官方托管版

官方站点使用 `UNIVERSAL_AUTH_MODE=required`，通过 Cloudflare Service Binding 接入 Universal。`UNIVERSAL_OIDC_ISSUER`、Client ID、产品 ID 和回调路径是公开协议元数据；OIDC 签名私钥、Cloudflare Token、管理员凭据、`UNIVERSAL_SESSION_SECRET`、refresh token 和 `.dev.vars` 不得进入 Git。

OIDC 回调地址按 Client 精确登记。第三方 fork 即使复制公开 Client ID，也不能从未登记的域名完成回调。

## 自托管选择

1. 推荐：部署自己的 Universal 实例，登记独立 Client ID、`blendproof` 产品和精确 HTTPS 回调地址。
2. 兼容：实现与 Universal `/oauth2/*`、JWKS、refresh token 和 `/v1/me` 产品权限契约一致的身份适配器。
3. 单机兼容：仅在明确承担本地账号维护责任时使用 `UNIVERSAL_AUTH_MODE=off`。`optional` 只用于迁移或人工回退，不是长期双轨模式。

任意通用 OIDC Provider 不能直接替代 Universal，因为 BlendProof 还依赖 `/v1/me` 返回的 `productId=blendproof`、`login` 和 `product_admin` 产品资格。

## 服务不可用策略

- 每 5 分钟刷新 token 并重新检查产品资格。
- `400/401/403`、资格撤销、subject 不一致或 `login!=true`：立即撤销本地 BFF 会话。
- 网络异常、`429` 或 `5xx`：使用最近成功校验结果，最多宽限 `UNIVERSAL_AUTH_GRACE_SECONDS`（默认 1800 秒，限制为 300–3600 秒）。
- 宽限期间角色强制为普通用户，管理操作不可用。
- 宽限结束后拒绝访问；服务恢复后，未被明确撤销的会话可再次完成校验。
- 紧急回退由管理员把模式改为 `optional` 并重新部署，不自动降级。

公开演示账号和演示分享口令不是秘密，必须保持无管理员权限、数据隔离、限流和小配额；不得复用为真实账号凭据。
