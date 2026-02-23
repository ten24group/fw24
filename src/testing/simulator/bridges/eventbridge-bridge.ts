import { IBridge, ILambdaRunner } from '../interfaces';
import { createLogger } from '../../../logging';
import * as cron from 'node-cron';

export interface EventBridgeRule {
    id: string;
    schedule: string;
    targets: any[];
}

export class EventBridgeBridge implements IBridge {
    readonly name = 'EventBridge';
    private readonly logger = createLogger(EventBridgeBridge.name);
    private tasks: cron.ScheduledTask[] = [];
    private rules: EventBridgeRule[] = [];
    private lambdaConfigs: Map<string, any> = new Map();

    constructor(private readonly lambdaRunner: ILambdaRunner) {}

    setLambdaConfigs(configs: Map<string, any>) {
        this.lambdaConfigs = configs;
    }

    setRules(rules: EventBridgeRule[]) {
        this.rules = rules;
    }

    async start(): Promise<void> {
        this.logger.info("Starting EventBridge Bridge (Scheduler)...");
        this.stopTasks();

        for (const rule of this.rules) {
            if (!rule.schedule) continue;

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
                            await this.lambdaRunner.runHandler(
                                config.entry,
                                config.handlerClassName,
                                { source: 'aws.events', 'detail-type': 'Scheduled Event', detail: {} },
                                {},
                                config.environment
                            );
                        } catch (e) {
                            this.logger.error(`Error executing scheduled task ${rule.id}:`, e);
                        }
                    }
                }
            });
            this.tasks.push(task);
        }
    }

    private awsScheduleToCron(awsSchedule: string): string | null {
        // Simple conversion for rate(1 minute) or cron(...)
        if (awsSchedule.startsWith('rate(')) {
            const match = awsSchedule.match(/rate\((\d+)\s+(minute|minutes|hour|hours|day|days)\)/);
            if (match) {
                const [ , value, unit ] = match;
                if (unit.startsWith('minute')) return `*/${value} * * * *`;
                if (unit.startsWith('hour')) return `0 */${value} * * *`;
                if (unit.startsWith('day')) return `0 0 */${value} * *`;
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

    private stopTasks() {
        this.tasks.forEach(t => t.stop());
        this.tasks = [];
    }

    async stop(): Promise<void> {
        this.stopTasks();
    }
}
