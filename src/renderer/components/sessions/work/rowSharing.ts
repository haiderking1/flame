import type { BashJob } from "@contracts/bash";
import type { WorkStep } from "@contracts/work";
/** Share snapshot members when a stream republishes unchanged records. */
export function shareJobs(previous: readonly BashJob[], incoming: readonly BashJob[]): readonly BashJob[] {
  const known = new Map(previous.map(job => [job.id, job]));
  const next = incoming.map(job => {
    const old = known.get(job.id);
    return old && Object.keys(job).every(key => job[key as keyof BashJob] === old[key as keyof BashJob]) ? old : job;
  });
  return next.length === previous.length && next.every((job, index) => job === previous[index]) ? previous : next;
}
export function shareSteps(previous: readonly WorkStep[], incoming: readonly WorkStep[]): readonly WorkStep[] {
  const known = new Map(previous.map(step => [step.id, step]));
  const next = incoming.map(step => {
    const old = known.get(step.id);
    if (!old || old.kind !== step.kind) return step;
    if (step.kind === "message" && old.kind === "message") return step.text === old.text ? old : step;
    if (step.kind === "tool" && old.kind === "tool") {
      const sameFile = step.file === old.file || !!step.file && !!old.file && step.file.status === old.file.status && step.file.summary === old.file.summary && step.file.output === old.file.output && step.file.truncated === old.file.truncated && step.file.image?.id === old.file.image?.id;
      if (sameFile && step.callId === old.callId && step.name === old.name && step.command === old.command && step.jobId === old.jobId && step.error === old.error && step.deferred === old.deferred) return old;
    }
    return step;
  });
  return next.length === previous.length && next.every((step, index) => step === previous[index]) ? previous : next;
}
