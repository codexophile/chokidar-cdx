# chokidar-cdx

A Windows-first Node.js file watcher driven by YAML rules.

## Usage

1. Edit `rules.yaml` and create the directories referenced by your rules.
2. Start the watcher:

```powershell
npm start
```

Validate matching and action plans without side effects:

```powershell
npm run dry-run
```

Use another rules file with `node chokidar-cdx.js --config .\path\to\rules.yaml`.

Each rule must declare `watch.path`, `watch.pattern`, `events`, and `actions`. Patterns are globs by default; use `pattern: { type: regex, value: '...' }` for an explicit regular expression. Actions run sequentially unless grouped under `parallel`. Set `onError` to `continue`, or use `onError: { retry: { attempts: 3, delayMs: 500 } }` to retry a failed rule step.

Supported actions are `copy`, `move`, `exec`, `git`, `notify`, `http`, and `script`. Activity is written as JSON lines to `chokidar-cdx.log`.
