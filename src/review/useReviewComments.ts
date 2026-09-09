import { useCallback, useEffect, useRef, useState } from "react";
import {
  reviewRepository,
  type ReviewComment,
  type ReviewCommentDraft,
} from "../reviewRepository";

export function useReviewComments(projectId: string | null) {
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestGeneration = useRef(0);
  const activeProjectId = useRef(projectId);
  activeProjectId.current = projectId;

  const reload = useCallback(async () => {
    const generation = ++requestGeneration.current;
    if (!projectId) {
      setComments([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await reviewRepository.list(projectId);
      if (requestGeneration.current === generation) setComments(next);
    } catch (reason) {
      if (requestGeneration.current === generation)
        setError(reason instanceof Error ? reason.message : "无法读取评论。");
    } finally {
      if (requestGeneration.current === generation) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = useCallback(
    async (draft: ReviewCommentDraft) => {
      if (!projectId) throw new Error("请先导入审稿项目。");
      const generation = ++requestGeneration.current;
      const comment = await reviewRepository.create(projectId, draft);
      if (
        requestGeneration.current === generation &&
        activeProjectId.current === projectId
      )
        setComments((current) => [...current, comment]);
      return comment;
    },
    [projectId],
  );

  const update = useCallback(
    async (
      commentId: string,
      patch: Pick<Partial<ReviewComment>, "body" | "status">,
    ) => {
      if (!projectId) throw new Error("缺少审稿项目。");
      const generation = ++requestGeneration.current;
      const comment = await reviewRepository.update(projectId, commentId, patch);
      if (
        requestGeneration.current === generation &&
        activeProjectId.current === projectId
      )
        setComments((current) =>
          current.map((item) => (item.id === comment.id ? comment : item)),
        );
      return comment;
    },
    [projectId],
  );

  return { comments, error, loading, create, update, reload };
}
