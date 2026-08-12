import type { FttrResult } from "../domain/types";

type FttrInputProps = {
  fttr: FttrResult;
  onChange: (raw: string) => void;
};

const INPUT_ID = "fttr-amount";
const HELP_ID = "fttr-help";
const ERROR_ID = "fttr-error";

export const FttrInput = ({ fttr, onChange }: FttrInputProps) => (
  <section aria-labelledby="fttr-title" className="fttr-input">
    <h2 id="fttr-title">联通 FTTR 金额</h2>
    <label htmlFor={INPUT_ID}>联通 FTTR 报价（选填）</label>
    <input
      id={INPUT_ID}
      type="text"
      inputMode="decimal"
      value={fttr.raw}
      placeholder="待联通填写"
      aria-invalid={fttr.error !== null}
      aria-describedby={fttr.error ? `${HELP_ID} ${ERROR_ID}` : HELP_ID}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
    <p id={HELP_ID}>未填写时按 0 元计入合计</p>
    {fttr.error ? (
      <p id={ERROR_ID} role="alert">
        {fttr.error}
      </p>
    ) : (
      <p>
        当前状态：<output htmlFor={INPUT_ID}>{fttr.display}</output>
      </p>
    )}
  </section>
);
