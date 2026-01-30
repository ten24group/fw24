import type { InputValidationRule, HttpRequestValidations } from "../validation";
/**
 * Decorator function for adding validations to a route.
 * @param validations - The validations to be applied to the route.
 * @returns A decorator function that adds the validations to the route.
 */
export declare const Validation: (validations: InputValidationRule | HttpRequestValidations) => (target: any, methodToDecorate: any) => void;
