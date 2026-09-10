import { Component, type ReactNode } from "react";

type AppErrorBoundaryProps = {
  children: ReactNode;
  onReload?: () => void;
};

type AppErrorBoundaryState = {
  hasError: boolean;
};

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error): void {
    console.error("系统页面运行失败", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="config-error">
          <section aria-labelledby="config-error-title">
            <p className="config-error-mark" aria-hidden="true">!</p>
            <h1 id="config-error-title">当前页面暂时无法使用</h1>
            <p>页面运行时遇到问题，请刷新后重试；如仍无法使用，请联系项目工作人员。</p>
            <button
              type="button"
              onClick={
                this.props.onReload ?? (() => window.location.reload())
              }
            >
              刷新重试
            </button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
