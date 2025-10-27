import { DIContainer } from '../../../di';
import MakeListEntityConfig from '../../../ui-config-gen/templates/list-entity';
import MakeViewEntityConfig from '../../../ui-config-gen/templates/view-entity';
import { DynamoDBAuditEntitySchema } from '../../loggers/dynamodb';
import { DynamoDBAuditEntityService } from '../audit-entity-service';

const auditService = DIContainer.ROOT.resolve(DynamoDBAuditEntityService);

const entityDefaultOpsSchema = auditService.getOpsDefaultIOSchema();
const entitySchema = DynamoDBAuditEntitySchema;

const listingUiConfig = MakeListEntityConfig({
  entityName: entitySchema.model.entity,
  entityNamePlural: entitySchema.model.entityNamePlural,
  properties: entityDefaultOpsSchema.list.output,
  useSearch: false,
  excludeFromAdminCreate: true,
  excludeFromAdminUpdate: true,
  excludeFromAdminDelete: true,
});

const viewUiConfig = MakeViewEntityConfig({
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
  actions: [],  // Empty array to prevent default actions (Back, Edit) from being added
}, auditService);


export const AuditCustomPageConfigs = {
  listingUiConfig: {
    ...listingUiConfig,
    pageTitle: "AuditLog",  // Must match default key generation: list-${entityName} → "list-auditlog"
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
  } as const,
  viewUiConfig: {
    ...viewUiConfig,
    pageTitle: "AuditLog",  // Must match default key generation: "view-auditlog"
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
  } as const,
};