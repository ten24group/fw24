const chokidar = require('chokidar');
import { resolve } from 'node:path';

export class HMRWatcher {
    private timer: NodeJS.Timeout | null = null;

    constructor(private readonly directory: string, private readonly onChange: () => void) {}

    start() {
        const watcher = chokidar.watch(this.directory, {
            ignored: /(^|[\/\\])\../, // ignore dotfiles
            persistent: true,
            ignoreInitial: true
        });

        watcher.on('all', (event: string, path: string) => {
            if (this.timer) clearTimeout(this.timer);

            this.timer = setTimeout(() => {
                console.log(`HMR: ${event} detected at ${path}. Re-synchronizing...`);
                this.onChange();
                this.timer = null;
            }, 500); // 500ms debounce
        });
    }
}
