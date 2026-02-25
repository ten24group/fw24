"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventBridgeBridge = void 0;
const logging_1 = require("../../../logging");
const cron = __importStar(require("node-cron"));
class EventBridgeBridge {
    lambdaRunner;
    name = 'EventBridge';
    logger = (0, logging_1.createLogger)(EventBridgeBridge.name);
    tasks = [];
    rules = [];
    lambdaConfigs = new Map();
    constructor(lambdaRunner) {
        this.lambdaRunner = lambdaRunner;
    }
    setLambdaConfigs(configs) {
        this.lambdaConfigs = configs;
    }
    setRules(rules) {
        this.rules = rules;
    }
    async start() {
        this.logger.info("Starting EventBridge Bridge (Scheduler)...");
        this.stopTasks();
        for (const rule of this.rules) {
            if (!rule.schedule)
                continue;
            const cronExpression = this.awsScheduleToCron(rule.schedule);
            if (!cronExpression) {
                this.logger.warn(`Unsupported schedule expression: ${rule.schedule} for rule ${rule.id}`);
                continue;
            }
            this.logger.info(`Scheduling rule ${rule.id}: ${rule.schedule} -> ${cronExpression}`);
            const task = cron.schedule(cronExpression, async () => {
                this.logger.info(`Triggering EventBridge rule: ${rule.id}`);
                for (const target of rule.targets) {
                    const lambdaId = target.Arn?.split(':').pop() || target.Id;
                    const config = this.lambdaConfigs.get(lambdaId);
                    if (config) {
                        try {
                            await this.lambdaRunner.runHandler(config.entry, config.handlerClassName, { source: 'aws.events', 'detail-type': 'Scheduled Event', detail: {} }, {}, config.environment);
                        }
                        catch (e) {
                            this.logger.error(`Error executing scheduled task ${rule.id}:`, e);
                        }
                    }
                }
            });
            this.tasks.push(task);
        }
    }
    awsScheduleToCron(awsSchedule) {
        // Simple conversion for rate(1 minute) or cron(...)
        if (awsSchedule.startsWith('rate(')) {
            const match = awsSchedule.match(/rate\((\d+)\s+(minute|minutes|hour|hours|day|days)\)/);
            if (match) {
                const [, value, unit] = match;
                if (unit.startsWith('minute'))
                    return `*/${value} * * * *`;
                if (unit.startsWith('hour'))
                    return `0 */${value} * * *`;
                if (unit.startsWith('day'))
                    return `0 0 */${value} * *`;
            }
        }
        if (awsSchedule.startsWith('cron(')) {
            // aws cron has 6 fields, node-cron has 5 or 6.
            // AWS: cron(Minutes Hours Day-of-month Month Day-of-week Year)
            const match = awsSchedule.match(/cron\((.+)\)/);
            if (match) {
                const parts = match[1].split(/\s+/);
                if (parts.length >= 5) {
                    // Return first 5 parts for node-cron
                    return parts.slice(0, 5).join(' ').replace(/\?/g, '*');
                }
            }
        }
        return null;
    }
    stopTasks() {
        this.tasks.forEach(t => t.stop());
        this.tasks = [];
    }
    async stop() {
        this.stopTasks();
    }
}
exports.EventBridgeBridge = EventBridgeBridge;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXZlbnRicmlkZ2UtYnJpZGdlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL3Rlc3Rpbmcvc2ltdWxhdG9yL2JyaWRnZXMvZXZlbnRicmlkZ2UtYnJpZGdlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUNBLDhDQUFnRDtBQUNoRCxnREFBa0M7QUFRbEMsTUFBYSxpQkFBaUI7SUFPRztJQU5wQixJQUFJLEdBQUcsYUFBYSxDQUFDO0lBQ2IsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxpQkFBaUIsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUN2RCxLQUFLLEdBQXlCLEVBQUUsQ0FBQztJQUNqQyxLQUFLLEdBQXNCLEVBQUUsQ0FBQztJQUM5QixhQUFhLEdBQXFCLElBQUksR0FBRyxFQUFFLENBQUM7SUFFcEQsWUFBNkIsWUFBMkI7UUFBM0IsaUJBQVksR0FBWixZQUFZLENBQWU7SUFBRyxDQUFDO0lBRTVELGdCQUFnQixDQUFDLE9BQXlCO1FBQ3RDLElBQUksQ0FBQyxhQUFhLEdBQUcsT0FBTyxDQUFDO0lBQ2pDLENBQUM7SUFFRCxRQUFRLENBQUMsS0FBd0I7UUFDN0IsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUM7SUFDdkIsQ0FBQztJQUVELEtBQUssQ0FBQyxLQUFLO1FBQ1AsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsNENBQTRDLENBQUMsQ0FBQztRQUMvRCxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUM7UUFFakIsS0FBSyxNQUFNLElBQUksSUFBSSxJQUFJLENBQUMsS0FBSyxFQUFFLENBQUM7WUFDNUIsSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRO2dCQUFFLFNBQVM7WUFFN0IsTUFBTSxjQUFjLEdBQUcsSUFBSSxDQUFDLGlCQUFpQixDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQztZQUM3RCxJQUFJLENBQUMsY0FB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LElBQUksQ0FBQyxFQUFFLENBQUM7b0JBQ3BCLHFDQUFxQztvQkFDckMsT0FBTyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxHQUFHLENBQUMsQ0FBQztnQkFDM0QsQ0FBQztZQUNMLENBQUM7UUFDTCxDQUFDO1FBQ0QsT0FBTyxJQUFJLENBQUM7SUFDaEIsQ0FBQztJQUVPLFNBQVM7UUFDYixJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDO1FBQ2xDLElBQUksQ0FBQyxLQUFLLEdBQUcsRUFBRSxDQUFDO0lBQ3BCLENBQUM7SUFFRCxLQUFLLENBQUMsSUFBSTtRQUNOLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztJQUNyQixDQUFDO0NBQ0o7QUExRkQsOENBMEZDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgSUJyaWRnZSwgSUxhbWJkYVJ1bm5lciB9IGZyb20gJy4uL2ludGVyZmFjZXMnO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vLi4vLi4vbG9nZ2luZyc7XG5pbXBvcnQgKiBhcyBjcm9uIGZyb20gJ25vZGUtY3Jvbic7XG5cbmV4cG9ydCBpbnRlcmZhY2UgRXZlbnRCcmlkZ2VSdWxlIHtcbiAgICBpZDogc3RyaW5nO1xuICAgIHNjaGVkdWxlOiBzdHJpbmc7XG4gICAgdGFyZ2V0czogYW55W107XG59XG5cbmV4cG9ydCBjbGFzcyBFdmVudEJyaWRnZUJyaWRnZSBpbXBsZW1lbnRzIElCcmlkZ2Uge1xuICAgIHJlYWRvbmx5IG5hbWUgPSAnRXZlbnRCcmlkZ2UnO1xuICAgIHByaXZhdGUgcmVhZG9ubHkgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKEV2ZW50QnJpZGdlQnJpZGdlLm5hbWUpO1xuICAgIHByaXZhdGUgdGFza3M6IGNyb24uU2NoZWR1bGVkVGFza1tdID0gW107XG4gICAgcHJpdmF0ZSBydWxlczogRXZlbnRCcmlkZ2VSdWxlW10gPSBbXTtcbiAgICBwcml2YXRlIGxhbWJkYUNvbmZpZ3M6IE1hcDxzdHJpbmcsIGFueT4gPSBuZXcgTWFwKCk7XG5cbiAgICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGxhbWJkYVJ1bm5lcjogSUxhbWJkYVJ1bm5lcikge31cblxuICAgIHNldExhbWJkYUNvbmZpZ3MoY29uZmlnczogTWFwPHN0cmluZywgYW55Pikge1xuICAgICAgICB0aGlzLmxhbWJkYUNvbmZpZ3MgPSBjb25maWdzO1xuICAgIH1cblxuICAgIHNldFJ1bGVzKHJ1bGVzOiBFdmVudEJyaWRnZVJ1bGVbXSkge1xuICAgICAgICB0aGlzLnJ1bGVzID0gcnVsZXM7XG4gICAgfVxuXG4gICAgYXN5bmMgc3RhcnQoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oXCJTdGFydGluZyBFdmVudEJyaWRnZSBCcmlkZ2UgKFNjaGVkdWxlcikuLi5cIik7XG4gICAgICAgIHRoaXMuc3RvcFRhc2tzKCk7XG5cbiAgICAgICAgZm9yIChjb25zdCBydWxlIG9mIHRoaXMucnVsZXMpIHtcbiAgICAgICAgICAgIGlmICghcnVsZS5zY2hlZHVsZSkgY29udGludWU7XG5cbiAgICAgICAgICAgIGNvbnN0IGNyb25FeHByZXNzaW9uID0gdGhpcy5hd3NTY2hlZHVsZVRvQ3JvbihydWxlLnNjaGVkdWxlKTtcbiAgICAgICAgICAgIGlmICghY3JvbkV4cHJlc3Npb24pIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBVbnN1cHBvcnRlZCBzY2hlZHVsZSBleHByZXNzaW9uOiAke3J1bGUuc2NoZWR1bGV9IGZvciBydWxlICR7cnVsZS5pZH1gKTtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgU2NoZWR1bGluZyBydWxlICR7cnVsZS5pZH06ICR7cnVsZS5zY2hlZHVsZX0gLT4gJHtjcm9uRXhwcmVzc2lvbn1gKTtcblxuICAgICAgICAgICAgY29uc3QgdGFzayA9IGNyb24uc2NoZWR1bGUoY3JvbkV4cHJlc3Npb24sIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBUcmlnZ2VyaW5nIEV2ZW50QnJpZGdlIHJ1bGU6ICR7cnVsZS5pZH1gKTtcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IHRhcmdldCBvZiBydWxlLnRhcmdldHMpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbGFtYmRhSWQgPSB0YXJnZXQuQXJuPy5zcGxpdCgnOicpLnBvcCgpIHx8IHRhcmdldC5JZDtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY29uZmlnID0gdGhpcy5sYW1iZGFDb25maWdzLmdldChsYW1iZGFJZCk7XG4gICAgICAgICAgICAgICAgICAgIGlmIChjb25maWcpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5sYW1iZGFSdW5uZXIucnVuSGFuZGxlcihcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uZmlnLmVudHJ5LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25maWcuaGFuZGxlckNsYXNzTmFtZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgeyBzb3VyY2U6ICdhd3MuZXZlbnRzJywgJ2RldGFpbC10eXBlJzogJ1NjaGVkdWxlZCBFdmVudCcsIGRldGFpbDoge30gfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAge30sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbmZpZy5lbnZpcm9ubWVudFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYEVycm9yIGV4ZWN1dGluZyBzY2hlZHVsZWQgdGFzayAke3J1bGUuaWR9OmAsIGUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB0aGlzLnRhc2tzLnB1c2godGFzayk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGF3c1NjaGVkdWxlVG9Dcm9uKGF3c1NjaGVkdWxlOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgICAgICAgLy8gU2ltcGxlIGNvbnZlcnNpb24gZm9yIHJhdGUoMSBtaW51dGUpIG9yIGNyb24oLi4uKVxuICAgICAgICBpZiAoYXdzU2NoZWR1bGUuc3RhcnRzV2l0aCgncmF0ZSgnKSkge1xuICAgICAgICAgICAgY29uc3QgbWF0Y2ggPSBhd3NTY2hlZHVsZS5tYXRjaCgvcmF0ZVxcKChcXGQrKVxccysobWludXRlfG1pbnV0ZXN8aG91cnxob3Vyc3xkYXl8ZGF5cylcXCkvKTtcbiAgICAgICAgICAgIGlmIChtYXRjaCkge1xuICAgICAgICAgICAgICAgIGNvbnN0IFsgLCB2YWx1ZSwgdW5pdCBdID0gbWF0Y2g7XG4gICAgICAgICAgICAgICAgaWYgKHVuaXQuc3RhcnRzV2l0aCgnbWludXRlJykpIHJldHVybiBgKi8ke3ZhbHVlfSAqICogKiAqYDtcbiAgICAgICAgICAgICAgICBpZiAodW5pdC5zdGFydHNXaXRoKCdob3VyJykpIHJldHVybiBgMCAqLyR7dmFsdWV9ICogKiAqYDtcbiAgICAgICAgICAgICAgICBpZiAodW5pdC5zdGFydHNXaXRoKCdkYXknKSkgcmV0dXJuIGAwIDAgKi8ke3ZhbHVlfSAqICpgO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmIChhd3NTY2hlZHVsZS5zdGFydHNXaXRoKCdjcm9uKCcpKSB7XG4gICAgICAgICAgICAvLyBhd3MgY3JvbiBoYXMgNiBmaWVsZHMsIG5vZGUtY3JvbiBoYXMgNSBvciA2LiBcbiAgICAgICAgICAgIC8vIEFXUzogY3JvbihNaW51dGVzIEhvdXJzIERheS1vZi1tb250aCBNb250aCBEYXktb2Ytd2VlayBZZWFyKVxuICAgICAgICAgICAgY29uc3QgbWF0Y2ggPSBhd3NTY2hlZHVsZS5tYXRjaCgvY3JvblxcKCguKylcXCkvKTtcbiAgICAgICAgICAgIGlmIChtYXRjaCkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHBhcnRzID0gbWF0Y2hbMV0uc3BsaXQoL1xccysvKTtcbiAgICAgICAgICAgICAgICBpZiAocGFydHMubGVuZ3RoID49IDUpIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gUmV0dXJuIGZpcnN0IDUgcGFydHMgZm9yIG5vZGUtY3JvblxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gcGFydHMuc2xpY2UoMCwgNSkuam9pbignICcpLnJlcGxhY2UoL1xcPy9nLCAnKicpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBwcml2YXRlIHN0b3BUYXNrcygpIHtcbiAgICAgICAgdGhpcy50YXNrcy5mb3JFYWNoKHQgPT4gdC5zdG9wKCkpO1xuICAgICAgICB0aGlzLnRhc2tzID0gW107XG4gICAgfVxuXG4gICAgYXN5bmMgc3RvcCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgdGhpcy5zdG9wVGFza3MoKTtcbiAgICB9XG59XG4iXX0=