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
exports.Observer = exports.withObservability = exports.ObservabilityManager = void 0;
const logging_1 = require("../logging");
const types_1 = require("./types");
const dynamodb_1 = require("./backends/dynamodb");
const otel_1 = require("./backends/otel");
const level_utils_1 = require("./utils/level-utils");
const source_utils_1 = require("./utils/source-utils");
const logger = (0, logging_1.createLogger)('ObservabilityManager');
class ObservabilityManager {
    static config = null;
    static backends = [];
    static initialize(config, backends) {
        this.validateConfig(config);
        this.config = config;
        this.backends = backends;
    }
    static validateConfig(config) {
        // Validate minLevel
        const validLevels = Object.values(types_1.ObservabilityLevel).filter((v) => typeof v === 'number');
        if (!validLevels.includes(config.minLevel)) {
            throw new Error(`Invalid minLevel: ${config.minLevel}. Must be one of: ${Object.keys(types_1.ObservabilityLevel).join(', ')}`);
        }
        // Validate sampling rates
        if (config.sampling.enabled) {
            Object.entries(config.sampling.rates).forEach(([level, rate]) => {
                if (typeof rate !== 'number' || rate < 0 || rate > 1) {
                    throw new Error(`Invalid sampling rate for ${level}: ${rate}. Must be between 0 and 1.`);
                }
            });
        }
        // Validate backend types
        const validBackends = ['cloudwatch', 'dynamodb', 'otel', 'mock'];
        config.backends.forEach((backend) => {
            if (!validBackends.includes(backend.type)) {
                throw new Error(`Invalid backend type: ${backend.type}. Must be one of: ${validBackends.join(', ')}`);
            }
        });
    }
    static getConfig() {
        this.ensureInitialized();
        return this.config;
    }
    static registerBackend(backend) {
        if (!this.backends.find((b) => b.name === backend.name)) {
            this.backends.push(backend);
        }
    }
    static initializeInvocation() {
        this.ensureInitialized();
        this.backends.forEach((backend) => backend.initializeInvocation?.());
    }
    static capture(event) {
        // Defensive checks
        if (!event || typeof event !== 'object') {
            logger.warn('Invalid event passed to capture');
            return;
        }
        if (!event.type) {
            logger.warn('Event missing required field: type');
            return;
        }
        if (!event.correlationId) {
            logger.warn('Event missing required field: correlationId');
            return;
        }
        const config = this.getConfig();
        if (!config.enabled)
            return;
        // Auto-inject source if not provided
        if (!event.source) {
            event.source = (0, source_utils_1.detectSource)();
        }
        // Auto-merge environment tags with event tags
        event.tags = (0, source_utils_1.mergeTags)(event.tags, true);
        if (!ObservabilityManager.shouldCapture(event, config)) {
            return;
        }
        // Get backends for this specific type
        const backends = this.getBackendsForType(event.type);
        // Fire-and-forget (don't await)
        void Promise.all(backends.map(async (backend) => {
            try {
                if (backend.minLevel !== undefined &&
                    ObservabilityManager.getLevelValue(event.level) < backend.minLevel) {
                    return;
                }
                await backend.capture(event);
            }
            catch (error) {
                logger.error(`Failed to capture event in backend ${backend.name}`, error);
            }
        }));
    }
    static getBackendsForType(type) {
        const typeCategory = this.getTypeCategory(type);
        const typeConfig = this.config?.types?.[typeCategory];
        if (typeConfig?.backends) {
            // Use type-specific backends
            return this.backends.filter((b) => typeConfig.backends.includes(b.name));
        }
        // Fall back to all enabled backends
        return this.backends;
    }
    static getTypeCategory(type) {
        if (type.startsWith('span.'))
            return 'span';
        if (type === 'metric')
            return 'metric';
        if (type.startsWith('audit.'))
            return 'audit';
        if (type.startsWith('workflow.'))
            return 'workflow';
        if (type.startsWith('decision.'))
            return 'decision';
        return 'log';
    }
    static async flush() {
        await Promise.all(this.backends.map(async (backend) => {
            if (backend.flush) {
                try {
                    await backend.flush();
                }
                catch (error) {
                    logger.error(`Failed to flush backend ${backend.name}`, error);
                }
            }
        }));
    }
    static shouldCapture(event, config) {
        // Level check FIRST
        const levelValue = this.getLevelValue(event.level);
        if (levelValue < config.minLevel) {
            return false;
        }
        // CRITICAL level always captured
        if (levelValue === types_1.ObservabilityLevel.CRITICAL) {
            return true;
        }
        if (!config.sampling.enabled) {
            return true;
        }
        // Check operation-specific sampling
        if (event.operation && config.sampling.operations) {
            const entries = Object.entries(config.sampling.operations);
            for (const [pattern, opRate] of entries) {
                const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
                if (regex.test(event.operation)) {
                    return Math.random() < opRate;
                }
            }
        }
        // Sample by level
        const rate = config.sampling.rates[levelValue] ?? 1.0;
        if (rate >= 1)
            return true;
        if (rate <= 0)
            return false;
        return Math.random() < rate;
    }
    static getLevelValue(level) {
        return (0, level_utils_1.stringToLevel)(level);
    }
    static async ensureInitialized() {
        if (this.config) {
            return;
        }
        const enabled = (process.env.OBSERVABILITY_ENABLED ?? 'true').toLowerCase() !== 'false';
        const levelName = (process.env.OBSERVABILITY_LEVEL ?? 'info').toUpperCase();
        const minLevel = types_1.ObservabilityLevel[levelName] ?? types_1.ObservabilityLevel.INFO;
        const backendNames = (process.env.OBSERVABILITY_BACKENDS ?? 'cloudwatch')
            .split(',')
            .map((name) => name.trim().toLowerCase())
            .filter(Boolean);
        const backendInstances = [];
        const backendConfigs = [];
        const registerBackend = async (type) => {
            switch (type) {
                case 'dynamodb':
                    backendInstances.push(new dynamodb_1.DynamoDBObservabilityBackend({
                        minLevel,
                        ttlDays: parseInt(process.env.OBSERVABILITY_DYNAMO_TTL_DAYS || '90', 10),
                    }));
                    backendConfigs.push({ type: 'dynamodb', enabled: true });
                    break;
                case 'otel':
                    backendInstances.push(new otel_1.OTELObservabilityBackend({
                        serviceName: process.env.SERVICE_NAME || 'fw24-service',
                        minLevel,
                    }));
                    backendConfigs.push({ type: 'otel', enabled: true });
                    break;
                case 'cloudwatch': {
                    const { CloudWatchBackend } = await Promise.resolve().then(() => __importStar(require('./backends/cloudwatch')));
                    backendInstances.push(new CloudWatchBackend({
                        serviceName: process.env.SERVICE_NAME || 'fw24-service',
                        minLevel,
                        namespace: process.env.CLOUDWATCH_METRICS_NAMESPACE || 'FW24',
                    }));
                    backendConfigs.push({ type: 'cloudwatch', enabled: true });
                    break;
                }
                default:
                    logger.warn(`Unknown backend type: ${type}`);
                    break;
            }
        };
        if (backendNames.length === 0) {
            await registerBackend('cloudwatch');
        }
        else {
            for (const backendName of backendNames) {
                await registerBackend(backendName);
            }
        }
        // Parse type-specific backend overrides
        const types = {};
        const parseTypeBackends = (envVar, typeKey) => {
            const value = process.env[envVar];
            if (value) {
                types[typeKey] = {
                    backends: value.split(',').map((b) => b.trim()),
                };
            }
        };
        parseTypeBackends('OBSERVABILITY_SPAN_BACKENDS', 'span');
        parseTypeBackends('OBSERVABILITY_METRIC_BACKENDS', 'metric');
        parseTypeBackends('OBSERVABILITY_AUDIT_BACKENDS', 'audit');
        parseTypeBackends('OBSERVABILITY_LOG_BACKENDS', 'log');
        parseTypeBackends('OBSERVABILITY_DECISION_BACKENDS', 'decision');
        parseTypeBackends('OBSERVABILITY_WORKFLOW_BACKENDS', 'workflow');
        const config = {
            enabled,
            minLevel,
            sampling: types_1.DefaultSamplingConfig,
            backends: backendConfigs,
            types: Object.keys(types).length > 0 ? types : undefined,
        };
        this.initialize(config, backendInstances);
    }
}
exports.ObservabilityManager = ObservabilityManager;
const withObservability = (handler) => {
    return (async (...args) => {
        try {
            ObservabilityManager.initializeInvocation();
            return await handler(...args);
        }
        finally {
            await ObservabilityManager.flush();
        }
    });
};
exports.withObservability = withObservability;
/**
 * Alias for ObservabilityManager (follows Observer design pattern)
 *
 * Usage:
 * ```typescript
 * import { Observer } from '@ten24group/fw24/observability';
 *
 * Observer.capture({ ... });
 * await Observer.flush();
 * ```
 */
exports.Observer = ObservabilityManager;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFuYWdlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L21hbmFnZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsd0NBQTBDO0FBQzFDLG1DQU1pQjtBQUNqQixrREFBbUU7QUFDbkUsMENBQTJEO0FBQzNELHFEQUFvRDtBQUNwRCx1REFBK0Q7QUFFL0QsTUFBTSxNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLHNCQUFzQixDQUFDLENBQUM7QUFFcEQsTUFBYSxvQkFBb0I7SUFDdkIsTUFBTSxDQUFDLE1BQU0sR0FBK0IsSUFBSSxDQUFDO0lBQ2pELE1BQU0sQ0FBQyxRQUFRLEdBQTJCLEVBQUUsQ0FBQztJQUVyRCxNQUFNLENBQUMsVUFBVSxDQUFDLE1BQTJCLEVBQUUsUUFBZ0M7UUFDN0UsSUFBSSxDQUFDLGNBQWMsQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUM1QixJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQztRQUNyQixJQUFJLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQztJQUMzQixDQUFDO0lBRU8sTUFBTSxDQUFDLGNBQWMsQ0FBQyxNQUEyQjtRQUN2RCxvQkFBb0I7UUFDcEIsTUFBTSxXQUFXLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQywwQkFBa0IsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsT0FBTyxDQUFDLEtBQUssUUFBUSxDQUFDLENBQUM7UUFDM0YsSUFBSSxDQUFDLFdBQVcsQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUM7WUFDM0MsTUFBTSxJQUFJLEtBQUssQ0FDYixxQkFBcUIsTUFBTSxDQUFDLFFBQVEscUJBQXFCLE1BQU0sQ0FBQyxJQUFJLENBQUMsMEJBQWtCLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUUs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QUNqRSxpQkFBaUIsQ0FBQyxpQ0FBaUMsRUFBRSxVQUFVLENBQUMsQ0FBQztRQUVqRSxNQUFNLE1BQU0sR0FBd0I7WUFDbEMsT0FBTztZQUNQLFFBQVE7WUFDUixRQUFRLEVBQUUsNkJBQXFCO1lBQy9CLFFBQVEsRUFBRSxjQUFjO1lBQ3hCLEtBQUssRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsU0FBUztTQUN6RCxDQUFDO1FBRUYsSUFBSSxDQUFDLFVBQVUsQ0FBQyxNQUFNLEVBQUUsZ0JBQWdCLENBQUMsQ0FBQztJQUM1QyxDQUFDOztBQXBSSCxvREFxUkM7QUFFTSxNQUFNLGlCQUFpQixHQUFHLENBQTZDLE9BQVUsRUFBSyxFQUFFO0lBQzdGLE9BQU8sQ0FBQyxLQUFLLEVBQUUsR0FBRyxJQUFtQixFQUFFLEVBQUU7UUFDdkMsSUFBSSxDQUFDO1lBQ0gsb0JBQW9CLENBQUMsb0JBQW9CLEVBQUUsQ0FBQztZQUM1QyxPQUFPLE1BQU0sT0FBTyxDQUFDLEdBQUcsSUFBSSxDQUFDLENBQUM7UUFDaEMsQ0FBQztnQkFBUyxDQUFDO1lBQ1QsTUFBTSxvQkFBb0IsQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUNyQyxDQUFDO0lBQ0gsQ0FBQyxDQUFNLENBQUM7QUFDVixDQUFDLENBQUM7QUFUVyxRQUFBLGlCQUFpQixxQkFTNUI7QUFFRjs7Ozs7Ozs7OztHQVVHO0FBQ1UsUUFBQSxRQUFRLEdBQUcsb0JBQW9CLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tICcuLi9sb2dnaW5nJztcbmltcG9ydCB7XG4gIERlZmF1bHRTYW1wbGluZ0NvbmZpZyxcbiAgT2JzZXJ2YWJpbGl0eUJhY2tlbmQsXG4gIE9ic2VydmFiaWxpdHlDb25maWcsXG4gIE9ic2VydmFiaWxpdHlFdmVudCxcbiAgT2JzZXJ2YWJpbGl0eUxldmVsLFxufSBmcm9tICcuL3R5cGVzJztcbmltcG9ydCB7IER5bmFtb0RCT2JzZXJ2YWJpbGl0eUJhY2tlbmQgfSBmcm9tICcuL2JhY2tlbmRzL2R5bmFtb2RiJztcbmltcG9ydCB7IE9URUxPYnNlcnZhYmlsaXR5QmFja2VuZCB9IGZyb20gJy4vYmFja2VuZHMvb3RlbCc7XG5pbXBvcnQgeyBzdHJpbmdUb0xldmVsIH0gZnJvbSAnLi91dGlscy9sZXZlbC11dGlscyc7XG5pbXBvcnQgeyBkZXRlY3RTb3VyY2UsIG1lcmdlVGFncyB9IGZyb20gJy4vdXRpbHMvc291cmNlLXV0aWxzJztcblxuY29uc3QgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdPYnNlcnZhYmlsaXR5TWFuYWdlcicpO1xuXG5leHBvcnQgY2xhc3MgT2JzZXJ2YWJpbGl0eU1hbmFnZXIge1xuICBwcml2YXRlIHN0YXRpYyBjb25maWc6IE9ic2VydmFiaWxpdHlDb25maWcgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzdGF0aWMgYmFja2VuZHM6IE9ic2VydmFiaWxpdHlCYWNrZW5kW10gPSBbXTtcblxuICBzdGF0aWMgaW5pdGlhbGl6ZShjb25maWc6IE9ic2VydmFiaWxpdHlDb25maWcsIGJhY2tlbmRzOiBPYnNlcnZhYmlsaXR5QmFja2VuZFtdKSB7XG4gICAgdGhpcy52YWxpZGF0ZUNvbmZpZyhjb25maWcpO1xuICAgIHRoaXMuY29uZmlnID0gY29uZmlnO1xuICAgIHRoaXMuYmFja2VuZHMgPSBiYWNrZW5kcztcbiAgfVxuXG4gIHByaXZhdGUgc3RhdGljIHZhbGlkYXRlQ29uZmlnKGNvbmZpZzogT2JzZXJ2YWJpbGl0eUNvbmZpZyk6IHZvaWQge1xuICAgIC8vIFZhbGlkYXRlIG1pbkxldmVsXG4gICAgY29uc3QgdmFsaWRMZXZlbHMgPSBPYmplY3QudmFsdWVzKE9ic2VydmFiaWxpdHlMZXZlbCkuZmlsdGVyKCh2KSA9PiB0eXBlb2YgdiA9PT0gJ251bWJlcicpO1xuICAgIGlmICghdmFsaWRMZXZlbHMuaW5jbHVkZXMoY29uZmlnLm1pbkxldmVsKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBgSW52YWxpZCBtaW5MZXZlbDogJHtjb25maWcubWluTGV2ZWx9LiBNdXN0IGJlIG9uZSBvZjogJHtPYmplY3Qua2V5cyhPYnNlcnZhYmlsaXR5TGV2ZWwpLmpvaW4oJywgJyl9YCxcbiAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gVmFsaWRhdGUgc2FtcGxpbmcgcmF0ZXNcbiAgICBpZiAoY29uZmlnLnNhbXBsaW5nLmVuYWJsZWQpIHtcbiAgICAgIE9iamVjdC5lbnRyaWVzKGNvbmZpZy5zYW1wbGluZy5yYXRlcykuZm9yRWFjaCgoW2xldmVsLCByYXRlXSkgPT4ge1xuICAgICAgICBpZiAodHlwZW9mIHJhdGUgIT09ICdudW1iZXInIHx8IHJhdGUgPCAwIHx8IHJhdGUgPiAxKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHNhbXBsaW5nIHJhdGUgZm9yICR7bGV2ZWx9OiAke3JhdGV9LiBNdXN0IGJlIGJldHdlZW4gMCBhbmQgMS5gKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gVmFsaWRhdGUgYmFja2VuZCB0eXBlc1xuICAgIGNvbnN0IHZhbGlkQmFja2VuZHMgPSBbJ2Nsb3Vkd2F0Y2gnLCAnZHluYW1vZGInLCAnb3RlbCcsICdtb2NrJ107XG4gICAgY29uZmlnLmJhY2tlbmRzLmZvckVhY2goKGJhY2tlbmQpID0+IHtcbiAgICAgIGlmICghdmFsaWRCYWNrZW5kcy5pbmNsdWRlcyhiYWNrZW5kLnR5cGUpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICBgSW52YWxpZCBiYWNrZW5kIHR5cGU6ICR7YmFja2VuZC50eXBlfS4gTXVzdCBiZSBvbmUgb2Y6ICR7dmFsaWRCYWNrZW5kcy5qb2luKCcsICcpfWAsXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBzdGF0aWMgZ2V0Q29uZmlnKCk6IE9ic2VydmFiaWxpdHlDb25maWcge1xuICAgIHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKTtcbiAgICByZXR1cm4gdGhpcy5jb25maWchO1xuICB9XG5cbiAgc3RhdGljIHJlZ2lzdGVyQmFja2VuZChiYWNrZW5kOiBPYnNlcnZhYmlsaXR5QmFja2VuZCkge1xuICAgIGlmICghdGhpcy5iYWNrZW5kcy5maW5kKChiKSA9PiBiLm5hbWUgPT09IGJhY2tlbmQubmFtZSkpIHtcbiAgICAgIHRoaXMuYmFja2VuZHMucHVzaChiYWNrZW5kKTtcbiAgICB9XG4gIH1cblxuICBzdGF0aWMgaW5pdGlhbGl6ZUludm9jYXRpb24oKSB7XG4gICAgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpO1xuICAgIHRoaXMuYmFja2VuZHMuZm9yRWFjaCgoYmFja2VuZCkgPT4gYmFja2VuZC5pbml0aWFsaXplSW52b2NhdGlvbj8uKCkpO1xuICB9XG5cbiAgc3RhdGljIGNhcHR1cmUoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCk6IHZvaWQge1xuICAgIC8vIERlZmVuc2l2ZSBjaGVja3NcbiAgICBpZiAoIWV2ZW50IHx8IHR5cGVvZiBldmVudCAhPT0gJ29iamVjdCcpIHtcbiAgICAgIGxvZ2dlci53YXJuKCdJbnZhbGlkIGV2ZW50IHBhc3NlZCB0byBjYXB0dXJlJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKCFldmVudC50eXBlKSB7XG4gICAgICBsb2dnZXIud2FybignRXZlbnQgbWlzc2luZyByZXF1aXJlZCBmaWVsZDogdHlwZScpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICghZXZlbnQuY29ycmVsYXRpb25JZCkge1xuICAgICAgbG9nZ2VyLndhcm4oJ0V2ZW50IG1pc3NpbmcgcmVxdWlyZWQgZmllbGQ6IGNvcnJlbGF0aW9uSWQnKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBjb25maWcgPSB0aGlzLmdldENvbmZpZygpO1xuICAgIGlmICghY29uZmlnLmVuYWJsZWQpIHJldHVybjtcblxuICAgIC8vIEF1dG8taW5qZWN0IHNvdXJjZSBpZiBub3QgcHJvdmlkZWRcbiAgICBpZiAoIWV2ZW50LnNvdXJjZSkge1xuICAgICAgZXZlbnQuc291cmNlID0gZGV0ZWN0U291cmNlKCk7XG4gICAgfVxuXG4gICAgLy8gQXV0by1tZXJnZSBlbnZpcm9ubWVudCB0YWdzIHdpdGggZXZlbnQgdGFnc1xuICAgIGV2ZW50LnRhZ3MgPSBtZXJnZVRhZ3MoZXZlbnQudGFncywgdHJ1ZSk7XG5cbiAgICBpZiAoIU9ic2VydmFiaWxpdHlNYW5hZ2VyLnNob3VsZENhcHR1cmUoZXZlbnQsIGNvbmZpZykpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBHZXQgYmFja2VuZHMgZm9yIHRoaXMgc3BlY2lmaWMgdHlwZVxuICAgIGNvbnN0IGJhY2tlbmRzID0gdGhpcy5nZXRCYWNrZW5kc0ZvclR5cGUoZXZlbnQudHlwZSk7XG5cbiAgICAvLyBGaXJlLWFuZC1mb3JnZXQgKGRvbid0IGF3YWl0KVxuICAgIHZvaWQgUHJvbWlzZS5hbGwoXG4gICAgICBiYWNrZW5kcy5tYXAoYXN5bmMgKGJhY2tlbmQpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBpZiAoXG4gICAgICAgICAgICBiYWNrZW5kLm1pbkxldmVsICE9PSB1bmRlZmluZWQgJiZcbiAgICAgICAgICAgIE9ic2VydmFiaWxpdHlNYW5hZ2VyLmdldExldmVsVmFsdWUoZXZlbnQubGV2ZWwpIDwgYmFja2VuZC5taW5MZXZlbFxuICAgICAgICAgICkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgICBhd2FpdCBiYWNrZW5kLmNhcHR1cmUoZXZlbnQpO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGxvZ2dlci5lcnJvcihgRmFpbGVkIHRvIGNhcHR1cmUgZXZlbnQgaW4gYmFja2VuZCAke2JhY2tlbmQubmFtZX1gLCBlcnJvcik7XG4gICAgICAgIH1cbiAgICAgIH0pLFxuICAgICk7XG4gIH1cblxuICBwcml2YXRlIHN0YXRpYyBnZXRCYWNrZW5kc0ZvclR5cGUodHlwZTogc3RyaW5nKTogT2JzZXJ2YWJpbGl0eUJhY2tlbmRbXSB7XG4gICAgY29uc3QgdHlwZUNhdGVnb3J5ID0gdGhpcy5nZXRUeXBlQ2F0ZWdvcnkodHlwZSk7XG4gICAgY29uc3QgdHlwZUNvbmZpZyA9IHRoaXMuY29uZmlnPy50eXBlcz8uW3R5cGVDYXRlZ29yeV07XG5cbiAgICBpZiAodHlwZUNvbmZpZz8uYmFja2VuZHMpIHtcbiAgICAgIC8vIFVzZSB0eXBlLXNwZWNpZmljIGJhY2tlbmRzXG4gICAgICByZXR1cm4gdGhpcy5iYWNrZW5kcy5maWx0ZXIoKGIpID0+IHR5cGVDb25maWcuYmFja2VuZHMhLmluY2x1ZGVzKGIubmFtZSBhcyBhbnkpKTtcbiAgICB9XG5cbiAgICAvLyBGYWxsIGJhY2sgdG8gYWxsIGVuYWJsZWQgYmFja2VuZHNcbiAgICByZXR1cm4gdGhpcy5iYWNrZW5kcztcbiAgfVxuXG4gIHByaXZhdGUgc3RhdGljIGdldFR5cGVDYXRlZ29yeShcbiAgICB0eXBlOiBzdHJpbmcsXG4gICk6IGtleW9mIE5vbk51bGxhYmxlPE9ic2VydmFiaWxpdHlDb25maWdbJ3R5cGVzJ10+IHtcbiAgICBpZiAodHlwZS5zdGFydHNXaXRoKCdzcGFuLicpKSByZXR1cm4gJ3NwYW4nO1xuICAgIGlmICh0eXBlID09PSAnbWV0cmljJykgcmV0dXJuICdtZXRyaWMnO1xuICAgIGlmICh0eXBlLnN0YXJ0c1dpdGgoJ2F1ZGl0LicpKSByZXR1cm4gJ2F1ZGl0JztcbiAgICBpZiAodHlwZS5zdGFydHNXaXRoKCd3b3JrZmxvdy4nKSkgcmV0dXJuICd3b3JrZmxvdyc7XG4gICAgaWYgKHR5cGUuc3RhcnRzV2l0aCgnZGVjaXNpb24uJykpIHJldHVybiAnZGVjaXNpb24nO1xuICAgIHJldHVybiAnbG9nJztcbiAgfVxuXG4gIHN0YXRpYyBhc3luYyBmbHVzaCgpIHtcbiAgICBhd2FpdCBQcm9taXNlLmFsbChcbiAgICAgIHRoaXMuYmFja2VuZHMubWFwKGFzeW5jIChiYWNrZW5kKSA9PiB7XG4gICAgICAgIGlmIChiYWNrZW5kLmZsdXNoKSB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IGJhY2tlbmQuZmx1c2goKTtcbiAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgbG9nZ2VyLmVycm9yKGBGYWlsZWQgdG8gZmx1c2ggYmFja2VuZCAke2JhY2tlbmQubmFtZX1gLCBlcnJvcik7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KSxcbiAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSBzdGF0aWMgc2hvdWxkQ2FwdHVyZShldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50LCBjb25maWc6IE9ic2VydmFiaWxpdHlDb25maWcpOiBib29sZWFuIHtcbiAgICAvLyBMZXZlbCBjaGVjayBGSVJTVFxuICAgIGNvbnN0IGxldmVsVmFsdWUgPSB0aGlzLmdldExldmVsVmFsdWUoZXZlbnQubGV2ZWwpO1xuICAgIGlmIChsZXZlbFZhbHVlIDwgY29uZmlnLm1pbkxldmVsKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgLy8gQ1JJVElDQUwgbGV2ZWwgYWx3YXlzIGNhcHR1cmVkXG4gICAgaWYgKGxldmVsVmFsdWUgPT09IE9ic2VydmFiaWxpdHlMZXZlbC5DUklUSUNBTCkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgaWYgKCFjb25maWcuc2FtcGxpbmcuZW5hYmxlZCkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgLy8gQ2hlY2sgb3BlcmF0aW9uLXNwZWNpZmljIHNhbXBsaW5nXG4gICAgaWYgKGV2ZW50Lm9wZXJhdGlvbiAmJiBjb25maWcuc2FtcGxpbmcub3BlcmF0aW9ucykge1xuICAgICAgY29uc3QgZW50cmllcyA9IE9iamVjdC5lbnRyaWVzKGNvbmZpZy5zYW1wbGluZy5vcGVyYXRpb25zKTtcbiAgICAgIGZvciAoY29uc3QgW3BhdHRlcm4sIG9wUmF0ZV0gb2YgZW50cmllcykge1xuICAgICAgICBjb25zdCByZWdleCA9IG5ldyBSZWdFeHAoYF4ke3BhdHRlcm4ucmVwbGFjZSgvXFwqL2csICcuKicpfSRgKTtcbiAgICAgICAgaWYgKHJlZ2V4LnRlc3QoZXZlbnQub3BlcmF0aW9uKSkge1xuICAgICAgICAgIHJldHVybiBNYXRoLnJhbmRvbSgpIDwgb3BSYXRlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gU2FtcGxlIGJ5IGxldmVsXG4gICAgY29uc3QgcmF0ZSA9IGNvbmZpZy5zYW1wbGluZy5yYXRlc1tsZXZlbFZhbHVlXSA/PyAxLjA7XG4gICAgaWYgKHJhdGUgPj0gMSkgcmV0dXJuIHRydWU7XG4gICAgaWYgKHJhdGUgPD0gMCkgcmV0dXJuIGZhbHNlO1xuXG4gICAgcmV0dXJuIE1hdGgucmFuZG9tKCkgPCByYXRlO1xuICB9XG5cbiAgcHJpdmF0ZSBzdGF0aWMgZ2V0TGV2ZWxWYWx1ZShsZXZlbDogT2JzZXJ2YWJpbGl0eUV2ZW50WydsZXZlbCddKTogT2JzZXJ2YWJpbGl0eUxldmVsIHtcbiAgICByZXR1cm4gc3RyaW5nVG9MZXZlbChsZXZlbCk7XG4gIH1cblxuICBwcml2YXRlIHN0YXRpYyBhc3luYyBlbnN1cmVJbml0aWFsaXplZCgpIHtcbiAgICBpZiAodGhpcy5jb25maWcpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBlbmFibGVkID0gKHByb2Nlc3MuZW52Lk9CU0VSVkFCSUxJVFlfRU5BQkxFRCA/PyAndHJ1ZScpLnRvTG93ZXJDYXNlKCkgIT09ICdmYWxzZSc7XG4gICAgY29uc3QgbGV2ZWxOYW1lID0gKHByb2Nlc3MuZW52Lk9CU0VSVkFCSUxJVFlfTEVWRUwgPz8gJ2luZm8nKS50b1VwcGVyQ2FzZSgpO1xuICAgIGNvbnN0IG1pbkxldmVsID0gKE9ic2VydmFiaWxpdHlMZXZlbCBhcyBhbnkpW2xldmVsTmFtZV0gPz8gT2JzZXJ2YWJpbGl0eUxldmVsLklORk87XG5cbiAgICBjb25zdCBiYWNrZW5kTmFtZXMgPSAocHJvY2Vzcy5lbnYuT0JTRVJWQUJJTElUWV9CQUNLRU5EUyA/PyAnY2xvdWR3YXRjaCcpXG4gICAgICAuc3BsaXQoJywnKVxuICAgICAgLm1hcCgobmFtZSkgPT4gbmFtZS50cmltKCkudG9Mb3dlckNhc2UoKSlcbiAgICAgIC5maWx0ZXIoQm9vbGVhbik7XG5cbiAgICBjb25zdCBiYWNrZW5kSW5zdGFuY2VzOiBPYnNlcnZhYmlsaXR5QmFja2VuZFtdID0gW107XG4gICAgY29uc3QgYmFja2VuZENvbmZpZ3M6IE9ic2VydmFiaWxpdHlDb25maWdbJ2JhY2tlbmRzJ10gPSBbXTtcblxuICAgIGNvbnN0IHJlZ2lzdGVyQmFja2VuZCA9IGFzeW5jICh0eXBlOiBzdHJpbmcpID0+IHtcbiAgICAgIHN3aXRjaCAodHlwZSkge1xuICAgICAgICBjYXNlICdkeW5hbW9kYic6XG4gICAgICAgICAgYmFja2VuZEluc3RhbmNlcy5wdXNoKFxuICAgICAgICAgICAgbmV3IER5bmFtb0RCT2JzZXJ2YWJpbGl0eUJhY2tlbmQoe1xuICAgICAgICAgICAgICBtaW5MZXZlbCxcbiAgICAgICAgICAgICAgdHRsRGF5czogcGFyc2VJbnQocHJvY2Vzcy5lbnYuT0JTRVJWQUJJTElUWV9EWU5BTU9fVFRMX0RBWVMgfHwgJzkwJywgMTApLFxuICAgICAgICAgICAgfSksXG4gICAgICAgICAgKTtcbiAgICAgICAgICBiYWNrZW5kQ29uZmlncy5wdXNoKHsgdHlwZTogJ2R5bmFtb2RiJywgZW5hYmxlZDogdHJ1ZSB9KTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAnb3RlbCc6XG4gICAgICAgICAgYmFja2VuZEluc3RhbmNlcy5wdXNoKFxuICAgICAgICAgICAgbmV3IE9URUxPYnNlcnZhYmlsaXR5QmFja2VuZCh7XG4gICAgICAgICAgICAgIHNlcnZpY2VOYW1lOiBwcm9jZXNzLmVudi5TRVJWSUNFX05BTUUgfHwgJ2Z3MjQtc2VydmljZScsXG4gICAgICAgICAgICAgIG1pbkxldmVsLFxuICAgICAgICAgICAgfSksXG4gICAgICAgICAgKTtcbiAgICAgICAgICBiYWNrZW5kQ29uZmlncy5wdXNoKHsgdHlwZTogJ290ZWwnLCBlbmFibGVkOiB0cnVlIH0pO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICdjbG91ZHdhdGNoJzoge1xuICAgICAgICAgIGNvbnN0IHsgQ2xvdWRXYXRjaEJhY2tlbmQgfSA9IGF3YWl0IGltcG9ydCgnLi9iYWNrZW5kcy9jbG91ZHdhdGNoJyk7XG4gICAgICAgICAgYmFja2VuZEluc3RhbmNlcy5wdXNoKFxuICAgICAgICAgICAgbmV3IENsb3VkV2F0Y2hCYWNrZW5kKHtcbiAgICAgICAgICAgICAgc2VydmljZU5hbWU6IHByb2Nlc3MuZW52LlNFUlZJQ0VfTkFNRSB8fCAnZncyNC1zZXJ2aWNlJyxcbiAgICAgICAgICAgICAgbWluTGV2ZWwsXG4gICAgICAgICAgICAgIG5hbWVzcGFjZTogcHJvY2Vzcy5lbnYuQ0xPVURXQVRDSF9NRVRSSUNTX05BTUVTUEFDRSB8fCAnRlcyNCcsXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICApO1xuICAgICAgICAgIGJhY2tlbmRDb25maWdzLnB1c2goeyB0eXBlOiAnY2xvdWR3YXRjaCcsIGVuYWJsZWQ6IHRydWUgfSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICBsb2dnZXIud2FybihgVW5rbm93biBiYWNrZW5kIHR5cGU6ICR7dHlwZX1gKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9O1xuXG4gICAgaWYgKGJhY2tlbmROYW1lcy5sZW5ndGggPT09IDApIHtcbiAgICAgIGF3YWl0IHJlZ2lzdGVyQmFja2VuZCgnY2xvdWR3YXRjaCcpO1xuICAgIH0gZWxzZSB7XG4gICAgICBmb3IgKGNvbnN0IGJhY2tlbmROYW1lIG9mIGJhY2tlbmROYW1lcykge1xuICAgICAgICBhd2FpdCByZWdpc3RlckJhY2tlbmQoYmFja2VuZE5hbWUpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFBhcnNlIHR5cGUtc3BlY2lmaWMgYmFja2VuZCBvdmVycmlkZXNcbiAgICBjb25zdCB0eXBlczogT2JzZXJ2YWJpbGl0eUNvbmZpZ1sndHlwZXMnXSA9IHt9O1xuXG4gICAgY29uc3QgcGFyc2VUeXBlQmFja2VuZHMgPSAoZW52VmFyOiBzdHJpbmcsIHR5cGVLZXk6IGtleW9mIE5vbk51bGxhYmxlPE9ic2VydmFiaWxpdHlDb25maWdbJ3R5cGVzJ10+KSA9PiB7XG4gICAgICBjb25zdCB2YWx1ZSA9IHByb2Nlc3MuZW52W2VudlZhcl07XG4gICAgICBpZiAodmFsdWUpIHtcbiAgICAgICAgdHlwZXNbdHlwZUtleV0gPSB7XG4gICAgICAgICAgYmFja2VuZHM6IHZhbHVlLnNwbGl0KCcsJykubWFwKChiKSA9PiBiLnRyaW0oKSkgYXMgYW55LFxuICAgICAgICB9O1xuICAgICAgfVxuICAgIH07XG5cbiAgICBwYXJzZVR5cGVCYWNrZW5kcygnT0JTRVJWQUJJTElUWV9TUEFOX0JBQ0tFTkRTJywgJ3NwYW4nKTtcbiAgICBwYXJzZVR5cGVCYWNrZW5kcygnT0JTRVJWQUJJTElUWV9NRVRSSUNfQkFDS0VORFMnLCAnbWV0cmljJyk7XG4gICAgcGFyc2VUeXBlQmFja2VuZHMoJ09CU0VSVkFCSUxJVFlfQVVESVRfQkFDS0VORFMnLCAnYXVkaXQnKTtcbiAgICBwYXJzZVR5cGVCYWNrZW5kcygnT0JTRVJWQUJJTElUWV9MT0dfQkFDS0VORFMnLCAnbG9nJyk7XG4gICAgcGFyc2VUeXBlQmFja2VuZHMoJ09CU0VSVkFCSUxJVFlfREVDSVNJT05fQkFDS0VORFMnLCAnZGVjaXNpb24nKTtcbiAgICBwYXJzZVR5cGVCYWNrZW5kcygnT0JTRVJWQUJJTElUWV9XT1JLRkxPV19CQUNLRU5EUycsICd3b3JrZmxvdycpO1xuXG4gICAgY29uc3QgY29uZmlnOiBPYnNlcnZhYmlsaXR5Q29uZmlnID0ge1xuICAgICAgZW5hYmxlZCxcbiAgICAgIG1pbkxldmVsLFxuICAgICAgc2FtcGxpbmc6IERlZmF1bHRTYW1wbGluZ0NvbmZpZyxcbiAgICAgIGJhY2tlbmRzOiBiYWNrZW5kQ29uZmlncyxcbiAgICAgIHR5cGVzOiBPYmplY3Qua2V5cyh0eXBlcykubGVuZ3RoID4gMCA/IHR5cGVzIDogdW5kZWZpbmVkLFxuICAgIH07XG5cbiAgICB0aGlzLmluaXRpYWxpemUoY29uZmlnLCBiYWNrZW5kSW5zdGFuY2VzKTtcbiAgfVxufVxuXG5leHBvcnQgY29uc3Qgd2l0aE9ic2VydmFiaWxpdHkgPSA8VCBleHRlbmRzICguLi5hcmdzOiBhbnlbXSkgPT4gUHJvbWlzZTxhbnk+PihoYW5kbGVyOiBUKTogVCA9PiB7XG4gIHJldHVybiAoYXN5bmMgKC4uLmFyZ3M6IFBhcmFtZXRlcnM8VD4pID0+IHtcbiAgICB0cnkge1xuICAgICAgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuaW5pdGlhbGl6ZUludm9jYXRpb24oKTtcbiAgICAgIHJldHVybiBhd2FpdCBoYW5kbGVyKC4uLmFyZ3MpO1xuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBPYnNlcnZhYmlsaXR5TWFuYWdlci5mbHVzaCgpO1xuICAgIH1cbiAgfSkgYXMgVDtcbn07XG5cbi8qKlxuICogQWxpYXMgZm9yIE9ic2VydmFiaWxpdHlNYW5hZ2VyIChmb2xsb3dzIE9ic2VydmVyIGRlc2lnbiBwYXR0ZXJuKVxuICogXG4gKiBVc2FnZTpcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IE9ic2VydmVyIH0gZnJvbSAnQHRlbjI0Z3JvdXAvZncyNC9vYnNlcnZhYmlsaXR5JztcbiAqIFxuICogT2JzZXJ2ZXIuY2FwdHVyZSh7IC4uLiB9KTtcbiAqIGF3YWl0IE9ic2VydmVyLmZsdXNoKCk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IE9ic2VydmVyID0gT2JzZXJ2YWJpbGl0eU1hbmFnZXI7XG4iXX0=