import { readFileSync } from "node:fs";
// Isolate OS-specific identity and cleanup from jobs, storage, and the agent loop.
export function processIdentity(pid: number): string | null {
  if (process.platform !== "linux") return null;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    if (Number(fields[2]) !== pid) return null; // Only our own group leader.
    return `${readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()}:${fields[19]}`;
  } catch { return null; }
}
export function killGroup(pid: number) {
  try { process.kill(-pid, "SIGKILL"); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw new Error("Could not stop the command process group.");
    return false;
  }
}
export function recoverGroup(pid: number | null, identity: string | null) {
  if (!pid || !identity || processIdentity(pid) !== identity) return false;
  killGroup(pid);
  return true;
}
