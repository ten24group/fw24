import type { HttpRequestValidations, InputValidationRule } from "../validation";
/**
 * Decorator function for defining a GET route.
 *
 * @param path - The path of the route.
 * @returns A decorator function that can be used to decorate a method.
 */
export declare const Get: (route: string, options?: {
    validations?: InputValidationRule | HttpRequestValidations;
    /**
     * Specifies the target for the API
     * Values can be "queue" or "topic"
     * @default ""
     */
    target?: string;
}) => (target: any, methodToDecorate: any) => void;
/**
 * Decorator function for creating a POST route.
 * @param path - The path for the route.
 */
export declare const Post: (route: string, options?: {
    validations?: InputValidationRule | HttpRequestValidations;
    /**
     * Specifies the target for the API
     * Values can be "queue" or "topic"
     * @default ""
     */
    target?: string;
}) => (target: any, methodToDecorate: any) => void;
/**
 * Decorator function for defining a PUT route.
 * @param target The target object.
 * @param propertyKey The name of the property being decorated.
 * @param descriptor The property descriptor.
 */
export declare const Put: (route: string, options?: {
    validations?: InputValidationRule | HttpRequestValidations;
    /**
     * Specifies the target for the API
     * Values can be "queue" or "topic"
     * @default ""
     */
    target?: string;
}) => (target: any, methodToDecorate: any) => void;
/**
 * Decorator function for defining a DELETE route.
 *
 * @param path - The path of the route.
 * @returns A decorator function that can be used to decorate a method as a DELETE route.
 */
export declare const Delete: (route: string, options?: {
    validations?: InputValidationRule | HttpRequestValidations;
    /**
     * Specifies the target for the API
     * Values can be "queue" or "topic"
     * @default ""
     */
    target?: string;
}) => (target: any, methodToDecorate: any) => void;
/**
 * Decorator function for PATCH routes.
 * @param target The target object.
 * @param propertyKey The name of the property.
 * @param descriptor The property descriptor.
 */
export declare const Patch: (route: string, options?: {
    validations?: InputValidationRule | HttpRequestValidations;
    /**
     * Specifies the target for the API
     * Values can be "queue" or "topic"
     * @default ""
     */
    target?: string;
}) => (target: any, methodToDecorate: any) => void;
/**
 * Represents a decorator that creates a route decorator with the specified HTTP method "OPTIONS".
 * @param target The target object.
 * @param propertyKey The property key.
 * @param descriptor The property descriptor.
 */
export declare const Options: (route: string, options?: {
    validations?: InputValidationRule | HttpRequestValidations;
    /**
     * Specifies the target for the API
     * Values can be "queue" or "topic"
     * @default ""
     */
    target?: string;
}) => (target: any, methodToDecorate: any) => void;
export type RouteMethods = typeof Options | typeof Patch | typeof Delete | typeof Put | typeof Post | typeof Get;
