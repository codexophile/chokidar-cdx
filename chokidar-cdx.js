import chokidar from 'chokidar';
import os from 'os';
import path from 'path';

const watchDir = path.join(os.homedir(), 'Downloads');
console.log(`Watching directory: ${watchDir}`);

chokidar.watch(watchDir).on('all', (event, path) => {
  console.log(event, path);
});
