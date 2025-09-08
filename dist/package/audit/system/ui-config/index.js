"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditCustomPageConfigs = void 0;
const di_1 = require("../../../di");
const list_entity_1 = __importDefault(require("../../../ui-config-gen/templates/list-entity"));
const view_entity_1 = __importDefault(require("../../../ui-config-gen/templates/view-entity"));
const dynamodb_1 = require("../../loggers/dynamodb");
const audit_entity_service_1 = require("../audit-entity-service");
const auditService = di_1.DIContainer.ROOT.resolve(audit_entity_service_1.DynamoDBAuditEntityService);
const entityDefaultOpsSchema = auditService.getOpsDefaultIOSchema();
const entitySchema = dynamodb_1.DynamoDBAuditEntitySchema;
const listingUiConfig = (0, list_entity_1.default)({
    entityName: entitySchema.model.entity,
    entityNamePlural: entitySchema.model.entityNamePlural,
    CRUDApiPath: entitySchema.model.CRUDApiPath,
    useSearch: Boolean(entitySchema.model.search?.enabled),
    properties: entityDefaultOpsSchema.list.output,
    excludeFromAdminCreate: true,
    excludeFromAdminUpdate: true,
    excludeFromAdminDelete: true,
});
const viewUiConfig = (0, view_entity_1.default)({
    entityName: entitySchema.model.entity,
    entityNamePlural: entitySchema.model.entityNamePlural,
    properties: entityDefaultOpsSchema.get.output,
    breadcrumbs: [
        { label: "Home", url: "/" },
        { label: "System", url: "/system" },
        { label: "Audit Logs", url: "/system/list-auditlog" },
        { label: "Audit Log Detail" }
    ],
    columnsConfig: entitySchema.model.viewPageColumnsConfig,
}, auditService);
exports.AuditCustomPageConfigs = {
    listingUiConfig: {
        ...listingUiConfig,
        routePattern: `/system/list-auditlog`,
        breadcrumbs: [
            { label: "Home", url: "/" },
            { label: "System", url: "/system" },
            { label: "Audit Logs" }
        ]
    },
    viewUiConfig: {
        ...viewUiConfig,
        pageHeaderActions: [{
                label: "Back",
                url: "/system/list-auditlog",
                icon: "arrow-left"
            }],
        routePattern: `/view-auditlog/:auditId`,
        detailsPageConfig: {
            ...viewUiConfig.detailsPageConfig,
            detailApiConfig: {
                ...viewUiConfig.detailsPageConfig.detailApiConfig,
                apiUrl: '/system/auditlog/:auditId',
            }
        }
    },
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvYXVkaXQvc3lzdGVtL3VpLWNvbmZpZy9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFBQSxvQ0FBMEM7QUFDMUMsK0ZBQWdGO0FBQ2hGLCtGQUFnRjtBQUNoRixxREFBbUU7QUFDbkUsa0VBQXFFO0FBRXJFLE1BQU0sWUFBWSxHQUFHLGdCQUFXLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxpREFBMEIsQ0FBQyxDQUFDO0FBRTFFLE1BQU0sc0JBQXNCLEdBQUcsWUFBWSxDQUFDLHFCQUFxQixFQUFFLENBQUM7QUFDcEUsTUFBTSxZQUFZLEdBQUcsb0NBQXlCLENBQUM7QUFFL0MsTUFBTSxlQUFlLEdBQUcsSUFBQSxxQkFBb0IsRUFBQztJQUMzQyxVQUFVLEVBQUUsWUFBWSxDQUFDLEtBQUssQ0FBQyxNQUFNO0lBQ3JDLGdCQUFnQixFQUFFLFlBQVksQ0FBQyxLQUFLLENBQUMsZ0JBQWdCO0lBQ3JELFdBQVcsRUFBRSxZQUFZLENBQUMsS0FBSyxDQUFDLFdBQVc7SUFDM0MsU0FBUyxFQUFFLE9BQU8sQ0FBQyxZQUFZLENBQUMsS0FBSyxDQUFDLE1BQU0sRUFBRSxPQUFPLENBQUM7SUFDdEQsVUFBVSxFQUFFLHNCQUFzQixDQUFDLElBQUksQ0FBQyxNQUFNO0lBQzlDLHNCQUFzQixFQUFFLElBQUk7SUFDNUIsc0JBQXNCLEVBQUUsSUFBSTtJQUM1QixzQkFBc0IsRUFBRSxJQUFJO0NBQzdCLENBQUMsQ0FBQztBQUVILE1BQU0sWUFBWSxHQUFHLElBQUEscUJBQW9CLEVBQUM7SUFDeEMsVUFBVSxFQUFFLFlBQVksQ0FBQyxLQUFLLENBQUMsTUFBTTtJQUNyQyxnQkFBZ0IsRUFBRSxZQUFZLENBQUMsS0FBSyxDQUFDLGdCQUFnQjtJQUNyRCxVQUFVLEVBQUUsc0JBQXNCLENBQUMsR0FBRyxDQUFDLE1BQU07SUFDN0MsV0FBVyxFQUFFO1FBQ1gsRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUU7UUFDM0IsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLEdBQUcsRUFBRSxTQUFTLEVBQUU7UUFDbkMsRUFBRSxLQUFLLEVBQUUsWUFBWSxFQUFFLEdBQUcsRUFBRSx1QkFBdUIsRUFBRTtRQUNyRCxFQUFFLEtBQUssRUFBRSxrQkFBa0IsRUFBRTtLQUM5QjtJQUNELGFBQWEsRUFBRSxZQUFZLENBQUMsS0FBSyxDQUFDLHFCQUFxQjtDQUN4RCxFQUFFLFlBQVksQ0FBQyxDQUFDO0FBR0osUUFBQSxzQkFBc0IsR0FBRztJQUVwQyxlQUFlLEVBQUU7UUFDZixHQUFHLGVBQWU7UUFDbEIsWUFBWSxFQUFFLHVCQUF1QjtRQUNyQyxXQUFXLEVBQUU7WUFDWCxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRTtZQUMzQixFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLFNBQVMsRUFBRTtZQUNuQyxFQUFFLEtBQUssRUFBRSxZQUFZLEVBQUU7U0FDeEI7S0FDTztJQUVWLFlBQVksRUFBRTtRQUNaLEdBQUcsWUFBWTtRQUNmLGlCQUFpQixFQUFFLENBQUU7Z0JBQ25CLEtBQUssRUFBRSxNQUFNO2dCQUNiLEdBQUcsRUFBRSx1QkFBdUI7Z0JBQzVCLElBQUksRUFBRSxZQUFZO2FBQ25CLENBQUM7UUFDRixZQUFZLEVBQUUseUJBQXlCO1FBQ3ZDLGlCQUFpQixFQUFFO1lBQ2pCLEdBQUcsWUFBWSxDQUFDLGlCQUFpQjtZQUNqQyxlQUFlLEVBQUU7Z0JBQ2YsR0FBRyxZQUFZLENBQUMsaUJBQWlCLENBQUMsZUFBZTtnQkFDakQsTUFBTSxFQUFFLDJCQUEyQjthQUNwQztTQUNGO0tBQ087Q0FDWCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgRElDb250YWluZXIgfSBmcm9tICcuLi8uLi8uLi9kaSc7XG5pbXBvcnQgTWFrZUxpc3RFbnRpdHlDb25maWcgZnJvbSAnLi4vLi4vLi4vdWktY29uZmlnLWdlbi90ZW1wbGF0ZXMvbGlzdC1lbnRpdHknO1xuaW1wb3J0IE1ha2VWaWV3RW50aXR5Q29uZmlnIGZyb20gJy4uLy4uLy4uL3VpLWNvbmZpZy1nZW4vdGVtcGxhdGVzL3ZpZXctZW50aXR5JztcbmltcG9ydCB7IER5bmFtb0RCQXVkaXRFbnRpdHlTY2hlbWEgfSBmcm9tICcuLi8uLi9sb2dnZXJzL2R5bmFtb2RiJztcbmltcG9ydCB7IER5bmFtb0RCQXVkaXRFbnRpdHlTZXJ2aWNlIH0gZnJvbSAnLi4vYXVkaXQtZW50aXR5LXNlcnZpY2UnO1xuXG5jb25zdCBhdWRpdFNlcnZpY2UgPSBESUNvbnRhaW5lci5ST09ULnJlc29sdmUoRHluYW1vREJBdWRpdEVudGl0eVNlcnZpY2UpO1xuXG5jb25zdCBlbnRpdHlEZWZhdWx0T3BzU2NoZW1hID0gYXVkaXRTZXJ2aWNlLmdldE9wc0RlZmF1bHRJT1NjaGVtYSgpO1xuY29uc3QgZW50aXR5U2NoZW1hID0gRHluYW1vREJBdWRpdEVudGl0eVNjaGVtYTtcblxuY29uc3QgbGlzdGluZ1VpQ29uZmlnID0gTWFrZUxpc3RFbnRpdHlDb25maWcoe1xuICBlbnRpdHlOYW1lOiBlbnRpdHlTY2hlbWEubW9kZWwuZW50aXR5LFxuICBlbnRpdHlOYW1lUGx1cmFsOiBlbnRpdHlTY2hlbWEubW9kZWwuZW50aXR5TmFtZVBsdXJhbCxcbiAgQ1JVREFwaVBhdGg6IGVudGl0eVNjaGVtYS5tb2RlbC5DUlVEQXBpUGF0aCxcbiAgdXNlU2VhcmNoOiBCb29sZWFuKGVudGl0eVNjaGVtYS5tb2RlbC5zZWFyY2g/LmVuYWJsZWQpLFxuICBwcm9wZXJ0aWVzOiBlbnRpdHlEZWZhdWx0T3BzU2NoZW1hLmxpc3Qub3V0cHV0LFxuICBleGNsdWRlRnJvbUFkbWluQ3JlYXRlOiB0cnVlLFxuICBleGNsdWRlRnJvbUFkbWluVXBkYXRlOiB0cnVlLFxuICBleGNsdWRlRnJvbUFkbWluRGVsZXRlOiB0cnVlLFxufSk7XG5cbmNvbnN0IHZpZXdVaUNvbmZpZyA9IE1ha2VWaWV3RW50aXR5Q29uZmlnKHtcbiAgZW50aXR5TmFtZTogZW50aXR5U2NoZW1hLm1vZGVsLmVudGl0eSxcbiAgZW50aXR5TmFtZVBsdXJhbDogZW50aXR5U2NoZW1hLm1vZGVsLmVudGl0eU5hbWVQbHVyYWwsXG4gIHByb3BlcnRpZXM6IGVudGl0eURlZmF1bHRPcHNTY2hlbWEuZ2V0Lm91dHB1dCxcbiAgYnJlYWRjcnVtYnM6IFtcbiAgICB7IGxhYmVsOiBcIkhvbWVcIiwgdXJsOiBcIi9cIiB9LFxuICAgIHsgbGFiZWw6IFwiU3lzdGVtXCIsIHVybDogXCIvc3lzdGVtXCIgfSxcbiAgICB7IGxhYmVsOiBcIkF1ZGl0IExvZ3NcIiwgdXJsOiBcIi9zeXN0ZW0vbGlzdC1hdWRpdGxvZ1wiIH0sXG4gICAgeyBsYWJlbDogXCJBdWRpdCBMb2cgRGV0YWlsXCIgfVxuICBdLFxuICBjb2x1bW5zQ29uZmlnOiBlbnRpdHlTY2hlbWEubW9kZWwudmlld1BhZ2VDb2x1bW5zQ29uZmlnLFxufSwgYXVkaXRTZXJ2aWNlKTtcblxuXG5leHBvcnQgY29uc3QgQXVkaXRDdXN0b21QYWdlQ29uZmlncyA9IHtcblxuICBsaXN0aW5nVWlDb25maWc6IHtcbiAgICAuLi5saXN0aW5nVWlDb25maWcsXG4gICAgcm91dGVQYXR0ZXJuOiBgL3N5c3RlbS9saXN0LWF1ZGl0bG9nYCxcbiAgICBicmVhZGNydW1iczogW1xuICAgICAgeyBsYWJlbDogXCJIb21lXCIsIHVybDogXCIvXCIgfSxcbiAgICAgIHsgbGFiZWw6IFwiU3lzdGVtXCIsIHVybDogXCIvc3lzdGVtXCIgfSxcbiAgICAgIHsgbGFiZWw6IFwiQXVkaXQgTG9nc1wiIH1cbiAgICBdXG4gIH0gYXMgY29uc3QsXG5cbiAgdmlld1VpQ29uZmlnOiB7XG4gICAgLi4udmlld1VpQ29uZmlnLFxuICAgIHBhZ2VIZWFkZXJBY3Rpb25zOiBbIHtcbiAgICAgIGxhYmVsOiBcIkJhY2tcIixcbiAgICAgIHVybDogXCIvc3lzdGVtL2xpc3QtYXVkaXRsb2dcIixcbiAgICAgIGljb246IFwiYXJyb3ctbGVmdFwiXG4gICAgfV0sXG4gICAgcm91dGVQYXR0ZXJuOiBgL3ZpZXctYXVkaXRsb2cvOmF1ZGl0SWRgLFxuICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAuLi52aWV3VWlDb25maWcuZGV0YWlsc1BhZ2VDb25maWcsXG4gICAgICBkZXRhaWxBcGlDb25maWc6IHtcbiAgICAgICAgLi4udmlld1VpQ29uZmlnLmRldGFpbHNQYWdlQ29uZmlnLmRldGFpbEFwaUNvbmZpZyxcbiAgICAgICAgYXBpVXJsOiAnL3N5c3RlbS9hdWRpdGxvZy86YXVkaXRJZCcsXG4gICAgICB9XG4gICAgfVxuICB9IGFzIGNvbnN0LFxufTsiXX0=