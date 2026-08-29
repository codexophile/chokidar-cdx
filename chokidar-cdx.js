import chokidar from 'chokidar';
import { execFile, spawn } from 'child_process';
import { appendFile, copyFile, mkdir, rename, stat } from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { fileURLToPath, pathToFileURL } from 'url';
import { parse } from 'yaml';
import picomatch from 'picomatch';
import { stdout } from 'process';

const execFileAsync = promisify(execFile);
const projectDir = path.dirname(fileURLToPath(import.meta.url));
const defaultConfigPath = path.join(projectDir, 'rules.yaml');
const logPath = path.join(projectDir, 'chokidar-cdx.log');
const supportedEvents = new Set([
  'add',
  'change',
  'unlink',
  'addDir',
  'unlinkDir',
]);
const debounceTimers = new Map();

const args = new Set(process.argv.slice(2));
const configIndex = process.argv.indexOf('--config');
const configPath =
  configIndex >= 0 && process.argv[configIndex + 1]
    ? path.resolve(process.argv[configIndex + 1])
    : defaultConfigPath;
const dryRun = args.has('--dry-run');

function log(message, details = {}) {
  const reset = '\x1b[0m';
  const yellow = '\x1b[33m';

  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    message,
    ...details,
  });
  console.log(yellow + entry + reset);
  appendFile(logPath, `${entry}${os.EOL}`).catch(error =>
    console.error(`Could not write log: ${error.message}`),
  );
}

function required(condition, message) {
  if (!condition) throw new Error(message);
}

function applyRuleDefaults(config) {
  if (!config || !Array.isArray(config.rules)) return config;
  for (const rule of config.rules) {
    if (!rule || typeof rule !== 'object') continue;
    rule.enabled ??= true;
    rule.events ??= ['add', 'change'];
    rule.debounce ??= 500;
    rule.conditions = {
      minSizeBytes: 0,
      ignoreInitial: true,
      ...(rule.conditions ?? {}),
    };
    rule.onError ??= 'stop';
  }
  return config;
}

function coercePatternList(value) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

function getRuleExcludePatterns(rule) {
  const watchExclude = coercePatternList(
    rule.watch?.exclude ??
      rule.watch?.excludePatterns ??
      rule.watch?.excludePattern,
  );
  const ruleExclude = coercePatternList(
    rule.exclude ?? rule.excludePatterns ?? rule.excludePattern,
  );
  return [...watchExclude, ...ruleExclude];
}

function validateRules(config) {
  required(
    config && Array.isArray(config.rules),
    'Config must contain a rules array',
  );
  for (const [index, rule] of config.rules.entries()) {
    required(
      rule && typeof rule.name === 'string' && rule.name.length > 0,
      `Rule ${index} needs a name`,
    );
    required(rule.watch?.path, `Rule ${rule.name} needs watch.path`);
    required(rule.watch?.pattern, `Rule ${rule.name} needs watch.pattern`);
    required(
      rule.watch?.subfolders === undefined ||
        rule.watch.subfolders === false ||
        rule.watch.subfolders === true ||
        (Number.isInteger(rule.watch.subfolders) && rule.watch.subfolders >= 0),
      `Rule ${rule.name} has invalid watch.subfolders; use false, true, or a nonnegative integer`,
    );
    const excludePatterns = getRuleExcludePatterns(rule);
    required(
      excludePatterns.every(
        pattern =>
          typeof pattern === 'string' ||
          (pattern &&
            typeof pattern === 'object' &&
            pattern.type === 'regex' &&
            typeof pattern.value === 'string'),
      ),
      `Rule ${rule.name} has invalid exclude patterns`,
    );
    required(
      Array.isArray(rule.events) && rule.events.length > 0,
      `Rule ${rule.name} needs events`,
    );
    required(
      rule.events.every(event => supportedEvents.has(event)),
      `Rule ${rule.name} contains an unsupported event`,
    );
    required(
      Array.isArray(rule.actions),
      `Rule ${rule.name} needs an actions array`,
    );
    required(
      !rule.onError ||
        ['stop', 'continue', 'retry'].includes(rule.onError) ||
        typeof rule.onError === 'object',
      `Rule ${rule.name} has invalid onError`,
    );
  }
}

function normalizeMatchPath(value) {
  return String(value ?? '').replace(/\\/g, '/');
}

function template(value, context) {
  if (typeof value !== 'string') return value;
  return value.replace(/{{\s*([\w.]+)\s*}}/g, (_, key) =>
    String(context[key] ?? ''),
  );
}

function resolveObject(value, context) {
  if (Array.isArray(value))
    return value.map(item => resolveObject(item, context));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        resolveObject(item, context),
      ]),
    );
  return template(value, context);
}

export function matchesPattern(filePath, rule) {
  const pattern = rule.watch.pattern;
  const normalizedFilePath = normalizeMatchPath(filePath);
  const normalizedWatchPath = normalizeMatchPath(path.resolve(rule.watch.path));
  const relativePath = normalizedFilePath.startsWith(`${normalizedWatchPath}/`)
    ? normalizedFilePath.slice(normalizedWatchPath.length + 1)
    : path.basename(normalizedFilePath);
  const fileName = path.basename(normalizedFilePath);

  const matchesPositivePattern =
    typeof pattern === 'object' && pattern.type === 'regex'
      ? new RegExp(pattern.value).test(fileName)
      : picomatch(pattern)(relativePath) || picomatch(pattern)(fileName);

  if (!matchesPositivePattern) return false;

  const excludePatterns = getRuleExcludePatterns(rule);
  return !excludePatterns.some(excludePattern => {
    if (typeof excludePattern === 'object' && excludePattern.type === 'regex')
      return new RegExp(excludePattern.value).test(fileName);
    return (
      picomatch(excludePattern)(relativePath) ||
      picomatch(excludePattern)(fileName)
    );
  });
}

function runProcess(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      ...options,
      shell: options.shell ?? false,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', data => {
      stdout += data;
    });
    child.stderr?.on('data', data => {
      stderr += data;
    });
    child.on('error', reject);
    child.on('close', exitCode =>
      exitCode === 0
        ? resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode })
        : reject(
            Object.assign(
              new Error(
                stderr.trim() || `Process exited with code ${exitCode}`,
              ),
              { stdout, stderr, exitCode },
            ),
          ),
    );
  });
}

export async function executeAction(action, context, options) {
  if (options?.rule && !matchesPattern(context.filepath, options.rule)) {
    return;
  }

  const resolved = resolveObject(action, context);
  const type = resolved.type;
  if (options.dryRun) {
    log('dry-run action', { rule: options.rule.name, action: type, context });
    return;
  }
  if (type === 'copy' || type === 'move') {
    const source = context.filepath;
    const destination = path.resolve(resolved.destination);
    await mkdir(path.dirname(destination), { recursive: true });
    if (type === 'copy') await copyFile(source, destination);
    else await rename(source, destination);
    context.destinationPath = destination;
  } else if (type === 'exec') {
    const result = await runProcess(resolved.command, [], {
      shell: true,
      cwd: resolved.cwd || projectDir,
    });
    context.stdout = result.stdout;
    context.exitCode = result.exitCode;
  } else if (type === 'git') {
    const result = await execFileAsync('git', ['add', context.filepath], {
      cwd: projectDir,
    });
    if (resolved.commit) {
      const commit = await execFileAsync(
        'git',
        [
          'commit',
          '-m',
          resolved.message || `auto: update ${context.filename}`,
        ],
        { cwd: projectDir },
      );
      context.commitHash =
        commit.stdout.match(/\[[^ ]+ ([a-f0-9]+)\]/)?.[1] || '';
      if (resolved.push)
        await execFileAsync('git', ['push'], { cwd: projectDir });
    }
    context.stdout = result.stdout;
  } else if (type === 'notify') {
    log(resolved.message || `File ${context.filename} updated`, {
      rule: options.rule.name,
    });
  } else if (type === 'simple-log') {
    console.log(`
      Simple log:
      -----------
      Rule name    : ${options.rule.name}
      Trigger      : ${context.event}
      Watch folder : ${path.resolve(options.rule.watch.path)}
      File name    : ${context.filename}
    `);
  } else if (type === 'http') {
    const response = await fetch(resolved.url, {
      method: resolved.method || 'POST',
      headers: resolved.headers,
      body: resolved.body ? JSON.stringify(resolved.body) : undefined,
    });
    if (!response.ok)
      throw new Error(`HTTP request failed with ${response.status}`);
  } else if (type === 'script') {
    const result = await runProcess(resolved.path, [], {
      shell: true,
      cwd: projectDir,
    });
    const stdOut = result.stdout.trim();
    console.log(stdOut);
    context.stdout = stdOut;
  } else {
    throw new Error(`Unsupported action type: ${type}`);
  }
}

async function executeStep(step, context, options) {
  if (step.parallel) {
    const results = await Promise.allSettled(
      step.parallel.map(action =>
        executeAction(action, { ...context }, options),
      ),
    );
    const failed = results.find(result => result.status === 'rejected');
    results.forEach((result, index) =>
      result.status === 'rejected'
        ? log('parallel child failed', {
            rule: options.rule.name,
            index,
            error: result.reason.message,
          })
        : log('parallel child completed', { rule: options.rule.name, index }),
    );
    if (failed) throw failed.reason;
    return;
  }
  await executeAction(step, context, options);
}

async function runRule(rule, event, filePath) {
  if (!matchesPattern(filePath, rule)) return;
  const fileInfo = await stat(filePath).catch(() => null);
  if (
    rule.conditions?.minSizeBytes &&
    (!fileInfo || fileInfo.size < rule.conditions.minSizeBytes)
  )
    return;
  const context = {
    filepath: filePath,
    filename: path.basename(filePath),
    dirname: path.dirname(filePath),
    event,
    timestamp: new Date().toISOString(),
  };
  const retry = typeof rule.onError === 'object' ? rule.onError.retry : null;
  const attempts = rule.onError === 'retry' || retry ? retry?.attempts || 3 : 1;
  const delayMs = retry?.delayMs || 0;
  for (const step of rule.actions) {
    let completed = false;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await executeStep(step, context, { rule, dryRun });
        completed = true;
        break;
      } catch (error) {
        log('rule action failed', {
          rule: rule.name,
          attempt,
          error: error.message,
        });
        if (rule.onError === 'continue') {
          completed = true;
          break;
        }
        if (attempt < attempts)
          await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    if (!completed) return;
  }
  log('rule completed', { rule: rule.name, event, filePath });
}

function scheduleRule(rule, event, filePath) {
  if (
    !rule.enabled ||
    !rule.events.includes(event) ||
    !matchesPattern(filePath, rule)
  )
    return;
  const key = `${rule.name}:${path.resolve(filePath)}`;
  clearTimeout(debounceTimers.get(key));
  debounceTimers.set(
    key,
    setTimeout(() => {
      debounceTimers.delete(key);
      runRule(rule, event, path.resolve(filePath));
    }, rule.debounce || 0),
  );
}

export async function main() {
  const { readFile } = await import('fs/promises');
  const rules = applyRuleDefaults(parse(await readFile(configPath, 'utf8')));
  validateRules(rules);
  const activeRules = rules.rules.filter(rule => rule.enabled !== false);
  required(activeRules.length > 0, 'Config contains no enabled rules');
  for (const rule of activeRules) {
    const watchPath = path.resolve(rule.watch.path);
    const subfolders = rule.watch.subfolders ?? false;
    const watcher = chokidar.watch(watchPath, {
      ignoreInitial: rule.conditions?.ignoreInitial !== false,
      depth: subfolders === true ? undefined : subfolders,
    });
    for (const event of rule.events)
      watcher.on(event, filePath => scheduleRule(rule, event, filePath));
    log('watching rule', {
      rule: rule.name,
      watchPath,
      pattern: rule.watch.pattern,
      subfolders,
      events: rule.events,
    });
  }
  log('rules engine started', { configPath, dryRun });
}

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  main().catch(error => {
    log('rules engine stopped', { error: error.message });
    process.exitCode = 1;
  });
}
