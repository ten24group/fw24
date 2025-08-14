import { DIContainer } from '../../../di';
import MakeListEntityConfig from '../../../ui-config-gen/templates/list-entity';
import MakeViewEntityConfig from '../../../ui-config-gen/templates/view-entity';
import { DynamoDBAuditEntitySchema, DynamoDBAuditEntityService } from '../../loggers/dynamodb';

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
}, auditService);

export const AuditCustomPageConfigs = {
  listingUiConfig: {
    ...listingUiConfig,
    routePattern: `/system/list-auditlog`,
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
    routePattern: `/view-auditlog/:auditId`,
    detailsPageConfig: {
      ...viewUiConfig.detailsPageConfig,
      detailApiConfig: {
        ...viewUiConfig.detailsPageConfig.detailApiConfig,
        apiUrl: '/system/auditlog/:auditId',
      }
    }
  } as const,
};