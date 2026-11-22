import fs from "node:fs";
import path from "node:path";

/** The nearest config within the current git repository, or at the app root outside Git. */
function locateConfig(from: string): { configFile: string | null; repoRoot: string } {
  const start = path.resolve(from);
  const configAt = (dir: string) => path.join(dir, ".remarq", "config.json");
  let found: string | null = null;
  for (let dir = start; ; ) {
    if (!found && fs.existsSync(configAt(dir))) found = configAt(dir);
    if (fs.existsSync(path.join(dir, ".git"))) return { configFile: found, repoRoot: dir };
    const parent = path.dirname(dir);
    if (parent === dir) {
      found = fs.existsSync(configAt(start)) ? configAt(start) : null;
      return { configFile: found, repoRoot: start };
    }
    dir = parent;
  }
}

export function resolveAgentRoot(from: string): string {
  const { configFile, repoRoot } = locateConfig(from);
  return configFile ? path.dirname(path.dirname(configFile)) : repoRoot;
}

function readJson(file: string | null): Record<string, unknown> | null {
  if (!file) return null;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function readLocalToken(from: string = process.cwd()): string | null {
  const token = readJson(locateConfig(from).configFile)?.token;
  return typeof token === "string" ? token : null;
}

const isPort = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535;

export function getLocalPairing(host: string | null, fetchSite: string | null, from = process.cwd()) {
  if (process.env.NODE_ENV !== "development" ||
      !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?$/i.test(host ?? "") ||
      (fetchSite !== null && fetchSite !== "same-origin")) return null;

  const { configFile } = locateConfig(from);
  if (!configFile) return null;
  const config = readJson(configFile);
  if (typeof config?.projectId !== "string" || typeof config.token !== "string") return null;
  const lockPort = readJson(path.join(path.dirname(configFile), "server.lock"))?.port;
  const port = isPort(lockPort) ? lockPort : isPort(config.port) ? config.port : undefined;
  return { projectId: config.projectId, token: config.token, ...(port === undefined ? {} : { port }) };
}
