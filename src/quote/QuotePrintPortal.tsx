import { createPortal } from "react-dom";

import { QuotePrintDocument, type QuotePrintDocumentProps } from "./QuotePrintDocument";

type QuotePrintPortalProps = Omit<QuotePrintDocumentProps, "actions" | "preview">;

/**
 * Keep the browser print document outside the application layout. This prevents
 * legacy global print rules and hidden application chrome from changing the
 * quotation that is sent to the system print dialog.
 */
export const QuotePrintPortal = (props: QuotePrintPortalProps) => {
  if (typeof document === "undefined") return null;

  return createPortal(
    <div aria-hidden="true" className="quote-print-root">
      <QuotePrintDocument {...props} />
    </div>,
    document.body,
  );
};
