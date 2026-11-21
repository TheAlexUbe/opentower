/**
 * Ralph provider auto-start.
 *
 * Starts the Ralph provider (`opencode-ralph-rlm serve`) when OpenCode loads so
 * you don't have to run it by hand. Idempotent — the serve CLI's pre-flight
 * check refuses to start a duplicate provider. Disable with RALPH_AUTOSTART=0
 * (or delete this file). Provider logs go to <tmp>/opencode-ralph-rlm/provider.log.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { openSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const RalphAutostartPlugin = async (ctx) => {
  const flag = (process.env.RALPH_AUTOSTART ?? "").trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "no") return {};
  try {
    const cli = join(dirname(createRequire(import.meta.url).resolve("@doeixd/opencode-ralph-rlm")), "opencode-ralph-rlm.js");
    const port = process.env.RALPH_PROVIDER_PORT?.trim() || "8787";
    const wt = ctx?.worktree && ctx.worktree !== "/" ? ctx.worktree : process.cwd();
    const logDir = join(tmpdir(), "opencode-ralph-rlm");
    try { mkdirSync(logDir, { recursive: true }); } catch {}
    const out = openSync(join(logDir, "provider.log"), "a");
    // Launch with Node (NOT process.execPath — that is the opencode binary here)
    // and pipe stdio to a file (NOT "ignore" — a detached child with ignored
    // stdio is killed on Windows). detached + unref lets the provider outlive
    // OpenCode and be reused on the next launch. windowsHide stops a console
    // window from popping up on Windows.
    const child = spawn("node", [cli, "serve", "--port", port, "--worktree", wt], {
      detached: true,
      stdio: ["ignore", out, out],
      windowsHide: true,
    });
    child.unref();
  } catch {
    // best-effort — provider can still be started with `opencode-ralph-rlm serve`
  }
  return {};
};

export default RalphAutostartPlugin;
