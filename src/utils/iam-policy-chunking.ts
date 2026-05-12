import { PolicyStatement } from "aws-cdk-lib/aws-iam";

/**
 * IAM customer-managed policy document maximum size (bytes). Policies larger than this must be split.
 * @see https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_iam-quotas.html
 */
export const IAM_MANAGED_POLICY_DOCUMENT_MAX_BYTES = 6144;

/**
 * Stay slightly under the hard limit so JSON serialization / CDK output matches IAM validation.
 */
export const IAM_MANAGED_POLICY_DOCUMENT_SAFETY_MARGIN_BYTES = 160;

/**
 * Serialized byte length of a policy document `{ Version, Statement }` as UTF-8.
 */
export function managedPolicyDocumentByteLength(statements: PolicyStatement[]): number {
    const doc = {
        Version: "2012-10-17",
        Statement: statements.map((s) => s.toStatementJson()),
    };
    return Buffer.byteLength(JSON.stringify(doc), "utf8");
}

/**
 * Greedy-pack policy statements into as few chunks as possible without exceeding
 * `maxDocumentBytes` (minus {@link IAM_MANAGED_POLICY_DOCUMENT_SAFETY_MARGIN_BYTES}).
 * Preserves statement order. One oversize statement is placed in its own chunk (may fail IAM validation if above limit).
 */
export function packPolicyStatementsIntoManagedPolicyChunks(
    statements: PolicyStatement[],
    maxDocumentBytes: number = IAM_MANAGED_POLICY_DOCUMENT_MAX_BYTES,
): PolicyStatement[][] {
    const effectiveMax = Math.max(
        512,
        maxDocumentBytes - IAM_MANAGED_POLICY_DOCUMENT_SAFETY_MARGIN_BYTES,
    );
    const chunks: PolicyStatement[][] = [];
    let current: PolicyStatement[] = [];

    const fits = (sts: PolicyStatement[]) =>
        managedPolicyDocumentByteLength(sts) <= effectiveMax;

    for (const stmt of statements) {
        const next = [ ...current, stmt ];
        if (fits(next)) {
            current = next;
            continue;
        }
        if (current.length > 0) {
            chunks.push(current);
            current = [];
        }
        if (fits([ stmt ])) {
            current = [ stmt ];
        } else {
            chunks.push([ stmt ]);
        }
    }
    if (current.length > 0) {
        chunks.push(current);
    }
    return chunks;
}
