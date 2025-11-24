"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordMetric = void 0;
const crypto_1 = require("crypto");
const manager_1 = require("./manager");
const recordMetric = (options) => {
    const metricId = (0, crypto_1.randomUUID)();
    manager_1.ObservabilityManager.capture({
        type: 'metric',
        level: options.level ?? 'info',
        correlationId: options.traceId ?? (0, crypto_1.randomUUID)(),
        entityName: 'metric',
        entityId: metricId,
        timestampMs: Date.now(),
        operation: options.name,
        metrics: {
            [options.name]: options.value,
        },
        attributes: {
            unit: options.unit,
            metricType: options.type ?? 'gauge',
            ...options.attributes,
        },
    });
};
exports.recordMetric = recordMetric;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWV0cmljcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L21ldHJpY3MudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsbUNBQW9DO0FBQ3BDLHVDQUFpRDtBQWExQyxNQUFNLFlBQVksR0FBRyxDQUFDLE9BQTRCLEVBQVEsRUFBRTtJQUNqRSxNQUFNLFFBQVEsR0FBRyxJQUFBLG1CQUFVLEdBQUUsQ0FBQztJQUM5Qiw4QkFBb0IsQ0FBQyxPQUFPLENBQUM7UUFDM0IsSUFBSSxFQUFFLFFBQVE7UUFDZCxLQUFLLEVBQUUsT0FBTyxDQUFDLEtBQUssSUFBSSxNQUFNO1FBQzlCLGFBQWEsRUFBRSxPQUFPLENBQUMsT0FBTyxJQUFJLElBQUEsbUJBQVUsR0FBRTtRQUM5QyxVQUFVLEVBQUUsUUFBUTtRQUNwQixRQUFRLEVBQUUsUUFBUTtRQUNsQixXQUFXLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRTtRQUN2QixTQUFTLEVBQUUsT0FBTyxDQUFDLElBQUk7UUFDdkIsT0FBTyxFQUFFO1lBQ1AsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLEVBQUUsT0FBTyxDQUFDLEtBQUs7U0FDOUI7UUFDRCxVQUFVLEVBQUU7WUFDVixJQUFJLEVBQUUsT0FBTyxDQUFDLElBQUk7WUFDbEIsVUFBVSxFQUFFLE9BQU8sQ0FBQyxJQUFJLElBQUksT0FBTztZQUNuQyxHQUFHLE9BQU8sQ0FBQyxVQUFVO1NBQ3RCO0tBQ0YsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDO0FBbkJXLFFBQUEsWUFBWSxnQkFtQnZCIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgcmFuZG9tVVVJRCB9IGZyb20gJ2NyeXB0byc7XG5pbXBvcnQgeyBPYnNlcnZhYmlsaXR5TWFuYWdlciB9IGZyb20gJy4vbWFuYWdlcic7XG5pbXBvcnQgdHlwZSB7IE9ic2VydmFiaWxpdHlFdmVudCB9IGZyb20gJy4vdHlwZXMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIFJlY29yZE1ldHJpY09wdGlvbnMge1xuICBuYW1lOiBzdHJpbmc7XG4gIHZhbHVlOiBudW1iZXI7XG4gIHVuaXQ/OiBzdHJpbmc7XG4gIHR5cGU/OiAnY291bnRlcicgfCAnZ2F1Z2UnIHwgJ2hpc3RvZ3JhbSc7XG4gIGxldmVsPzogT2JzZXJ2YWJpbGl0eUV2ZW50WydsZXZlbCddO1xuICBhdHRyaWJ1dGVzPzogUmVjb3JkPHN0cmluZywgYW55PjtcbiAgdHJhY2VJZD86IHN0cmluZztcbn1cblxuZXhwb3J0IGNvbnN0IHJlY29yZE1ldHJpYyA9IChvcHRpb25zOiBSZWNvcmRNZXRyaWNPcHRpb25zKTogdm9pZCA9PiB7XG4gIGNvbnN0IG1ldHJpY0lkID0gcmFuZG9tVVVJRCgpO1xuICBPYnNlcnZhYmlsaXR5TWFuYWdlci5jYXB0dXJlKHtcbiAgICB0eXBlOiAnbWV0cmljJyxcbiAgICBsZXZlbDogb3B0aW9ucy5sZXZlbCA/PyAnaW5mbycsXG4gICAgY29ycmVsYXRpb25JZDogb3B0aW9ucy50cmFjZUlkID8/IHJhbmRvbVVVSUQoKSxcbiAgICBlbnRpdHlOYW1lOiAnbWV0cmljJyxcbiAgICBlbnRpdHlJZDogbWV0cmljSWQsXG4gICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgb3BlcmF0aW9uOiBvcHRpb25zLm5hbWUsXG4gICAgbWV0cmljczoge1xuICAgICAgW29wdGlvbnMubmFtZV06IG9wdGlvbnMudmFsdWUsXG4gICAgfSxcbiAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICB1bml0OiBvcHRpb25zLnVuaXQsXG4gICAgICBtZXRyaWNUeXBlOiBvcHRpb25zLnR5cGUgPz8gJ2dhdWdlJyxcbiAgICAgIC4uLm9wdGlvbnMuYXR0cmlidXRlcyxcbiAgICB9LFxuICB9KTtcbn07XG5cbiJdfQ==