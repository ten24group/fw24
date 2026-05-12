"use strict";
/**
 * Ships observability events to Logtrail’s Vector HTTP source (same contract as tslog logging).
 */
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LogtrailObservabilityBackend = void 0;
const di_1 = require("../../di");
const logtrail_1 = require("../../logging/logtrail");
const payload_1 = require("../utils/payload");
let LogtrailObservabilityBackend = class LogtrailObservabilityBackend {
    name = 'logtrail';
    minLevel;
    serviceLabelOverride;
    constructor(minLevel) {
        this.minLevel = minLevel;
    }
    configureFromBackendEntry(entry) {
        if (entry.type !== 'logtrail')
            return;
        const s = entry.config?.service?.trim();
        this.serviceLabelOverride = s || undefined;
    }
    async capture(event) {
        if (event.type === 'span.start') {
            return;
        }
        const levelStr = event.level.toLowerCase();
        try {
            const payload = (0, payload_1.safeSerialize)(event, { maxLength: 256 * 1024 });
            const message = typeof payload === 'string'
                ? payload
                : JSON.stringify(payload);
            (0, logtrail_1.shipLogtrailVectorJson)({
                level: levelStr,
                message,
                ...(this.serviceLabelOverride ? { service: this.serviceLabelOverride } : {}),
            });
        }
        catch {
            (0, logtrail_1.shipLogtrailVectorJson)({
                level: levelStr || 'info',
                message: JSON.stringify({ _fw24: 'observability_serialize_failed', type: event.type }),
                ...(this.serviceLabelOverride ? { service: this.serviceLabelOverride } : {}),
            });
        }
    }
};
exports.LogtrailObservabilityBackend = LogtrailObservabilityBackend;
exports.LogtrailObservabilityBackend = LogtrailObservabilityBackend = __decorate([
    (0, di_1.Injectable)({
        provide: 'ObservabilityBackend',
        providedIn: 'ROOT',
        tags: ['observability', 'backend', 'logtrail'],
    }),
    __param(0, (0, di_1.InjectConfig)('observability.minLevel'))
], LogtrailObservabilityBackend);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9ndHJhaWwuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9iYWNrZW5kcy9sb2d0cmFpbC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7O0dBRUc7Ozs7Ozs7Ozs7OztBQUVILGlDQUFvRDtBQUNwRCxxREFBZ0U7QUFHaEUsOENBQWlEO0FBTzFDLElBQU0sNEJBQTRCLEdBQWxDLE1BQU0sNEJBQTRCO0lBQ3ZCLElBQUksR0FBRyxVQUFtQixDQUFDO0lBQzNCLFFBQVEsQ0FBc0I7SUFFdEMsb0JBQW9CLENBQXFCO0lBRWpELFlBQzBDLFFBQTRCO1FBRXBFLElBQUksQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFDO0lBQzNCLENBQUM7SUFFRCx5QkFBeUIsQ0FBQyxLQUFpQztRQUN6RCxJQUFJLEtBQUssQ0FBQyxJQUFJLEtBQUssVUFBVTtZQUFFLE9BQU87UUFDdEMsTUFBTSxDQUFDLEdBQUcsS0FBSyxDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLENBQUM7UUFDeEMsSUFBSSxDQUFDLG9CQUFvQixHQUFHLENBQUMsSUFBSSxTQUFTLENBQUM7SUFDN0MsQ0FBQztJQUVELEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBeUI7UUFDckMsSUFBSSxLQUFLLENBQUMsSUFBSSxLQUFLLFlBQVksRUFBRSxDQUFDO1lBQ2hDLE9BQU87UUFDVCxDQUFDO1FBRUQsTUFBTSxRQUFRLEdBQUcsS0FBSyxDQUFDLEtBQUssQ0FBQyxXQUFXLEVBQUUsQ0FBQztRQUUzQyxJQUFJLENBQUM7WUFDSCxNQUFNLE9BQU8sR0FBRyxJQUFBLHVCQUFhLEVBQUMsS0FBSyxFQUFFLEVBQUUsU0FBUyxFQUFFLEdBQUcsR0FBRyxJQUFJLEVBQUUsQ0FBQyxDQUFDO1lBQ2hFLE1BQU0sT0FBTyxHQUFHLE9BQU8sT0FBTyxLQUFLLFFBQVE7Z0JBQ3pDLENBQUMsQ0FBQyxPQUFPO2dCQUNULENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1lBRTVCLElBQUEsaUNBQXNCLEVBQUM7Z0JBQ3JCLEtBQUssRUFBRSxRQUFRO2dCQUNmLE9BQU87Z0JBQ1AsR0FBRyxDQUFDLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLENBQUMsRUFBRSxPQUFPLEVBQUUsSUFBSSxDQUFDLG9CQUFvQixFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQzthQUM3RSxDQUFDLENBQUM7UUFDTCxDQUFDO1FBQUMsTUFBTSxDQUFDO1lBQ1AsSUFBQSxpQ0FBc0IsRUFBQztnQkFDckIsS0FBSyxFQUFFLFFBQVEsSUFBSSxNQUFNO2dCQUN6QixPQUFPLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLEtBQUssRUFBRSxnQ0FBZ0MsRUFBRSxJQUFJLEVBQUUsS0FBSyxDQUFDLElBQUksRUFBRSxDQUFDO2dCQUN0RixHQUFHLENBQUMsSUFBSSxDQUFDLG9CQUFvQixDQUFDLENBQUMsQ0FBQyxFQUFFLE9BQU8sRUFBRSxJQUFJLENBQUMsb0JBQW9CLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO2FBQzdFLENBQUMsQ0FBQztRQUNMLENBQUM7SUFDSCxDQUFDO0NBQ0YsQ0FBQTtBQTVDWSxvRUFBNEI7dUNBQTVCLDRCQUE0QjtJQUx4QyxJQUFBLGVBQVUsRUFBQztRQUNWLE9BQU8sRUFBRSxzQkFBc0I7UUFDL0IsVUFBVSxFQUFFLE1BQU07UUFDbEIsSUFBSSxFQUFFLENBQUUsZUFBZSxFQUFFLFNBQVMsRUFBRSxVQUFVLENBQUU7S0FDakQsQ0FBQztJQVFHLFdBQUEsSUFBQSxpQkFBWSxFQUFDLHdCQUF3QixDQUFDLENBQUE7R0FQOUIsNEJBQTRCLENBNEN4QyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogU2hpcHMgb2JzZXJ2YWJpbGl0eSBldmVudHMgdG8gTG9ndHJhaWzigJlzIFZlY3RvciBIVFRQIHNvdXJjZSAoc2FtZSBjb250cmFjdCBhcyB0c2xvZyBsb2dnaW5nKS5cbiAqL1xuXG5pbXBvcnQgeyBJbmplY3RhYmxlLCBJbmplY3RDb25maWcgfSBmcm9tICcuLi8uLi9kaSc7XG5pbXBvcnQgeyBzaGlwTG9ndHJhaWxWZWN0b3JKc29uIH0gZnJvbSAnLi4vLi4vbG9nZ2luZy9sb2d0cmFpbCc7XG5pbXBvcnQgdHlwZSB7IE9ic2VydmFiaWxpdHlCYWNrZW5kLCBPYnNlcnZhYmlsaXR5QmFja2VuZENvbmZpZywgT2JzZXJ2YWJpbGl0eUV2ZW50IH0gZnJvbSAnLi4vdHlwZXMnO1xuaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eUxldmVsIH0gZnJvbSAnLi4vdHlwZXMnO1xuaW1wb3J0IHsgc2FmZVNlcmlhbGl6ZSB9IGZyb20gJy4uL3V0aWxzL3BheWxvYWQnO1xuXG5ASW5qZWN0YWJsZSh7XG4gIHByb3ZpZGU6ICdPYnNlcnZhYmlsaXR5QmFja2VuZCcsXG4gIHByb3ZpZGVkSW46ICdST09UJyxcbiAgdGFnczogWyAnb2JzZXJ2YWJpbGl0eScsICdiYWNrZW5kJywgJ2xvZ3RyYWlsJyBdLFxufSlcbmV4cG9ydCBjbGFzcyBMb2d0cmFpbE9ic2VydmFiaWxpdHlCYWNrZW5kIGltcGxlbWVudHMgT2JzZXJ2YWJpbGl0eUJhY2tlbmQge1xuICBwdWJsaWMgcmVhZG9ubHkgbmFtZSA9ICdsb2d0cmFpbCcgYXMgY29uc3Q7XG4gIHB1YmxpYyByZWFkb25seSBtaW5MZXZlbD86IE9ic2VydmFiaWxpdHlMZXZlbDtcblxuICBwcml2YXRlIHNlcnZpY2VMYWJlbE92ZXJyaWRlOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgQEluamVjdENvbmZpZygnb2JzZXJ2YWJpbGl0eS5taW5MZXZlbCcpIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwsXG4gICkge1xuICAgIHRoaXMubWluTGV2ZWwgPSBtaW5MZXZlbDtcbiAgfVxuXG4gIGNvbmZpZ3VyZUZyb21CYWNrZW5kRW50cnkoZW50cnk6IE9ic2VydmFiaWxpdHlCYWNrZW5kQ29uZmlnKTogdm9pZCB7XG4gICAgaWYgKGVudHJ5LnR5cGUgIT09ICdsb2d0cmFpbCcpIHJldHVybjtcbiAgICBjb25zdCBzID0gZW50cnkuY29uZmlnPy5zZXJ2aWNlPy50cmltKCk7XG4gICAgdGhpcy5zZXJ2aWNlTGFiZWxPdmVycmlkZSA9IHMgfHwgdW5kZWZpbmVkO1xuICB9XG5cbiAgYXN5bmMgY2FwdHVyZShldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKGV2ZW50LnR5cGUgPT09ICdzcGFuLnN0YXJ0Jykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGxldmVsU3RyID0gZXZlbnQubGV2ZWwudG9Mb3dlckNhc2UoKTtcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBwYXlsb2FkID0gc2FmZVNlcmlhbGl6ZShldmVudCwgeyBtYXhMZW5ndGg6IDI1NiAqIDEwMjQgfSk7XG4gICAgICBjb25zdCBtZXNzYWdlID0gdHlwZW9mIHBheWxvYWQgPT09ICdzdHJpbmcnXG4gICAgICAgID8gcGF5bG9hZFxuICAgICAgICA6IEpTT04uc3RyaW5naWZ5KHBheWxvYWQpO1xuXG4gICAgICBzaGlwTG9ndHJhaWxWZWN0b3JKc29uKHtcbiAgICAgICAgbGV2ZWw6IGxldmVsU3RyLFxuICAgICAgICBtZXNzYWdlLFxuICAgICAgICAuLi4odGhpcy5zZXJ2aWNlTGFiZWxPdmVycmlkZSA/IHsgc2VydmljZTogdGhpcy5zZXJ2aWNlTGFiZWxPdmVycmlkZSB9IDoge30pLFxuICAgICAgfSk7XG4gICAgfSBjYXRjaCB7XG4gICAgICBzaGlwTG9ndHJhaWxWZWN0b3JKc29uKHtcbiAgICAgICAgbGV2ZWw6IGxldmVsU3RyIHx8ICdpbmZvJyxcbiAgICAgICAgbWVzc2FnZTogSlNPTi5zdHJpbmdpZnkoeyBfZncyNDogJ29ic2VydmFiaWxpdHlfc2VyaWFsaXplX2ZhaWxlZCcsIHR5cGU6IGV2ZW50LnR5cGUgfSksXG4gICAgICAgIC4uLih0aGlzLnNlcnZpY2VMYWJlbE92ZXJyaWRlID8geyBzZXJ2aWNlOiB0aGlzLnNlcnZpY2VMYWJlbE92ZXJyaWRlIH0gOiB7fSksXG4gICAgICB9KTtcbiAgICB9XG4gIH1cbn1cbiJdfQ==