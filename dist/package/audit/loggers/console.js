"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConsoleAuditLogger = void 0;
const logging_1 = require("../../logging");
class ConsoleAuditLogger {
    logger = (0, logging_1.createLogger)(ConsoleAuditLogger);
    enabled;
    constructor(config) {
        this.enabled = config?.enabled ?? false;
    }
    async audit(options) {
        // If explicitly disabled for this operation or globally disabled, skip logging
        if (options.enabled === false || this.enabled === false) {
            return;
        }
        const auditEntry = {
            timestamp: new Date().toISOString(),
            ...options.auditEntry
        };
        this.logger.info('Audit Log:', auditEntry);
    }
}
exports.ConsoleAuditLogger = ConsoleAuditLogger;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29uc29sZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9hdWRpdC9sb2dnZXJzL2NvbnNvbGUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsMkNBQTZDO0FBRzdDLE1BQWEsa0JBQWtCO0lBQ25CLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsa0JBQWtCLENBQUMsQ0FBQztJQUMxQyxPQUFPLENBQVU7SUFFekIsWUFBWSxNQUEwQjtRQUNsQyxJQUFJLENBQUMsT0FBTyxHQUFHLE1BQU0sRUFBRSxPQUFPLElBQUksS0FBSyxDQUFDO0lBQzVDLENBQUM7SUFFRCxLQUFLLENBQUMsS0FBSyxDQUFDLE9BQXFCO1FBQzdCLCtFQUErRTtRQUMvRSxJQUFJLE9BQU8sQ0FBQyxPQUFPLEtBQUssS0FBSyxJQUFJLElBQUksQ0FBQyxPQUFPLEtBQUssS0FBSyxFQUFFLENBQUM7WUFDdEQsT0FBTztRQUNYLENBQUM7UUFFRCxNQUFNLFVBQVUsR0FBRztZQUNmLFNBQVMsRUFBRSxJQUFJLElBQUksRUFBRSxDQUFDLFdBQVcsRUFBRTtZQUNuQyxHQUFHLE9BQU8sQ0FBQyxVQUFVO1NBQ3hCLENBQUM7UUFDRixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxZQUFZLEVBQUUsVUFBVSxDQUFDLENBQUM7SUFDL0MsQ0FBQztDQUNKO0FBcEJELGdEQW9CQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gJy4uLy4uL2xvZ2dpbmcnO1xuaW1wb3J0IHsgQXVkaXRMb2dnZXJDb25maWcsIEF1ZGl0T3B0aW9ucywgSUF1ZGl0TG9nZ2VyIH0gZnJvbSAnLi4vaW50ZXJmYWNlcyc7XG5cbmV4cG9ydCBjbGFzcyBDb25zb2xlQXVkaXRMb2dnZXIgaW1wbGVtZW50cyBJQXVkaXRMb2dnZXIge1xuICAgIHByaXZhdGUgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKENvbnNvbGVBdWRpdExvZ2dlcik7XG4gICAgcHJpdmF0ZSBlbmFibGVkOiBib29sZWFuO1xuXG4gICAgY29uc3RydWN0b3IoY29uZmlnPzogQXVkaXRMb2dnZXJDb25maWcpIHtcbiAgICAgICAgdGhpcy5lbmFibGVkID0gY29uZmlnPy5lbmFibGVkID8/IGZhbHNlO1xuICAgIH1cblxuICAgIGFzeW5jIGF1ZGl0KG9wdGlvbnM6IEF1ZGl0T3B0aW9ucyk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICAvLyBJZiBleHBsaWNpdGx5IGRpc2FibGVkIGZvciB0aGlzIG9wZXJhdGlvbiBvciBnbG9iYWxseSBkaXNhYmxlZCwgc2tpcCBsb2dnaW5nXG4gICAgICAgIGlmIChvcHRpb25zLmVuYWJsZWQgPT09IGZhbHNlIHx8IHRoaXMuZW5hYmxlZCA9PT0gZmFsc2UpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGF1ZGl0RW50cnkgPSB7XG4gICAgICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICAgIC4uLm9wdGlvbnMuYXVkaXRFbnRyeVxuICAgICAgICB9O1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKCdBdWRpdCBMb2c6JywgYXVkaXRFbnRyeSk7XG4gICAgfVxufSAiXX0=