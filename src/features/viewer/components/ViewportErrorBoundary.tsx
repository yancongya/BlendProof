/**
 * 视口错误边界（B2）。
 *
 * 此前 GLB 404 或解析失败会让整棵 React 树卸载：客户看到的是全白页面，
 * 既不知道发生了什么，也没有任何可做的动作，只能关掉。
 *
 * 这里把失败收敛到视口区域，给出可读原因与「重试」。重试由调用方清除
 * GLTF 缓存后重新挂载 —— 只清 error 状态会因为缓存的 rejected promise
 * 立刻再次抛错。
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { t } from "../../../i18n";

type Props = {
  children: ReactNode;
  /** 分享页与工作台的提示语不同：客户需要「联系分享者」，创作者需要「重新上传」。 */
  hint?: string;
  onRetry?: () => void;
};

type State = { error: Error | null };

export class ViewportErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 保留原始错误供排查；生产环境下这里会出现在浏览器控制台与错误上报中。
    console.error("视口渲染失败：", error, info.componentStack);
  }

  private retry = () => {
    this.props.onRetry?.();
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    // 不额外包一层 DOM：children 就是视口内容，加 wrapper 会打乱既有布局。
    if (!error) return this.props.children;
    return (
      <div className="viewport-error" role="alert" data-testid="viewport-error">
        <p>{t("模型无法加载")}</p>
        <small className="viewport-error-reason">{error.message || t("未知错误")}</small>
        {this.props.hint && <small className="viewport-error-hint">{this.props.hint}</small>}
        <button type="button" className="primary" onClick={this.retry}>
          {t("重试")}
        </button>
      </div>
    );
  }
}
