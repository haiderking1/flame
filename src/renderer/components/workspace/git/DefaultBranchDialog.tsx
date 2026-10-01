import { GitDialogFrame } from "./GitDialogFrame";
import type { DefaultBranchCopy } from "./gitActionLogic";

/** Asks before pushing or opening a change request from the default branch, offering a feature branch instead. */
export default function DefaultBranchDialog({ copy, onChoose }: { copy: DefaultBranchCopy; onChoose(choice: "continue" | "feature" | "abort"): void }) {
  return <GitDialogFrame className="git-dialog--wide" title={copy.title} description={copy.description} onClose={() => onChoose("abort")} footer={<>
    <button type="button" className="git-button git-button--outline git-dialog__abort" onClick={() => onChoose("abort")}>Abort</button>
    <button type="button" className="git-button git-button--outline git-button--multiline" onClick={() => onChoose("continue")}>{copy.continueLabel}</button>
    <button type="button" className="git-button git-button--primary git-button--multiline" autoFocus onClick={() => onChoose("feature")}>Check out feature branch &amp; continue</button>
  </>} />;
}
