import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

export type GuidedTourStep = { id: string; title: string; description: string; target: string; placement?: "top" | "bottom" | "left" | "right"; group: string };

/**
 * 操作指南浮层。
 *
 * 定位依赖对目标元素 `getBoundingClientRect()` 的测量。测量逻辑有三条硬约束，
 * 违反任意一条都会让主线程被 setState 风暴占满、页面失去响应：
 *   1. 测量结果只在数值变化时才写回 state —— `getBoundingClientRect()` 每次返回
 *      新对象，直接 setState 会让「渲染 → 测量 → 渲染」自激。
 *   2. 监听 scroll 必须节流到每帧一次 —— 平滑滚动会连续触发 scroll，逐次测量
 *      并写 state 会形成反馈循环。
 *   3. 滚动后的二次测量用 ref 保存句柄并覆盖，不能每次新建一堆 timer —— 否则
 *      timer 堆积后在 200ms 处同时触发，瞬间打满渲染队列。
 */
export function GuidedTour({ steps, onClose, onStepChange }: { steps: GuidedTourStep[]; onClose: () => void; onStepChange?: (step: GuidedTourStep, index: number) => void }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // props 存 ref：父组件传内联函数时引用每次渲染都变，放进依赖会让 effect 反复执行。
  const stepChangeRef = useRef(onStepChange);
  stepChangeRef.current = onStepChange;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  const frameRef = useRef<number | null>(null);
  const settleRef = useRef<number | null>(null);

  /** 读取目标元素矩形；数值未变时复用旧对象，避免无谓重渲染。 */
  const readRect = useCallback((target: string): void => {
    const el = document.querySelector(target);
    if (!el) {
      setRect(null);
      return;
    }
    const next = el.getBoundingClientRect();
    setRect((prev) =>
      prev && prev.top === next.top && prev.left === next.left && prev.width === next.width && prev.height === next.height ? prev : next,
    );
  }, []);

  /** 每帧最多测量一次。 */
  const scheduleMeasure = useCallback((target: string): void => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      readRect(target);
    });
  }, [readRect]);

  // 切换步骤：把目标滚进视口，再测量一次并把最终位置补上。
  useEffect(() => {
    const current = stepsRef.current[index];
    if (!current) return;
    stepChangeRef.current?.(current, index);

    const el = document.querySelector(current.target);
    if (!el) {
      setRect(null);
      return;
    }
    const initial = el.getBoundingClientRect();
    if (initial.top < 0 || initial.bottom > window.innerHeight) {
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    }
    setRect(initial);

    if (settleRef.current !== null) window.clearTimeout(settleRef.current);
    settleRef.current = window.setTimeout(() => {
      settleRef.current = null;
      readRect(current.target);
    }, 320);
  }, [index, steps.length, readRect]);

  // 视口变化时重新测量；scroll 用被动监听 + 每帧节流。
  useEffect(() => {
    const target = () => stepsRef.current[index]?.target;
    const refresh = () => {
      const t = target();
      if (t) scheduleMeasure(t);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
      if (e.key === "ArrowRight" || e.key === "Enter") setIndex((i) => Math.min(i + 1, stepsRef.current.length - 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh, { capture: true, passive: true });
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", refresh, { capture: true });
      window.removeEventListener("keydown", key);
    };
  }, [index, scheduleMeasure]);

  // 卸载时清掉挂起的帧与定时器，避免离开页面后仍有回调写 state。
  useEffect(
    () => () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      if (settleRef.current !== null) window.clearTimeout(settleRef.current);
    },
    [],
  );

  const step = steps[index];
  if (!step) return null;
  const popoverWidth = 320;
  const popoverHeight = 190;
  const gap = 12;
  const margin = 16;
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));
  let top = window.innerHeight / 2 - popoverHeight / 2;
  let left = margin;
  if (rect) {
    if (step.placement === "right") { left = rect.right + gap; top = rect.top + rect.height / 2 - popoverHeight / 2; }
    else if (step.placement === "left") { left = rect.left - popoverWidth - gap; top = rect.top + rect.height / 2 - popoverHeight / 2; }
    else if (step.placement === "top") { left = rect.left + rect.width / 2 - popoverWidth / 2; top = rect.top - popoverHeight - gap; }
    else { left = rect.left + rect.width / 2 - popoverWidth / 2; top = rect.bottom + gap; }
    left = clamp(left, margin, window.innerWidth - popoverWidth - margin);
    top = clamp(top, margin, window.innerHeight - popoverHeight - margin);
  }
  return <div className="guided-tour"><button className="guided-tour-backdrop" aria-label="退出操作指南" onClick={onClose} /><div className="guided-tour-highlight" style={rect ? { left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 } : { display: "none" }} /><article className="guided-tour-popover" style={{ top, left }} onClick={(e) => e.stopPropagation()}><header><span>{step.group} · {index + 1}/{steps.length}</span><button onClick={onClose} aria-label="关闭"><X size={14} /></button></header><h3>{step.title}</h3><p>{step.description}</p><footer><div>{steps.map((item, i) => <button key={item.id} className={i === index ? "active" : ""} onClick={() => setIndex(i)} aria-label={item.title} />)}</div><nav><button disabled={index === 0} onClick={() => setIndex((i) => i - 1)}><ChevronLeft size={13} />上一步</button>{index === steps.length - 1 ? <button className="primary" onClick={onClose}>完成</button> : <button className="primary" onClick={() => setIndex((i) => i + 1)}>下一步<ChevronRight size={13} /></button>}</nav></footer></article></div>;
}
