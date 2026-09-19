/**
 * 浏览器本地数据层。
 *
 * 「本地上传只存浏览器缓存，不上传」这条产品约束的落点：
 * 未登录用户的 .blend 转换产物、批注、分享全部只存在于本机 IndexedDB，
 * 不产生任何网络请求。登录后才由 cloud transport 上传。
 *
 * 这里只提供 IndexedDB 原语，不含任何业务规则（规则在 browserBackend.ts）。
 */

import type { ReviewComment } from "../features/review";

const DB_NAME = "blendproof:browser";
const DB_VERSION = 1;

export const PROJECT_STORE = "projects";
export const SHARE_STORE = "shares";
export const COMMENT_STORE = "comments";

/** 一个本地项目的持久记录。GLB 与 manifest 都以二进制保存，供分享页跨会话读取。 */
export type BrowserProjectRecord = {
  id: string;
  name: string;
  ownerCapability: string;
  model: ArrayBuffer;
  manifest: unknown;
  createdAt: string;
};

/** 一条本地分享。token 同时是记录主键与 URL 里的分享标识。 */
export type BrowserShareRecord = {
  token: string;
  id: string;
  projectId: string;
  password: string | null;
  expiresAt: string | null;
  commentsPermission: "read_only" | "comment";
  createdAt: string;
  revokedAt: string | null;
};

/**
 * 批注记录。`deleteToken` 只对访客创建的内容写入，
 * 且只在创建响应里返回一次 —— 列表响应必须剥掉（见 REVIEW_CONTRACT.md）。
 */
export type BrowserCommentRecord = ReviewComment & {
  deleteToken: string | null;
  replyDeleteTokens: Record<string, string>;
};

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("当前浏览器不支持本地存储，无法在未登录状态下预览模型。"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECT_STORE)) {
        db.createObjectStore(PROJECT_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(SHARE_STORE)) {
        db.createObjectStore(SHARE_STORE, { keyPath: "token" });
      }
      if (!db.objectStoreNames.contains(COMMENT_STORE)) {
        const store = db.createObjectStore(COMMENT_STORE, { keyPath: "id" });
        store.createIndex("projectId", "projectId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("打开本地存储失败。"));
  });
  return databasePromise;
}

/** 在一个事务里执行操作，并把 IDBRequest 包成 Promise。 */
export async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | null,
): Promise<T | undefined> {
  const db = await openDatabase();
  return new Promise<T | undefined>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = run(transaction.objectStore(storeName));
    transaction.oncomplete = () => resolve(request ? request.result : undefined);
    transaction.onerror = () => reject(new Error("本地存储读写失败。"));
    transaction.onabort = () => reject(new Error("本地存储事务被中止。"));
  });
}

export function getRecord<T>(storeName: string, key: string): Promise<T | undefined> {
  return withStore<T>(storeName, "readonly", (store) => store.get(key) as IDBRequest<T>);
}

export function putRecord<T>(storeName: string, value: T): Promise<undefined> {
  return withStore<undefined>(storeName, "readwrite", (store) => {
    store.put(value);
    return null;
  });
}

export function deleteRecord(storeName: string, key: string): Promise<undefined> {
  return withStore<undefined>(storeName, "readwrite", (store) => {
    store.delete(key);
    return null;
  });
}

export function listStore<T>(storeName: string): Promise<T[]> {
  return withStore<T[]>(storeName, "readonly", (store) => store.getAll() as IDBRequest<T[]>).then((rows) => rows ?? []);
}

/** 读某项目下的全部批注。按创建时间排序，保证 pin 与列表顺序稳定。 */
export async function listComments(projectId: string): Promise<BrowserCommentRecord[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(COMMENT_STORE, "readonly");
    const request = transaction.objectStore(COMMENT_STORE).index("projectId").getAll(projectId);
    request.onsuccess = () => {
      const rows = (request.result as BrowserCommentRecord[]) ?? [];
      resolve(rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    };
    request.onerror = () => reject(new Error("读取本地批注失败。"));
  });
}

/** 找出某个项目下的全部分享（含已撤销的，由调用方过滤）。 */
export function listSharesOf(projectId: string): Promise<BrowserShareRecord[]> {
  return listStore<BrowserShareRecord>(SHARE_STORE).then((rows) => rows.filter((row) => row.projectId === projectId));
}

/** 为 GLB 字节生成当前会话可用的 blob URL。跨会话由调用方重新 materialize。 */
export function materializeBlobUrl(bytes: ArrayBuffer, type: string): string {
  return URL.createObjectURL(new Blob([bytes], { type }));
}

// ---------------------------------------------------------------------------
// 项目
// ---------------------------------------------------------------------------

export function readProject(id: string): Promise<BrowserProjectRecord | undefined> {
  return getRecord<BrowserProjectRecord>(PROJECT_STORE, id);
}

export function saveProject(record: BrowserProjectRecord): Promise<unknown> {
  return putRecord(PROJECT_STORE, record);
}

/**
 * 删除项目及其名下的分享与批注。
 * 这是「本地不清理」约束下唯一的清理入口 —— 只由用户主动删除触发。
 */
export async function removeProject(id: string): Promise<void> {
  const comments = await listComments(id);
  await Promise.all(comments.map((comment) => deleteRecord(COMMENT_STORE, comment.id)));
  const shares = await listSharesOf(id);
  await Promise.all(shares.map((share) => deleteRecord(SHARE_STORE, share.token)));
  await deleteRecord(PROJECT_STORE, id);
}

/**
 * 把持久记录还原成可用的 Project：blob URL 只在本会话有效，
 * 因此每次从 IndexedDB 读出都要重新生成。
 */
export function materializeProject(record: BrowserProjectRecord): {
  modelUrl: string;
  manifestUrl: string;
} {
  return {
    modelUrl: materializeBlobUrl(record.model, "model/gltf-binary"),
    manifestUrl: materializeBlobUrl(
      new TextEncoder().encode(JSON.stringify(record.manifest)).buffer as ArrayBuffer,
      "application/json",
    ),
  };
}
