import type { SessionLocation } from "../../contracts/sessions.js";
import type { BashRuntime } from "./service.js";
export const bashTools = [
  { type: "function", name: "bash", description: "Run Bash in the project directory. No execution timeout. Use background=true for long-running commands and continue other work; a completion notification will arrive without polling. Do not append & or daemonize. Commands run directly without approval and can modify the filesystem. Never rerun a command merely because its outcome is unknown.", strict: true,
    parameters: { type: "object", properties: { command: { type: "string" }, background: { type: "boolean" } }, required: ["command", "background"], additionalProperties: false } },
  { type: "function", name: "bash_job", description: "Read a Bash job's current bounded output or explicitly stop it. Do not poll repeatedly: background completion notifications are automatic.", strict: true,
    parameters: { type: "object", properties: { job_id: { type: "string" }, action: { type: "string", enum: ["status", "stop"] } }, required: ["job_id", "action"], additionalProperties: false } },
];
export type ToolCall = { type: "function_call"; name: string; call_id: string; arguments: string };
export function calls(output: unknown[]): ToolCall[] { return output.filter((item): item is ToolCall => !!item && typeof item === "object" && "type" in item && item.type === "function_call"); }
export function jobResult(job: { id: string; status: string; exitCode: number | null; signal: string | null; text: string; truncated: boolean; outputClosed: boolean; message: string | null }) {
  return { job_id: job.id, status: job.status, exit_code: job.exitCode, signal: job.signal,
    output: job.text, truncated: job.truncated, output_complete: job.outputClosed && job.status !== "interrupted", message: job.message };
}
export async function executeCall(runtime: BashRuntime, location: SessionLocation, turnId: string, account: string, call: ToolCall, signal: AbortSignal) {
  try {
    const args = JSON.parse(call.arguments);
    if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Invalid arguments");
    if (call.name === "bash" && typeof args.command === "string" && typeof args.background === "boolean" && Object.keys(args).length === 2) {
      return jobResult(await runtime.execute(location, turnId, call.call_id, account, args.command, args.background, signal));
    }
    if (call.name === "bash_job" && typeof args.job_id === "string" && ["status", "stop"].includes(args.action) && Object.keys(args).length === 2) {
      const job = runtime.get(location, args.job_id);
      if (!job) return { error: "Bash job not found in this session." };
      if (args.action === "stop" && ["claimed", "running"].includes(job.status)) runtime.stop(location, job.id);
      return { ...jobResult(job), stop_requested: args.action === "stop" };
    }
    return { error: "Invalid Bash tool arguments. No command was launched." };
  } catch {
    if (signal.aborted) throw new Error("Tool execution cancelled");
    return { error: "Bash operation failed. Inspect existing jobs before doing anything else; do not assume the command had no effects or automatically rerun it." };
  }
}
