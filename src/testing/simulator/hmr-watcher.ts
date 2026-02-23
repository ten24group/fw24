const chokidar = require('chokidar');
import { resolve } from 'node:path';

export class HMRWatcher {
    constructor(private readonly directory: string, private readonly onChange: () => void) {}

    start() {
        const watcher = chokidar.watch(this.directory, {
            ignored: /(^|[\/\\])\../, // ignore dotfiles
            persistent: true
        });

        watcher.on('change', (path: string) => {
            console.log(`File ${path} has been changed`);
            this.onChange();
        });
    }
}
