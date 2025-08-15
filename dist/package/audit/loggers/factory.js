"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditLoggerFactory = void 0;
const logging_1 = require("../../logging");
const utils_1 = require("../../utils");
const interfaces_1 = require("../interfaces");
const cloudwatch_1 = require("./cloudwatch");
const console_1 = require("./console");
const dummy_1 = require("./dummy");
const dynamodb_1 = require("./dynamodb");
class AuditLoggerFactory {
    static instance;
    auditLoggerCache = new Map();
    logger = (0, logging_1.createLogger)(AuditLoggerFactory);
    constructor() { }
    static getInstance() {
        if (!AuditLoggerFactory.instance) {
            AuditLoggerFactory.instance = new AuditLoggerFactory();
        }
        return AuditLoggerFactory.instance;
    }
    /**
     * Get the default auditor configuration based on environment variables
     */
    getDefaultConfig() {
        const envType = (0, utils_1.resolveEnvValueFor)({ key: interfaces_1.AUDIT_ENV_KEYS.TYPE }) || interfaces_1.AuditLoggerType.CLOUDWATCH;
        return {
            enabled: (0, utils_1.resolveEnvValueFor)({ key: interfaces_1.AUDIT_ENV_KEYS.ENABLED }) === 'true',
            type: envType,
            logGroupName: (0, utils_1.resolveEnvValueFor)({ key: interfaces_1.AUDIT_ENV_KEYS.LOG_GROUP_NAME }),
            region: (0, utils_1.resolveEnvValueFor)({ key: interfaces_1.AUDIT_ENV_KEYS.REGION }),
        };
    }
    /**
     * Create an auditor instance. If no configuration is provided, uses environment variables.
     * If no environment variables are set, defaults to console auditor.
     */
    create(config) {
        const effectiveConfig = {
            ...this.getDefaultConfig(),
            ...config
        };
        // Return cached instance if available
        const cacheKey = this.getCacheKey(effectiveConfig);
        if (this.auditLoggerCache.has(cacheKey)) {
            return this.auditLoggerCache.get(cacheKey);
        }
        this.logger.debug('Creating audit logger', effectiveConfig);
        let auditLogger;
        // If auditing is disabled, return dummy auditor
        switch (effectiveConfig.type) {
            case interfaces_1.AuditLoggerType.DYNAMODB:
                auditLogger = new dynamodb_1.DynamoDbAuditLogger(effectiveConfig);
                break;
            case interfaces_1.AuditLoggerType.CONSOLE:
                auditLogger = new console_1.ConsoleAuditLogger(effectiveConfig);
                break;
            case interfaces_1.AuditLoggerType.DUMMY:
                auditLogger = new dummy_1.DummyAuditLogger();
                break;
            case interfaces_1.AuditLoggerType.CLOUDWATCH:
            default:
                auditLogger = new cloudwatch_1.CloudWatchAuditLogger(effectiveConfig);
                break;
        }
        // Cache the instance
        this.auditLoggerCache.set(cacheKey, auditLogger);
        return auditLogger;
    }
    getCacheKey(config) {
        return `${config.type}`;
    }
}
exports.AuditLoggerFactory = AuditLoggerFactory;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZmFjdG9yeS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9hdWRpdC9sb2dnZXJzL2ZhY3RvcnkudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsMkNBQTZDO0FBQzdDLHVDQUFpRDtBQUNqRCw4Q0FBaUc7QUFDakcsNkNBQXFEO0FBQ3JELHVDQUErQztBQUMvQyxtQ0FBMkM7QUFDM0MseUNBQWlEO0FBRWpELE1BQWEsa0JBQWtCO0lBQ25CLE1BQU0sQ0FBQyxRQUFRLENBQXFCO0lBQ3BDLGdCQUFnQixHQUE4QixJQUFJLEdBQUcsRUFBRSxDQUFDO0lBQ3hELE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsa0JBQWtCLENBQUMsQ0FBQztJQUNsRCxnQkFBd0IsQ0FBQztJQUVsQixNQUFNLENBQUMsV0FBVztRQUNyQixJQUFJLENBQUMsa0JBQWtCLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDL0Isa0JBQWtCLENBQUMsUUFBUSxHQUFHLElBQUksa0JBQWtCLEVBQUUsQ0FBQztRQUMzRCxDQUFDO1FBQ0QsT0FBTyxrQkFBa0IsQ0FBQyxRQUFRLENBQUM7SUFDdkMsQ0FBQztJQUVEOztPQUVHO0lBQ0ssZ0JBQWdCO1FBQ3BCLE1BQU0sT0FBTyxHQUFHLElBQUEsMEJBQWtCLEVBQUMsRUFBRSxHQUFHLEVBQUUsMkJBQWMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxJQUFJLDRCQUFlLENBQUMsVUFBVSxDQUFDO1FBRS9GLE9BQU87WUFDSCxPQUFPLEVBQUUsSUFBQSwwQkFBa0IsRUFBQyxFQUFFLEdBQUcsRUFBRSwyQkFBYyxDQUFDLE9BQU8sRUFBRSxDQUFDLEtBQUssTUFBTTtZQUN2RSxJQUFJLEVBQUUsT0FBMEI7WUFDaEMsWUFBWSxFQUFFLElBQUEsMEJBQWtCLEVBQUMsRUFBRSxHQUFHLEVBQUUsMkJBQWMsQ0FBQyxjQUFjLEVBQUUsQ0FBQztZQUN4RSxNQUFNLEVBQUUsSUFBQSwwQkFBa0IsRUFBQyxFQUFFLEdBQUcsRUFBRSwyQkFBYyxDQUFDLE1BQU0sRUFBRSxDQUFDO1NBQzdELENBQUM7SUFDTixDQUFDO0lBRUQ7OztPQUdHO0lBQ0ksTUFBTSxDQUFDLE1BQTBCO1FBRXBDLE1BQU0sZUFBZSxHQUFHO1lBQ3BCLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixFQUFFO1lBQzFCLEdBQUcsTUFBTTtTQUNaLENBQUM7UUFFRixzQ0FBc0M7UUFDdEMsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLFdBQVcsQ0FBQyxlQUFlLENBQUMsQ0FBQztRQUNuRCxJQUFJLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQztZQUN0QyxPQUFPLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFFLENBQUM7UUFDaEQsQ0FBQztRQUVELElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLHVCQUF1QixFQUFFLGVBQWUsQ0FBQyxDQUFDO1FBRTVELElBQUksV0FBeUIsQ0FBQztRQUU5QixnREFBZ0Q7UUFDaEQsUUFBUSxlQUFlLENBQUMsSUFBSSxFQUFFLENBQUM7WUFDM0IsS0FBSyw0QkFBZSxDQUFDLFFBQVE7Z0JBQ3pCLFdBQVcsR0FBRyxJQUFJLDhCQUFtQixDQUFDLGVBQWUsQ0FBQyxDQUFDO2dCQUN2RCxNQUFNO1lBQ1YsS0FBSyw0QkFBZSxDQUFDLE9BQU87Z0JBQ3hCLFdBQVcsR0FBRyxJQUFJLDRCQUFrQixDQUFDLGVBQWUsQ0FBQyxDQUFDO2dCQUN0RCxNQUFNO1lBQ1YsS0FBSyw0QkFBZSxDQUFDLEtBQUs7Z0JBQ3RCLFdBQVcsR0FBRyxJQUFJLHdCQUFnQixFQUFFLENBQUM7Z0JBQ3JDLE1BQU07WUFDVixLQUFLLDRCQUFlLENBQUMsVUFBVSxDQUFDO1lBQ2hDO2dCQUNJLFdBQVcsR0FBRyxJQUFJLGtDQUFxQixDQUFDLGVBQWUsQ0FBQyxDQUFDO2dCQUN6RCxNQUFNO1FBQ2QsQ0FBQztRQUVELHFCQUFxQjtRQUNyQixJQUFJLENBQUMsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLFFBQVEsRUFBRSxXQUFXLENBQUMsQ0FBQztRQUNqRCxPQUFPLFdBQVcsQ0FBQztJQUN2QixDQUFDO0lBRU8sV0FBVyxDQUFDLE1BQXlCO1FBQ3pDLE9BQU8sR0FBRyxNQUFNLENBQUMsSUFBSSxFQUFFLENBQUM7SUFDNUIsQ0FBQztDQUNKO0FBekVELGdEQXlFQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gJy4uLy4uL2xvZ2dpbmcnO1xuaW1wb3J0IHsgcmVzb2x2ZUVudlZhbHVlRm9yIH0gZnJvbSAnLi4vLi4vdXRpbHMnO1xuaW1wb3J0IHsgQVVESVRfRU5WX0tFWVMsIEF1ZGl0TG9nZ2VyQ29uZmlnLCBBdWRpdExvZ2dlclR5cGUsIElBdWRpdExvZ2dlciB9IGZyb20gJy4uL2ludGVyZmFjZXMnO1xuaW1wb3J0IHsgQ2xvdWRXYXRjaEF1ZGl0TG9nZ2VyIH0gZnJvbSAnLi9jbG91ZHdhdGNoJztcbmltcG9ydCB7IENvbnNvbGVBdWRpdExvZ2dlciB9IGZyb20gJy4vY29uc29sZSc7XG5pbXBvcnQgeyBEdW1teUF1ZGl0TG9nZ2VyIH0gZnJvbSAnLi9kdW1teSc7XG5pbXBvcnQgeyBEeW5hbW9EYkF1ZGl0TG9nZ2VyIH0gZnJvbSAnLi9keW5hbW9kYic7XG5cbmV4cG9ydCBjbGFzcyBBdWRpdExvZ2dlckZhY3Rvcnkge1xuICAgIHByaXZhdGUgc3RhdGljIGluc3RhbmNlOiBBdWRpdExvZ2dlckZhY3Rvcnk7XG4gICAgcHJpdmF0ZSBhdWRpdExvZ2dlckNhY2hlOiBNYXA8c3RyaW5nLCBJQXVkaXRMb2dnZXI+ID0gbmV3IE1hcCgpO1xuICAgIHByaXZhdGUgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKEF1ZGl0TG9nZ2VyRmFjdG9yeSk7XG4gICAgcHJpdmF0ZSBjb25zdHJ1Y3RvcigpIHsgfVxuXG4gICAgcHVibGljIHN0YXRpYyBnZXRJbnN0YW5jZSgpOiBBdWRpdExvZ2dlckZhY3Rvcnkge1xuICAgICAgICBpZiAoIUF1ZGl0TG9nZ2VyRmFjdG9yeS5pbnN0YW5jZSkge1xuICAgICAgICAgICAgQXVkaXRMb2dnZXJGYWN0b3J5Lmluc3RhbmNlID0gbmV3IEF1ZGl0TG9nZ2VyRmFjdG9yeSgpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBBdWRpdExvZ2dlckZhY3RvcnkuaW5zdGFuY2U7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IHRoZSBkZWZhdWx0IGF1ZGl0b3IgY29uZmlndXJhdGlvbiBiYXNlZCBvbiBlbnZpcm9ubWVudCB2YXJpYWJsZXNcbiAgICAgKi9cbiAgICBwcml2YXRlIGdldERlZmF1bHRDb25maWcoKTogQXVkaXRMb2dnZXJDb25maWcge1xuICAgICAgICBjb25zdCBlbnZUeXBlID0gcmVzb2x2ZUVudlZhbHVlRm9yKHsga2V5OiBBVURJVF9FTlZfS0VZUy5UWVBFIH0pIHx8IEF1ZGl0TG9nZ2VyVHlwZS5DTE9VRFdBVENIO1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBlbmFibGVkOiByZXNvbHZlRW52VmFsdWVGb3IoeyBrZXk6IEFVRElUX0VOVl9LRVlTLkVOQUJMRUQgfSkgPT09ICd0cnVlJyxcbiAgICAgICAgICAgIHR5cGU6IGVudlR5cGUgYXMgQXVkaXRMb2dnZXJUeXBlLFxuICAgICAgICAgICAgbG9nR3JvdXBOYW1lOiByZXNvbHZlRW52VmFsdWVGb3IoeyBrZXk6IEFVRElUX0VOVl9LRVlTLkxPR19HUk9VUF9OQU1FIH0pLFxuICAgICAgICAgICAgcmVnaW9uOiByZXNvbHZlRW52VmFsdWVGb3IoeyBrZXk6IEFVRElUX0VOVl9LRVlTLlJFR0lPTiB9KSxcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDcmVhdGUgYW4gYXVkaXRvciBpbnN0YW5jZS4gSWYgbm8gY29uZmlndXJhdGlvbiBpcyBwcm92aWRlZCwgdXNlcyBlbnZpcm9ubWVudCB2YXJpYWJsZXMuXG4gICAgICogSWYgbm8gZW52aXJvbm1lbnQgdmFyaWFibGVzIGFyZSBzZXQsIGRlZmF1bHRzIHRvIGNvbnNvbGUgYXVkaXRvci5cbiAgICAgKi9cbiAgICBwdWJsaWMgY3JlYXRlKGNvbmZpZz86IEF1ZGl0TG9nZ2VyQ29uZmlnKTogSUF1ZGl0TG9nZ2VyIHtcblxuICAgICAgICBjb25zdCBlZmZlY3RpdmVDb25maWcgPSB7XG4gICAgICAgICAgICAuLi50aGlzLmdldERlZmF1bHRDb25maWcoKSxcbiAgICAgICAgICAgIC4uLmNvbmZpZ1xuICAgICAgICB9O1xuXG4gICAgICAgIC8vIFJldHVybiBjYWNoZWQgaW5zdGFuY2UgaWYgYXZhaWxhYmxlXG4gICAgICAgIGNvbnN0IGNhY2hlS2V5ID0gdGhpcy5nZXRDYWNoZUtleShlZmZlY3RpdmVDb25maWcpO1xuICAgICAgICBpZiAodGhpcy5hdWRpdExvZ2dlckNhY2hlLmhhcyhjYWNoZUtleSkpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmF1ZGl0TG9nZ2VyQ2FjaGUuZ2V0KGNhY2hlS2V5KSE7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnQ3JlYXRpbmcgYXVkaXQgbG9nZ2VyJywgZWZmZWN0aXZlQ29uZmlnKTtcblxuICAgICAgICBsZXQgYXVkaXRMb2dnZXI6IElBdWRpdExvZ2dlcjtcblxuICAgICAgICAvLyBJZiBhdWRpdGluZyBpcyBkaXNhYmxlZCwgcmV0dXJuIGR1bW15IGF1ZGl0b3JcbiAgICAgICAgc3dpdGNoIChlZmZlY3RpdmVDb25maWcudHlwZSkge1xuICAgICAgICAgICAgY2FzZSBBdWRpdExvZ2dlclR5cGUuRFlOQU1PREI6XG4gICAgICAgICAgICAgICAgYXVkaXRMb2dnZXIgPSBuZXcgRHluYW1vRGJBdWRpdExvZ2dlcihlZmZlY3RpdmVDb25maWcpO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSBBdWRpdExvZ2dlclR5cGUuQ09OU09MRTpcbiAgICAgICAgICAgICAgICBhdWRpdExvZ2dlciA9IG5ldyBDb25zb2xlQXVkaXRMb2dnZXIoZWZmZWN0aXZlQ29uZmlnKTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgQXVkaXRMb2dnZXJUeXBlLkRVTU1ZOlxuICAgICAgICAgICAgICAgIGF1ZGl0TG9nZ2VyID0gbmV3IER1bW15QXVkaXRMb2dnZXIoKTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgQXVkaXRMb2dnZXJUeXBlLkNMT1VEV0FUQ0g6XG4gICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgIGF1ZGl0TG9nZ2VyID0gbmV3IENsb3VkV2F0Y2hBdWRpdExvZ2dlcihlZmZlY3RpdmVDb25maWcpO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ2FjaGUgdGhlIGluc3RhbmNlXG4gICAgICAgIHRoaXMuYXVkaXRMb2dnZXJDYWNoZS5zZXQoY2FjaGVLZXksIGF1ZGl0TG9nZ2VyKTtcbiAgICAgICAgcmV0dXJuIGF1ZGl0TG9nZ2VyO1xuICAgIH1cblxuICAgIHByaXZhdGUgZ2V0Q2FjaGVLZXkoY29uZmlnOiBBdWRpdExvZ2dlckNvbmZpZyk6IHN0cmluZyB7XG4gICAgICAgIHJldHVybiBgJHtjb25maWcudHlwZX1gO1xuICAgIH1cbn0iXX0=