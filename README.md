# chokidar-cdx

A Windows-first Node.js file watcher driven by YAML rules. It watches one or more directories, filters filesystem events, and runs file, process, Git, notification, or HTTP actions when a matching file changes.

## Usage

See [Quick start](#quick-start) for installation and startup, and [Rule configuration](#rule-configuration) for the YAML schema.

## Requirements

- Node.js with native `fetch` support (Node.js 18 or newer is recommended).
- Git installed and available on `PATH` for `git` actions.
- A Git working tree in the project directory when using `git` actions. The project directory is the directory containing `chokidar-cdx.js`.

## Quick start

1. Edit `rules.yaml` and create the directories referenced by your rules.
2. Start the watcher:

```powershell
npm start
```

3. Change or create a matching file. The watcher prints JSON events and appends them to `chokidar-cdx.log`.

Validate the configuration and matching flow without changing files, running commands, staging Git files, sending HTTP requests, or committing:

```powershell
npm run dry-run
```

Use another rules file:

```powershell
node .\chokidar-cdx.js --config .\examples\rules.yaml
node .\chokidar-cdx.js --config C:\work\shared-rules.yaml --dry-run
```

The process stays active until it is stopped with `Ctrl+C`. The `debug` script starts Node's inspector:

```powershell
npm run debug
```

## Rule configuration

The configuration file is YAML with a top-level `rules` array. By default, the application reads `rules.yaml` beside `chokidar-cdx.js`.

```yaml
rules:
  - name: markdown-copy
    watch:
      path: ./watch
      pattern: '**/*.md'
    actions:
      - type: copy
        destination: './dist/{{filename}}'
      - parallel:
          - type: notify
            message: 'Copied {{filename}}'
          - type: exec
            command: 'node --version'
```

### Rule fields

| Field                      | Required | Description                                                                                                                                                   |
| -------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                     | Yes      | Unique, descriptive name used in logs and debounce keys.                                                                                                      |
| `enabled`                  | No       | Set to `false` to disable a rule. Defaults to enabled. At least one rule must be enabled.                                                                     |
| `watch.path`               | Yes      | Directory or path passed to Chokidar. Relative paths are resolved from the process working directory.                                                         |
| `watch.pattern`            | Yes      | A glob string or a regex object. Matching checks both the path relative to `watch.path` and the file name.                                                    |
| `watch.subfolders`         | No       | Defaults to `false`, so only the watched directory is monitored. Set to `true` for all nested directories, or use a nonnegative integer for a specific depth. |
| `events`                   | No       | One or more of `add`, `change`, `unlink`, `addDir`, or `unlinkDir`. Defaults to `[add, change]`.                                                              |
| `debounce`                 | No       | Delay in milliseconds before the matching rule runs. A later event for the same rule and path resets the timer. Defaults to `500`.                            |
| `conditions.minSizeBytes`  | No       | Skip the rule unless the current file is at least this many bytes. Defaults to `0`; this is most useful for `add` and `change` events.                        |
| `conditions.ignoreInitial` | No       | Defaults to `true`, so existing files do not trigger events at startup. Set to `false` to process initial files.                                              |
| `onError`                  | No       | `stop`, `continue`, or a retry object. Defaults to `stop`; invalid values fail configuration validation.                                                      |
| `actions`                  | Yes      | Ordered action steps. Each step is one action or a `parallel` group.                                                                                          |

Glob patterns use picomatch syntax. Examples include `*.md` for Markdown files in the watched directory, `**/*.json` for JSON files in nested directories, and `dist/**` for everything below `dist`. A pattern does not enable recursive monitoring by itself; set `watch.subfolders` explicitly when nested directories should be watched. Use a regular expression when a glob is not expressive enough:

```yaml
watch:
  path: ./incoming
  pattern:
    type: regex
    value: '^report-\\d{4}-\\d{2}\\.csv$'
  subfolders: false
```

To monitor nested directories, use `subfolders: true` for unlimited depth or `subfolders: 1` to include files one directory below the watched path:

```yaml
watch:
  path: ./incoming
  pattern: '**/*.json'
  subfolders: true
```

## Templates and action order

String values can contain `{{placeholder}}` templates. The available context is:

| Placeholder           | Value                                                           |
| --------------------- | --------------------------------------------------------------- |
| `{{filepath}}`        | Absolute path of the event file.                                |
| `{{filename}}`        | File name including its extension.                              |
| `{{dirname}}`         | Absolute parent directory.                                      |
| `{{event}}`           | Chokidar event name.                                            |
| `{{timestamp}}`       | ISO timestamp captured when the rule starts.                    |
| `{{destinationPath}}` | Destination set by a completed `copy` or `move` action.         |
| `{{stdout}}`          | Standard output from the most recent `exec` or `script` action. |
| `{{exitCode}}`        | Exit code from the most recent `exec` action.                   |
| `{{commitHash}}`      | Commit hash captured by a committing `git` action.              |

Templates are resolved recursively in strings, arrays, and nested objects. Actions run in YAML order. A `parallel` step starts all of its child actions together; if any child fails, the step fails after all children settle.

```yaml
actions:
  - type: copy
    destination: './archive/{{event}}/{{filename}}'
  - type: exec
    command: 'powershell -NoProfile -Command "Get-Item -LiteralPath ''{{destinationPath}}''"'
  - type: notify
    message: '{{filename}} processed at {{timestamp}}'
```

## Supported actions

### `copy` and `move`

Copy or move the event file to `destination`. Parent directories are created automatically. The destination can use templates.

```yaml
actions:
  - type: copy
    destination: './dist/{{filename}}'
  - type: move
    destination: './processed/{{filename}}'
```

Use separate rules when you need both operations: a move changes the watched file's location, so later actions in the same rule should use `{{destinationPath}}` if they need the new path.

### `exec`

Run a shell command. The command runs with the watcher project directory as its default working directory; set `cwd` to override it. Templates are available in `command` and `cwd`.

```yaml
- type: exec
  cwd: './tools'
  command: 'node build-report.js "{{filepath}}"'
```

A non-zero exit code is an action failure and follows the rule's `onError` policy.

### `script`

Run a script or executable path through the shell from the watcher project directory.

```yaml
- type: script
  path: 'powershell -NoProfile -File .\scripts\publish.ps1 -InputFile "{{filepath}}"'
```

### `notify`

Write a notification message to the JSON log and console. This does not display a Windows toast or send a network request.

```yaml
- type: notify
  message: 'Changed {{filename}} in {{dirname}}'
```

### `http`

Send an HTTP request using `fetch`. The default method is `POST`; provide `method`, `headers`, and an optional structured `body`. A non-2xx response fails the action.

```yaml
- type: http
  url: 'http://localhost:3000/hooks/files'
  method: POST
  headers:
    content-type: application/json
  body:
    file: '{{filename}}'
    event: '{{event}}'
    path: '{{filepath}}'
```

### `git`

Stage the event file with `git add`. Set `commit: true` to create a commit, and `push: true` to push after that commit. The default commit message is `auto: update <filename>`; use `message` to customize it.

```yaml
- type: git
  commit: true
  message: 'docs: update {{filename}}'
  push: false
```

The action runs Git from the watcher project directory. Git credentials, branch selection, remotes, hooks, and authentication remain under normal Git configuration. A Git action does not automatically create a branch, pull, resolve conflicts, or commit unrelated changes.

## Git workflows

### Stage generated files for review

This leaves the change staged so a developer can inspect and amend it before committing:

```yaml
rules:
  - name: stage-generated-doc
    watch:
      path: ./generated
      pattern: '*.md'
    events: [add, change]
    debounce: 750
    actions:
      - type: git
```

Inspect the result from another PowerShell window:

```powershell
git status --short
git diff --cached -- generated\README.md
git commit -m "docs: review generated README"
```

### Commit documentation updates automatically

```yaml
rules:
  - name: commit-docs
    watch:
      path: ./docs
      pattern: '**/*.md'
    events: [add, change]
    debounce: 2000
    actions:
      - type: git
        commit: true
        message: 'docs: update {{filename}}'
      - type: notify
        message: 'Committed {{filename}} as {{commitHash}}'
```

The debounce matters here: it groups rapid editor saves, but each matching path still produces its own rule execution. Keep `commit: true` rules narrow so a commit contains only the intended staged file plus any changes already staged by the user.

### Commit and push a release artifact

```yaml
rules:
  - name: publish-release-manifest
    watch:
      path: ./release
      pattern: 'manifest.json'
    events: [change]
    conditions:
      minSizeBytes: 2
    onError:
      retry:
        attempts: 3
        delayMs: 2000
    actions:
      - type: git
        commit: true
        push: true
        message: 'release: update manifest'
      - type: notify
        message: 'Pushed release manifest {{commitHash}}'
```

Run this only in a working tree with a configured upstream and non-interactive Git authentication. Test it first with `--dry-run`, then use `push: false` until the generated commit is trustworthy.

### Use an external script for a Git policy

The built-in Git action intentionally performs only add, optional commit, and optional push. Put validation, branch checks, signing, or pull-request automation in a script action:

```yaml
rules:
  - name: validate-and-stage-schema
    watch:
      path: ./schemas
      pattern: '*.json'
    events: [add, change]
    actions:
      - type: script
        path: 'powershell -NoProfile -File .\scripts\validate-schema.ps1 -Path "{{filepath}}"'
      - type: git
```

## Error handling and retries

The default `onError: stop` stops the current rule after the failed step; it does not terminate the watcher process. `onError: continue` records the failure and continues with the next action step. Retry a failed step with either `onError: retry` (three attempts) or an explicit policy:

```yaml
onError:
  retry:
    attempts: 5
    delayMs: 1000
```

Retries apply to the whole action step, including every child of a `parallel` step. A condition that does not match is a skip, not an error.

## Logging and troubleshooting

Every log entry is a JSON object on one line. Entries include an ISO `timestamp`, a `message`, and event-specific fields such as `rule`, `filePath`, `event`, `attempt`, or `error`. The log file is `chokidar-cdx.log` beside the script, while console output is also emitted.

Useful checks:

```powershell
Get-Content .\chokidar-cdx.log -Wait
git status --short
node --version
git --version
```

- No rule starts: confirm `enabled` is not `false`, the event is listed, and the pattern matches the relative path or file name.
- Existing files do not run at startup: set `conditions.ignoreInitial: false`.
- A file is processed repeatedly: increase `debounce`, narrow the pattern, or avoid watching an output directory that an action writes into.
- Copy or move fails: check that the source still exists and that the destination is not the same path.
- Git fails: run the equivalent `git add`, `git commit`, or `git push` manually from the project directory and check repository status, hooks, branch tracking, and credentials.
- HTTP fails: verify the URL, request body, headers, and that the endpoint returns a 2xx status.

## Full example

The included `rules.yaml` demonstrates a Markdown copy, a notification, and a parallel command. It expects a `watch` directory and writes to `dist`. A compact multi-purpose configuration looks like this:

```yaml
rules:
  - name: archive-images
    watch:
      path: ./incoming
      pattern: '**/*.{png,jpg}'
    events: [add, change]
    debounce: 300
    actions:
      - type: copy
        destination: './archive/{{filename}}'
      - type: notify
        message: 'Archived {{filename}}'

  - name: commit-notes
    watch:
      path: ./notes
      pattern: '*.md'
    events: [add, change]
    debounce: 1500
    onError: continue
    actions:
      - type: git
        commit: true
        message: 'notes: update {{filename}}'
```
