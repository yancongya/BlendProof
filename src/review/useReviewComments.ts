import { useCallback, useEffect, useRef, useState } from "react";
import {
  reviewRepository,
  type ReviewComment,
  type ReviewCommentDraft,
} from "../reviewRepository";
import type { ProjectTransport } from "../api/blendProofClient";

export function useReviewComments(projectId: string | null, ownerCapability: string | null, transport: ProjectTransport = "local") {
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestGeneration = useRef(0);
  const activeProjectId = useRef(projectId);
  activeProjectId.current = projectId;

  const reload = useCallback(async () => {
    const generation = ++requestGeneration.current;
    if (!projectId || !ownerCapability) {
      setComments([]);
      setError(null);
      setLoading(false);
      return;
    }
    setComments([]);
    setLoading(true);
    setError(null);
    try {
      const next = await reviewRepository.list(projectId, ownerCapability, transport);
      if (requestGeneration.current === generation) setComments(next);
    } catch (reason) {
      if (requestGeneration.current === generation)
        setError(reason instanceof Error ? reason.message : "无法读取评论。");
    } finally {
      if (requestGeneration.current === generation) setLoading(false);
    }
  }, [projectId, ownerCapability, transport]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = useCallback(
    async (draft: ReviewCommentDraft) => {
      if (!projectId || !ownerCapability) throw new Error("请重新导入项目以取得所有者凭据。");
      const generation = ++requestGeneration.current;
      const comment = await reviewRepository.create(projectId, ownerCapability, draft, transport);
      if (
        requestGeneration.current === generation &&
        activeProjectId.current === projectId
      )
        setComments((current) => [...current, comment]);
      return comment;
    },
    [projectId, ownerCapability, transport],
  );

  const update = useCallback(
    async (
      commentId: string,
      patch: Pick<Partial<ReviewComment>, "body" | "status">,
    ) => {
      if (!projectId || !ownerCapability) throw new Error("缺少项目所有者凭据。");
      const generation = ++requestGeneration.current;
      const comment = await reviewRepository.update(projectId, ownerCapability, commentId, patch, transport);
      if (
        requestGeneration.current === generation &&
        activeProjectId.current === projectId
      )
        setComments((current) =>
          current.map((item) => (item.id === comment.id ? comment : item)),
        );
      return comment;
    },
    [projectId, ownerCapability, transport],
  );

  return { comments, error, loading, create, update, reload };
}
