import type { QuoteMode } from "../domain/types";

type ModeSelectorProps = {
  mode: QuoteMode;
  onChange: (mode: QuoteMode) => void;
};

export const ModeSelector = ({ mode, onChange }: ModeSelectorProps) => (
  <section aria-labelledby="mode-selector-title" className="mode-selector">
    <h2 id="mode-selector-title">快速开始</h2>
    <div className="mode-options">
      <button
        type="button"
        aria-pressed={mode === "guardian"}
        onClick={() => onChange("guardian")}
      >
        轻量守护组合
      </button>
      <button
        type="button"
        aria-pressed={mode === "home"}
        onClick={() => onChange("home")}
      >
        按户型推荐
      </button>
    </div>
  </section>
);
