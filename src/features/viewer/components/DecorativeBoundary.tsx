/**
 * 装饰性内容的错误边界：失败就跳过，不影响主体。
 *
 * 背景环境贴图（<Environment preset="city" />）来自 CDN，在弱网或受限网络下
 * 会加载失败。它是纯氛围元素——少了只是不好看，但若让它把错误抛到视口的
 * 主边界上，用户会看到「模型无法加载」，而模型其实完全正常。
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

export class DecorativeBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn("装饰性内容加载失败，已跳过：", error.message, info.componentStack);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
