export interface BashRequest {
  command: string;
  cwd: string;
  // Explicit environment only. Never inherit backend credentials accidentally.
  env: Readonly<Record<string, string>>;
}
export interface BashSnapshot {
  id: string;
  pid: number | null;
  status: "running" | "exited" | "cancelled" | "failed";
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stopRequested: boolean;
  outputClosed: boolean;
  output: { text: string; bytes: number; truncated: boolean };
  error: string | null;
}
