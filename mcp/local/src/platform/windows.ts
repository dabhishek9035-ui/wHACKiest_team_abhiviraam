// owner: M4 (D Venkata Abhishek, 1TD25CS079)
// purpose: all Windows-specific behaviour of the Local MCP server lives here:
//          env-var expansion for config paths, real-path resolution with symlink
//          awareness, root containment checks, Chrome discovery/launch, allowlisted
//          app launch, and the capped-output restricted process runner.
// public interface it must expose: expandEnvVars, realpathNative,
//          nearestExistingRealpath, isPathInside, openInChrome, launchApp,
//          spawnCapture, resolveWithinRoots (with Scopes type), CLEAN_ENV.
// consumed by: tools/*.ts, server.ts.
// TODO: none (implemented).

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { LocalToolError } from "../types.js";

/** Environment used by restricted child processes: minimal, never passes secrets. */
export function buildCleanEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const keep = [
    "PATH",
    "PATHEXT",
    "SystemRoot",
    "windir",
    "TEMP",
    "TMP",
    "COMPUTERNAME",
    "PROCESSOR_ARCHITECTURE",
  ];
  const clean: NodeJS.ProcessEnv = {};
  for (const k of keep) {
    const v = env[k];
    if (v !== undefined) clean[k] = v;
  }
  return clean;
}

/** Expands %VAR% references using the given environment; unknown vars fail closed. */
export function expandEnvVars(input: string, env: NodeJS.ProcessEnv): string {
  return input.replace(/%([A-Za-z0-9_()$-]+)%/g, (_m, name: string) => {
    const v = env[name];
    if (v === undefined || v === "") {
      throw new LocalToolError("config_invalid", `environment variable %${name}% is not set`);
    }
    return v;
  });
}

export function realpathNative(p: string): string {
  return realpathSync.native(p);
}

/**
 * Real path of the nearest existing ancestor plus the not-yet-existing tail.
 * This is how we detect symlink escapes for paths that do not exist yet.
 */
export function nearestExistingRealpath(
  target: string,
): { realAncestor: string; tail: string[] } {
  let probe = target;
  const tail: string[] = [];
  for (;;) {
    if (existsSync(probe)) {
      const real = realpathSync.native(probe);
      return { realAncestor: real, tail };
    }
    const parent = path.dirname(probe);
    if (parent === probe) {
      throw new LocalToolError("config_invalid", `cannot resolve real path for ${target}`);
    }
    tail.unshift(path.basename(probe));
    probe = parent;
  }
}

/** Win32-aware containment check (case-insensitive, separator boundary respected). */
export function isPathInside(root: string, child: string): boolean {
  const normRoot = path.resolve(root).toLowerCase();
  const normChild = path.resolve(child).toLowerCase();
  if (normChild === normRoot) return true;
  const prefix = normRoot.endsWith(path.sep) ? normRoot : normRoot + path.sep;
  return normChild.startsWith(prefix);
}

export interface ResolvedRoot {
  id: string;
  absolute: string;
  realpath: string;
  description?: string;
}

/**
 * Resolves a user-supplied path against the approved roots:
 * - absolute input must land inside an approved root after resolution;
 * - relative input resolves under the default root;
 * - `..` traversal and symlink escapes are rejected (fail closed).
 */
export function resolveWithinRoots(
  roots: ResolvedRoot[],
  defaultRootId: string | undefined,
  rawPath: string,
  opts?: { rootId?: string; mustExist?: boolean; createRoot?: boolean },
): { target: string; root: ResolvedRoot } {
  if (typeof rawPath !== "string" || rawPath.trim() === "") {
    throw new LocalToolError("path_outside_scope", "path is required");
  }
  let root: ResolvedRoot | undefined;
  if (opts?.rootId) {
    root = roots.find((r) => r.id === opts.rootId);
    if (!root) throw new LocalToolError("config_invalid", `unknown root id: ${opts.rootId}`);
  }
  if (!root) {
    const def = defaultRootId ? roots.find((r) => r.id === defaultRootId) : undefined;
    root = def ?? roots[0];
    if (!root) throw new LocalToolError("config_invalid", "no approved roots configured");
  }

  const absolute = path.isAbsolute(rawPath)
    ? path.resolve(rawPath)
    : path.resolve(root.absolute, rawPath);

  // Symlink-aware real path of the nearest existing ancestor.
  const { realAncestor, tail } = nearestExistingRealpath(absolute);

  const candidate = tail.length > 0 ? path.join(realAncestor, ...tail) : realAncestor;
  const lexicalInside = isPathInside(root.absolute, absolute);
  const realInside =
    isPathInside(root.realpath, realAncestor) && isPathInside(root.realpath, candidate);
  if (!realInside) {
    if (lexicalInside) {
      // The written path looks like it is inside the root, but the resolved real
      // path escapes it — a symlink/junction led us out (fail closed).
      throw new LocalToolError("symlink_escape", "path escapes the approved root through a symlink");
    }
    const code = rawPath.includes("..") ? "path_traversal" : "path_outside_scope";
    throw new LocalToolError(code, "path resolves outside the approved roots");
  }

  if (opts?.mustExist && !existsSync(candidate)) {
    throw new LocalToolError("path_not_found", `no such directory: ${candidate}`);
  }
  if (opts?.createRoot && !existsSync(root.absolute)) {
    mkdirSync(root.absolute, { recursive: true });
  }
  return { target: candidate, root };
}

/**
 * Locates Chrome. An explicit `chromePath` in config is authoritative: if it is set
 * but missing, we fail closed (no fallback) instead of silently opening another browser.
 */
export function findChrome(chromePath: string | undefined, env: NodeJS.ProcessEnv): string | null {
  if (chromePath && chromePath.trim() !== "") {
    const configured = expandEnvVars(chromePath, env);
    try {
      return existsSync(configured) ? configured : null;
    } catch {
      return null;
    }
  }
  for (const base of ["ProgramFiles", "ProgramFiles(x86)", "LocalAppData"]) {
    const dir = env[base];
    if (!dir) continue;
    const candidate = path.join(dir, "Google", "Chrome", "Application", "chrome.exe");
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      // skip unreadable candidates
    }
  }
  return null;
}

/** Opens an already-validated URL in Chrome (detached, no shell). */
export function openInChrome(
  url: string,
  chromePath: string | undefined,
  env: NodeJS.ProcessEnv,
): { chrome: string; pid?: number } {
  const chrome = findChrome(chromePath, env);
  if (!chrome) {
    throw new LocalToolError(
      "chrome_not_found",
      "Chrome was not found; set chromePath in config/local-scopes.json",
    );
  }
  try {
    const child = spawn(chrome, [url], {
      detached: true,
      stdio: "ignore",
      shell: false,
      windowsHide: true,
    });
    child.once("error", () => {
      /* detached fire-and-forget: caller sees no UI open and marks unknown */
    });
    child.unref();
    return { chrome, pid: child.pid };
  } catch (err) {
    throw new LocalToolError("launch_failed", `could not launch Chrome: ${String(err)}`);
  }
}

export interface AppSpec {
  executable: string;
  args?: string[];
}

/** Launches an allowlisted application (detached, no shell, no elevation). */
export function launchApp(
  appId: string,
  spec: AppSpec,
  env: NodeJS.ProcessEnv,
): { pid?: number } {
  const exe = expandEnvVars(spec.executable, env);
  try {
    const child = spawn(exe, spec.args ?? [], {
      detached: true,
      stdio: "ignore",
      shell: false,
      windowsHide: true,
    });
    child.once("error", () => {
      /* fire-and-forget like Chrome: launch result is not locally verifiable */
    });
    child.unref();
    return { pid: child.pid };
  } catch (err) {
    throw new LocalToolError("launch_failed", `could not launch app ${appId}: ${String(err)}`);
  }
}

export interface SpawnOutcome {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  truncated: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/**
 * Runs a process with hard limits: fixed cwd, timeout kill, per-stream output cap,
 * clean minimal environment, no shell, no elevation. Returns a capped summary.
 */
export function spawnCapture(
  executable: string,
  argv: string[],
  opts: { cwd: string; timeoutMs: number; maxOutputBytes: number; env: NodeJS.ProcessEnv },
): Promise<SpawnOutcome> {
  return new Promise<SpawnOutcome>((resolve) => {
    const started = Date.now();
    const child = spawn(executable, argv, {
      cwd: opts.cwd,
      shell: false,
      windowsHide: true,
      env: buildCleanEnv(opts.env),
    });

    let timedOut = false;
    let truncated = false;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const stdoutLen = { n: 0 };
    const stderrLen = { n: 0 };

    const cap = (chunks: Buffer[], sizeRef: { n: number }, data: Buffer): void => {
      const room = Math.max(0, opts.maxOutputBytes - sizeRef.n);
      if (data.length > room) {
        truncated = true;
        if (room > 0) chunks.push(data.subarray(0, room));
        sizeRef.n += data.length;
        return;
      }
      chunks.push(data);
      sizeRef.n += data.length;
    };

    child.stdout?.on("data", (d: Buffer) => cap(stdout, stdoutLen, d));
    child.stderr?.on("data", (d: Buffer) => cap(stderr, stderrLen, d));

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // already gone
      }
    }, opts.timeoutMs);

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      clearTimeout(timer);
      resolve({
        exitCode,
        signal,
        timedOut,
        truncated,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        durationMs: Date.now() - started,
      });
    };

    child.once("error", (err) => {
      clearTimeout(timer);
      // spawn failure (e.g. executable not found) surfaces as an error event
      resolve({
        exitCode: null,
        signal: null,
        timedOut,
        truncated,
        stdout: "",
        stderr: `spawn error: ${String(err)}`,
        durationMs: Date.now() - started,
      });
    });
    child.once("close", (code, signal) => finish(code, signal));
  });
}

/** Convenience used by fs_list_dir result building. */
export function listDirectory(
  target: string,
  limit: number,
): { entries: Array<{ name: string; type: "dir" | "file" | "other" }>; truncated: boolean } {
  const dirents = readdirSync(target, { withFileTypes: true });
  const entries = dirents
    .slice(0, limit)
    .map((d) => ({
      name: d.name,
      type: d.isDirectory() ? ("dir" as const) : d.isFile() ? ("file" as const) : ("other" as const),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { entries, truncated: dirents.length > limit };
}

export function statIsDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
