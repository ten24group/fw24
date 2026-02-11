/**
 * Tests for Feature 2: SQS Retry Detection
 *
 * Validates that SQS records with ApproximateReceiveCount > 1 produce
 * correct retry tags and metrics on spans.
 */
