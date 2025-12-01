import { Controller } from "../../decorators";
import { Inject } from "../../di";
import { BaseEntityController } from "../../entity";
import { AuditEntitySchemaType } from "../loggers/dynamodb";
import { DynamoDBAuditEntityService } from "./audit-entity-service";

// @Controller('/system/auditlog')
export class DynamoDBAuditSystemController extends BaseEntityController<AuditEntitySchemaType> {
  constructor(
      @Inject(DynamoDBAuditEntityService)
      readonly auditService: DynamoDBAuditEntityService
    ) {
      super(auditService);
    }
}