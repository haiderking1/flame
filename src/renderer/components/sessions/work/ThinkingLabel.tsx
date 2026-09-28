import "./thinking-label.css";
export function ThinkingLabel({ children, active = true }: { children: string; active?: boolean }) {
  return <span className={active ? "thinking-label thinking-label--active" : "thinking-label"}>{children}</span>;
}
