/**
 * SNS -> SQS Envelope Parser
 *
 * When an SNS topic delivers messages to an SQS queue subscription, the SQS record body
 * contains an SNS "notification envelope" JSON, not the raw publisher payload.
 *
 * This helper centralizes envelope parsing and validation so multiple parts of the runtime
 * (data extractors, trace propagation) don't implement slightly different heuristics.
 */
export type SnsMessageAttributes = Record<string, {
    Type?: string;
    Value?: string;
}>;
export interface SnsSqsEnvelope {
    Type?: string;
    Message?: string;
    MessageAttributes?: SnsMessageAttributes;
    TopicArn?: string;
    Timestamp?: string;
    Subject?: string;
    MessageId?: string;
}
export type ValidSnsSqsEnvelope = Omit<SnsSqsEnvelope, 'Message'> & {
    Message: string;
};
/**
 * Parse an SNS->SQS body envelope.
 *
 * Validation is intentionally strict to avoid false positives for arbitrary SQS JSON payloads:
 * - must be JSON object
 * - must include `Message` as a string
 * - must include either `Type` (string) or `TopicArn` (string)
 */
export declare function parseSnsSqsEnvelope(body: string): ValidSnsSqsEnvelope | undefined;
