import test from 'node:test';
import assert from 'node:assert/strict';
import { executeAction, matchesPattern } from '../chokidar-cdx.js';

test('exclude patterns prevent matches', () => {
  const rule = {
    watch: {
      path: 'C:/tmp/watch',
      pattern: '**/*.txt',
      exclude: ['**/skip/**', '*.bak'],
    },
  };

  assert.equal(matchesPattern('C:/tmp/watch/keep.txt', rule), true);
  assert.equal(matchesPattern('C:/tmp/watch/skip/note.txt', rule), false);
  assert.equal(matchesPattern('C:/tmp/watch/archive.log', rule), false);
  assert.equal(matchesPattern('C:/tmp/watch/readme.bak', rule), false);
});

test('download temp files are excluded before script actions run', () => {
  const rule = {
    watch: {
      path: 'C:/Users/xq151/Downloads',
      pattern: '*',
      exclude: ['*.tmp', '*.crdownload'],
    },
  };

  assert.equal(
    matchesPattern('C:/Users/xq151/Downloads/file.tmp', rule),
    false,
  );
  assert.equal(
    matchesPattern('C:/Users/xq151/Downloads/file.crdownload', rule),
    false,
  );
  assert.equal(matchesPattern('C:/Users/xq151/Downloads/file.txt', rule), true);
});

test('excluded files do not run script actions', async () => {
  const rule = {
    name: 'any',
    watch: {
      path: 'C:/Users/xq151/Downloads',
      pattern: '*',
      exclude: ['*.tmp', '*.crdownload'],
    },
    actions: [
      {
        type: 'script',
        path: 'node -e "throw new Error(\'should not run\')"',
      },
    ],
  };

  await assert.doesNotReject(async () => {
    await executeAction(
      rule.actions[0],
      {
        filepath: 'C:/Users/xq151/Downloads/file.tmp',
        filename: 'file.tmp',
        event: 'add',
      },
      { rule, dryRun: false },
    );
  });
});
