export const RegionalActionErrorDialog = ({
  message,
  onClose,
}: {
  message: string | null;
  onClose: () => void;
}) => message ? (
  <div className="regional-action-dialog-backdrop" role="presentation">
    <section aria-labelledby="regional-action-error-title" aria-modal="true" className="regional-action-dialog" role="alertdialog">
      <span className="regional-action-dialog__icon" aria-hidden="true">!</span>
      <div>
        <h2 id="regional-action-error-title">操作未执行</h2>
        <p>{message}</p>
      </div>
      <button autoFocus className="regional-primary-action" type="button" onClick={onClose}>我知道了</button>
    </section>
  </div>
) : null;
