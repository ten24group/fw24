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
}, auditService);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvYXVkaXQvc3lzdGVtL3VpLWNvbmZpZy9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFBQSxvQ0FBMEM7QUFDMUMsK0ZBQWdGO0FBQ2hGLCtGQUFnRjtBQUNoRixxREFBbUU7QUFDbkUsa0VBQXFFO0FBRXJFLE1BQU0sWUFBWSxHQUFHLGdCQUFXLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxpREFBMEIsQ0FBQyxDQUFDO0FBRTFFLE1BQU0sc0JBQXNCLEdBQUcsWUFBWSxDQUFDLHFCQUFxQixFQUFFLENBQUM7QUFDcEUsTUFBTSxZQUFZLEdBQUcsb0NBQXlCLENBQUM7QUFFL0MsTUFBTSxlQUFlLEdBQUcsSUFBQSxxQkFBb0IsRUFBQztJQUMzQyxVQUFVLEVBQUUsWUFBWSxDQUFDLEtBQUssQ0FBQyxNQUFNO0lBQ3JDLGdCQUFnQixFQUFFLFlBQVksQ0FBQyxLQUFLLENBQUMsZ0JBQWdCO0lBQ3JELFVBQVUsRUFBRSxzQkFBc0IsQ0FBQyxJQUFJLENBQUMsTUFBTTtJQUM5QyxTQUFTLEVBQUUsS0FBSztJQUNoQixzQkFBc0IsRUFBRSxJQUFJO0lBQzVCLHNCQUFzQixFQUFFLElBQUk7SUFDNUIsc0JBQXNCLEVBQUUsSUFBSTtDQUM3QixFQUFFLFlBQVksQ0FBQyxDQUFDO0FBRWpCLE1BQU0sWUFBWSxHQUFHLElBQUEscUJBQW9CLEVBQUM7SUFDeEMsVUFBVSxFQUFFLFlBQVksQ0FBQyxLQUFLLENBQUMsTUFBTTtJQUNyQyxnQkFBZ0IsRUFBRSxZQUFZLENBQUMsS0FBSyxDQUFDLGdCQUFnQjtJQUNyRCxVQUFVLEVBQUUsc0JBQXNCLENBQUMsR0FBRyxDQUFDLE1BQU07SUFDN0MsV0FBVyxFQUFFO1FBQ1gsRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUU7UUFDM0IsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLEdBQUcsRUFBRSxTQUFTLEVBQUU7UUFDbkMsRUFBRSxLQUFLLEVBQUUsWUFBWSxFQUFFLEdBQUcsRUFBRSx1QkFBdUIsRUFBRTtRQUNyRCxFQUFFLEtBQUssRUFBRSxrQkFBa0IsRUFBRTtLQUM5QjtJQUNELGFBQWEsRUFBRSxZQUFZLENBQUMsS0FBSyxDQUFDLHFCQUFxQjtJQUN2RCxPQUFPLEVBQUUsRUFBRSxFQUFHLHVFQUF1RTtDQUN0RixFQUFFLFlBQVksQ0FBQyxDQUFDO0FBR0osUUFBQSxzQkFBc0IsR0FBRztJQUNwQyxlQUFlLEVBQUU7UUFDZixHQUFHLGVBQWU7UUFDbEIsU0FBUyxFQUFFLFVBQVUsRUFBRywwRUFBMEU7UUFDbEcsWUFBWSxFQUFFLHVCQUF1QjtRQUNyQyxXQUFXLEVBQUU7WUFDWCxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRTtZQUMzQixFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLFNBQVMsRUFBRTtZQUNuQyxFQUFFLEtBQUssRUFBRSxZQUFZLEVBQUU7U0FDeEI7UUFDRCxjQUFjLEVBQUU7WUFDZCxHQUFHLGVBQWUsQ0FBQyxjQUFjO1lBQ2pDLFNBQVMsRUFBRTtnQkFDVCxHQUFHLGVBQWUsQ0FBQyxjQUFjLENBQUMsU0FBUztnQkFDM0MsTUFBTSxFQUFFLGtCQUFrQjthQUMzQjtTQUNGO0tBQ087SUFDVixZQUFZLEVBQUU7UUFDWixHQUFHLFlBQVk7UUFDZixTQUFTLEVBQUUsVUFBVSxFQUFHLHFEQUFxRDtRQUM3RSxZQUFZLEVBQUUseUJBQXlCO1FBQ3ZDLGlCQUFpQixFQUFFO1lBQ2pCO2dCQUNFLEtBQUssRUFBRSxNQUFNO2dCQUNiLEdBQUcsRUFBRSx1QkFBdUI7Z0JBQzVCLElBQUksRUFBRSxZQUFZO2FBQ25CO1NBQ0Y7UUFDRCxpQkFBaUIsRUFBRTtZQUNqQixHQUFHLFlBQVksQ0FBQyxpQkFBaUI7WUFDakMsZUFBZSxFQUFFO2dCQUNmLEdBQUcsWUFBWSxDQUFDLGlCQUFpQixDQUFDLGVBQWU7Z0JBQ2pELE1BQU0sRUFBRSwyQkFBMkI7YUFDcEM7U0FDRjtLQUNPO0NBQ1gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IERJQ29udGFpbmVyIH0gZnJvbSAnLi4vLi4vLi4vZGknO1xuaW1wb3J0IE1ha2VMaXN0RW50aXR5Q29uZmlnIGZyb20gJy4uLy4uLy4uL3VpLWNvbmZpZy1nZW4vdGVtcGxhdGVzL2xpc3QtZW50aXR5JztcbmltcG9ydCBNYWtlVmlld0VudGl0eUNvbmZpZyBmcm9tICcuLi8uLi8uLi91aS1jb25maWctZ2VuL3RlbXBsYXRlcy92aWV3LWVudGl0eSc7XG5pbXBvcnQgeyBEeW5hbW9EQkF1ZGl0RW50aXR5U2NoZW1hIH0gZnJvbSAnLi4vLi4vbG9nZ2Vycy9keW5hbW9kYic7XG5pbXBvcnQgeyBEeW5hbW9EQkF1ZGl0RW50aXR5U2VydmljZSB9IGZyb20gJy4uL2F1ZGl0LWVudGl0eS1zZXJ2aWNlJztcblxuY29uc3QgYXVkaXRTZXJ2aWNlID0gRElDb250YWluZXIuUk9PVC5yZXNvbHZlKER5bmFtb0RCQXVkaXRFbnRpdHlTZXJ2aWNlKTtcblxuY29uc3QgZW50aXR5RGVmYXVsdE9wc1NjaGVtYSA9IGF1ZGl0U2VydmljZS5nZXRPcHNEZWZhdWx0SU9TY2hlbWEoKTtcbmNvbnN0IGVudGl0eVNjaGVtYSA9IER5bmFtb0RCQXVkaXRFbnRpdHlTY2hlbWE7XG5cbmNvbnN0IGxpc3RpbmdVaUNvbmZpZyA9IE1ha2VMaXN0RW50aXR5Q29uZmlnKHtcbiAgZW50aXR5TmFtZTogZW50aXR5U2NoZW1hLm1vZGVsLmVudGl0eSxcbiAgZW50aXR5TmFtZVBsdXJhbDogZW50aXR5U2NoZW1hLm1vZGVsLmVudGl0eU5hbWVQbHVyYWwsXG4gIHByb3BlcnRpZXM6IGVudGl0eURlZmF1bHRPcHNTY2hlbWEubGlzdC5vdXRwdXQsXG4gIHVzZVNlYXJjaDogZmFsc2UsXG4gIGV4Y2x1ZGVGcm9tQWRtaW5DcmVhdGU6IHRydWUsXG4gIGV4Y2x1ZGVGcm9tQWRtaW5VcGRhdGU6IHRydWUsXG4gIGV4Y2x1ZGVGcm9tQWRtaW5EZWxldGU6IHRydWUsXG59LCBhdWRpdFNlcnZpY2UpO1xuXG5jb25zdCB2aWV3VWlDb25maWcgPSBNYWtlVmlld0VudGl0eUNvbmZpZyh7XG4gIGVudGl0eU5hbWU6IGVudGl0eVNjaGVtYS5tb2RlbC5lbnRpdHksXG4gIGVudGl0eU5hbWVQbHVyYWw6IGVudGl0eVNjaGVtYS5tb2RlbC5lbnRpdHlOYW1lUGx1cmFsLFxuICBwcm9wZXJ0aWVzOiBlbnRpdHlEZWZhdWx0T3BzU2NoZW1hLmdldC5vdXRwdXQsXG4gIGJyZWFkY3J1bWJzOiBbXG4gICAgeyBsYWJlbDogXCJIb21lXCIsIHVybDogXCIvXCIgfSxcbiAgICB7IGxhYmVsOiBcIlN5c3RlbVwiLCB1cmw6IFwiL3N5c3RlbVwiIH0sXG4gICAgeyBsYWJlbDogXCJBdWRpdCBMb2dzXCIsIHVybDogXCIvc3lzdGVtL2xpc3QtYXVkaXRsb2dcIiB9LFxuICAgIHsgbGFiZWw6IFwiQXVkaXQgTG9nIERldGFpbFwiIH1cbiAgXSxcbiAgY29sdW1uc0NvbmZpZzogZW50aXR5U2NoZW1hLm1vZGVsLnZpZXdQYWdlQ29sdW1uc0NvbmZpZyxcbiAgYWN0aW9uczogW10sICAvLyBFbXB0eSBhcnJheSB0byBwcmV2ZW50IGRlZmF1bHQgYWN0aW9ucyAoQmFjaywgRWRpdCkgZnJvbSBiZWluZyBhZGRlZFxufSwgYXVkaXRTZXJ2aWNlKTtcblxuXG5leHBvcnQgY29uc3QgQXVkaXRDdXN0b21QYWdlQ29uZmlncyA9IHtcbiAgbGlzdGluZ1VpQ29uZmlnOiB7XG4gICAgLi4ubGlzdGluZ1VpQ29uZmlnLFxuICAgIHBhZ2VUaXRsZTogXCJBdWRpdExvZ1wiLCAgLy8gTXVzdCBtYXRjaCBkZWZhdWx0IGtleSBnZW5lcmF0aW9uOiBsaXN0LSR7ZW50aXR5TmFtZX0g4oaSIFwibGlzdC1hdWRpdGxvZ1wiXG4gICAgcm91dGVQYXR0ZXJuOiBgL3N5c3RlbS9saXN0LWF1ZGl0bG9nYCxcbiAgICBicmVhZGNydW1iczogW1xuICAgICAgeyBsYWJlbDogXCJIb21lXCIsIHVybDogXCIvXCIgfSxcbiAgICAgIHsgbGFiZWw6IFwiU3lzdGVtXCIsIHVybDogXCIvc3lzdGVtXCIgfSxcbiAgICAgIHsgbGFiZWw6IFwiQXVkaXQgTG9nc1wiIH1cbiAgICBdLFxuICAgIGxpc3RQYWdlQ29uZmlnOiB7XG4gICAgICAuLi5saXN0aW5nVWlDb25maWcubGlzdFBhZ2VDb25maWcsXG4gICAgICBhcGlDb25maWc6IHtcbiAgICAgICAgLi4ubGlzdGluZ1VpQ29uZmlnLmxpc3RQYWdlQ29uZmlnLmFwaUNvbmZpZyxcbiAgICAgICAgYXBpVXJsOiAnL3N5c3RlbS9hdWRpdGxvZycsXG4gICAgICB9IFxuICAgIH1cbiAgfSBhcyBjb25zdCxcbiAgdmlld1VpQ29uZmlnOiB7XG4gICAgLi4udmlld1VpQ29uZmlnLFxuICAgIHBhZ2VUaXRsZTogXCJBdWRpdExvZ1wiLCAgLy8gTXVzdCBtYXRjaCBkZWZhdWx0IGtleSBnZW5lcmF0aW9uOiBcInZpZXctYXVkaXRsb2dcIlxuICAgIHJvdXRlUGF0dGVybjogYC92aWV3LWF1ZGl0bG9nLzphdWRpdElkYCxcbiAgICBwYWdlSGVhZGVyQWN0aW9uczogW1xuICAgICAge1xuICAgICAgICBsYWJlbDogXCJCYWNrXCIsXG4gICAgICAgIHVybDogYC9zeXN0ZW0vbGlzdC1hdWRpdGxvZ2AsXG4gICAgICAgIGljb246IFwiYXJyb3ctbGVmdFwiXG4gICAgICB9XG4gICAgXSxcbiAgICBkZXRhaWxzUGFnZUNvbmZpZzoge1xuICAgICAgLi4udmlld1VpQ29uZmlnLmRldGFpbHNQYWdlQ29uZmlnLFxuICAgICAgZGV0YWlsQXBpQ29uZmlnOiB7XG4gICAgICAgIC4uLnZpZXdVaUNvbmZpZy5kZXRhaWxzUGFnZUNvbmZpZy5kZXRhaWxBcGlDb25maWcsXG4gICAgICAgIGFwaVVybDogJy9zeXN0ZW0vYXVkaXRsb2cvOmF1ZGl0SWQnLFxuICAgICAgfVxuICAgIH1cbiAgfSBhcyBjb25zdCxcbn07Il19