/**
 * E2E INTEGRATION TEST FOR NOISE REDUCTION
 *
 * This test uses REAL FW24 components:
 * - Real controllers with @Controller decorator
 * - Real services extending BaseEntityService
 * - Real entities with schemas
 * - Real DynamoDB backend for observability
 * - Real Lambda test harness to invoke controllers
 *
 * NO MANUAL SPAN CREATION - ALL spans come from framework code paths
 */
export {};
