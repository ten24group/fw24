import { BaseEntityController } from "../../entity";
import { AuditEntitySchemaType, DynamoDBAuditEntityService } from "../loggers/dynamodb";
export declare class DynamoDBAuditSystemController extends BaseEntityController<AuditEntitySchemaType> {
    readonly auditService: DynamoDBAuditEntityService;
    constructor(auditService: DynamoDBAuditEntityService);
}
