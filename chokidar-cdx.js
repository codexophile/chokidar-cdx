import chokidar from 'chokidar';
import os from 'os';
import path from 'path';

const WATCH_DIR = path.join(os.homedir(), 'Downloads');
console.log(`Watching directory: ${WATCH_DIR}`);

chokidar.watch(WATCH_DIR).on('all', (event, path) => {
  console.log(event, path);
});
