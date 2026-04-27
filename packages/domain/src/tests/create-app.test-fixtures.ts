import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function createIo() {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      stdout: {
        write(chunk: string) {
          stdout += chunk;
          return true;
        },
      },
      stderr: {
        write(chunk: string) {
          stderr += chunk;
          return true;
        },
      },
    },
    read: () => ({ stdout, stderr }),
  };
}

export async function createTrackedTargetDir(tempDirs: string[]) {
  const targetDir = await mkdtemp(join(tmpdir(), "ek-domain-create-app-"));
  tempDirs.push(targetDir);
  return targetDir;
}

export async function cleanupTempDirs(tempDirs: string[]) {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
