import { BaseEntityController } from "../../entity";
import { AuditEntitySchemaType } from "../loggers/dynamodb";
import { DynamoDBAuditEntityService } from "./audit-entity-service";
export declare class DynamoDBAuditSystemController extends BaseEntityController<AuditEntitySchemaType> {
    readonly auditService: DynamoDBAuditEntityService;
    constructor(auditService: DynamoDBAuditEntityService);
}
