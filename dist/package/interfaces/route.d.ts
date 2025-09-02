import type { HttpRequestValidations, InputValidationRule } from "../validation";
import type { AuditConfig } from "../audit/interfaces";
export interface Route {
    httpMethod: string;
    functionName: string;
    path: string;
    parameters: Array<String>;
    authorizer?: {
        name?: string;
        type?: string;
        groups?: string[] | string;
    } | string;
    validations?: InputValidationRule | HttpRequestValidations;
    target?: string;
    audit?: AuditConfig;
}
export type Routes = Route[];
