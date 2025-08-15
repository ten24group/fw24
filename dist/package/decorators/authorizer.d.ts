export type AuthorizerTypeMetadata = {
    type?: string;
    name?: string;
    groups?: string[] | string;
    requireRouteInGroupConfig?: boolean;
};
/**
 * Specifies the authorizer for the API-route, it can be a single authorizer-type-metadata-object, or a authorizer-type-name.
 * @param authorizationType - The authorization type for the route.
 * @returns A decorator function that sets the authorization type for the route.
 */
export declare const Authorizer: (authorizationType: AuthorizerTypeMetadata | string) => (target: any, methodToDecorate: any) => void;
