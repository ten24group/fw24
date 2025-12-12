import type { HttpRequestValidations, InputValidationRule } from "../validation";
import type { ControllerObservabilityConfig } from "../observability/controller-config";
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
    /** Method-level observability configuration */
    observability?: ControllerObservabilityConfig;
}
export type Routes = Route[];
