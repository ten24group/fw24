/**
 * Event payload passed to the Lambda from the CDK Custom Resource
 */
interface ResourceMigrationEvent {
    restApiId: string;
    rootPaths: string[];
    mainStackName: string;
    mode: 'migrate';
    Payload?: string;
    body?: string;
}
/**
 * Response returned to CloudFormation Custom Resource
 */
interface ResourceMigrationResponse {
    statusCode: number;
    body: string;
}
/**
 * Lambda handler for API Gateway resource migration.
 *
 * This function queries actual AWS state to detect when resources exist in the wrong stack.
 * It only deletes resources when a genuine conflict is detected (resource in nested stack
 * but needs to be in main stack). This allows CloudFormation to recreate them correctly.
 *
 * The function is idempotent - running it multiple times is safe. It queries real AWS state
 * on every invocation, making it reliable across CI/CD, multiple developers, and environments.
 *
 * @param event - Contains restApiId, rootPaths, and mainStackName
 * @returns Response indicating success and actions taken
 */
export declare const handler: (event: ResourceMigrationEvent) => Promise<ResourceMigrationResponse>;
export {};
