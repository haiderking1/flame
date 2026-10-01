export function processMemory(app) {
  return app.getAppMetrics().map(process => ({ type: process.type, workingSetMiB: process.memory.workingSetSize / 1024, peakWorkingSetMiB: process.memory.peakWorkingSetSize / 1024, cpuPercent: process.cpu.percentCPUUsage }));
}
