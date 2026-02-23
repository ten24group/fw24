"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HMRWatcher = void 0;
const chokidar = require('chokidar');
class HMRWatcher {
    directory;
    onChange;
    constructor(directory, onChange) {
        this.directory = directory;
        this.onChange = onChange;
    }
    start() {
        const watcher = chokidar.watch(this.directory, {
            ignored: /(^|[\/\\])\../, // ignore dotfiles
            persistent: true
        });
        watcher.on('change', (path) => {
            console.log(`File ${path} has been changed`);
            this.onChange();
        });
    }
}
exports.HMRWatcher = HMRWatcher;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaG1yLXdhdGNoZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvdGVzdGluZy9zaW11bGF0b3IvaG1yLXdhdGNoZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsTUFBTSxRQUFRLEdBQUcsT0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFDO0FBR3JDLE1BQWEsVUFBVTtJQUNVO0lBQW9DO0lBQWpFLFlBQTZCLFNBQWlCLEVBQW1CLFFBQW9CO1FBQXhELGNBQVMsR0FBVCxTQUFTLENBQVE7UUFBbUIsYUFBUSxHQUFSLFFBQVEsQ0FBWTtJQUFHLENBQUM7SUFFekYsS0FBSztRQUNELE1BQU0sT0FBTyxHQUFHLFFBQVEsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRTtZQUMzQyxPQUFPLEVBQUUsZUFBZSxFQUFFLGtCQUFrQjtZQUM1QyxVQUFVLEVBQUUsSUFBSTtTQUNuQixDQUFDLENBQUM7UUFFSCxPQUFPLENBQUMsRUFBRSxDQUFDLFFBQVEsRUFBRSxDQUFDLElBQVksRUFBRSxFQUFFO1lBQ2xDLE9BQU8sQ0FBQyxHQUFHLENBQUMsUUFBUSxJQUFJLG1CQUFtQixDQUFDLENBQUM7WUFDN0MsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDO1FBQ3BCLENBQUMsQ0FBQyxDQUFDO0lBQ1AsQ0FBQztDQUNKO0FBZEQsZ0NBY0MiLCJzb3VyY2VzQ29udGVudCI6WyJjb25zdCBjaG9raWRhciA9IHJlcXVpcmUoJ2Nob2tpZGFyJyk7XG5pbXBvcnQgeyByZXNvbHZlIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuZXhwb3J0IGNsYXNzIEhNUldhdGNoZXIge1xuICAgIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgZGlyZWN0b3J5OiBzdHJpbmcsIHByaXZhdGUgcmVhZG9ubHkgb25DaGFuZ2U6ICgpID0+IHZvaWQpIHt9XG5cbiAgICBzdGFydCgpIHtcbiAgICAgICAgY29uc3Qgd2F0Y2hlciA9IGNob2tpZGFyLndhdGNoKHRoaXMuZGlyZWN0b3J5LCB7XG4gICAgICAgICAgICBpZ25vcmVkOiAvKF58W1xcL1xcXFxdKVxcLi4vLCAvLyBpZ25vcmUgZG90ZmlsZXNcbiAgICAgICAgICAgIHBlcnNpc3RlbnQ6IHRydWVcbiAgICAgICAgfSk7XG5cbiAgICAgICAgd2F0Y2hlci5vbignY2hhbmdlJywgKHBhdGg6IHN0cmluZykgPT4ge1xuICAgICAgICAgICAgY29uc29sZS5sb2coYEZpbGUgJHtwYXRofSBoYXMgYmVlbiBjaGFuZ2VkYCk7XG4gICAgICAgICAgICB0aGlzLm9uQ2hhbmdlKCk7XG4gICAgICAgIH0pO1xuICAgIH1cbn1cbiJdfQ==