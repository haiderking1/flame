# Bash execution

The backend connects Responses function calls to durable session-owned Bash jobs. `agent-loop.ts` returns each tool result to the provider and continues until an answer, cancellation, failure, or the 32-step limit. Execution is direct: there is no approval system or systemd dependency.

## Lifecycle

- `store.ts` persists jobs in each session's SQLite database. The claim is committed before spawn. The process identity is committed before releasing an stdin gate that permits the shell to execute the command. A repeated call identifier observes the existing claim, never launches again.
- `process.ts` starts a noninteractive shell in the project's directory with an explicitly selected environment and its own POSIX process group. Actual command stdin is `/dev/null`. Each call starts fresh; shell variables and directory changes do not carry to later calls.
- There are no command execution, inactivity, or post-exit timeouts. Spawn failure and shell exit are reported independently of inherited stdout/stderr handles. Stop signals the group with SIGKILL. A stop request is not reported as successful termination until the OS reports exit.
- The job owns ordinary descendants in its process group. Shell exit also kills leftovers. To run in the background, use the tool's `background` argument, not `&`, daemonization, or a new session/group.
- `service.ts` checkpoints bounded output while the job runs. Checkpoint failure requests termination instead of silently continuing side effects. UI watches expose command, state, output, and an explicit per-job Stop action.
- A foreground call waits for process completion, but cancelling the agent releases that wait immediately. Background calls return a job ID immediately. Completion is saved in SQLite and an event wakes the model when idle, or is consumed at the next loop boundary. The model need not poll. Notifications are acknowledged after the continuation is claimed/checkpointed. A crash in delivery has an uncertain model outcome and never causes automatic command replay.
- Composer Stop cancels the model loop and requests termination of that session's running jobs; it suppresses their automatic follow-up notifications. Graceful backend shutdown records interrupted jobs and requests group termination.

## Output and limits

Stdout and stderr are continuously drained into a combined UTF-8 tail bounded at 64 KiB. Earlier output is discarded, not spooled; truncation is explicit. Process completion and output-pipe closure are distinct: `output_complete: false` means further output may still arrive. A later job-status read obtains the current tail without rerunning anything.

Four jobs may run concurrently across the backend, with 256 durable jobs per session. The UI shows the most recent 50 jobs plus any older jobs still running. Agent text is bounded at 1 MiB and provider conversation/output at 8 MiB. Bounds fail explicitly rather than silently launching more work or truncating conversation context.

## Recovery and platform boundaries

Linux recovery checks boot ID, process start time, and group-leader identity before signalling a persisted PID. Unverifiable ownership is reported as an interrupted/unknown outcome; the PID is not blindly killed and the command is never replayed. Effects may already have occurred. Job records and output checkpoints survive renderer reloads and backend restarts, but a crashed backend's live process is not adopted as a resumable job.

Process groups are not a sandbox and do not contain descendants that deliberately escape into new groups/sessions. Kernel-uninterruptible processes cannot be guaranteed to exit promptly. POSIX cleanup is isolated in `platform.ts`; Windows launch is currently rejected rather than pretending to provide process-tree ownership there. No systemd services are used.

Bash has the current user's filesystem/network privileges. The working directory is not a security boundary. Backend authentication tokens are not injected into the process environment, but unrestricted shell access can read files accessible to that user, including sensitive files. Permissions are a separate future feature.
