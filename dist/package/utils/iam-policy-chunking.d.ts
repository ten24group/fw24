import { PolicyStatement } from "aws-cdk-lib/aws-iam";
/**
 * IAM customer-managed policy document maximum size (bytes). Policies larger than this must be split.
 * @see https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_iam-quotas.html
 */
export declare const IAM_MANAGED_POLICY_DOCUMENT_MAX_BYTES = 6144;
/**
 * Stay slightly under the hard limit so JSON serialization / CDK output matches IAM validation.
 */
export declare const IAM_MANAGED_POLICY_DOCUMENT_SAFETY_MARGIN_BYTES = 160;
/**
 * Serialized byte length of a policy document `{ Version, Statement }` as UTF-8.
 */
export declare function managedPolicyDocumentByteLength(statements: PolicyStatement[]): number;
/**
 * Greedy-pack policy statements into as few chunks as possible without exceeding
 * `maxDocumentBytes` (minus {@link IAM_MANAGED_POLICY_DOCUMENT_SAFETY_MARGIN_BYTES}).
 * Preserves statement order. One oversize statement is placed in its own chunk (may fail IAM validation if above limit).
 */
export declare function packPolicyStatementsIntoManagedPolicyChunks(statements: PolicyStatement[], maxDocumentBytes?: number): PolicyStatement[][];
