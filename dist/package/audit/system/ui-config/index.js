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
const auditService = di_1.DIContainer.ROOT.resolve(dynamodb_1.DynamoDBAuditEntityService);
const entityDefaultOpsSchema = auditService.getOpsDefaultIOSchema();
const entitySchema = dynamodb_1.DynamoDBAuditEntitySchema;
const listingUiConfig = (0, list_entity_1.default)({
    entityName: entitySchema.model.entity,
    entityNamePlural: entitySchema.model.entityNamePlural,
    properties: entityDefaultOpsSchema.list.output,
    useSearch: false,
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
        ],
        listPageConfig: {
            ...listingUiConfig.listPageConfig,
            apiConfig: {
                ...listingUiConfig.listPageConfig.apiConfig,
                apiUrl: '/system/auditlog',
            }
        }
    },
    viewUiConfig: {
        ...viewUiConfig,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvYXVkaXQvc3lzdGVtL3VpLWNvbmZpZy9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFBQSxvQ0FBMEM7QUFDMUMsK0ZBQWdGO0FBQ2hGLCtGQUFnRjtBQUNoRixxREFBK0Y7QUFFL0YsTUFBTSxZQUFZLEdBQUcsZ0JBQVcsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLHFDQUEwQixDQUFDLENBQUM7QUFFMUUsTUFBTSxzQkFBc0IsR0FBRyxZQUFZLENBQUMscUJBQXFCLEVBQUUsQ0FBQztBQUNwRSxNQUFNLFlBQVksR0FBRyxvQ0FBeUIsQ0FBQztBQUUvQyxNQUFNLGVBQWUsR0FBRyxJQUFBLHFCQUFvQixFQUFDO0lBQzNDLFVBQVUsRUFBRSxZQUFZLENBQUMsS0FBSyxDQUFDLE1BQU07SUFDckMsZ0JBQWdCLEVBQUUsWUFBWSxDQUFDLEtBQUssQ0FBQyxnQkFBZ0I7SUFDckQsVUFBVSxFQUFFLHNCQUFzQixDQUFDLElBQUksQ0FBQyxNQUFNO0lBQzlDLFNBQVMsRUFBRSxLQUFLO0lBQ2hCLHNCQUFzQixFQUFFLElBQUk7SUFDNUIsc0JBQXNCLEVBQUUsSUFBSTtJQUM1QixzQkFBc0IsRUFBRSxJQUFJO0NBQzdCLENBQUMsQ0FBQztBQUVILE1BQU0sWUFBWSxHQUFHLElBQUEscUJBQW9CLEVBQUM7SUFDeEMsVUFBVSxFQUFFLFlBQVksQ0FBQyxLQUFLLENBQUMsTUFBTTtJQUNyQyxnQkFBZ0IsRUFBRSxZQUFZLENBQUMsS0FBSyxDQUFDLGdCQUFnQjtJQUNyRCxVQUFVLEVBQUUsc0JBQXNCLENBQUMsR0FBRyxDQUFDLE1BQU07SUFDN0MsV0FBVyxFQUFFO1FBQ1gsRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUU7UUFDM0IsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLEdBQUcsRUFBRSxTQUFTLEVBQUU7UUFDbkMsRUFBRSxLQUFLLEVBQUUsWUFBWSxFQUFFLEdBQUcsRUFBRSx1QkFBdUIsRUFBRTtRQUNyRCxFQUFFLEtBQUssRUFBRSxrQkFBa0IsRUFBRTtLQUM5QjtJQUNELGFBQWEsRUFBRSxZQUFZLENBQUMsS0FBSyxDQUFDLHFCQUFxQjtDQUN4RCxFQUFFLFlBQVksQ0FBQyxDQUFDO0FBR0osUUFBQSxzQkFBc0IsR0FBRztJQUNwQyxlQUFlLEVBQUU7UUFDZixHQUFHLGVBQWU7UUFDbEIsWUFBWSxFQUFFLHVCQUF1QjtRQUNyQyxXQUFXLEVBQUU7WUFDWCxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRTtZQUMzQixFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLFNBQVMsRUFBRTtZQUNuQyxFQUFFLEtBQUssRUFBRSxZQUFZLEVBQUU7U0FDeEI7UUFDRCxjQUFjLEVBQUU7WUFDZCxHQUFHLGVBQWUsQ0FBQyxjQUFjO1lBQ2pDLFNBQVMsRUFBRTtnQkFDVCxHQUFHLGVBQWUsQ0FBQyxjQUFjLENBQUMsU0FBUztnQkFDM0MsTUFBTSxFQUFFLGtCQUFrQjthQUMzQjtTQUNGO0tBQ087SUFDVixZQUFZLEVBQUU7UUFDWixHQUFHLFlBQVk7UUFDZixZQUFZLEVBQUUseUJBQXlCO1FBQ3ZDLGlCQUFpQixFQUFFO1lBQ2pCLEdBQUcsWUFBWSxDQUFDLGlCQUFpQjtZQUNqQyxlQUFlLEVBQUU7Z0JBQ2YsR0FBRyxZQUFZLENBQUMsaUJBQWlCLENBQUMsZUFBZTtnQkFDakQsTUFBTSxFQUFFLDJCQUEyQjthQUNwQztTQUNGO0tBQ087Q0FDWCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgRElDb250YWluZXIgfSBmcm9tICcuLi8uLi8uLi9kaSc7XG5pbXBvcnQgTWFrZUxpc3RFbnRpdHlDb25maWcgZnJvbSAnLi4vLi4vLi4vdWktY29uZmlnLWdlbi90ZW1wbGF0ZXMvbGlzdC1lbnRpdHknO1xuaW1wb3J0IE1ha2VWaWV3RW50aXR5Q29uZmlnIGZyb20gJy4uLy4uLy4uL3VpLWNvbmZpZy1nZW4vdGVtcGxhdGVzL3ZpZXctZW50aXR5JztcbmltcG9ydCB7IER5bmFtb0RCQXVkaXRFbnRpdHlTY2hlbWEsIER5bmFtb0RCQXVkaXRFbnRpdHlTZXJ2aWNlIH0gZnJvbSAnLi4vLi4vbG9nZ2Vycy9keW5hbW9kYic7XG5cbmNvbnN0IGF1ZGl0U2VydmljZSA9IERJQ29udGFpbmVyLlJPT1QucmVzb2x2ZShEeW5hbW9EQkF1ZGl0RW50aXR5U2VydmljZSk7XG5cbmNvbnN0IGVudGl0eURlZmF1bHRPcHNTY2hlbWEgPSBhdWRpdFNlcnZpY2UuZ2V0T3BzRGVmYXVsdElPU2NoZW1hKCk7XG5jb25zdCBlbnRpdHlTY2hlbWEgPSBEeW5hbW9EQkF1ZGl0RW50aXR5U2NoZW1hO1xuXG5jb25zdCBsaXN0aW5nVWlDb25maWcgPSBNYWtlTGlzdEVudGl0eUNvbmZpZyh7XG4gIGVudGl0eU5hbWU6IGVudGl0eVNjaGVtYS5tb2RlbC5lbnRpdHksXG4gIGVudGl0eU5hbWVQbHVyYWw6IGVudGl0eVNjaGVtYS5tb2RlbC5lbnRpdHlOYW1lUGx1cmFsLFxuICBwcm9wZXJ0aWVzOiBlbnRpdHlEZWZhdWx0T3BzU2NoZW1hLmxpc3Qub3V0cHV0LFxuICB1c2VTZWFyY2g6IGZhbHNlLFxuICBleGNsdWRlRnJvbUFkbWluQ3JlYXRlOiB0cnVlLFxuICBleGNsdWRlRnJvbUFkbWluVXBkYXRlOiB0cnVlLFxuICBleGNsdWRlRnJvbUFkbWluRGVsZXRlOiB0cnVlLFxufSk7XG5cbmNvbnN0IHZpZXdVaUNvbmZpZyA9IE1ha2VWaWV3RW50aXR5Q29uZmlnKHtcbiAgZW50aXR5TmFtZTogZW50aXR5U2NoZW1hLm1vZGVsLmVudGl0eSxcbiAgZW50aXR5TmFtZVBsdXJhbDogZW50aXR5U2NoZW1hLm1vZGVsLmVudGl0eU5hbWVQbHVyYWwsXG4gIHByb3BlcnRpZXM6IGVudGl0eURlZmF1bHRPcHNTY2hlbWEuZ2V0Lm91dHB1dCxcbiAgYnJlYWRjcnVtYnM6IFtcbiAgICB7IGxhYmVsOiBcIkhvbWVcIiwgdXJsOiBcIi9cIiB9LFxuICAgIHsgbGFiZWw6IFwiU3lzdGVtXCIsIHVybDogXCIvc3lzdGVtXCIgfSxcbiAgICB7IGxhYmVsOiBcIkF1ZGl0IExvZ3NcIiwgdXJsOiBcIi9zeXN0ZW0vbGlzdC1hdWRpdGxvZ1wiIH0sXG4gICAgeyBsYWJlbDogXCJBdWRpdCBMb2cgRGV0YWlsXCIgfVxuICBdLFxuICBjb2x1bW5zQ29uZmlnOiBlbnRpdHlTY2hlbWEubW9kZWwudmlld1BhZ2VDb2x1bW5zQ29uZmlnLFxufSwgYXVkaXRTZXJ2aWNlKTtcblxuXG5leHBvcnQgY29uc3QgQXVkaXRDdXN0b21QYWdlQ29uZmlncyA9IHtcbiAgbGlzdGluZ1VpQ29uZmlnOiB7XG4gICAgLi4ubGlzdGluZ1VpQ29uZmlnLFxuICAgIHJvdXRlUGF0dGVybjogYC9zeXN0ZW0vbGlzdC1hdWRpdGxvZ2AsXG4gICAgYnJlYWRjcnVtYnM6IFtcbiAgICAgIHsgbGFiZWw6IFwiSG9tZVwiLCB1cmw6IFwiL1wiIH0sXG4gICAgICB7IGxhYmVsOiBcIlN5c3RlbVwiLCB1cmw6IFwiL3N5c3RlbVwiIH0sXG4gICAgICB7IGxhYmVsOiBcIkF1ZGl0IExvZ3NcIiB9XG4gICAgXSxcbiAgICBsaXN0UGFnZUNvbmZpZzoge1xuICAgICAgLi4ubGlzdGluZ1VpQ29uZmlnLmxpc3RQYWdlQ29uZmlnLFxuICAgICAgYXBpQ29uZmlnOiB7XG4gICAgICAgIC4uLmxpc3RpbmdVaUNvbmZpZy5saXN0UGFnZUNvbmZpZy5hcGlDb25maWcsXG4gICAgICAgIGFwaVVybDogJy9zeXN0ZW0vYXVkaXRsb2cnLFxuICAgICAgfSBcbiAgICB9XG4gIH0gYXMgY29uc3QsXG4gIHZpZXdVaUNvbmZpZzoge1xuICAgIC4uLnZpZXdVaUNvbmZpZyxcbiAgICByb3V0ZVBhdHRlcm46IGAvdmlldy1hdWRpdGxvZy86YXVkaXRJZGAsXG4gICAgZGV0YWlsc1BhZ2VDb25maWc6IHtcbiAgICAgIC4uLnZpZXdVaUNvbmZpZy5kZXRhaWxzUGFnZUNvbmZpZyxcbiAgICAgIGRldGFpbEFwaUNvbmZpZzoge1xuICAgICAgICAuLi52aWV3VWlDb25maWcuZGV0YWlsc1BhZ2VDb25maWcuZGV0YWlsQXBpQ29uZmlnLFxuICAgICAgICBhcGlVcmw6ICcvc3lzdGVtL2F1ZGl0bG9nLzphdWRpdElkJyxcbiAgICAgIH1cbiAgICB9XG4gIH0gYXMgY29uc3QsXG59OyJdfQ==