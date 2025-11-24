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
exports.withObservability = exports.ObservabilityManager = void 0;
const logging_1 = require("../logging");
const types_1 = require("./types");
const dynamodb_1 = require("./backends/dynamodb");
const otel_1 = require("./backends/otel");
const level_utils_1 = require("./utils/level-utils");
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFuYWdlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L21hbmFnZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsd0NBQTBDO0FBQzFDLG1DQU1pQjtBQUNqQixrREFBbUU7QUFDbkUsMENBQTJEO0FBQzNELHFEQUFvRDtBQUVwRCxNQUFNLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsc0JBQXNCLENBQUMsQ0FBQztBQUVwRCxNQUFhLG9CQUFvQjtJQUN2QixNQUFNLENBQUMsTUFBTSxHQUErQixJQUFJLENBQUM7SUFDakQsTUFBTSxDQUFDLFFBQVEsR0FBMkIsRUFBRSxDQUFDO0lBRXJELE1BQU0sQ0FBQyxVQUFVLENBQUMsTUFBMkIsRUFBRSxRQUFnQztRQUM3RSxJQUFJLENBQUMsY0FBYyxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBQzVCLElBQUksQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFDO1FBQ3JCLElBQUksQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFDO0lBQzNCLENBQUM7SUFFTyxNQUFNLENBQUMsY0FBYyxDQUFDLE1BQTJCO1FBQ3ZELG9CQUFvQjtRQUNwQixNQUFNLFdBQVcsR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLDBCQUFrQixDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxPQUFPLENBQUMsS0FBSyxRQUFRLENBQUMsQ0FBQztRQUMzRixJQUFJLENBQUMsV0FBVyxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQztZQUMzQyxNQUFNLElBQUksS0FBSyxDQUNiLHFCQUFxQixNQUFNLENBQUMsUUFBUSxxQkFBcUIsTUFBTSxDQUFDLElBQUksQ0FBQywwQkFBa0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUN0RyxDQUFDO1FB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SyxDQUFDLENBQUMsQ0FBQyxTQUFTO1NBQ3pELENBQUM7UUFFRixJQUFJLENBQUMsVUFBVSxDQUFDLE1BQU0sRUFBRSxnQkFBZ0IsQ0FBQyxDQUFDO0lBQzVDLENBQUM7O0FBNVFILG9EQTZRQztBQUVNLE1BQU0saUJBQWlCLEdBQUcsQ0FBNkMsT0FBVSxFQUFLLEVBQUU7SUFDN0YsT0FBTyxDQUFDLEtBQUssRUFBRSxHQUFHLElBQW1CLEVBQUUsRUFBRTtRQUN2QyxJQUFJLENBQUM7WUFDSCxvQkFBb0IsQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO1lBQzVDLE9BQU8sTUFBTSxPQUFPLENBQUMsR0FBRyxJQUFJLENBQUMsQ0FBQztRQUNoQyxDQUFDO2dCQUFTLENBQUM7WUFDVCxNQUFNLG9CQUFvQixDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ3JDLENBQUM7SUFDSCxDQUFDLENBQU0sQ0FBQztBQUNWLENBQUMsQ0FBQztBQVRXLFFBQUEsaUJBQWlCLHFCQVM1QiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gJy4uL2xvZ2dpbmcnO1xuaW1wb3J0IHtcbiAgRGVmYXVsdFNhbXBsaW5nQ29uZmlnLFxuICBPYnNlcnZhYmlsaXR5QmFja2VuZCxcbiAgT2JzZXJ2YWJpbGl0eUNvbmZpZyxcbiAgT2JzZXJ2YWJpbGl0eUV2ZW50LFxuICBPYnNlcnZhYmlsaXR5TGV2ZWwsXG59IGZyb20gJy4vdHlwZXMnO1xuaW1wb3J0IHsgRHluYW1vREJPYnNlcnZhYmlsaXR5QmFja2VuZCB9IGZyb20gJy4vYmFja2VuZHMvZHluYW1vZGInO1xuaW1wb3J0IHsgT1RFTE9ic2VydmFiaWxpdHlCYWNrZW5kIH0gZnJvbSAnLi9iYWNrZW5kcy9vdGVsJztcbmltcG9ydCB7IHN0cmluZ1RvTGV2ZWwgfSBmcm9tICcuL3V0aWxzL2xldmVsLXV0aWxzJztcblxuY29uc3QgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdPYnNlcnZhYmlsaXR5TWFuYWdlcicpO1xuXG5leHBvcnQgY2xhc3MgT2JzZXJ2YWJpbGl0eU1hbmFnZXIge1xuICBwcml2YXRlIHN0YXRpYyBjb25maWc6IE9ic2VydmFiaWxpdHlDb25maWcgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzdGF0aWMgYmFja2VuZHM6IE9ic2VydmFiaWxpdHlCYWNrZW5kW10gPSBbXTtcblxuICBzdGF0aWMgaW5pdGlhbGl6ZShjb25maWc6IE9ic2VydmFiaWxpdHlDb25maWcsIGJhY2tlbmRzOiBPYnNlcnZhYmlsaXR5QmFja2VuZFtdKSB7XG4gICAgdGhpcy52YWxpZGF0ZUNvbmZpZyhjb25maWcpO1xuICAgIHRoaXMuY29uZmlnID0gY29uZmlnO1xuICAgIHRoaXMuYmFja2VuZHMgPSBiYWNrZW5kcztcbiAgfVxuXG4gIHByaXZhdGUgc3RhdGljIHZhbGlkYXRlQ29uZmlnKGNvbmZpZzogT2JzZXJ2YWJpbGl0eUNvbmZpZyk6IHZvaWQge1xuICAgIC8vIFZhbGlkYXRlIG1pbkxldmVsXG4gICAgY29uc3QgdmFsaWRMZXZlbHMgPSBPYmplY3QudmFsdWVzKE9ic2VydmFiaWxpdHlMZXZlbCkuZmlsdGVyKCh2KSA9PiB0eXBlb2YgdiA9PT0gJ251bWJlcicpO1xuICAgIGlmICghdmFsaWRMZXZlbHMuaW5jbHVkZXMoY29uZmlnLm1pbkxldmVsKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBgSW52YWxpZCBtaW5MZXZlbDogJHtjb25maWcubWluTGV2ZWx9LiBNdXN0IGJlIG9uZSBvZjogJHtPYmplY3Qua2V5cyhPYnNlcnZhYmlsaXR5TGV2ZWwpLmpvaW4oJywgJyl9YCxcbiAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gVmFsaWRhdGUgc2FtcGxpbmcgcmF0ZXNcbiAgICBpZiAoY29uZmlnLnNhbXBsaW5nLmVuYWJsZWQpIHtcbiAgICAgIE9iamVjdC5lbnRyaWVzKGNvbmZpZy5zYW1wbGluZy5yYXRlcykuZm9yRWFjaCgoW2xldmVsLCByYXRlXSkgPT4ge1xuICAgICAgICBpZiAodHlwZW9mIHJhdGUgIT09ICdudW1iZXInIHx8IHJhdGUgPCAwIHx8IHJhdGUgPiAxKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHNhbXBsaW5nIHJhdGUgZm9yICR7bGV2ZWx9OiAke3JhdGV9LiBNdXN0IGJlIGJldHdlZW4gMCBhbmQgMS5gKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gVmFsaWRhdGUgYmFja2VuZCB0eXBlc1xuICAgIGNvbnN0IHZhbGlkQmFja2VuZHMgPSBbJ2Nsb3Vkd2F0Y2gnLCAnZHluYW1vZGInLCAnb3RlbCcsICdtb2NrJ107XG4gICAgY29uZmlnLmJhY2tlbmRzLmZvckVhY2goKGJhY2tlbmQpID0+IHtcbiAgICAgIGlmICghdmFsaWRCYWNrZW5kcy5pbmNsdWRlcyhiYWNrZW5kLnR5cGUpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICBgSW52YWxpZCBiYWNrZW5kIHR5cGU6ICR7YmFja2VuZC50eXBlfS4gTXVzdCBiZSBvbmUgb2Y6ICR7dmFsaWRCYWNrZW5kcy5qb2luKCcsICcpfWAsXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBzdGF0aWMgZ2V0Q29uZmlnKCk6IE9ic2VydmFiaWxpdHlDb25maWcge1xuICAgIHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKTtcbiAgICByZXR1cm4gdGhpcy5jb25maWchO1xuICB9XG5cbiAgc3RhdGljIHJlZ2lzdGVyQmFja2VuZChiYWNrZW5kOiBPYnNlcnZhYmlsaXR5QmFja2VuZCkge1xuICAgIGlmICghdGhpcy5iYWNrZW5kcy5maW5kKChiKSA9PiBiLm5hbWUgPT09IGJhY2tlbmQubmFtZSkpIHtcbiAgICAgIHRoaXMuYmFja2VuZHMucHVzaChiYWNrZW5kKTtcbiAgICB9XG4gIH1cblxuICBzdGF0aWMgaW5pdGlhbGl6ZUludm9jYXRpb24oKSB7XG4gICAgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpO1xuICAgIHRoaXMuYmFja2VuZHMuZm9yRWFjaCgoYmFja2VuZCkgPT4gYmFja2VuZC5pbml0aWFsaXplSW52b2NhdGlvbj8uKCkpO1xuICB9XG5cbiAgc3RhdGljIGNhcHR1cmUoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCk6IHZvaWQge1xuICAgIC8vIERlZmVuc2l2ZSBjaGVja3NcbiAgICBpZiAoIWV2ZW50IHx8IHR5cGVvZiBldmVudCAhPT0gJ29iamVjdCcpIHtcbiAgICAgIGxvZ2dlci53YXJuKCdJbnZhbGlkIGV2ZW50IHBhc3NlZCB0byBjYXB0dXJlJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKCFldmVudC50eXBlKSB7XG4gICAgICBsb2dnZXIud2FybignRXZlbnQgbWlzc2luZyByZXF1aXJlZCBmaWVsZDogdHlwZScpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICghZXZlbnQuY29ycmVsYXRpb25JZCkge1xuICAgICAgbG9nZ2VyLndhcm4oJ0V2ZW50IG1pc3NpbmcgcmVxdWlyZWQgZmllbGQ6IGNvcnJlbGF0aW9uSWQnKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBjb25maWcgPSB0aGlzLmdldENvbmZpZygpO1xuICAgIGlmICghY29uZmlnLmVuYWJsZWQpIHJldHVybjtcblxuICAgIGlmICghT2JzZXJ2YWJpbGl0eU1hbmFnZXIuc2hvdWxkQ2FwdHVyZShldmVudCwgY29uZmlnKSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIEdldCBiYWNrZW5kcyBmb3IgdGhpcyBzcGVjaWZpYyB0eXBlXG4gICAgY29uc3QgYmFja2VuZHMgPSB0aGlzLmdldEJhY2tlbmRzRm9yVHlwZShldmVudC50eXBlKTtcblxuICAgIC8vIEZpcmUtYW5kLWZvcmdldCAoZG9uJ3QgYXdhaXQpXG4gICAgdm9pZCBQcm9taXNlLmFsbChcbiAgICAgIGJhY2tlbmRzLm1hcChhc3luYyAoYmFja2VuZCkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGlmIChcbiAgICAgICAgICAgIGJhY2tlbmQubWluTGV2ZWwgIT09IHVuZGVmaW5lZCAmJlxuICAgICAgICAgICAgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuZ2V0TGV2ZWxWYWx1ZShldmVudC5sZXZlbCkgPCBiYWNrZW5kLm1pbkxldmVsXG4gICAgICAgICAgKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIGF3YWl0IGJhY2tlbmQuY2FwdHVyZShldmVudCk7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgbG9nZ2VyLmVycm9yKGBGYWlsZWQgdG8gY2FwdHVyZSBldmVudCBpbiBiYWNrZW5kICR7YmFja2VuZC5uYW1lfWAsIGVycm9yKTtcbiAgICAgICAgfVxuICAgICAgfSksXG4gICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgc3RhdGljIGdldEJhY2tlbmRzRm9yVHlwZSh0eXBlOiBzdHJpbmcpOiBPYnNlcnZhYmlsaXR5QmFja2VuZFtdIHtcbiAgICBjb25zdCB0eXBlQ2F0ZWdvcnkgPSB0aGlzLmdldFR5cGVDYXRlZ29yeSh0eXBlKTtcbiAgICBjb25zdCB0eXBlQ29uZmlnID0gdGhpcy5jb25maWc/LnR5cGVzPy5bdHlwZUNhdGVnb3J5XTtcblxuICAgIGlmICh0eXBlQ29uZmlnPy5iYWNrZW5kcykge1xuICAgICAgLy8gVXNlIHR5cGUtc3BlY2lmaWMgYmFja2VuZHNcbiAgICAgIHJldHVybiB0aGlzLmJhY2tlbmRzLmZpbHRlcigoYikgPT4gdHlwZUNvbmZpZy5iYWNrZW5kcyEuaW5jbHVkZXMoYi5uYW1lIGFzIGFueSkpO1xuICAgIH1cblxuICAgIC8vIEZhbGwgYmFjayB0byBhbGwgZW5hYmxlZCBiYWNrZW5kc1xuICAgIHJldHVybiB0aGlzLmJhY2tlbmRzO1xuICB9XG5cbiAgcHJpdmF0ZSBzdGF0aWMgZ2V0VHlwZUNhdGVnb3J5KFxuICAgIHR5cGU6IHN0cmluZyxcbiAgKToga2V5b2YgTm9uTnVsbGFibGU8T2JzZXJ2YWJpbGl0eUNvbmZpZ1sndHlwZXMnXT4ge1xuICAgIGlmICh0eXBlLnN0YXJ0c1dpdGgoJ3NwYW4uJykpIHJldHVybiAnc3Bhbic7XG4gICAgaWYgKHR5cGUgPT09ICdtZXRyaWMnKSByZXR1cm4gJ21ldHJpYyc7XG4gICAgaWYgKHR5cGUuc3RhcnRzV2l0aCgnYXVkaXQuJykpIHJldHVybiAnYXVkaXQnO1xuICAgIGlmICh0eXBlLnN0YXJ0c1dpdGgoJ3dvcmtmbG93LicpKSByZXR1cm4gJ3dvcmtmbG93JztcbiAgICBpZiAodHlwZS5zdGFydHNXaXRoKCdkZWNpc2lvbi4nKSkgcmV0dXJuICdkZWNpc2lvbic7XG4gICAgcmV0dXJuICdsb2cnO1xuICB9XG5cbiAgc3RhdGljIGFzeW5jIGZsdXNoKCkge1xuICAgIGF3YWl0IFByb21pc2UuYWxsKFxuICAgICAgdGhpcy5iYWNrZW5kcy5tYXAoYXN5bmMgKGJhY2tlbmQpID0+IHtcbiAgICAgICAgaWYgKGJhY2tlbmQuZmx1c2gpIHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgYXdhaXQgYmFja2VuZC5mbHVzaCgpO1xuICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBsb2dnZXIuZXJyb3IoYEZhaWxlZCB0byBmbHVzaCBiYWNrZW5kICR7YmFja2VuZC5uYW1lfWAsIGVycm9yKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pLFxuICAgICk7XG4gIH1cblxuICBwcml2YXRlIHN0YXRpYyBzaG91bGRDYXB0dXJlKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsIGNvbmZpZzogT2JzZXJ2YWJpbGl0eUNvbmZpZyk6IGJvb2xlYW4ge1xuICAgIC8vIExldmVsIGNoZWNrIEZJUlNUXG4gICAgY29uc3QgbGV2ZWxWYWx1ZSA9IHRoaXMuZ2V0TGV2ZWxWYWx1ZShldmVudC5sZXZlbCk7XG4gICAgaWYgKGxldmVsVmFsdWUgPCBjb25maWcubWluTGV2ZWwpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICAvLyBDUklUSUNBTCBsZXZlbCBhbHdheXMgY2FwdHVyZWRcbiAgICBpZiAobGV2ZWxWYWx1ZSA9PT0gT2JzZXJ2YWJpbGl0eUxldmVsLkNSSVRJQ0FMKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICBpZiAoIWNvbmZpZy5zYW1wbGluZy5lbmFibGVkKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICAvLyBDaGVjayBvcGVyYXRpb24tc3BlY2lmaWMgc2FtcGxpbmdcbiAgICBpZiAoZXZlbnQub3BlcmF0aW9uICYmIGNvbmZpZy5zYW1wbGluZy5vcGVyYXRpb25zKSB7XG4gICAgICBjb25zdCBlbnRyaWVzID0gT2JqZWN0LmVudHJpZXMoY29uZmlnLnNhbXBsaW5nLm9wZXJhdGlvbnMpO1xuICAgICAgZm9yIChjb25zdCBbcGF0dGVybiwgb3BSYXRlXSBvZiBlbnRyaWVzKSB7XG4gICAgICAgIGNvbnN0IHJlZ2V4ID0gbmV3IFJlZ0V4cChgXiR7cGF0dGVybi5yZXBsYWNlKC9cXCovZywgJy4qJyl9JGApO1xuICAgICAgICBpZiAocmVnZXgudGVzdChldmVudC5vcGVyYXRpb24pKSB7XG4gICAgICAgICAgcmV0dXJuIE1hdGgucmFuZG9tKCkgPCBvcFJhdGU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBTYW1wbGUgYnkgbGV2ZWxcbiAgICBjb25zdCByYXRlID0gY29uZmlnLnNhbXBsaW5nLnJhdGVzW2xldmVsVmFsdWVdID8/IDEuMDtcbiAgICBpZiAocmF0ZSA+PSAxKSByZXR1cm4gdHJ1ZTtcbiAgICBpZiAocmF0ZSA8PSAwKSByZXR1cm4gZmFsc2U7XG5cbiAgICByZXR1cm4gTWF0aC5yYW5kb20oKSA8IHJhdGU7XG4gIH1cblxuICBwcml2YXRlIHN0YXRpYyBnZXRMZXZlbFZhbHVlKGxldmVsOiBPYnNlcnZhYmlsaXR5RXZlbnRbJ2xldmVsJ10pOiBPYnNlcnZhYmlsaXR5TGV2ZWwge1xuICAgIHJldHVybiBzdHJpbmdUb0xldmVsKGxldmVsKTtcbiAgfVxuXG4gIHByaXZhdGUgc3RhdGljIGFzeW5jIGVuc3VyZUluaXRpYWxpemVkKCkge1xuICAgIGlmICh0aGlzLmNvbmZpZykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGVuYWJsZWQgPSAocHJvY2Vzcy5lbnYuT0JTRVJWQUJJTElUWV9FTkFCTEVEID8/ICd0cnVlJykudG9Mb3dlckNhc2UoKSAhPT0gJ2ZhbHNlJztcbiAgICBjb25zdCBsZXZlbE5hbWUgPSAocHJvY2Vzcy5lbnYuT0JTRVJWQUJJTElUWV9MRVZFTCA/PyAnaW5mbycpLnRvVXBwZXJDYXNlKCk7XG4gICAgY29uc3QgbWluTGV2ZWwgPSAoT2JzZXJ2YWJpbGl0eUxldmVsIGFzIGFueSlbbGV2ZWxOYW1lXSA/PyBPYnNlcnZhYmlsaXR5TGV2ZWwuSU5GTztcblxuICAgIGNvbnN0IGJhY2tlbmROYW1lcyA9IChwcm9jZXNzLmVudi5PQlNFUlZBQklMSVRZX0JBQ0tFTkRTID8/ICdjbG91ZHdhdGNoJylcbiAgICAgIC5zcGxpdCgnLCcpXG4gICAgICAubWFwKChuYW1lKSA9PiBuYW1lLnRyaW0oKS50b0xvd2VyQ2FzZSgpKVxuICAgICAgLmZpbHRlcihCb29sZWFuKTtcblxuICAgIGNvbnN0IGJhY2tlbmRJbnN0YW5jZXM6IE9ic2VydmFiaWxpdHlCYWNrZW5kW10gPSBbXTtcbiAgICBjb25zdCBiYWNrZW5kQ29uZmlnczogT2JzZXJ2YWJpbGl0eUNvbmZpZ1snYmFja2VuZHMnXSA9IFtdO1xuXG4gICAgY29uc3QgcmVnaXN0ZXJCYWNrZW5kID0gYXN5bmMgKHR5cGU6IHN0cmluZykgPT4ge1xuICAgICAgc3dpdGNoICh0eXBlKSB7XG4gICAgICAgIGNhc2UgJ2R5bmFtb2RiJzpcbiAgICAgICAgICBiYWNrZW5kSW5zdGFuY2VzLnB1c2goXG4gICAgICAgICAgICBuZXcgRHluYW1vREJPYnNlcnZhYmlsaXR5QmFja2VuZCh7XG4gICAgICAgICAgICAgIG1pbkxldmVsLFxuICAgICAgICAgICAgICB0dGxEYXlzOiBwYXJzZUludChwcm9jZXNzLmVudi5PQlNFUlZBQklMSVRZX0RZTkFNT19UVExfREFZUyB8fCAnOTAnLCAxMCksXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICApO1xuICAgICAgICAgIGJhY2tlbmRDb25maWdzLnB1c2goeyB0eXBlOiAnZHluYW1vZGInLCBlbmFibGVkOiB0cnVlIH0pO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICdvdGVsJzpcbiAgICAgICAgICBiYWNrZW5kSW5zdGFuY2VzLnB1c2goXG4gICAgICAgICAgICBuZXcgT1RFTE9ic2VydmFiaWxpdHlCYWNrZW5kKHtcbiAgICAgICAgICAgICAgc2VydmljZU5hbWU6IHByb2Nlc3MuZW52LlNFUlZJQ0VfTkFNRSB8fCAnZncyNC1zZXJ2aWNlJyxcbiAgICAgICAgICAgICAgbWluTGV2ZWwsXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICApO1xuICAgICAgICAgIGJhY2tlbmRDb25maWdzLnB1c2goeyB0eXBlOiAnb3RlbCcsIGVuYWJsZWQ6IHRydWUgfSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgJ2Nsb3Vkd2F0Y2gnOiB7XG4gICAgICAgICAgY29uc3QgeyBDbG91ZFdhdGNoQmFja2VuZCB9ID0gYXdhaXQgaW1wb3J0KCcuL2JhY2tlbmRzL2Nsb3Vkd2F0Y2gnKTtcbiAgICAgICAgICBiYWNrZW5kSW5zdGFuY2VzLnB1c2goXG4gICAgICAgICAgICBuZXcgQ2xvdWRXYXRjaEJhY2tlbmQoe1xuICAgICAgICAgICAgICBzZXJ2aWNlTmFtZTogcHJvY2Vzcy5lbnYuU0VSVklDRV9OQU1FIHx8ICdmdzI0LXNlcnZpY2UnLFxuICAgICAgICAgICAgICBtaW5MZXZlbCxcbiAgICAgICAgICAgICAgbmFtZXNwYWNlOiBwcm9jZXNzLmVudi5DTE9VRFdBVENIX01FVFJJQ1NfTkFNRVNQQUNFIHx8ICdGVzI0JyxcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgICk7XG4gICAgICAgICAgYmFja2VuZENvbmZpZ3MucHVzaCh7IHR5cGU6ICdjbG91ZHdhdGNoJywgZW5hYmxlZDogdHJ1ZSB9KTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIGxvZ2dlci53YXJuKGBVbmtub3duIGJhY2tlbmQgdHlwZTogJHt0eXBlfWApO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH07XG5cbiAgICBpZiAoYmFja2VuZE5hbWVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgYXdhaXQgcmVnaXN0ZXJCYWNrZW5kKCdjbG91ZHdhdGNoJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGZvciAoY29uc3QgYmFja2VuZE5hbWUgb2YgYmFja2VuZE5hbWVzKSB7XG4gICAgICAgIGF3YWl0IHJlZ2lzdGVyQmFja2VuZChiYWNrZW5kTmFtZSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gUGFyc2UgdHlwZS1zcGVjaWZpYyBiYWNrZW5kIG92ZXJyaWRlc1xuICAgIGNvbnN0IHR5cGVzOiBPYnNlcnZhYmlsaXR5Q29uZmlnWyd0eXBlcyddID0ge307XG5cbiAgICBjb25zdCBwYXJzZVR5cGVCYWNrZW5kcyA9IChlbnZWYXI6IHN0cmluZywgdHlwZUtleToga2V5b2YgTm9uTnVsbGFibGU8T2JzZXJ2YWJpbGl0eUNvbmZpZ1sndHlwZXMnXT4pID0+IHtcbiAgICAgIGNvbnN0IHZhbHVlID0gcHJvY2Vzcy5lbnZbZW52VmFyXTtcbiAgICAgIGlmICh2YWx1ZSkge1xuICAgICAgICB0eXBlc1t0eXBlS2V5XSA9IHtcbiAgICAgICAgICBiYWNrZW5kczogdmFsdWUuc3BsaXQoJywnKS5tYXAoKGIpID0+IGIudHJpbSgpKSBhcyBhbnksXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgfTtcblxuICAgIHBhcnNlVHlwZUJhY2tlbmRzKCdPQlNFUlZBQklMSVRZX1NQQU5fQkFDS0VORFMnLCAnc3BhbicpO1xuICAgIHBhcnNlVHlwZUJhY2tlbmRzKCdPQlNFUlZBQklMSVRZX01FVFJJQ19CQUNLRU5EUycsICdtZXRyaWMnKTtcbiAgICBwYXJzZVR5cGVCYWNrZW5kcygnT0JTRVJWQUJJTElUWV9BVURJVF9CQUNLRU5EUycsICdhdWRpdCcpO1xuICAgIHBhcnNlVHlwZUJhY2tlbmRzKCdPQlNFUlZBQklMSVRZX0xPR19CQUNLRU5EUycsICdsb2cnKTtcbiAgICBwYXJzZVR5cGVCYWNrZW5kcygnT0JTRVJWQUJJTElUWV9ERUNJU0lPTl9CQUNLRU5EUycsICdkZWNpc2lvbicpO1xuICAgIHBhcnNlVHlwZUJhY2tlbmRzKCdPQlNFUlZBQklMSVRZX1dPUktGTE9XX0JBQ0tFTkRTJywgJ3dvcmtmbG93Jyk7XG5cbiAgICBjb25zdCBjb25maWc6IE9ic2VydmFiaWxpdHlDb25maWcgPSB7XG4gICAgICBlbmFibGVkLFxuICAgICAgbWluTGV2ZWwsXG4gICAgICBzYW1wbGluZzogRGVmYXVsdFNhbXBsaW5nQ29uZmlnLFxuICAgICAgYmFja2VuZHM6IGJhY2tlbmRDb25maWdzLFxuICAgICAgdHlwZXM6IE9iamVjdC5rZXlzKHR5cGVzKS5sZW5ndGggPiAwID8gdHlwZXMgOiB1bmRlZmluZWQsXG4gICAgfTtcblxuICAgIHRoaXMuaW5pdGlhbGl6ZShjb25maWcsIGJhY2tlbmRJbnN0YW5jZXMpO1xuICB9XG59XG5cbmV4cG9ydCBjb25zdCB3aXRoT2JzZXJ2YWJpbGl0eSA9IDxUIGV4dGVuZHMgKC4uLmFyZ3M6IGFueVtdKSA9PiBQcm9taXNlPGFueT4+KGhhbmRsZXI6IFQpOiBUID0+IHtcbiAgcmV0dXJuIChhc3luYyAoLi4uYXJnczogUGFyYW1ldGVyczxUPikgPT4ge1xuICAgIHRyeSB7XG4gICAgICBPYnNlcnZhYmlsaXR5TWFuYWdlci5pbml0aWFsaXplSW52b2NhdGlvbigpO1xuICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZXIoLi4uYXJncyk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmZsdXNoKCk7XG4gICAgfVxuICB9KSBhcyBUO1xufTtcbiJdfQ==