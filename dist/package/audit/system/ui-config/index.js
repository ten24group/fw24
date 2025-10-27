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
    actions: [], // Empty array to prevent default actions (Back, Edit) from being added
}, auditService);
exports.AuditCustomPageConfigs = {
    listingUiConfig: {
        ...listingUiConfig,
        pageTitle: "AuditLog", // Must match default key generation: list-${entityName} → "list-auditlog"
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
        pageTitle: "AuditLog", // Must match default key generation: "view-auditlog"
        routePattern: `/view-auditlog/:auditId`,
        pageHeaderActions: [
            {
                label: "Back",
                url: `/system/list-auditlog`,
                icon: "arrow-left"
            }
        ],
        detailsPageConfig: {
            ...viewUiConfig.detailsPageConfig,
            detailApiConfig: {
                ...viewUiConfig.detailsPageConfig.detailApiConfig,
                apiUrl: '/system/auditlog/:auditId',
            }
        }
    },
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvYXVkaXQvc3lzdGVtL3VpLWNvbmZpZy9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFBQSxvQ0FBMEM7QUFDMUMsK0ZBQWdGO0FBQ2hGLCtGQUFnRjtBQUNoRixxREFBbUU7QUFDbkUsa0VBQXFFO0FBRXJFLE1BQU0sWUFBWSxHQUFHLGdCQUFXLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxpREFBMEIsQ0FBQyxDQUFDO0FBRTFFLE1BQU0sc0JBQXNCLEdBQUcsWUFBWSxDQUFDLHFCQUFxQixFQUFFLENBQUM7QUFDcEUsTUFBTSxZQUFZLEdBQUcsb0NBQXlCLENBQUM7QUFFL0MsTUFBTSxlQUFlLEdBQUcsSUFBQSxxQkFBb0IsRUFBQztJQUMzQyxVQUFVLEVBQUUsWUFBWSxDQUFDLEtBQUssQ0FBQyxNQUFNO0lBQ3JDLGdCQUFnQixFQUFFLFlBQVksQ0FBQyxLQUFLLENBQUMsZ0JBQWdCO0lBQ3JELFVBQVUsRUFBRSxzQkFBc0IsQ0FBQyxJQUFJLENBQUMsTUFBTTtJQUM5QyxTQUFTLEVBQUUsS0FBSztJQUNoQixzQkFBc0IsRUFBRSxJQUFJO0lBQzVCLHNCQUFzQixFQUFFLElBQUk7SUFDNUIsc0JBQXNCLEVBQUUsSUFBSTtDQUM3QixDQUFDLENBQUM7QUFFSCxNQUFNLFlBQVksR0FBRyxJQUFBLHFCQUFvQixFQUFDO0lBQ3hDLFVBQVUsRUFBRSxZQUFZLENBQUMsS0FBSyxDQUFDLE1BQU07SUFDckMsZ0JBQWdCLEVBQUUsWUFBWSxDQUFDLEtBQUssQ0FBQyxnQkFBZ0I7SUFDckQsVUFBVSxFQUFFLHNCQUFzQixDQUFDLEdBQUcsQ0FBQyxNQUFNO0lBQzdDLFdBQVcsRUFBRTtRQUNYLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFO1FBQzNCLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxHQUFHLEVBQUUsU0FBUyxFQUFFO1FBQ25DLEVBQUUsS0FBSyxFQUFFLFlBQVksRUFBRSxHQUFHLEVBQUUsdUJBQXVCLEVBQUU7UUFDckQsRUFBRSxLQUFLLEVBQUUsa0JBQWtCLEVBQUU7S0FDOUI7SUFDRCxhQUFhLEVBQUUsWUFBWSxDQUFDLEtBQUssQ0FBQyxxQkFBcUI7SUFDdkQsT0FBTyxFQUFFLEVBQUUsRUFBRyx1RUFBdUU7Q0FDdEYsRUFBRSxZQUFZLENBQUMsQ0FBQztBQUdKLFFBQUEsc0JBQXNCLEdBQUc7SUFDcEMsZUFBZSxFQUFFO1FBQ2YsR0FBRyxlQUFlO1FBQ2xCLFNBQVMsRUFBRSxVQUFVLEVBQUcsMEVBQTBFO1FBQ2xHLFlBQVksRUFBRSx1QkFBdUI7UUFDckMsV0FBVyxFQUFFO1lBQ1gsRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUU7WUFDM0IsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLEdBQUcsRUFBRSxTQUFTLEVBQUU7WUFDbkMsRUFBRSxLQUFLLEVBQUUsWUFBWSxFQUFFO1NBQ3hCO1FBQ0QsY0FBYyxFQUFFO1lBQ2QsR0FBRyxlQUFlLENBQUMsY0FBYztZQUNqQyxTQUFTLEVBQUU7Z0JBQ1QsR0FBRyxlQUFlLENBQUMsY0FBYyxDQUFDLFNBQVM7Z0JBQzNDLE1BQU0sRUFBRSxrQkFBa0I7YUFDM0I7U0FDRjtLQUNPO0lBQ1YsWUFBWSxFQUFFO1FBQ1osR0FBRyxZQUFZO1FBQ2YsU0FBUyxFQUFFLFVBQVUsRUFBRyxxREFBcUQ7UUFDN0UsWUFBWSxFQUFFLHlCQUF5QjtRQUN2QyxpQkFBaUIsRUFBRTtZQUNqQjtnQkFDRSxLQUFLLEVBQUUsTUFBTTtnQkFDYixHQUFHLEVBQUUsdUJBQXVCO2dCQUM1QixJQUFJLEVBQUUsWUFBWTthQUNuQjtTQUNGO1FBQ0QsaUJBQWlCLEVBQUU7WUFDakIsR0FBRyxZQUFZLENBQUMsaUJBQWlCO1lBQ2pDLGVBQWUsRUFBRTtnQkFDZixHQUFHLFlBQVksQ0FBQyxpQkFBaUIsQ0FBQyxlQUFlO2dCQUNqRCxNQUFNLEVBQUUsMkJBQTJCO2FBQ3BDO1NBQ0Y7S0FDTztDQUNYLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBESUNvbnRhaW5lciB9IGZyb20gJy4uLy4uLy4uL2RpJztcbmltcG9ydCBNYWtlTGlzdEVudGl0eUNvbmZpZyBmcm9tICcuLi8uLi8uLi91aS1jb25maWctZ2VuL3RlbXBsYXRlcy9saXN0LWVudGl0eSc7XG5pbXBvcnQgTWFrZVZpZXdFbnRpdHlDb25maWcgZnJvbSAnLi4vLi4vLi4vdWktY29uZmlnLWdlbi90ZW1wbGF0ZXMvdmlldy1lbnRpdHknO1xuaW1wb3J0IHsgRHluYW1vREJBdWRpdEVudGl0eVNjaGVtYSB9IGZyb20gJy4uLy4uL2xvZ2dlcnMvZHluYW1vZGInO1xuaW1wb3J0IHsgRHluYW1vREJBdWRpdEVudGl0eVNlcnZpY2UgfSBmcm9tICcuLi9hdWRpdC1lbnRpdHktc2VydmljZSc7XG5cbmNvbnN0IGF1ZGl0U2VydmljZSA9IERJQ29udGFpbmVyLlJPT1QucmVzb2x2ZShEeW5hbW9EQkF1ZGl0RW50aXR5U2VydmljZSk7XG5cbmNvbnN0IGVudGl0eURlZmF1bHRPcHNTY2hlbWEgPSBhdWRpdFNlcnZpY2UuZ2V0T3BzRGVmYXVsdElPU2NoZW1hKCk7XG5jb25zdCBlbnRpdHlTY2hlbWEgPSBEeW5hbW9EQkF1ZGl0RW50aXR5U2NoZW1hO1xuXG5jb25zdCBsaXN0aW5nVWlDb25maWcgPSBNYWtlTGlzdEVudGl0eUNvbmZpZyh7XG4gIGVudGl0eU5hbWU6IGVudGl0eVNjaGVtYS5tb2RlbC5lbnRpdHksXG4gIGVudGl0eU5hbWVQbHVyYWw6IGVudGl0eVNjaGVtYS5tb2RlbC5lbnRpdHlOYW1lUGx1cmFsLFxuICBwcm9wZXJ0aWVzOiBlbnRpdHlEZWZhdWx0T3BzU2NoZW1hLmxpc3Qub3V0cHV0LFxuICB1c2VTZWFyY2g6IGZhbHNlLFxuICBleGNsdWRlRnJvbUFkbWluQ3JlYXRlOiB0cnVlLFxuICBleGNsdWRlRnJvbUFkbWluVXBkYXRlOiB0cnVlLFxuICBleGNsdWRlRnJvbUFkbWluRGVsZXRlOiB0cnVlLFxufSk7XG5cbmNvbnN0IHZpZXdVaUNvbmZpZyA9IE1ha2VWaWV3RW50aXR5Q29uZmlnKHtcbiAgZW50aXR5TmFtZTogZW50aXR5U2NoZW1hLm1vZGVsLmVudGl0eSxcbiAgZW50aXR5TmFtZVBsdXJhbDogZW50aXR5U2NoZW1hLm1vZGVsLmVudGl0eU5hbWVQbHVyYWwsXG4gIHByb3BlcnRpZXM6IGVudGl0eURlZmF1bHRPcHNTY2hlbWEuZ2V0Lm91dHB1dCxcbiAgYnJlYWRjcnVtYnM6IFtcbiAgICB7IGxhYmVsOiBcIkhvbWVcIiwgdXJsOiBcIi9cIiB9LFxuICAgIHsgbGFiZWw6IFwiU3lzdGVtXCIsIHVybDogXCIvc3lzdGVtXCIgfSxcbiAgICB7IGxhYmVsOiBcIkF1ZGl0IExvZ3NcIiwgdXJsOiBcIi9zeXN0ZW0vbGlzdC1hdWRpdGxvZ1wiIH0sXG4gICAgeyBsYWJlbDogXCJBdWRpdCBMb2cgRGV0YWlsXCIgfVxuICBdLFxuICBjb2x1bW5zQ29uZmlnOiBlbnRpdHlTY2hlbWEubW9kZWwudmlld1BhZ2VDb2x1bW5zQ29uZmlnLFxuICBhY3Rpb25zOiBbXSwgIC8vIEVtcHR5IGFycmF5IHRvIHByZXZlbnQgZGVmYXVsdCBhY3Rpb25zIChCYWNrLCBFZGl0KSBmcm9tIGJlaW5nIGFkZGVkXG59LCBhdWRpdFNlcnZpY2UpO1xuXG5cbmV4cG9ydCBjb25zdCBBdWRpdEN1c3RvbVBhZ2VDb25maWdzID0ge1xuICBsaXN0aW5nVWlDb25maWc6IHtcbiAgICAuLi5saXN0aW5nVWlDb25maWcsXG4gICAgcGFnZVRpdGxlOiBcIkF1ZGl0TG9nXCIsICAvLyBNdXN0IG1hdGNoIGRlZmF1bHQga2V5IGdlbmVyYXRpb246IGxpc3QtJHtlbnRpdHlOYW1lfSDihpIgXCJsaXN0LWF1ZGl0bG9nXCJcbiAgICByb3V0ZVBhdHRlcm46IGAvc3lzdGVtL2xpc3QtYXVkaXRsb2dgLFxuICAgIGJyZWFkY3J1bWJzOiBbXG4gICAgICB7IGxhYmVsOiBcIkhvbWVcIiwgdXJsOiBcIi9cIiB9LFxuICAgICAgeyBsYWJlbDogXCJTeXN0ZW1cIiwgdXJsOiBcIi9zeXN0ZW1cIiB9LFxuICAgICAgeyBsYWJlbDogXCJBdWRpdCBMb2dzXCIgfVxuICAgIF0sXG4gICAgbGlzdFBhZ2VDb25maWc6IHtcbiAgICAgIC4uLmxpc3RpbmdVaUNvbmZpZy5saXN0UGFnZUNvbmZpZyxcbiAgICAgIGFwaUNvbmZpZzoge1xuICAgICAgICAuLi5saXN0aW5nVWlDb25maWcubGlzdFBhZ2VDb25maWcuYXBpQ29uZmlnLFxuICAgICAgICBhcGlVcmw6ICcvc3lzdGVtL2F1ZGl0bG9nJyxcbiAgICAgIH0gXG4gICAgfVxuICB9IGFzIGNvbnN0LFxuICB2aWV3VWlDb25maWc6IHtcbiAgICAuLi52aWV3VWlDb25maWcsXG4gICAgcGFnZVRpdGxlOiBcIkF1ZGl0TG9nXCIsICAvLyBNdXN0IG1hdGNoIGRlZmF1bHQga2V5IGdlbmVyYXRpb246IFwidmlldy1hdWRpdGxvZ1wiXG4gICAgcm91dGVQYXR0ZXJuOiBgL3ZpZXctYXVkaXRsb2cvOmF1ZGl0SWRgLFxuICAgIHBhZ2VIZWFkZXJBY3Rpb25zOiBbXG4gICAgICB7XG4gICAgICAgIGxhYmVsOiBcIkJhY2tcIixcbiAgICAgICAgdXJsOiBgL3N5c3RlbS9saXN0LWF1ZGl0bG9nYCxcbiAgICAgICAgaWNvbjogXCJhcnJvdy1sZWZ0XCJcbiAgICAgIH1cbiAgICBdLFxuICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAuLi52aWV3VWlDb25maWcuZGV0YWlsc1BhZ2VDb25maWcsXG4gICAgICBkZXRhaWxBcGlDb25maWc6IHtcbiAgICAgICAgLi4udmlld1VpQ29uZmlnLmRldGFpbHNQYWdlQ29uZmlnLmRldGFpbEFwaUNvbmZpZyxcbiAgICAgICAgYXBpVXJsOiAnL3N5c3RlbS9hdWRpdGxvZy86YXVkaXRJZCcsXG4gICAgICB9XG4gICAgfVxuICB9IGFzIGNvbnN0LFxufTsiXX0=