import { SelectMenu } from "./SelectMenu";
import "./diff-scope-menu.css";

type Scope = "working" | "staged";
const options = [
  { value: "working", label: "Working tree" },
  { value: "staged", label: "Staged changes" },
] as const;

export function DiffScopeMenu({ value, onChange }: { value: Scope; onChange(value: Scope): void }) {
  return <SelectMenu value={value} options={options} onChange={onChange} label="Change scope" triggerClassName="diff-scope-trigger" menuClassName="diff-scope-menu" />;
}
