import { EntityConfiguration } from "electrodb";
import { EntitySchema } from "./base-entity";
import { IDIContainer } from "../interfaces";
export declare class EntitySchemaValidator {
    private readonly diContainer;
    constructor(diContainer: IDIContainer);
    validateSchema<S extends EntitySchema<any, any, any>>(schema: S, entityConfigurations: EntityConfiguration): void;
    private validateElectroDBSchema;
    private validateModelDefinition;
    private validateRelations;
    private validateFieldMetadata;
    private validateSelectFieldMetadata;
    private validateOptionsAPIConfig;
    private validateFileFieldMetadata;
    private validateImageFieldMetadata;
}
