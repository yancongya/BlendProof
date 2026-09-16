import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectTransport } from "../../../api/blendProofClient";
import { reviewRepository } from "../api/reviewRepository";
import { useReviewMutations } from "./useReviewMutations";
import type { ReviewComment } from "../types";

/**
 * 批注列表与轮询（读侧），并把写操作组合成同一个对外接口。
 *
 * 写操作在 useReviewMutations 里，两者靠 beginWrite / isStale 这对守卫协作：
 * 任何写请求返回时若项目已切换或已有更新的请求，结果一律丢弃。
 */
export function useReviewComments(
  projectId: string | null,
  ownerCapability: string | null,
  transport: ProjectTransport = "local",
) {
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const requestGeneration = useRef(0);
  const activeProjectId = useRef(projectId);
  activeProjectId.current = projectId;
  /** 最近一次轮询发现的、尚未被查看的批注 id，供「点击查看」定位。 */
  const unseenIds = useRef<string[]>([]);

  const beginWrite = useCallback(() => {
    return { generation: ++requestGeneration.current, projectId: projectId ?? "" };
  }, [projectId]);

  const isStale = useCallback((generation: number, forProject: string) => {
    return requestGeneration.current !== generation || activeProjectId.current !== forProject;
  }, []);

  const reload = useCallback(async () => {
    const generation = ++requestGeneration.current;
    if (!projectId || !ownerCapability) {
      setComments([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await reviewRepository.list(projectId, ownerCapability, transport);
      if (requestGeneration.current !== generation) return;
      setComments((current) => {
        // 首次加载不算「新批注」，否则刚打开项目就会提示有新内容。
        if (current.length > 0) {
          const known = new Set(current.map((item) => item.id));
          const unseen = next.filter((item) => !known.has(item.id));
          unseenIds.current = unseen.map((item) => item.id);
          setNewCount(unseen.length);
        }
        return next;
      });
    } catch (reason) {
      if (requestGeneration.current === generation)
        setError(reason instanceof Error ? reason.message : "无法读取评论。");
    } finally {
      if (requestGeneration.current === generation) setLoading(false);
    }
  }, [projectId, ownerCapability, transport]);

  useEffect(() => {
    void reload();
    if (!projectId || !ownerCapability) return;
    const timer = window.setInterval(() => void reload(), 15000);
    return () => window.clearInterval(timer);
  }, [reload]);

  /**
   * 清空未读计数并返回最新一条未读批注的 id，供调用方选中并跳转视角。
   * 只清计数不定位会让「收到新批注，点击查看」变成空承诺。
   */
  const acknowledgeNew = useCallback((): string | null => {
    const latest = unseenIds.current.at(-1) ?? null;
    unseenIds.current = [];
    setNewCount(0);
    return latest;
  }, []);

  const mutations = useReviewMutations({
    projectId,
    ownerCapability,
    transport,
    setComments,
    beginWrite,
    isStale,
  });

  return {
    comments,
    error,
    loading,
    newCount,
    acknowledgeNew,
    reload,
    ...mutations,
  };
}
