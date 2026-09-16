-- 批注回复：把审稿从「单向留言」变成可对话的闭环。
--
-- 回复不携带锚点，锚点继承所属评论（position / normal / camera），
-- 因此单独建表，不占用 comments 的 NOT NULL 锚点列。
--
-- 契约见 docs/REVIEW_CONTRACT.md。

CREATE TABLE comment_replies (
  id TEXT PRIMARY KEY NOT NULL,
  comment_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  body TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_type TEXT NOT NULL DEFAULT 'owner'
    CHECK (author_type IN ('owner', 'guest')),
  -- 访客身份无法验证（author_id 恒为 null），删除自己的内容必须出示令牌。
  -- 与其他凭据列一致，只存 SHA-256 摘要，明文令牌只在创建响应里返回一次。
  delete_token_hash TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX comment_replies_comment_created_idx
  ON comment_replies(comment_id, created_at, id);
CREATE INDEX comment_replies_project_idx ON comment_replies(project_id);

-- 评论同样需要令牌列，供访客删除自己创建的评论。
ALTER TABLE comments ADD COLUMN delete_token_hash TEXT;
