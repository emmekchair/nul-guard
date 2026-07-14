/**
 * NUL Guard — Pi Coding Agent extension
 *
 * Prevents creation of undeletable 'nul' files on Windows.
 *
 * Problem:
 *   LLMs generate `command > nul` thinking it's like /dev/null on Linux.
 *   Under Git Bash / MSYS2, `nul` is treated as a relative filename,
 *   creating a file that can't be deleted (Win32 reserved device name).
 *
 * Fix:
 *   1. Intercept bash tool calls -> replace `nul` redirects with `/dev/null`
 *   2. Intercept write/edit tool calls -> block Windows reserved filenames
 *   3. Register `/nul-cleanup` command -> delete existing reserved-name files
 *      using the \\?\ prefix to bypass Win32 reserved-name interception
 *
 * Only activates on Windows. No-op on macOS/Linux.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Windows reserved device names (case-insensitive).
// CON, PRN, AUX, NUL, COM1-COM9, LPT1-LPT9 -- with optional extension.
const RESERVED_FILE_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

// Nul in redirect context: >nul, > nul, 2>nul, >>nul, >> nul, > nul.txt, etc.
// Captures the redirect operator so we can replace with $1 /dev/null
// (dropping any trailing extension like .txt).
const NUL_REDIRECT_RE = /(\d?>>?)\s*(nul(?:\.[^\s]*)?)\b/gi;

const CLEANUP_HINT =
  " Use /nul-cleanup to delete existing reserved-name files.";

export default function (pi: ExtensionAPI) {
  if (process.platform !== "win32") return;

  pi.setLabel("NUL Guard");

  // ── Intercept tool calls ──

  pi.on("tool_call", async (event, ctx) => {
    // -- bash: replace nul redirects with /dev/null --
    if (event.toolName === "bash") {
      const command = event.input.command as string;
      const patched = command.replace(NUL_REDIRECT_RE, "$1 /dev/null");

      if (patched !== command) {
        event.input.command = patched;
        if (ctx.hasUI) {
          ctx.ui.notify(
            "🛡️ NUL Guard: replaced 'nul' redirect -> '/dev/null'",
            "info",
          );
        }
      }
      return;
    }

    // -- write/edit: block Windows reserved filenames --
    if (event.toolName === "write" || event.toolName === "edit") {
      const input = event.input as Record<string, unknown>;
      const filePath = typeof input?.path === "string" ? input.path : "";
      if (!filePath) return;
      const filename = filePath.split(/[/\\]/).pop() ?? "";

      if (RESERVED_FILE_RE.test(filename)) {
        if (ctx.hasUI) {
          ctx.ui.notify(
            '⛔ NUL Guard: blocked "' +
              filename +
              '" - Windows reserved name.' +
              CLEANUP_HINT,
            "warning",
          );
        }
        return {
          block: true,
          reason:
            '"' +
            filename +
            '" is a Windows reserved device name ' +
            "(CON, PRN, AUX, NUL, COM1-9, LPT1-9). " +
            "Use a different filename." +
            CLEANUP_HINT,
        };
      }
      return;
    }
  });

  // ── /nul-cleanup command: delete existing reserved-name files ──

  pi.registerCommand("nul-cleanup", {
    description:
      "Delete files with Windows reserved names " +
      "(nul, con, aux, prn, com1-9, lpt1-9) from the project.",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;

      const cwd = ctx.cwd;

      // Build reserved-name list
      const reservedNames: string[] = [
        "nul", "NUL",
        "con", "CON",
        "aux", "AUX",
        "prn", "PRN",
      ];
      for (let i = 1; i <= 9; i++) {
        reservedNames.push("com" + i, "COM" + i, "lpt" + i, "LPT" + i);
      }

      // Single cmd.exe call: scan via \\?\ prefix
      const quotedCwd = "\\??\\" + cwd;
      const ifExistsLines: string[] = [];
      for (const n of reservedNames) {
        ifExistsLines.push(
          'if exist "' + quotedCwd + "\\" + n + '" echo ' + n,
        );
      }
      const batchScript = ifExistsLines.join("\r\n");

      let found: string[] = [];
      try {
        const r = await pi.exec("cmd.exe", ["/c", batchScript]);
        const stdout = r.stdout ?? "";
        found = stdout
          .split(/\r?\n/)
          .map((s: string) => s.trim())
          .filter((s: string) => s.length > 0);
      } catch {
        // ignore errors
      }

      // Dedupe (NTFS is case-insensitive: "nul" === "NUL")
      const deduped = new Set(found.map((s) => s.toLowerCase()));
      found = [...deduped];

      if (found.length === 0) {
        ctx.ui.notify("No reserved-name files found in project.", "info");
        return;
      }

      ctx.ui.notify(
        "Found " +
          found.length +
          " reserved-name file(s): " +
          found.join(", "),
        "info",
      );

      const confirmed = await ctx.ui.confirm(
        "Delete these files?",
        "Windows-reserved files to delete:\n" + found.join("\n"),
      );
      if (!confirmed) {
        ctx.ui.notify("Skipped.", "info");
        return;
      }

      // Batch delete via \\?\ prefix
      const targets = found
        .map((n) => '"\\??\\' + cwd + "\\" + n + '"')
        .join(" ");

      let deleted = 0;
      try {
        const r = await pi.exec("cmd.exe", ["/c", "del /f /q " + targets]);
        deleted = r.code === 0 ? found.length : 0;
      } catch {
        // fall through
      }

      if (deleted === found.length) {
        ctx.ui.notify(
          "Cleaned up " + deleted + " reserved-name file(s).",
          "info",
        );
      } else {
        ctx.ui.notify(
          "Cleaned up " +
            deleted +
            " / " +
            found.length +
            ". Some files could not be deleted.",
          "warning",
        );
      }
    },
  });
}
