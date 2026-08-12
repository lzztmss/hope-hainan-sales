import { useEffect, useRef, useState } from "react";

import { Toast } from "./Toast";

type QuoteActionsProps = {
  quoteText: string;
  onReset: () => void;
};

type CopyResult = "idle" | "copied" | "manual";

const RESET_CONFIRMATION_ID = "reset-confirmation";
const RESET_CONFIRMATION_TITLE_ID = "reset-confirmation-title";
const MANUAL_COPY_ID = "manual-copy-text";

export const QuoteActions = ({ quoteText, onReset }: QuoteActionsProps) => {
  const [copyResult, setCopyResult] = useState<CopyResult>("idle");
  const [isResetConfirmationOpen, setIsResetConfirmationOpen] =
    useState(false);
  const resetTriggerRef = useRef<HTMLButtonElement>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const continueButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (copyResult !== "copied") {
      return;
    }

    const timer = window.setTimeout(() => setCopyResult("idle"), 3_000);
    return () => window.clearTimeout(timer);
  }, [copyResult]);

  useEffect(() => {
    if (!isResetConfirmationOpen) {
      return;
    }

    continueButtonRef.current?.focus();

    const handleModalKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsResetConfirmationOpen(false);
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = Array.from(
        confirmationRef.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
        ) ?? [],
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements.at(-1);

      if (!firstElement || !lastElement) {
        return;
      }

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener("keydown", handleModalKeyDown);
    return () => {
      document.removeEventListener("keydown", handleModalKeyDown);
      resetTriggerRef.current?.focus();
    };
  }, [isResetConfirmationOpen]);

  const copyQuote = async (): Promise<void> => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }

      await navigator.clipboard.writeText(quoteText);
      setCopyResult("copied");
    } catch {
      setCopyResult("manual");
    }
  };

  const confirmReset = (): void => {
    onReset();
    setCopyResult("idle");
    setIsResetConfirmationOpen(false);
  };

  return (
    <section aria-labelledby="quote-actions-title" className="quote-actions">
      <h2 id="quote-actions-title">报价操作</h2>
      <div className="action-buttons">
        <button type="button" className="primary-action" onClick={copyQuote}>
          复制报价
        </button>
        <button type="button" onClick={() => window.print()}>
          打印报价
        </button>
        <button
          ref={resetTriggerRef}
          type="button"
          className="reset-action"
          aria-haspopup="dialog"
          aria-expanded={isResetConfirmationOpen}
          aria-controls={RESET_CONFIRMATION_ID}
          onClick={() => setIsResetConfirmationOpen(true)}
        >
          重置报价
        </button>
      </div>

      {copyResult === "copied" ? <Toast message="报价已复制" /> : null}

      {copyResult === "manual" ? (
        <div className="copy-fallback" role="alert">
          <p>自动复制失败，请手动复制以下报价文本。</p>
          <label htmlFor={MANUAL_COPY_ID}>手动复制报价</label>
          <textarea
            id={MANUAL_COPY_ID}
            value={quoteText}
            readOnly
            rows={12}
            onFocus={(event) => event.currentTarget.select()}
            onClick={(event) => event.currentTarget.select()}
          />
        </div>
      ) : null}

      {isResetConfirmationOpen ? (
        <div
          ref={confirmationRef}
          id={RESET_CONFIRMATION_ID}
          className="reset-confirmation"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={RESET_CONFIRMATION_TITLE_ID}
        >
          <h3 id={RESET_CONFIRMATION_TITLE_ID}>确认重置报价</h3>
          <p>当前选择和 FTTR 金额将恢复为默认状态。</p>
          <div>
            <button
              ref={continueButtonRef}
              type="button"
              onClick={() => setIsResetConfirmationOpen(false)}
            >
              继续编辑
            </button>
            <button type="button" className="reset-action" onClick={confirmReset}>
              确认重置
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
};
