# NUL Guard

Prevents coding agents from creating undeletable `nul` files on Windows.

## The problem

LLMs often emit `command > nul` to discard output — a Unix idiom. On Windows, under Git Bash / MSYS2, `nul` is just a filename. This creates a real file that **can't be deleted**, because `nul` is a reserved Win32 device name (like `CON`, `PRN`, `AUX`, `COM1-9`, `LPT1-9`).

## What it does

- **Intercepts `bash` calls** — rewrites `nul` redirects (`> nul`, `2>nul`, `>>nul`, `> nul.txt`) to `/dev/null`
- **Blocks `write`/`edit` calls** targeting reserved filenames, before the file is created
- **`/nul-cleanup`** — finds and removes existing reserved-name files using the Win32 `\\?\` prefix

Only active on Windows. No-op everywhere else.

## Files

| File | For |
|------|-----|
| `nul-guard-pi.ts` | [Pi Coding Agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) |
| `nul-guard-oh-my-pi.ts` | [Oh My Pi](https://www.npmjs.com/package/@oh-my-pi/pi-coding-agent) |

Identical logic — only the agent name and package reference differ.

## Install

Copy the matching file into the agent's extensions folder:

```
Pi:       ~/.pi/agent/extensions/nul-guard.ts
Oh My Pi: ~/.omp/agent/extensions/nul-guard.ts
```

Restart the agent — it loads automatically.

## Usage

Nothing to configure. Redirects and file writes are checked automatically.

If it's working, you'll see this when a redirect gets intercepted:

```
🛡️ NUL Guard: replaced 'nul' redirect -> '/dev/null'
```

To clean up files created before installing:

```
/nul-cleanup
```

It scans your project, lists any reserved-name files, and asks before deleting.