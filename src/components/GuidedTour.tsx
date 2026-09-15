import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

export type GuidedTourStep = { id: string; title: string; description: string; target: string; placement?: "top" | "bottom" | "left" | "right"; group: string };
export function GuidedTour({ steps, onClose, onStepChange }: { steps: GuidedTourStep[]; onClose: () => void; onStepChange?: (step: GuidedTourStep, index: number) => void }) {
  const [index, setIndex] = useState(0); const [rect, setRect] = useState<DOMRect | null>(null); const step = steps[index];
  const measure = useCallback(() => { if (!step) return; const el = document.querySelector(step.target); if (!el) return setRect(null); el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" }); setRect(el.getBoundingClientRect()); window.setTimeout(() => setRect(el.getBoundingClientRect()), 220); }, [step]);
  useEffect(() => { onStepChange?.(step, index); measure(); }, [index, measure, onStepChange, step]);
  useEffect(() => { const refresh = () => measure(); window.addEventListener("resize", refresh); window.addEventListener("scroll", refresh, true); const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); if (e.key === "ArrowRight" || e.key === "Enter") setIndex((i) => Math.min(i + 1, steps.length - 1)); if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0)); }; window.addEventListener("keydown", key); return () => { window.removeEventListener("resize", refresh); window.removeEventListener("scroll", refresh, true); window.removeEventListener("keydown", key); }; }, [measure, onClose, steps.length]);
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
