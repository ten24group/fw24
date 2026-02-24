import { Task, TaskController, TaskExecutionContext } from '@ten24group/fw24';

@Task('cleanup', {
    schedule: 'rate(1 minute)'
})
export class CleanupTask extends TaskController {
    async process(_ctx?: TaskExecutionContext) {
        console.log("🧹 Running cleanup task...");
        // Cleanup logic here
    }
}
