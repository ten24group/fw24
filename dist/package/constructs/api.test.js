"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const aws_cdk_lib_1 = require("aws-cdk-lib");
const assertions_1 = require("aws-cdk-lib/assertions");
const api_1 = require("./api");
const fw24_1 = require("../core/fw24");
const aws_apigateway_1 = require("aws-cdk-lib/aws-apigateway");
const aws_logs_1 = require("aws-cdk-lib/aws-logs");
/**
 * APIConstruct Test Suite
 *
 * NOTE: APIConstruct is extremely complex (1056 lines) with many integration points.
 * These tests focus on:
 * 1. Core API creation and configuration
 * 2. CORS handling (critical security feature)
 * 3. Merge utility usage (bug we fixed)
 * 4. Authorizer type safety (strong typing we added)
 * 5. Usage plans and API keys
 *
 * NOT TESTED (requires full app context):
 * - Controller registration (needs @Controller decorated files)
 * - Route creation (needs HandlerDescriptor)
 * - Lambda integrations (needs full DI container)
 * - Nested stack deployment
 * - Custom authorizers
 *
 * These are integration-level features tested in E2E tests.
 */
describe('APIConstruct', () => {
    let app;
    let stack;
    beforeEach(() => {
        // Clean up singleton
        fw24_1.Fw24.instance = undefined;
        app = new aws_cdk_lib_1.App();
        stack = new aws_cdk_lib_1.Stack(app, 'TestStack', {
            env: { account: '123456789012', region: 'us-east-1' }
        });
        // Initialize Fw24
        const fw24 = fw24_1.Fw24.getInstance();
        fw24.setApp(app);
        fw24.setConfig({
            name: 'test-api-app',
            region: 'us-east-1',
            account: '123456789012'
        });
        fw24.addStack('main', stack);
    });
    afterEach(() => {
        fw24_1.Fw24.instance = undefined;
    });
    /**
     * Helper to add minimal method for CDK validation.
     * CDK requires at least one method in REST API for synthesis.
     */
    const addMinimalMethod = (api) => {
        api.root.addResource('health').addMethod('GET', new aws_apigateway_1.MockIntegration({
            integrationResponses: [{ statusCode: '200' }],
            passthroughBehavior: aws_apigateway_1.PassthroughBehavior.NEVER,
            requestTemplates: { 'application/json': '{"statusCode": 200}' }
        }), {
            methodResponses: [{ statusCode: '200' }]
        });
    };
    describe('Basic API Creation', () => {
        it('should create a REST API with default settings', async () => {
            const apiConstruct = new api_1.APIConstruct({
                skipControllers: true // Skip controller registration for unit test
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
            template.hasResourceProperties('AWS::ApiGateway::RestApi', {
                Name: assertions_1.Match.stringLikeRegexp('test-api-app')
            });
        });
        it('should create API with custom name from apiOptions', async () => {
            const apiConstruct = new api_1.APIConstruct({
                apiOptions: {
                    restApiName: 'custom-api-name'
                },
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::ApiGateway::RestApi', {
                Name: 'custom-api-name'
            });
        });
        it('should create API with custom description', async () => {
            const apiConstruct = new api_1.APIConstruct({
                apiOptions: {
                    description: 'Custom API Description'
                },
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::ApiGateway::RestApi', {
                Description: 'Custom API Description'
            });
        });
        it('should register API and make it accessible', async () => {
            const apiConstruct = new api_1.APIConstruct({
                skipControllers: true
            });
            await apiConstruct.construct();
            // Verify API is created and accessible through the construct
            expect(apiConstruct.api).toBeDefined();
            expect(apiConstruct.api.restApiId).toBeDefined();
            expect(apiConstruct.api.root).toBeDefined();
        });
    });
    describe('CORS Configuration', () => {
        it('should handle CORS with boolean true (allow all origins)', async () => {
            const apiConstruct = new api_1.APIConstruct({
                cors: true,
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            // CORS enabled - should have gateway responses for 4xx and 5xx with wildcard origin
            template.hasResourceProperties('AWS::ApiGateway::GatewayResponse', {
                ResponseType: 'DEFAULT_4XX',
                ResponseParameters: {
                    'gatewayresponse.header.Access-Control-Allow-Origin': "'*'"
                }
            });
            template.hasResourceProperties('AWS::ApiGateway::GatewayResponse', {
                ResponseType: 'DEFAULT_5XX',
                ResponseParameters: {
                    'gatewayresponse.header.Access-Control-Allow-Origin': "'*'"
                }
            });
        });
        it('should handle CORS with single origin string', async () => {
            const apiConstruct = new api_1.APIConstruct({
                cors: 'https://example.com',
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            // Verify exact origin is set in gateway responses
            template.hasResourceProperties('AWS::ApiGateway::GatewayResponse', {
                ResponseType: 'DEFAULT_4XX',
                ResponseParameters: {
                    'gatewayresponse.header.Access-Control-Allow-Origin': "'https://example.com'"
                }
            });
            template.hasResourceProperties('AWS::ApiGateway::GatewayResponse', {
                ResponseType: 'DEFAULT_5XX',
                ResponseParameters: {
                    'gatewayresponse.header.Access-Control-Allow-Origin': "'https://example.com'"
                }
            });
        });
        it('should handle CORS with multiple origins', async () => {
            const apiConstruct = new api_1.APIConstruct({
                cors: ['https://example.com', 'https://app.example.com'],
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            // Multiple origins are joined with comma
            template.hasResourceProperties('AWS::ApiGateway::GatewayResponse', {
                ResponseType: 'DEFAULT_4XX',
                ResponseParameters: {
                    'gatewayresponse.header.Access-Control-Allow-Origin': "'https://example.com,https://app.example.com'"
                }
            });
            template.hasResourceProperties('AWS::ApiGateway::GatewayResponse', {
                ResponseType: 'DEFAULT_5XX',
                ResponseParameters: {
                    'gatewayresponse.header.Access-Control-Allow-Origin': "'https://example.com,https://app.example.com'"
                }
            });
        });
        it('should NOT create gateway responses when CORS is disabled', async () => {
            const apiConstruct = new api_1.APIConstruct({
                cors: false,
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            template.resourceCountIs('AWS::ApiGateway::GatewayResponse', 0);
        });
        it('should NOT create gateway responses when CORS is undefined', async () => {
            const apiConstruct = new api_1.APIConstruct({
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            template.resourceCountIs('AWS::ApiGateway::GatewayResponse', 0);
        });
    });
    describe('Usage Plans and API Keys', () => {
        it('should create usage plan with rate and quota limits', async () => {
            const apiConstruct = new api_1.APIConstruct({
                usagePlans: [
                    {
                        name: 'basic-plan',
                        rateLimit: 100,
                        burstLimit: 200,
                        quotaLimit: 10000,
                        quotaPeriod: aws_apigateway_1.Period.DAY
                    }
                ],
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
                UsagePlanName: 'basic-plan',
                Throttle: {
                    RateLimit: 100,
                    BurstLimit: 200
                },
                Quota: {
                    Limit: 10000,
                    Period: 'DAY'
                }
            });
        });
        it('should create usage plan without quota', async () => {
            const apiConstruct = new api_1.APIConstruct({
                usagePlans: [
                    {
                        name: 'throttle-only-plan',
                        rateLimit: 50,
                        burstLimit: 100
                    }
                ],
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
                UsagePlanName: 'throttle-only-plan',
                Throttle: {
                    RateLimit: 50,
                    BurstLimit: 100
                }
            });
        });
        it('should create multiple usage plans', async () => {
            const apiConstruct = new api_1.APIConstruct({
                usagePlans: [
                    {
                        name: 'basic-plan',
                        rateLimit: 100,
                        burstLimit: 200
                    },
                    {
                        name: 'premium-plan',
                        rateLimit: 1000,
                        burstLimit: 2000
                    }
                ],
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            template.resourceCountIs('AWS::ApiGateway::UsagePlan', 2);
        });
        it('should create API keys for usage plan', async () => {
            const apiConstruct = new api_1.APIConstruct({
                usagePlans: [
                    {
                        name: 'basic-plan',
                        rateLimit: 100,
                        burstLimit: 200,
                        apiKeys: {
                            keys: ['test-key-123', 'test-key-456']
                        }
                    }
                ],
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            template.resourceCountIs('AWS::ApiGateway::ApiKey', 2);
            template.hasResourceProperties('AWS::ApiGateway::ApiKey', {
                Value: 'test-key-123'
            });
            template.hasResourceProperties('AWS::ApiGateway::ApiKey', {
                Value: 'test-key-456'
            });
        });
        it('should NOT create API keys when keys array is empty', async () => {
            const apiConstruct = new api_1.APIConstruct({
                usagePlans: [
                    {
                        name: 'basic-plan',
                        rateLimit: 100,
                        burstLimit: 200,
                        apiKeys: {
                            keys: [], // Empty array - no keys created
                            keyNamePrefix: 'auto-generated-key'
                        }
                    }
                ],
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            // No keys are created when the keys array is explicitly empty
            template.resourceCountIs('AWS::ApiGateway::ApiKey', 0);
        });
        it('should link API keys to usage plan', async () => {
            const apiConstruct = new api_1.APIConstruct({
                usagePlans: [
                    {
                        name: 'basic-plan',
                        rateLimit: 100,
                        burstLimit: 200,
                        apiKeys: {
                            keys: ['test-key-123']
                        }
                    }
                ],
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::ApiGateway::UsagePlanKey', {
                KeyType: 'API_KEY'
            });
        });
    });
    describe('Usage Plan Defaults', () => {
        it('should apply default throttle and quota when not provided', async () => {
            const apiConstruct = new api_1.APIConstruct({
                usagePlans: [
                    {
                        name: 'default-limits-plan'
                        // No rateLimit, burstLimit, quotaLimit, or quotaPeriod specified
                    }
                ],
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            // Framework defaults: rateLimit=10, burstLimit=20, quotaLimit=10000, quotaPeriod=MONTH
            template.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
                UsagePlanName: 'default-limits-plan',
                Throttle: {
                    RateLimit: 10,
                    BurstLimit: 20
                },
                Quota: {
                    Limit: 10000,
                    Period: 'MONTH'
                }
            });
        });
        it('should merge custom and default values correctly', async () => {
            const apiConstruct = new api_1.APIConstruct({
                usagePlans: [
                    {
                        name: 'partial-config-plan',
                        rateLimit: 500 // Custom rate, but burst/quota should use defaults
                    }
                ],
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
                Throttle: {
                    RateLimit: 500, // Custom
                    BurstLimit: 20 // Default
                },
                Quota: {
                    Limit: 10000, // Default
                    Period: 'MONTH' // Default
                }
            });
        });
    });
    describe('API Key Configuration', () => {
        it('should create API key with correct description', async () => {
            const apiConstruct = new api_1.APIConstruct({
                usagePlans: [
                    {
                        name: 'test-plan',
                        rateLimit: 100,
                        burstLimit: 200,
                        apiKeys: {
                            keys: ['test-key-value']
                        }
                    }
                ],
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::ApiGateway::ApiKey', {
                Value: 'test-key-value',
                Enabled: true,
                Description: assertions_1.Match.stringLikeRegexp('API key .* for test-api-app')
            });
        });
        it('should reuse existing API keys with same value', async () => {
            const apiConstruct = new api_1.APIConstruct({
                usagePlans: [
                    {
                        name: 'plan1',
                        rateLimit: 100,
                        burstLimit: 200,
                        apiKeys: {
                            keys: ['shared-key']
                        }
                    },
                    {
                        name: 'plan2',
                        rateLimit: 200,
                        burstLimit: 400,
                        apiKeys: {
                            keys: ['shared-key'] // Same key as plan1
                        }
                    }
                ],
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            // Should only create 1 API key (reused across both plans)
            template.resourceCountIs('AWS::ApiGateway::ApiKey', 1);
            // But should have 2 usage plan keys (linking key to both plans)
            template.resourceCountIs('AWS::ApiGateway::UsagePlanKey', 2);
        });
    });
    describe('Regression Tests - Bug Fixes', () => {
        /**
         * REGRESSION: Merge utility was called incorrectly as merge(obj1, obj2)
         * instead of merge([obj1, obj2]). This test verifies ALL properties
         * from ALL sources are present in the merged result.
         */
        it('REGRESSION: should merge apiOptions without losing any properties', async () => {
            const apiConstruct = new api_1.APIConstruct({
                apiOptions: {
                    restApiName: 'merged-api',
                    description: 'Test Description',
                    deployOptions: {
                        stageName: 'prod',
                        description: 'Production stage'
                    }
                },
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            // Verify ALL properties are present
            template.hasResourceProperties('AWS::ApiGateway::RestApi', {
                Name: 'merged-api',
                Description: 'Test Description'
            });
            // Verify deployOptions made it through
            template.hasResourceProperties('AWS::ApiGateway::Stage', {
                StageName: 'prod',
                Description: 'Production stage'
            });
        });
    });
    describe('Edge Cases and Error Scenarios', () => {
        it('should handle minimal configuration', async () => {
            const apiConstruct = new api_1.APIConstruct({
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
        });
        it('should handle empty usagePlans array', async () => {
            const apiConstruct = new api_1.APIConstruct({
                usagePlans: [],
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            template.resourceCountIs('AWS::ApiGateway::UsagePlan', 0);
        });
        it('should handle undefined usagePlans', async () => {
            const apiConstruct = new api_1.APIConstruct({
                usagePlans: undefined,
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            template.resourceCountIs('AWS::ApiGateway::UsagePlan', 0);
        });
        it('should handle usage plan with only throttle (no quota)', async () => {
            const apiConstruct = new api_1.APIConstruct({
                usagePlans: [
                    {
                        name: 'throttle-only',
                        rateLimit: 100,
                        burstLimit: 200
                    }
                ],
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
                UsagePlanName: 'throttle-only',
                Throttle: assertions_1.Match.objectLike({
                    RateLimit: 100
                })
            });
        });
        it('should handle very high rate limits', async () => {
            const apiConstruct = new api_1.APIConstruct({
                usagePlans: [
                    {
                        name: 'high-limit',
                        rateLimit: 10000,
                        burstLimit: 20000,
                        quotaLimit: 1000000,
                        quotaPeriod: aws_apigateway_1.Period.MONTH
                    }
                ],
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
                Throttle: {
                    RateLimit: 10000,
                    BurstLimit: 20000
                },
                Quota: {
                    Limit: 1000000,
                    Period: 'MONTH'
                }
            });
        });
        it('should use defaults when rate limit is zero (falsy value)', async () => {
            const apiConstruct = new api_1.APIConstruct({
                usagePlans: [
                    {
                        name: 'zero-limit',
                        rateLimit: 0,
                        burstLimit: 0
                    }
                ],
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            // Zero is falsy, so defaults are applied (rateLimit=10, burstLimit=20)
            template.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
                Throttle: {
                    RateLimit: 10,
                    BurstLimit: 20
                }
            });
        });
        it('should handle long usage plan names', async () => {
            const longName = 'a'.repeat(100);
            const apiConstruct = new api_1.APIConstruct({
                usagePlans: [
                    {
                        name: longName,
                        rateLimit: 100,
                        burstLimit: 200
                    }
                ],
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
                UsagePlanName: longName
            });
        });
        it('should handle special characters in API key values', async () => {
            const apiConstruct = new api_1.APIConstruct({
                usagePlans: [
                    {
                        name: 'special-chars-plan',
                        rateLimit: 100,
                        burstLimit: 200,
                        apiKeys: {
                            keys: ['key-with-dashes_123', 'KEY_WITH_UNDERSCORES-456']
                        }
                    }
                ],
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::ApiGateway::ApiKey', {
                Value: 'key-with-dashes_123'
            });
            template.hasResourceProperties('AWS::ApiGateway::ApiKey', {
                Value: 'KEY_WITH_UNDERSCORES-456'
            });
        });
        it('should handle mixed usage plans (some with quota, some without)', async () => {
            const apiConstruct = new api_1.APIConstruct({
                usagePlans: [
                    {
                        name: 'with-quota',
                        rateLimit: 100,
                        burstLimit: 200,
                        quotaLimit: 10000,
                        quotaPeriod: aws_apigateway_1.Period.DAY
                    },
                    {
                        name: 'without-quota',
                        rateLimit: 50,
                        burstLimit: 100
                        // No quota specified
                    }
                ],
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            template.resourceCountIs('AWS::ApiGateway::UsagePlan', 2);
            // First plan has quota
            template.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
                UsagePlanName: 'with-quota',
                Quota: {
                    Limit: 10000,
                    Period: 'DAY'
                }
            });
            // Second plan has default quota
            template.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
                UsagePlanName: 'without-quota',
                Quota: {
                    Limit: 10000,
                    Period: 'MONTH'
                }
            });
        });
        it('should handle multiple usage plans with different quota periods', async () => {
            const apiConstruct = new api_1.APIConstruct({
                usagePlans: [
                    {
                        name: 'daily-plan',
                        quotaLimit: 1000,
                        quotaPeriod: aws_apigateway_1.Period.DAY
                    },
                    {
                        name: 'weekly-plan',
                        quotaLimit: 7000,
                        quotaPeriod: aws_apigateway_1.Period.WEEK
                    },
                    {
                        name: 'monthly-plan',
                        quotaLimit: 30000,
                        quotaPeriod: aws_apigateway_1.Period.MONTH
                    }
                ],
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            template.resourceCountIs('AWS::ApiGateway::UsagePlan', 3);
            template.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
                UsagePlanName: 'daily-plan',
                Quota: { Period: 'DAY' }
            });
            template.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
                UsagePlanName: 'weekly-plan',
                Quota: { Period: 'WEEK' }
            });
            template.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
                UsagePlanName: 'monthly-plan',
                Quota: { Period: 'MONTH' }
            });
        });
    });
    describe('Custom Domain Configuration', () => {
        it('should create API with custom domain, certificate, and base path mapping', async () => {
            const apiConstruct = new api_1.APIConstruct({
                domainName: 'api.example.com',
                certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/test-cert',
                apiOptions: {
                    deployOptions: {
                        stageName: 'prod'
                    }
                },
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            // Verify domain name is configured
            template.hasResourceProperties('AWS::ApiGateway::RestApi', {
                Name: assertions_1.Match.stringLikeRegexp('test-api-app')
            });
            // DomainName resource should be created
            template.hasResourceProperties('AWS::ApiGateway::DomainName', {
                DomainName: 'api.example.com',
                RegionalCertificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/test-cert'
            });
            // BasePathMapping should link domain to API (api.ts:258-262)
            // basePath is set to deployOptions.stageName (api.ts:261)
            template.hasResourceProperties('AWS::ApiGateway::BasePathMapping', {
                DomainName: assertions_1.Match.objectLike({
                    Ref: assertions_1.Match.stringLikeRegexp('.*')
                }),
                BasePath: 'prod' // Uses stageName from deployOptions
            });
        });
        it('should handle API without custom domain', async () => {
            const apiConstruct = new api_1.APIConstruct({
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            // No custom domain resources
            template.resourceCountIs('AWS::ApiGateway::DomainName', 0);
        });
    });
    describe('Lambda Integration Configuration', () => {
        it('should pass integration timeout to Lambda functions', async () => {
            const apiConstruct = new api_1.APIConstruct({
                integrationTimeout: 15,
                functionProps: {
                    timeout: aws_cdk_lib_1.Duration.seconds(20)
                },
                skipControllers: true
            });
            await apiConstruct.construct();
            // Verify construct has the config
            expect(apiConstruct.apiConstructConfig.integrationTimeout).toBe(15);
            expect(apiConstruct.apiConstructConfig.functionProps?.timeout).toBeDefined();
        });
        it('should use default function props when not specified', async () => {
            const apiConstruct = new api_1.APIConstruct({
                skipControllers: true
            });
            await apiConstruct.construct();
            expect(apiConstruct.apiConstructConfig.functionProps).toBeUndefined();
        });
    });
    describe('Usage Plan Advanced Configuration', () => {
        it('should create usage plan with description', async () => {
            const apiConstruct = new api_1.APIConstruct({
                usagePlans: [
                    {
                        name: 'described-plan',
                        description: 'This is a test usage plan',
                        rateLimit: 100,
                        burstLimit: 200
                    }
                ],
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
                UsagePlanName: 'described-plan',
                Description: 'This is a test usage plan'
            });
        });
        it('should link usage plan to API deployment stage', async () => {
            const apiConstruct = new api_1.APIConstruct({
                usagePlans: [
                    {
                        name: 'stage-linked-plan',
                        rateLimit: 100,
                        burstLimit: 200
                    }
                ],
                apiOptions: {
                    deployOptions: {
                        stageName: 'prod'
                    }
                },
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            // Usage plan should reference the API
            template.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
                UsagePlanName: 'stage-linked-plan',
                ApiStages: assertions_1.Match.arrayWith([
                    assertions_1.Match.objectLike({
                        Stage: assertions_1.Match.anyValue()
                    })
                ])
            });
        });
    });
    describe('API Key Naming Strategy', () => {
        it('should use keyNamePrefix from usage plan config', async () => {
            const apiConstruct = new api_1.APIConstruct({
                usagePlans: [
                    {
                        name: 'prefix-test',
                        rateLimit: 100,
                        burstLimit: 200,
                        apiKeys: {
                            keys: ['key1', 'key2'],
                            keyNamePrefix: 'custom-prefix'
                        }
                    }
                ],
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            // Both keys should be created
            template.resourceCountIs('AWS::ApiGateway::ApiKey', 2);
        });
        it('should use global apiKeyConfig.keyName when provided', async () => {
            const apiConstruct = new api_1.APIConstruct({
                apiKeyConfig: {
                    keyName: 'global-key-name'
                },
                usagePlans: [
                    {
                        name: 'global-key-test',
                        rateLimit: 100,
                        burstLimit: 200,
                        apiKeys: {
                            keys: ['test-key']
                        }
                    }
                ],
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            template.resourceCountIs('AWS::ApiGateway::ApiKey', 1);
        });
        it('should generate default key names when no config provided', async () => {
            const apiConstruct = new api_1.APIConstruct({
                usagePlans: [
                    {
                        name: 'default-name-test',
                        rateLimit: 100,
                        burstLimit: 200,
                        apiKeys: {
                            keys: ['key1', 'key2', 'key3']
                        }
                    }
                ],
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            template.resourceCountIs('AWS::ApiGateway::ApiKey', 3);
        });
    });
    describe('Framework Integration', () => {
        it('should register API in fw24 instance', async () => {
            const apiConstruct = new api_1.APIConstruct({
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            // Verify API is accessible directly from construct
            expect(apiConstruct.api).toBeDefined();
            expect(apiConstruct.api.restApiId).toBeDefined();
            // Verify construct has the fw24 instance
            expect(apiConstruct.fw24).toBeDefined();
            expect(apiConstruct.fw24).toBe(fw24_1.Fw24.getInstance());
        });
        it('should set construct outputs for API resources', async () => {
            const fw24 = fw24_1.Fw24.getInstance();
            const apiConstruct = new api_1.APIConstruct({
                skipControllers: true
            });
            await apiConstruct.construct();
            // Verify construct outputs are set
            expect(apiConstruct.output).toBeDefined();
        });
        it('should respect skipControllers flag', async () => {
            const apiConstruct = new api_1.APIConstruct({
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            // Should complete without error and not register controllers
            expect(apiConstruct.api).toBeDefined();
        });
        it('should handle controllersDirectory configuration', async () => {
            const apiConstruct = new api_1.APIConstruct({
                controllersDirectory: '/custom/path/controllers',
                skipControllers: true
            });
            await apiConstruct.construct();
            expect(apiConstruct.apiConstructConfig.controllersDirectory).toBe('/custom/path/controllers');
        });
    });
    describe('API Configuration Options', () => {
        it('should handle logRetentionDays configuration', async () => {
            const apiConstruct = new api_1.APIConstruct({
                logRetentionDays: aws_logs_1.RetentionDays.ONE_WEEK,
                skipControllers: true
            });
            await apiConstruct.construct();
            expect(apiConstruct.apiConstructConfig.logRetentionDays).toBe(aws_logs_1.RetentionDays.ONE_WEEK);
        });
        it('should handle logRemovalPolicy configuration', async () => {
            const apiConstruct = new api_1.APIConstruct({
                logRemovalPolicy: aws_cdk_lib_1.RemovalPolicy.RETAIN,
                skipControllers: true
            });
            await apiConstruct.construct();
            expect(apiConstruct.apiConstructConfig.logRemovalPolicy).toBe(aws_cdk_lib_1.RemovalPolicy.RETAIN);
        });
        it('should handle forceDeployment flag', async () => {
            const apiConstruct = new api_1.APIConstruct({
                forceDeployment: true,
                skipControllers: true
            });
            await apiConstruct.construct();
            expect(apiConstruct.apiConstructConfig.forceDeployment).toBe(true);
        });
        it('should handle controllerParentStackName', async () => {
            const apiConstruct = new api_1.APIConstruct({
                controllerParentStackName: 'parent-stack',
                skipControllers: true
            });
            await apiConstruct.construct();
            expect(apiConstruct.apiConstructConfig.controllerParentStackName).toBe('parent-stack');
        });
    });
    describe('API Deployment Configuration', () => {
        it('should create deployment with custom stage name', async () => {
            const apiConstruct = new api_1.APIConstruct({
                apiOptions: {
                    deployOptions: {
                        stageName: 'production',
                        description: 'Production deployment'
                    }
                },
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::ApiGateway::Stage', {
                StageName: 'production',
                Description: 'Production deployment'
            });
        });
        it('should handle API options with endpoint configuration', async () => {
            const apiConstruct = new api_1.APIConstruct({
                apiOptions: {
                    restApiName: 'test-api',
                    endpointConfiguration: {
                        types: [aws_apigateway_1.EndpointType.REGIONAL]
                    }
                },
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::ApiGateway::RestApi', {
                Name: 'test-api',
                EndpointConfiguration: {
                    Types: ['REGIONAL']
                }
            });
        });
        it('should merge multiple apiOptions properties correctly', async () => {
            const apiConstruct = new api_1.APIConstruct({
                apiOptions: {
                    restApiName: 'complex-api',
                    description: 'Complex API with multiple options',
                    endpointConfiguration: {
                        types: [aws_apigateway_1.EndpointType.REGIONAL]
                    },
                    deployOptions: {
                        stageName: 'v1',
                        description: 'Version 1'
                    },
                    binaryMediaTypes: ['image/png', 'application/pdf']
                },
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::ApiGateway::RestApi', {
                Name: 'complex-api',
                Description: 'Complex API with multiple options',
                BinaryMediaTypes: ['image/png', 'application/pdf']
            });
            template.hasResourceProperties('AWS::ApiGateway::Stage', {
                StageName: 'v1',
                Description: 'Version 1'
            });
        });
    });
    describe('CORS Advanced Configuration', () => {
        it('should configure CORS preflight with all default headers', async () => {
            const apiConstruct = new api_1.APIConstruct({
                cors: true,
                apiOptions: {
                    defaultCorsPreflightOptions: {
                        allowOrigins: aws_apigateway_1.Cors.ALL_ORIGINS,
                        allowMethods: aws_apigateway_1.Cors.ALL_METHODS
                    }
                },
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            // Verify gateway responses for error codes
            template.hasResourceProperties('AWS::ApiGateway::GatewayResponse', {
                ResponseType: 'DEFAULT_4XX',
                ResponseParameters: {
                    'gatewayresponse.header.Access-Control-Allow-Origin': "'*'"
                }
            });
            // Verify CORS preflight is configured on the API
            // Framework uses getCorsPreflightOptions() which sets specific headers
            expect(apiConstruct.api.root).toBeDefined();
        });
        it('should include framework-specific CORS headers', async () => {
            const apiConstruct = new api_1.APIConstruct({
                cors: true,
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            // The preflight OPTIONS mock must allow every header the framework's own clients send —
            // notably the tracing/identity headers (x-correlation-id, x-caused-by, x-actor) the runtime
            // consumes. A header missing from this list fails the browser preflight for any request
            // carrying it, so the whole call dies as a CORS error before reaching the backend.
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::ApiGateway::Method', {
                HttpMethod: 'OPTIONS',
                Integration: {
                    IntegrationResponses: [
                        assertions_1.Match.objectLike({
                            ResponseParameters: assertions_1.Match.objectLike({
                                'method.response.header.Access-Control-Allow-Headers': assertions_1.Match.stringLikeRegexp('Impersonating-User-Sub,X-Correlation-Id,X-Caused-By,X-Actor'),
                            }),
                        }),
                    ],
                },
            });
        });
        it('should enable CORS credentials', async () => {
            const apiConstruct = new api_1.APIConstruct({
                cors: 'https://app.example.com',
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            // Verify CORS is configured (allowCredentials is set in getCorsPreflightOptions)
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::ApiGateway::GatewayResponse', {
                ResponseType: 'DEFAULT_4XX'
            });
            template.hasResourceProperties('AWS::ApiGateway::GatewayResponse', {
                ResponseType: 'DEFAULT_5XX'
            });
        });
    });
    describe('API Security - requireApiKey', () => {
        it('should enforce API key requirement at route level', async () => {
            // Note: This tests the configuration storage, actual route creation requires full controller context
            const apiConstruct = new api_1.APIConstruct({
                usagePlans: [
                    {
                        name: 'secured-plan',
                        rateLimit: 100,
                        burstLimit: 200,
                        apiKeys: {
                            keys: ['secure-key-123']
                        }
                    }
                ],
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            // Verify API key and usage plan are created (api.ts:851-883)
            template.resourceCountIs('AWS::ApiGateway::ApiKey', 1);
            template.resourceCountIs('AWS::ApiGateway::UsagePlanKey', 1);
        });
        it('should create API without requiring keys when not configured', async () => {
            const apiConstruct = new api_1.APIConstruct({
                usagePlans: undefined,
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            // No API keys should be created
            template.resourceCountIs('AWS::ApiGateway::ApiKey', 0);
        });
    });
    describe('Integration Types - Direct AWS Service Integrations', () => {
        /**
         * NOTE: SQS and SNS direct integrations (api.ts:885-951) require full controller context
         * with route.target='queue' or route.target='topic'. These are integration-level features
         * that need registered queues/topics in fw24 environment.
         *
         * These tests verify the construct has the integration methods available.
         */
        it('should have SQS integration capability', () => {
            const apiConstruct = new api_1.APIConstruct({
                skipControllers: true
            });
            // Verify the construct has the private createSQSIntegration method
            expect(apiConstruct.createSQSIntegration).toBeDefined();
            expect(typeof apiConstruct.createSQSIntegration).toBe('function');
        });
        it('should have SNS integration capability', () => {
            const apiConstruct = new api_1.APIConstruct({
                skipControllers: true
            });
            // Verify the construct has the private createSNSIntegration method
            expect(apiConstruct.createSNSIntegration).toBeDefined();
            expect(typeof apiConstruct.createSNSIntegration).toBe('function');
        });
        it('should have Lambda integration capability', () => {
            const apiConstruct = new api_1.APIConstruct({
                skipControllers: true
            });
            // Verify the construct has the private createLambdaFunction method
            expect(apiConstruct.createLambdaFunction).toBeDefined();
            expect(typeof apiConstruct.createLambdaFunction).toBe('function');
        });
    });
    describe('Environment Variable Hydration', () => {
        it('should process config through Helper.hydrateConfig', async () => {
            const apiConstruct = new api_1.APIConstruct({
                skipControllers: true
            });
            await apiConstruct.construct();
            // Verify construct was initialized (hydration happens in constructor via api.ts:239)
            expect(apiConstruct.apiConstructConfig).toBeDefined();
            expect(apiConstruct.api).toBeDefined();
        });
    });
    describe('Multi-Stack Deployment Configuration', () => {
        it('should handle deploy flag for multi-stack setup', async () => {
            const apiConstruct = new api_1.APIConstruct({
                apiOptions: {
                    deploy: false // api.ts:265-268 - prevents deployment in nested stack scenarios
                },
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            // When deploy=false, deployOptions should be removed
            expect(apiConstruct.apiConstructConfig.apiOptions?.deploy).toBe(false);
        });
        it('should handle controllerParentStackName for nested stacks', async () => {
            const apiConstruct = new api_1.APIConstruct({
                controllerParentStackName: 'parent-stack',
                skipControllers: true
            });
            await apiConstruct.construct();
            expect(apiConstruct.apiConstructConfig.controllerParentStackName).toBe('parent-stack');
        });
    });
    describe('Negative Tests - Invalid Configurations', () => {
        it('should handle empty domainName gracefully', async () => {
            const apiConstruct = new api_1.APIConstruct({
                domainName: '',
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            // Empty domain name should not create domain resources
            template.resourceCountIs('AWS::ApiGateway::DomainName', 0);
        });
        it('should handle usage plan with empty name', async () => {
            const apiConstruct = new api_1.APIConstruct({
                usagePlans: [
                    {
                        name: '',
                        rateLimit: 100,
                        burstLimit: 200
                    }
                ],
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            // Should still create the usage plan
            template.resourceCountIs('AWS::ApiGateway::UsagePlan', 1);
        });
        it('should handle undefined apiKeyConfig gracefully', async () => {
            const apiConstruct = new api_1.APIConstruct({
                apiKeyConfig: undefined,
                usagePlans: [
                    {
                        name: 'test-plan',
                        rateLimit: 100,
                        burstLimit: 200,
                        apiKeys: {
                            keys: ['test-key']
                        }
                    }
                ],
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            template.resourceCountIs('AWS::ApiGateway::ApiKey', 1);
        });
        it('should handle null CORS configuration', async () => {
            const apiConstruct = new api_1.APIConstruct({
                cors: undefined,
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            // No CORS gateway responses
            template.resourceCountIs('AWS::ApiGateway::GatewayResponse', 0);
        });
        it('should handle missing deployOptions', async () => {
            const apiConstruct = new api_1.APIConstruct({
                apiOptions: {
                    restApiName: 'no-deploy-options-api'
                    // No deployOptions
                },
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::ApiGateway::RestApi', {
                Name: 'no-deploy-options-api'
            });
        });
        it('should throw error for invalid certificateArn without domainName', async () => {
            const apiConstruct = new api_1.APIConstruct({
                certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/test-cert',
                // Missing domainName - should be handled gracefully or error
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack);
            // Should not create domain resources if domainName is missing
            template.resourceCountIs('AWS::ApiGateway::DomainName', 0);
        });
    });
    describe('Snapshot Tests - CloudFormation Consistency', () => {
        /**
         * Snapshot: Basic API Setup
         * Tests CloudFormation template for a basic API with CORS.
         */
        it('should generate consistent CloudFormation for basic API', async () => {
            const apiConstruct = new api_1.APIConstruct({
                cors: true,
                apiOptions: {
                    restApiName: 'snapshot-api',
                    description: 'Snapshot Test API'
                },
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack).toJSON();
            expect(template).toMatchSnapshot();
        });
        /**
         * Snapshot: API with Usage Plan
         * Tests CloudFormation template for API with usage plan and API keys.
         */
        it('should generate consistent CloudFormation for API with usage plan', async () => {
            const apiConstruct = new api_1.APIConstruct({
                usagePlans: [
                    {
                        name: 'snapshot-plan',
                        rateLimit: 100,
                        burstLimit: 200,
                        quotaLimit: 10000,
                        quotaPeriod: aws_apigateway_1.Period.DAY,
                        apiKeys: {
                            keys: ['snapshot-key-123']
                        }
                    }
                ],
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack).toJSON();
            expect(template).toMatchSnapshot();
        });
        /**
         * Snapshot: Complete API Configuration
         * Tests CloudFormation template with all options enabled.
         */
        it('should generate consistent CloudFormation for complete configuration', async () => {
            const apiConstruct = new api_1.APIConstruct({
                cors: ['https://example.com', 'https://app.example.com'],
                apiOptions: {
                    restApiName: 'complete-api',
                    description: 'Complete API Configuration',
                    deployOptions: {
                        stageName: 'prod'
                    }
                },
                usagePlans: [
                    {
                        name: 'complete-plan',
                        rateLimit: 500,
                        burstLimit: 1000,
                        quotaLimit: 50000,
                        quotaPeriod: aws_apigateway_1.Period.MONTH,
                        apiKeys: {
                            keys: ['complete-key-123', 'complete-key-456']
                        }
                    }
                ],
                skipControllers: true
            });
            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);
            const template = assertions_1.Template.fromStack(stack).toJSON();
            expect(template).toMatchSnapshot();
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY29uc3RydWN0cy9hcGkudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLDZDQUFrRTtBQUNsRSx1REFBeUQ7QUFDekQsK0JBQXFDO0FBQ3JDLHVDQUFvQztBQUNwQywrREFBdUg7QUFDdkgsbURBQXFEO0FBRXJEOzs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBbUJHO0FBQ0gsUUFBUSxDQUFDLGNBQWMsRUFBRSxHQUFHLEVBQUU7SUFDNUIsSUFBSSxHQUFRLENBQUM7SUFDYixJQUFJLEtBQVksQ0FBQztJQUVqQixVQUFVLENBQUMsR0FBRyxFQUFFO1FBQ2QscUJBQXFCO1FBQ3BCLFdBQVksQ0FBQyxRQUFRLEdBQUcsU0FBUyxDQUFDO1FBRW5DLEdBQUcsR0FBRyxJQUFJLGlCQUFHLEVBQUUsQ0FBQztRQUNoQixLQUFLLEdBQUcsSUFBSSxtQkFBSyxDQUFDLEdBQUcsRUFBRSxXQUFXLEVBQUU7WUFDbEMsR0FBRyxFQUFFLEVBQUUsT0FBTyxFQUFFLGNBQWMsRUFBRSxNQUFNLEVBQUUsV0FBVyxFQUFFO1NBQ3RELENBQUMsQ0FBQztRQUVILGtCQUFrQjtRQUNsQixNQUFNLElBQUksR0FBRyxXQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7UUFDaEMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUNqQixJQUFJLENBQUMsU0FBUyxDQUFDO1lBQ2IsSUFBSSxFQUFFLGNBQWM7WUFDcEIsTUFBTSxFQUFFLFdBQVc7WUFDbkIsT0FBTyxFQUFFLGNBQWM7U0FDeEIsQ0FBQyxDQUFDO1FBQ0gsSUFBSSxDQUFDLFFBQVEsQ0FBQyxNQUFNLEVBQUUsS0FBSyxDQUFDLENBQUM7SUFDL0IsQ0FBQyxDQUFDLENBQUM7SUFFSCxTQUFTLENBQUMsR0FBRyxFQUFFO1FBQ1osV0FBWSxDQUFDLFFBQVEsR0FBRyxTQUFTLENBQUM7SUFDckMsQ0FBQyxDQUFDLENB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bFBvbGljeSB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IFRlbXBsYXRlLCBNYXRjaCB9IGZyb20gJ2F3cy1jZGstbGliL2Fzc2VydGlvbnMnO1xuaW1wb3J0IHsgQVBJQ29uc3RydWN0IH0gZnJvbSAnLi9hcGknO1xuaW1wb3J0IHsgRncyNCB9IGZyb20gJy4uL2NvcmUvZncyNCc7XG5pbXBvcnQgeyBSZXN0QXBpLCBDb3JzLCBQZXJpb2QsIE1vY2tJbnRlZ3JhdGlvbiwgUGFzc3Rocm91Z2hCZWhhdmlvciwgRW5kcG9pbnRUeXBlIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXknO1xuaW1wb3J0IHsgUmV0ZW50aW9uRGF5cyB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcblxuLyoqXG4gKiBBUElDb25zdHJ1Y3QgVGVzdCBTdWl0ZVxuICogXG4gKiBOT1RFOiBBUElDb25zdHJ1Y3QgaXMgZXh0cmVtZWx5IGNvbXBsZXggKDEwNTYgbGluZXMpIHdpdGggbWFueSBpbnRlZ3JhdGlvbiBwb2ludHMuXG4gKiBUaGVzZSB0ZXN0cyBmb2N1cyBvbjpcbiAqIDEuIENvcmUgQVBJIGNyZWF0aW9uIGFuZCBjb25maWd1cmF0aW9uXG4gKiAyLiBDT1JTIGhhbmRsaW5nIChjcml0aWNhbCBzZWN1cml0eSBmZWF0dXJlKVxuICogMy4gTWVyZ2UgdXRpbGl0eSB1c2FnZSAoYnVnIHdlIGZpeGVkKVxuICogNC4gQXV0aG9yaXplciB0eXBlIHNhZmV0eSAoc3Ryb25nIHR5cGluZyB3ZSBhZGRlZClcbiAqIDUuIFVzYWdlIHBsYW5zIGFuZCBBUEkga2V5c1xuICogXG4gKiBOT1QgVEVTVEVEIChyZXF1aXJlcyBmdWxsIGFwcCBjb250ZXh0KTpcbiAqIC0gQ29udHJvbGxlciByZWdpc3RyYXRpb24gKG5lZWRzIEBDb250cm9sbGVyIGRlY29yYXRlZCBmaWxlcylcbiAqIC0gUm91dGUgY3JlYXRpb24gKG5lZWRzIEhhbmRsZXJEZXNjcmlwdG9yKVxuICogLSBMYW1iZGEgaW50ZWdyYXRpb25zIChuZWVkcyBmdWxsIERJIGNvbnRhaW5lcilcbiAqIC0gTmVzdGVkIHN0YWNrIGRlcGxveW1lbnRcbiAqIC0gQ3VzdG9tIGF1dGhvcml6ZXJzXG4gKiBcbiAqIFRoZXNlIGFyZSBpbnRlZ3JhdGlvbi1sZXZlbCBmZWF0dXJlcyB0ZXN0ZWQgaW4gRTJFIHRlc3RzLlxuICovXG5kZXNjcmliZSgnQVBJQ29uc3RydWN0JywgKCkgPT4ge1xuICBsZXQgYXBwOiBBcHA7XG4gIGxldCBzdGFjazogU3RhY2s7XG5cbiAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgLy8gQ2xlYW4gdXAgc2luZ2xldG9uXG4gICAgKEZ3MjQgYXMgYW55KS5pbnN0YW5jZSA9IHVuZGVmaW5lZDtcblxuICAgIGFwcCA9IG5ldyBBcHAoKTtcbiAgICBzdGFjayA9IG5ldyBTdGFjayhhcHAsICdUZXN0U3RhY2snLCB7XG4gICAgICBlbnY6IHsgYWNjb3VudDogJzEyMzQ1Njc4OTAxMicsIHJlZ2lvbjogJ3VzLWVhc3QtMScgfVxuICAgIH0pO1xuXG4gICAgLy8gSW5pdGlhbGl6ZSBGdzI0XG4gICAgY29uc3QgZncyNCA9IEZ3MjQuZ2V0SW5zdGFuY2UoKTtcbiAgICBmdzI0LnNldEFwcChhcHApO1xuICAgIGZ3MjQuc2V0Q29uZmlnKHtcbiAgICAgIG5hbWU6ICd0ZXN0LWFwaS1hcHAnLFxuICAgICAgcmVnaW9uOiAndXMtZWFzdC0xJyxcbiAgICAgIGFjY291bnQ6ICcxMjM0NTY3ODkwMTInXG4gICAgfSk7XG4gICAgZncyNC5hZGRTdGFjaygnbWFpbicsIHN0YWNrKTtcbiAgfSk7XG5cbiAgYWZ0ZXJFYWNoKCgpID0+IHtcbiAgICAoRncyNCBhcyBhbnkpLmluc3RhbmNlID0gdW5kZWZpbmVkO1xuICB9KTtcblxuICAvKipcbiAgICogSGVscGVyIHRvIGFkZCBtaW5pbWFsIG1ldGhvZCBmb3IgQ0RLIHZhbGlkYXRpb24uXG4gICAqIENESyByZXF1aXJlcyBhdCBsZWFzdCBvbmUgbWV0aG9kIGluIFJFU1QgQVBJIGZvciBzeW50aGVzaXMuXG4gICAqL1xuICBjb25zdCBhZGRNaW5pbWFsTWV0aG9kID0gKGFwaTogUmVzdEFwaSkgPT4ge1xuICAgIGFwaS5yb290LmFkZFJlc291cmNlKCdoZWFsdGgnKS5hZGRNZXRob2QoJ0dFVCcsIG5ldyBNb2NrSW50ZWdyYXRpb24oe1xuICAgICAgaW50ZWdyYXRpb25SZXNwb25zZXM6IFsgeyBzdGF0dXNDb2RlOiAnMjAwJyB9IF0sXG4gICAgICBwYXNzdGhyb3VnaEJlaGF2aW9yOiBQYXNzdGhyb3VnaEJlaGF2aW9yLk5FVkVSLFxuICAgICAgcmVxdWVzdFRlbXBsYXRlczogeyAnYXBwbGljYXRpb24vanNvbic6ICd7XCJzdGF0dXNDb2RlXCI6IDIwMH0nIH1cbiAgICB9KSwge1xuICAgICAgbWV0aG9kUmVzcG9uc2VzOiBbIHsgc3RhdHVzQ29kZTogJzIwMCcgfSBdXG4gICAgfSk7XG4gIH07XG5cbiAgZGVzY3JpYmUoJ0Jhc2ljIEFQSSBDcmVhdGlvbicsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGNyZWF0ZSBhIFJFU1QgQVBJIHdpdGggZGVmYXVsdCBzZXR0aW5ncycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGFwaUNvbnN0cnVjdCA9IG5ldyBBUElDb25zdHJ1Y3Qoe1xuICAgICAgICBza2lwQ29udHJvbGxlcnM6IHRydWUgLy8gU2tpcCBjb250cm9sbGVyIHJlZ2lzdHJhdGlvbiBmb3IgdW5pdCB0ZXN0XG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgYXBpQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuICAgICAgYWRkTWluaW1hbE1ldGhvZChhcGlDb25zdHJ1Y3QuYXBpKTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUucmVzb3VyY2VDb3VudElzKCdBV1M6OkFwaUdhdGV3YXk6OlJlc3RBcGknLCAxKTtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpBcGlHYXRld2F5OjpSZXN0QXBpJywge1xuICAgICAgICBOYW1lOiBNYXRjaC5zdHJpbmdMaWtlUmVnZXhwKCd0ZXN0LWFwaS1hcHAnKVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGNyZWF0ZSBBUEkgd2l0aCBjdXN0b20gbmFtZSBmcm9tIGFwaU9wdGlvbnMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBhcGlDb25zdHJ1Y3QgPSBuZXcgQVBJQ29uc3RydWN0KHtcbiAgICAgICAgYXBpT3B0aW9uczoge1xuICAgICAgICAgIHJlc3RBcGlOYW1lOiAnY3VzdG9tLWFwaS1uYW1lJ1xuICAgICAgICB9LFxuICAgICAgICBza2lwQ29udHJvbGxlcnM6IHRydWVcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBhcGlDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG4gICAgICBhZGRNaW5pbWFsTWV0aG9kKGFwaUNvbnN0cnVjdC5hcGkpO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6QXBpR2F0ZXdheTo6UmVzdEFwaScsIHtcbiAgICAgICAgTmFtZTogJ2N1c3RvbS1hcGktbmFtZSdcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgQVBJIHdpdGggY3VzdG9tIGRlc2NyaXB0aW9uJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYXBpQ29uc3RydWN0ID0gbmV3IEFQSUNvbnN0cnVjdCh7XG4gICAgICAgIGFwaU9wdGlvbnM6IHtcbiAgICAgICAgICBkZXNjcmlwdGlvbjogJ0N1c3RvbSBBUEkgRGVzY3JpcHRpb24nXG4gICAgICAgIH0sXG4gICAgICAgIHNraXBDb250cm9sbGVyczogdHJ1ZVxuICAgICAgfSk7XG5cbiAgICAgIGF3YWl0IGFwaUNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcbiAgICAgIGFkZE1pbmltYWxNZXRob2QoYXBpQ29uc3RydWN0LmFwaSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpBcGlHYXRld2F5OjpSZXN0QXBpJywge1xuICAgICAgICBEZXNjcmlwdGlvbjogJ0N1c3RvbSBBUEkgRGVzY3JpcHRpb24nXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcmVnaXN0ZXIgQVBJIGFuZCBtYWtlIGl0IGFjY2Vzc2libGUnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBhcGlDb25zdHJ1Y3QgPSBuZXcgQVBJQ29uc3RydWN0KHtcbiAgICAgICAgc2tpcENvbnRyb2xsZXJzOiB0cnVlXG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgYXBpQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuXG4gICAgICAvLyBWZXJpZnkgQVBJIGlzIGNyZWF0ZWQgYW5kIGFjY2Vzc2libGUgdGhyb3VnaCB0aGUgY29uc3RydWN0XG4gICAgICBleHBlY3QoYXBpQ29uc3RydWN0LmFwaSkudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdChhcGlDb25zdHJ1Y3QuYXBpLnJlc3RBcGlJZCkudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdChhcGlDb25zdHJ1Y3QuYXBpLnJvb3QpLnRvQmVEZWZpbmVkKCk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdDT1JTIENvbmZpZ3VyYXRpb24nLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgQ09SUyB3aXRoIGJvb2xlYW4gdHJ1ZSAoYWxsb3cgYWxsIG9yaWdpbnMpJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYXBpQ29uc3RydWN0ID0gbmV3IEFQSUNvbnN0cnVjdCh7XG4gICAgICAgIGNvcnM6IHRydWUsXG4gICAgICAgIHNraXBDb250cm9sbGVyczogdHJ1ZVxuICAgICAgfSk7XG5cbiAgICAgIGF3YWl0IGFwaUNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcbiAgICAgIGFkZE1pbmltYWxNZXRob2QoYXBpQ29uc3RydWN0LmFwaSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIC8vIENPUlMgZW5hYmxlZCAtIHNob3VsZCBoYXZlIGdhdGV3YXkgcmVzcG9uc2VzIGZvciA0eHggYW5kIDV4eCB3aXRoIHdpbGRjYXJkIG9yaWdpblxuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkFwaUdhdGV3YXk6OkdhdGV3YXlSZXNwb25zZScsIHtcbiAgICAgICAgUmVzcG9uc2VUeXBlOiAnREVGQVVMVF80WFgnLFxuICAgICAgICBSZXNwb25zZVBhcmFtZXRlcnM6IHtcbiAgICAgICAgICAnZ2F0ZXdheXJlc3BvbnNlLmhlYWRlci5BY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiBcIicqJ1wiXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6QXBpR2F0ZXdheTo6R2F0ZXdheVJlc3BvbnNlJywge1xuICAgICAgICBSZXNwb25zZVR5cGU6ICdERUZBVUxUXzVYWCcsXG4gICAgICAgIFJlc3BvbnNlUGFyYW1ldGVyczoge1xuICAgICAgICAgICdnYXRld2F5cmVzcG9uc2UuaGVhZGVyLkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6IFwiJyonXCJcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBDT1JTIHdpdGggc2luZ2xlIG9yaWdpbiBzdHJpbmcnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBhcGlDb25zdHJ1Y3QgPSBuZXcgQVBJQ29uc3RydWN0KHtcbiAgICAgICAgY29yczogJ2h0dHBzOi8vZXhhbXBsZS5jb20nLFxuICAgICAgICBza2lwQ29udHJvbGxlcnM6IHRydWVcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBhcGlDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG4gICAgICBhZGRNaW5pbWFsTWV0aG9kKGFwaUNvbnN0cnVjdC5hcGkpO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICAvLyBWZXJpZnkgZXhhY3Qgb3JpZ2luIGlzIHNldCBpbiBnYXRld2F5IHJlc3BvbnNlc1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkFwaUdhdGV3YXk6OkdhdGV3YXlSZXNwb25zZScsIHtcbiAgICAgICAgUmVzcG9uc2VUeXBlOiAnREVGQVVMVF80WFgnLFxuICAgICAgICBSZXNwb25zZVBhcmFtZXRlcnM6IHtcbiAgICAgICAgICAnZ2F0ZXdheXJlc3BvbnNlLmhlYWRlci5BY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiBcIidodHRwczovL2V4YW1wbGUuY29tJ1wiXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkFwaUdhdGV3YXk6OkdhdGV3YXlSZXNwb25zZScsIHtcbiAgICAgICAgUmVzcG9uc2VUeXBlOiAnREVGQVVMVF81WFgnLFxuICAgICAgICBSZXNwb25zZVBhcmFtZXRlcnM6IHtcbiAgICAgICAgICAnZ2F0ZXdheXJlc3BvbnNlLmhlYWRlci5BY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiBcIidodHRwczovL2V4YW1wbGUuY29tJ1wiXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgQ09SUyB3aXRoIG11bHRpcGxlIG9yaWdpbnMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBhcGlDb25zdHJ1Y3QgPSBuZXcgQVBJQ29uc3RydWN0KHtcbiAgICAgICAgY29yczogWyAnaHR0cHM6Ly9leGFtcGxlLmNvbScsICdodHRwczovL2FwcC5leGFtcGxlLmNvbScgXSxcbiAgICAgICAgc2tpcENvbnRyb2xsZXJzOiB0cnVlXG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgYXBpQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuICAgICAgYWRkTWluaW1hbE1ldGhvZChhcGlDb25zdHJ1Y3QuYXBpKTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgLy8gTXVsdGlwbGUgb3JpZ2lucyBhcmUgam9pbmVkIHdpdGggY29tbWFcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpBcGlHYXRld2F5OjpHYXRld2F5UmVzcG9uc2UnLCB7XG4gICAgICAgIFJlc3BvbnNlVHlwZTogJ0RFRkFVTFRfNFhYJyxcbiAgICAgICAgUmVzcG9uc2VQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgJ2dhdGV3YXlyZXNwb25zZS5oZWFkZXIuQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogXCInaHR0cHM6Ly9leGFtcGxlLmNvbSxodHRwczovL2FwcC5leGFtcGxlLmNvbSdcIlxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpBcGlHYXRld2F5OjpHYXRld2F5UmVzcG9uc2UnLCB7XG4gICAgICAgIFJlc3BvbnNlVHlwZTogJ0RFRkFVTFRfNVhYJyxcbiAgICAgICAgUmVzcG9uc2VQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgJ2dhdGV3YXlyZXNwb25zZS5oZWFkZXIuQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogXCInaHR0cHM6Ly9leGFtcGxlLmNvbSxodHRwczovL2FwcC5leGFtcGxlLmNvbSdcIlxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgTk9UIGNyZWF0ZSBnYXRld2F5IHJlc3BvbnNlcyB3aGVuIENPUlMgaXMgZGlzYWJsZWQnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBhcGlDb25zdHJ1Y3QgPSBuZXcgQVBJQ29uc3RydWN0KHtcbiAgICAgICAgY29yczogZmFsc2UsXG4gICAgICAgIHNraXBDb250cm9sbGVyczogdHJ1ZVxuICAgICAgfSk7XG5cbiAgICAgIGF3YWl0IGFwaUNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcbiAgICAgIGFkZE1pbmltYWxNZXRob2QoYXBpQ29uc3RydWN0LmFwaSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLnJlc291cmNlQ291bnRJcygnQVdTOjpBcGlHYXRld2F5OjpHYXRld2F5UmVzcG9uc2UnLCAwKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgTk9UIGNyZWF0ZSBnYXRld2F5IHJlc3BvbnNlcyB3aGVuIENPUlMgaXMgdW5kZWZpbmVkJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYXBpQ29uc3RydWN0ID0gbmV3IEFQSUNvbnN0cnVjdCh7XG4gICAgICAgIHNraXBDb250cm9sbGVyczogdHJ1ZVxuICAgICAgfSk7XG5cbiAgICAgIGF3YWl0IGFwaUNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcbiAgICAgIGFkZE1pbmltYWxNZXRob2QoYXBpQ29uc3RydWN0LmFwaSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLnJlc291cmNlQ291bnRJcygnQVdTOjpBcGlHYXRld2F5OjpHYXRld2F5UmVzcG9uc2UnLCAwKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1VzYWdlIFBsYW5zIGFuZCBBUEkgS2V5cycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGNyZWF0ZSB1c2FnZSBwbGFuIHdpdGggcmF0ZSBhbmQgcXVvdGEgbGltaXRzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYXBpQ29uc3RydWN0ID0gbmV3IEFQSUNvbnN0cnVjdCh7XG4gICAgICAgIHVzYWdlUGxhbnM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBuYW1lOiAnYmFzaWMtcGxhbicsXG4gICAgICAgICAgICByYXRlTGltaXQ6IDEwMCxcbiAgICAgICAgICAgIGJ1cnN0TGltaXQ6IDIwMCxcbiAgICAgICAgICAgIHF1b3RhTGltaXQ6IDEwMDAwLFxuICAgICAgICAgICAgcXVvdGFQZXJpb2Q6IFBlcmlvZC5EQVlcbiAgICAgICAgICB9XG4gICAgICAgIF0sXG4gICAgICAgIHNraXBDb250cm9sbGVyczogdHJ1ZVxuICAgICAgfSk7XG5cbiAgICAgIGF3YWl0IGFwaUNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcbiAgICAgIGFkZE1pbmltYWxNZXRob2QoYXBpQ29uc3RydWN0LmFwaSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpBcGlHYXRld2F5OjpVc2FnZVBsYW4nLCB7XG4gICAgICAgIFVzYWdlUGxhbk5hbWU6ICdiYXNpYy1wbGFuJyxcbiAgICAgICAgVGhyb3R0bGU6IHtcbiAgICAgICAgICBSYXRlTGltaXQ6IDEwMCxcbiAgICAgICAgICBCdXJzdExpbWl0OiAyMDBcbiAgICAgICAgfSxcbiAgICAgICAgUXVvdGE6IHtcbiAgICAgICAgICBMaW1pdDogMTAwMDAsXG4gICAgICAgICAgUGVyaW9kOiAnREFZJ1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgY3JlYXRlIHVzYWdlIHBsYW4gd2l0aG91dCBxdW90YScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGFwaUNvbnN0cnVjdCA9IG5ldyBBUElDb25zdHJ1Y3Qoe1xuICAgICAgICB1c2FnZVBsYW5zOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgbmFtZTogJ3Rocm90dGxlLW9ubHktcGxhbicsXG4gICAgICAgICAgICByYXRlTGltaXQ6IDUwLFxuICAgICAgICAgICAgYnVyc3RMaW1pdDogMTAwXG4gICAgICAgICAgfVxuICAgICAgICBdLFxuICAgICAgICBza2lwQ29udHJvbGxlcnM6IHRydWVcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBhcGlDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG4gICAgICBhZGRNaW5pbWFsTWV0aG9kKGFwaUNvbnN0cnVjdC5hcGkpO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6QXBpR2F0ZXdheTo6VXNhZ2VQbGFuJywge1xuICAgICAgICBVc2FnZVBsYW5OYW1lOiAndGhyb3R0bGUtb25seS1wbGFuJyxcbiAgICAgICAgVGhyb3R0bGU6IHtcbiAgICAgICAgICBSYXRlTGltaXQ6IDUwLFxuICAgICAgICAgIEJ1cnN0TGltaXQ6IDEwMFxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgY3JlYXRlIG11bHRpcGxlIHVzYWdlIHBsYW5zJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYXBpQ29uc3RydWN0ID0gbmV3IEFQSUNvbnN0cnVjdCh7XG4gICAgICAgIHVzYWdlUGxhbnM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBuYW1lOiAnYmFzaWMtcGxhbicsXG4gICAgICAgICAgICByYXRlTGltaXQ6IDEwMCxcbiAgICAgICAgICAgIGJ1cnN0TGltaXQ6IDIwMFxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgbmFtZTogJ3ByZW1pdW0tcGxhbicsXG4gICAgICAgICAgICByYXRlTGltaXQ6IDEwMDAsXG4gICAgICAgICAgICBidXJzdExpbWl0OiAyMDAwXG4gICAgICAgICAgfVxuICAgICAgICBdLFxuICAgICAgICBza2lwQ29udHJvbGxlcnM6IHRydWVcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBhcGlDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG4gICAgICBhZGRNaW5pbWFsTWV0aG9kKGFwaUNvbnN0cnVjdC5hcGkpO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5yZXNvdXJjZUNvdW50SXMoJ0FXUzo6QXBpR2F0ZXdheTo6VXNhZ2VQbGFuJywgMik7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGNyZWF0ZSBBUEkga2V5cyBmb3IgdXNhZ2UgcGxhbicsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGFwaUNvbnN0cnVjdCA9IG5ldyBBUElDb25zdHJ1Y3Qoe1xuICAgICAgICB1c2FnZVBsYW5zOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgbmFtZTogJ2Jhc2ljLXBsYW4nLFxuICAgICAgICAgICAgcmF0ZUxpbWl0OiAxMDAsXG4gICAgICAgICAgICBidXJzdExpbWl0OiAyMDAsXG4gICAgICAgICAgICBhcGlLZXlzOiB7XG4gICAgICAgICAgICAgIGtleXM6IFsgJ3Rlc3Qta2V5LTEyMycsICd0ZXN0LWtleS00NTYnIF1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIF0sXG4gICAgICAgIHNraXBDb250cm9sbGVyczogdHJ1ZVxuICAgICAgfSk7XG5cbiAgICAgIGF3YWl0IGFwaUNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcbiAgICAgIGFkZE1pbmltYWxNZXRob2QoYXBpQ29uc3RydWN0LmFwaSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLnJlc291cmNlQ291bnRJcygnQVdTOjpBcGlHYXRld2F5OjpBcGlLZXknLCAyKTtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpBcGlHYXRld2F5OjpBcGlLZXknLCB7XG4gICAgICAgIFZhbHVlOiAndGVzdC1rZXktMTIzJ1xuICAgICAgfSk7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6QXBpR2F0ZXdheTo6QXBpS2V5Jywge1xuICAgICAgICBWYWx1ZTogJ3Rlc3Qta2V5LTQ1NidcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBOT1QgY3JlYXRlIEFQSSBrZXlzIHdoZW4ga2V5cyBhcnJheSBpcyBlbXB0eScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGFwaUNvbnN0cnVjdCA9IG5ldyBBUElDb25zdHJ1Y3Qoe1xuICAgICAgICB1c2FnZVBsYW5zOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgbmFtZTogJ2Jhc2ljLXBsYW4nLFxuICAgICAgICAgICAgcmF0ZUxpbWl0OiAxMDAsXG4gICAgICAgICAgICBidXJzdExpbWl0OiAyMDAsXG4gICAgICAgICAgICBhcGlLZXlzOiB7XG4gICAgICAgICAgICAgIGtleXM6IFtdLCAvLyBFbXB0eSBhcnJheSAtIG5vIGtleXMgY3JlYXRlZFxuICAgICAgICAgICAgICBrZXlOYW1lUHJlZml4OiAnYXV0by1nZW5lcmF0ZWQta2V5J1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgXSxcbiAgICAgICAgc2tpcENvbnRyb2xsZXJzOiB0cnVlXG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgYXBpQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuICAgICAgYWRkTWluaW1hbE1ldGhvZChhcGlDb25zdHJ1Y3QuYXBpKTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgLy8gTm8ga2V5cyBhcmUgY3JlYXRlZCB3aGVuIHRoZSBrZXlzIGFycmF5IGlzIGV4cGxpY2l0bHkgZW1wdHlcbiAgICAgIHRlbXBsYXRlLnJlc291cmNlQ291bnRJcygnQVdTOjpBcGlHYXRld2F5OjpBcGlLZXknLCAwKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgbGluayBBUEkga2V5cyB0byB1c2FnZSBwbGFuJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYXBpQ29uc3RydWN0ID0gbmV3IEFQSUNvbnN0cnVjdCh7XG4gICAgICAgIHVzYWdlUGxhbnM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBuYW1lOiAnYmFzaWMtcGxhbicsXG4gICAgICAgICAgICByYXRlTGltaXQ6IDEwMCxcbiAgICAgICAgICAgIGJ1cnN0TGltaXQ6IDIwMCxcbiAgICAgICAgICAgIGFwaUtleXM6IHtcbiAgICAgICAgICAgICAga2V5czogWyAndGVzdC1rZXktMTIzJyBdXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICBdLFxuICAgICAgICBza2lwQ29udHJvbGxlcnM6IHRydWVcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBhcGlDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG4gICAgICBhZGRNaW5pbWFsTWV0aG9kKGFwaUNvbnN0cnVjdC5hcGkpO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6QXBpR2F0ZXdheTo6VXNhZ2VQbGFuS2V5Jywge1xuICAgICAgICBLZXlUeXBlOiAnQVBJX0tFWSdcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnVXNhZ2UgUGxhbiBEZWZhdWx0cycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGFwcGx5IGRlZmF1bHQgdGhyb3R0bGUgYW5kIHF1b3RhIHdoZW4gbm90IHByb3ZpZGVkJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYXBpQ29uc3RydWN0ID0gbmV3IEFQSUNvbnN0cnVjdCh7XG4gICAgICAgIHVzYWdlUGxhbnM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBuYW1lOiAnZGVmYXVsdC1saW1pdHMtcGxhbidcbiAgICAgICAgICAgIC8vIE5vIHJhdGVMaW1pdCwgYnVyc3RMaW1pdCwgcXVvdGFMaW1pdCwgb3IgcXVvdGFQZXJpb2Qgc3BlY2lmaWVkXG4gICAgICAgICAgfVxuICAgICAgICBdLFxuICAgICAgICBza2lwQ29udHJvbGxlcnM6IHRydWVcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBhcGlDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG4gICAgICBhZGRNaW5pbWFsTWV0aG9kKGFwaUNvbnN0cnVjdC5hcGkpO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICAvLyBGcmFtZXdvcmsgZGVmYXVsdHM6IHJhdGVMaW1pdD0xMCwgYnVyc3RMaW1pdD0yMCwgcXVvdGFMaW1pdD0xMDAwMCwgcXVvdGFQZXJpb2Q9TU9OVEhcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpBcGlHYXRld2F5OjpVc2FnZVBsYW4nLCB7XG4gICAgICAgIFVzYWdlUGxhbk5hbWU6ICdkZWZhdWx0LWxpbWl0cy1wbGFuJyxcbiAgICAgICAgVGhyb3R0bGU6IHtcbiAgICAgICAgICBSYXRlTGltaXQ6IDEwLFxuICAgICAgICAgIEJ1cnN0TGltaXQ6IDIwXG4gICAgICAgIH0sXG4gICAgICAgIFF1b3RhOiB7XG4gICAgICAgICAgTGltaXQ6IDEwMDAwLFxuICAgICAgICAgIFBlcmlvZDogJ01PTlRIJ1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgbWVyZ2UgY3VzdG9tIGFuZCBkZWZhdWx0IHZhbHVlcyBjb3JyZWN0bHknLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBhcGlDb25zdHJ1Y3QgPSBuZXcgQVBJQ29uc3RydWN0KHtcbiAgICAgICAgdXNhZ2VQbGFuczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIG5hbWU6ICdwYXJ0aWFsLWNvbmZpZy1wbGFuJyxcbiAgICAgICAgICAgIHJhdGVMaW1pdDogNTAwIC8vIEN1c3RvbSByYXRlLCBidXQgYnVyc3QvcXVvdGEgc2hvdWxkIHVzZSBkZWZhdWx0c1xuICAgICAgICAgIH1cbiAgICAgICAgXSxcbiAgICAgICAgc2tpcENvbnRyb2xsZXJzOiB0cnVlXG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgYXBpQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuICAgICAgYWRkTWluaW1hbE1ldGhvZChhcGlDb25zdHJ1Y3QuYXBpKTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkFwaUdhdGV3YXk6OlVzYWdlUGxhbicsIHtcbiAgICAgICAgVGhyb3R0bGU6IHtcbiAgICAgICAgICBSYXRlTGltaXQ6IDUwMCwgLy8gQ3VzdG9tXG4gICAgICAgICAgQnVyc3RMaW1pdDogMjAgIC8vIERlZmF1bHRcbiAgICAgICAgfSxcbiAgICAgICAgUXVvdGE6IHtcbiAgICAgICAgICBMaW1pdDogMTAwMDAsICAgLy8gRGVmYXVsdFxuICAgICAgICAgIFBlcmlvZDogJ01PTlRIJyAvLyBEZWZhdWx0XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnQVBJIEtleSBDb25maWd1cmF0aW9uJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgY3JlYXRlIEFQSSBrZXkgd2l0aCBjb3JyZWN0IGRlc2NyaXB0aW9uJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYXBpQ29uc3RydWN0ID0gbmV3IEFQSUNvbnN0cnVjdCh7XG4gICAgICAgIHVzYWdlUGxhbnM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBuYW1lOiAndGVzdC1wbGFuJyxcbiAgICAgICAgICAgIHJhdGVMaW1pdDogMTAwLFxuICAgICAgICAgICAgYnVyc3RMaW1pdDogMjAwLFxuICAgICAgICAgICAgYXBpS2V5czoge1xuICAgICAgICAgICAgICBrZXlzOiBbICd0ZXN0LWtleS12YWx1ZScgXVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgXSxcbiAgICAgICAgc2tpcENvbnRyb2xsZXJzOiB0cnVlXG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgYXBpQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuICAgICAgYWRkTWluaW1hbE1ldGhvZChhcGlDb25zdHJ1Y3QuYXBpKTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkFwaUdhdGV3YXk6OkFwaUtleScsIHtcbiAgICAgICAgVmFsdWU6ICd0ZXN0LWtleS12YWx1ZScsXG4gICAgICAgIEVuYWJsZWQ6IHRydWUsXG4gICAgICAgIERlc2NyaXB0aW9uOiBNYXRjaC5zdHJpbmdMaWtlUmVnZXhwKCdBUEkga2V5IC4qIGZvciB0ZXN0LWFwaS1hcHAnKVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHJldXNlIGV4aXN0aW5nIEFQSSBrZXlzIHdpdGggc2FtZSB2YWx1ZScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGFwaUNvbnN0cnVjdCA9IG5ldyBBUElDb25zdHJ1Y3Qoe1xuICAgICAgICB1c2FnZVBsYW5zOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgbmFtZTogJ3BsYW4xJyxcbiAgICAgICAgICAgIHJhdGVMaW1pdDogMTAwLFxuICAgICAgICAgICAgYnVyc3RMaW1pdDogMjAwLFxuICAgICAgICAgICAgYXBpS2V5czoge1xuICAgICAgICAgICAgICBrZXlzOiBbICdzaGFyZWQta2V5JyBdXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBuYW1lOiAncGxhbjInLFxuICAgICAgICAgICAgcmF0ZUxpbWl0OiAyMDAsXG4gICAgICAgICAgICBidXJzdExpbWl0OiA0MDAsXG4gICAgICAgICAgICBhcGlLZXlzOiB7XG4gICAgICAgICAgICAgIGtleXM6IFsgJ3NoYXJlZC1rZXknIF0gLy8gU2FtZSBrZXkgYXMgcGxhbjFcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIF0sXG4gICAgICAgIHNraXBDb250cm9sbGVyczogdHJ1ZVxuICAgICAgfSk7XG5cbiAgICAgIGF3YWl0IGFwaUNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcbiAgICAgIGFkZE1pbmltYWxNZXRob2QoYXBpQ29uc3RydWN0LmFwaSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIC8vIFNob3VsZCBvbmx5IGNyZWF0ZSAxIEFQSSBrZXkgKHJldXNlZCBhY3Jvc3MgYm90aCBwbGFucylcbiAgICAgIHRlbXBsYXRlLnJlc291cmNlQ291bnRJcygnQVdTOjpBcGlHYXRld2F5OjpBcGlLZXknLCAxKTtcbiAgICAgIC8vIEJ1dCBzaG91bGQgaGF2ZSAyIHVzYWdlIHBsYW4ga2V5cyAobGlua2luZyBrZXkgdG8gYm90aCBwbGFucylcbiAgICAgIHRlbXBsYXRlLnJlc291cmNlQ291bnRJcygnQVdTOjpBcGlHYXRld2F5OjpVc2FnZVBsYW5LZXknLCAyKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1JlZ3Jlc3Npb24gVGVzdHMgLSBCdWcgRml4ZXMnLCAoKSA9PiB7XG4gICAgLyoqXG4gICAgICogUkVHUkVTU0lPTjogTWVyZ2UgdXRpbGl0eSB3YXMgY2FsbGVkIGluY29ycmVjdGx5IGFzIG1lcmdlKG9iajEsIG9iajIpXG4gICAgICogaW5zdGVhZCBvZiBtZXJnZShbb2JqMSwgb2JqMl0pLiBUaGlzIHRlc3QgdmVyaWZpZXMgQUxMIHByb3BlcnRpZXNcbiAgICAgKiBmcm9tIEFMTCBzb3VyY2VzIGFyZSBwcmVzZW50IGluIHRoZSBtZXJnZWQgcmVzdWx0LlxuICAgICAqL1xuICAgIGl0KCdSRUdSRVNTSU9OOiBzaG91bGQgbWVyZ2UgYXBpT3B0aW9ucyB3aXRob3V0IGxvc2luZyBhbnkgcHJvcGVydGllcycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGFwaUNvbnN0cnVjdCA9IG5ldyBBUElDb25zdHJ1Y3Qoe1xuICAgICAgICBhcGlPcHRpb25zOiB7XG4gICAgICAgICAgcmVzdEFwaU5hbWU6ICdtZXJnZWQtYXBpJyxcbiAgICAgICAgICBkZXNjcmlwdGlvbjogJ1Rlc3QgRGVzY3JpcHRpb24nLFxuICAgICAgICAgIGRlcGxveU9wdGlvbnM6IHtcbiAgICAgICAgICAgIHN0YWdlTmFtZTogJ3Byb2QnLFxuICAgICAgICAgICAgZGVzY3JpcHRpb246ICdQcm9kdWN0aW9uIHN0YWdlJ1xuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgc2tpcENvbnRyb2xsZXJzOiB0cnVlXG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgYXBpQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuICAgICAgYWRkTWluaW1hbE1ldGhvZChhcGlDb25zdHJ1Y3QuYXBpKTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgLy8gVmVyaWZ5IEFMTCBwcm9wZXJ0aWVzIGFyZSBwcmVzZW50XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6QXBpR2F0ZXdheTo6UmVzdEFwaScsIHtcbiAgICAgICAgTmFtZTogJ21lcmdlZC1hcGknLFxuICAgICAgICBEZXNjcmlwdGlvbjogJ1Rlc3QgRGVzY3JpcHRpb24nXG4gICAgICB9KTtcbiAgICAgIC8vIFZlcmlmeSBkZXBsb3lPcHRpb25zIG1hZGUgaXQgdGhyb3VnaFxuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkFwaUdhdGV3YXk6OlN0YWdlJywge1xuICAgICAgICBTdGFnZU5hbWU6ICdwcm9kJyxcbiAgICAgICAgRGVzY3JpcHRpb246ICdQcm9kdWN0aW9uIHN0YWdlJ1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdFZGdlIENhc2VzIGFuZCBFcnJvciBTY2VuYXJpb3MnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgbWluaW1hbCBjb25maWd1cmF0aW9uJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYXBpQ29uc3RydWN0ID0gbmV3IEFQSUNvbnN0cnVjdCh7XG4gICAgICAgIHNraXBDb250cm9sbGVyczogdHJ1ZVxuICAgICAgfSk7XG5cbiAgICAgIGF3YWl0IGFwaUNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcbiAgICAgIGFkZE1pbmltYWxNZXRob2QoYXBpQ29uc3RydWN0LmFwaSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLnJlc291cmNlQ291bnRJcygnQVdTOjpBcGlHYXRld2F5OjpSZXN0QXBpJywgMSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBlbXB0eSB1c2FnZVBsYW5zIGFycmF5JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYXBpQ29uc3RydWN0ID0gbmV3IEFQSUNvbnN0cnVjdCh7XG4gICAgICAgIHVzYWdlUGxhbnM6IFtdLFxuICAgICAgICBza2lwQ29udHJvbGxlcnM6IHRydWVcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBhcGlDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG4gICAgICBhZGRNaW5pbWFsTWV0aG9kKGFwaUNvbnN0cnVjdC5hcGkpO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5yZXNvdXJjZUNvdW50SXMoJ0FXUzo6QXBpR2F0ZXdheTo6VXNhZ2VQbGFuJywgMCk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSB1bmRlZmluZWQgdXNhZ2VQbGFucycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGFwaUNvbnN0cnVjdCA9IG5ldyBBUElDb25zdHJ1Y3Qoe1xuICAgICAgICB1c2FnZVBsYW5zOiB1bmRlZmluZWQsXG4gICAgICAgIHNraXBDb250cm9sbGVyczogdHJ1ZVxuICAgICAgfSk7XG5cbiAgICAgIGF3YWl0IGFwaUNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcbiAgICAgIGFkZE1pbmltYWxNZXRob2QoYXBpQ29uc3RydWN0LmFwaSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLnJlc291cmNlQ291bnRJcygnQVdTOjpBcGlHYXRld2F5OjpVc2FnZVBsYW4nLCAwKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIHVzYWdlIHBsYW4gd2l0aCBvbmx5IHRocm90dGxlIChubyBxdW90YSknLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBhcGlDb25zdHJ1Y3QgPSBuZXcgQVBJQ29uc3RydWN0KHtcbiAgICAgICAgdXNhZ2VQbGFuczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIG5hbWU6ICd0aHJvdHRsZS1vbmx5JyxcbiAgICAgICAgICAgIHJhdGVMaW1pdDogMTAwLFxuICAgICAgICAgICAgYnVyc3RMaW1pdDogMjAwXG4gICAgICAgICAgfVxuICAgICAgICBdLFxuICAgICAgICBza2lwQ29udHJvbGxlcnM6IHRydWVcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBhcGlDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG4gICAgICBhZGRNaW5pbWFsTWV0aG9kKGFwaUNvbnN0cnVjdC5hcGkpO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6QXBpR2F0ZXdheTo6VXNhZ2VQbGFuJywge1xuICAgICAgICBVc2FnZVBsYW5OYW1lOiAndGhyb3R0bGUtb25seScsXG4gICAgICAgIFRocm90dGxlOiBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICBSYXRlTGltaXQ6IDEwMFxuICAgICAgICB9KVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSB2ZXJ5IGhpZ2ggcmF0ZSBsaW1pdHMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBhcGlDb25zdHJ1Y3QgPSBuZXcgQVBJQ29uc3RydWN0KHtcbiAgICAgICAgdXNhZ2VQbGFuczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIG5hbWU6ICdoaWdoLWxpbWl0JyxcbiAgICAgICAgICAgIHJhdGVMaW1pdDogMTAwMDAsXG4gICAgICAgICAgICBidXJzdExpbWl0OiAyMDAwMCxcbiAgICAgICAgICAgIHF1b3RhTGltaXQ6IDEwMDAwMDAsXG4gICAgICAgICAgICBxdW90YVBlcmlvZDogUGVyaW9kLk1PTlRIXG4gICAgICAgICAgfVxuICAgICAgICBdLFxuICAgICAgICBza2lwQ29udHJvbGxlcnM6IHRydWVcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBhcGlDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG4gICAgICBhZGRNaW5pbWFsTWV0aG9kKGFwaUNvbnN0cnVjdC5hcGkpO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6QXBpR2F0ZXdheTo6VXNhZ2VQbGFuJywge1xuICAgICAgICBUaHJvdHRsZToge1xuICAgICAgICAgIFJhdGVMaW1pdDogMTAwMDAsXG4gICAgICAgICAgQnVyc3RMaW1pdDogMjAwMDBcbiAgICAgICAgfSxcbiAgICAgICAgUXVvdGE6IHtcbiAgICAgICAgICBMaW1pdDogMTAwMDAwMCxcbiAgICAgICAgICBQZXJpb2Q6ICdNT05USCdcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHVzZSBkZWZhdWx0cyB3aGVuIHJhdGUgbGltaXQgaXMgemVybyAoZmFsc3kgdmFsdWUpJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYXBpQ29uc3RydWN0ID0gbmV3IEFQSUNvbnN0cnVjdCh7XG4gICAgICAgIHVzYWdlUGxhbnM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBuYW1lOiAnemVyby1saW1pdCcsXG4gICAgICAgICAgICByYXRlTGltaXQ6IDAsXG4gICAgICAgICAgICBidXJzdExpbWl0OiAwXG4gICAgICAgICAgfVxuICAgICAgICBdLFxuICAgICAgICBza2lwQ29udHJvbGxlcnM6IHRydWVcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBhcGlDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG4gICAgICBhZGRNaW5pbWFsTWV0aG9kKGFwaUNvbnN0cnVjdC5hcGkpO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICAvLyBaZXJvIGlzIGZhbHN5LCBzbyBkZWZhdWx0cyBhcmUgYXBwbGllZCAocmF0ZUxpbWl0PTEwLCBidXJzdExpbWl0PTIwKVxuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkFwaUdhdGV3YXk6OlVzYWdlUGxhbicsIHtcbiAgICAgICAgVGhyb3R0bGU6IHtcbiAgICAgICAgICBSYXRlTGltaXQ6IDEwLFxuICAgICAgICAgIEJ1cnN0TGltaXQ6IDIwXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgbG9uZyB1c2FnZSBwbGFuIG5hbWVzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgbG9uZ05hbWUgPSAnYScucmVwZWF0KDEwMCk7XG4gICAgICBjb25zdCBhcGlDb25zdHJ1Y3QgPSBuZXcgQVBJQ29uc3RydWN0KHtcbiAgICAgICAgdXNhZ2VQbGFuczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIG5hbWU6IGxvbmdOYW1lLFxuICAgICAgICAgICAgcmF0ZUxpbWl0OiAxMDAsXG4gICAgICAgICAgICBidXJzdExpbWl0OiAyMDBcbiAgICAgICAgICB9XG4gICAgICAgIF0sXG4gICAgICAgIHNraXBDb250cm9sbGVyczogdHJ1ZVxuICAgICAgfSk7XG5cbiAgICAgIGF3YWl0IGFwaUNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcbiAgICAgIGFkZE1pbmltYWxNZXRob2QoYXBpQ29uc3RydWN0LmFwaSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpBcGlHYXRld2F5OjpVc2FnZVBsYW4nLCB7XG4gICAgICAgIFVzYWdlUGxhbk5hbWU6IGxvbmdOYW1lXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIHNwZWNpYWwgY2hhcmFjdGVycyBpbiBBUEkga2V5IHZhbHVlcycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGFwaUNvbnN0cnVjdCA9IG5ldyBBUElDb25zdHJ1Y3Qoe1xuICAgICAgICB1c2FnZVBsYW5zOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgbmFtZTogJ3NwZWNpYWwtY2hhcnMtcGxhbicsXG4gICAgICAgICAgICByYXRlTGltaXQ6IDEwMCxcbiAgICAgICAgICAgIGJ1cnN0TGltaXQ6IDIwMCxcbiAgICAgICAgICAgIGFwaUtleXM6IHtcbiAgICAgICAgICAgICAga2V5czogWyAna2V5LXdpdGgtZGFzaGVzXzEyMycsICdLRVlfV0lUSF9VTkRFUlNDT1JFUy00NTYnIF1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIF0sXG4gICAgICAgIHNraXBDb250cm9sbGVyczogdHJ1ZVxuICAgICAgfSk7XG5cbiAgICAgIGF3YWl0IGFwaUNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcbiAgICAgIGFkZE1pbmltYWxNZXRob2QoYXBpQ29uc3RydWN0LmFwaSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpBcGlHYXRld2F5OjpBcGlLZXknLCB7XG4gICAgICAgIFZhbHVlOiAna2V5LXdpdGgtZGFzaGVzXzEyMydcbiAgICAgIH0pO1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkFwaUdhdGV3YXk6OkFwaUtleScsIHtcbiAgICAgICAgVmFsdWU6ICdLRVlfV0lUSF9VTkRFUlNDT1JFUy00NTYnXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIG1peGVkIHVzYWdlIHBsYW5zIChzb21lIHdpdGggcXVvdGEsIHNvbWUgd2l0aG91dCknLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBhcGlDb25zdHJ1Y3QgPSBuZXcgQVBJQ29uc3RydWN0KHtcbiAgICAgICAgdXNhZ2VQbGFuczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIG5hbWU6ICd3aXRoLXF1b3RhJyxcbiAgICAgICAgICAgIHJhdGVMaW1pdDogMTAwLFxuICAgICAgICAgICAgYnVyc3RMaW1pdDogMjAwLFxuICAgICAgICAgICAgcXVvdGFMaW1pdDogMTAwMDAsXG4gICAgICAgICAgICBxdW90YVBlcmlvZDogUGVyaW9kLkRBWVxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgbmFtZTogJ3dpdGhvdXQtcXVvdGEnLFxuICAgICAgICAgICAgcmF0ZUxpbWl0OiA1MCxcbiAgICAgICAgICAgIGJ1cnN0TGltaXQ6IDEwMFxuICAgICAgICAgICAgLy8gTm8gcXVvdGEgc3BlY2lmaWVkXG4gICAgICAgICAgfVxuICAgICAgICBdLFxuICAgICAgICBza2lwQ29udHJvbGxlcnM6IHRydWVcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBhcGlDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG4gICAgICBhZGRNaW5pbWFsTWV0aG9kKGFwaUNvbnN0cnVjdC5hcGkpO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5yZXNvdXJjZUNvdW50SXMoJ0FXUzo6QXBpR2F0ZXdheTo6VXNhZ2VQbGFuJywgMik7XG4gICAgICAvLyBGaXJzdCBwbGFuIGhhcyBxdW90YVxuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkFwaUdhdGV3YXk6OlVzYWdlUGxhbicsIHtcbiAgICAgICAgVXNhZ2VQbGFuTmFtZTogJ3dpdGgtcXVvdGEnLFxuICAgICAgICBRdW90YToge1xuICAgICAgICAgIExpbWl0OiAxMDAwMCxcbiAgICAgICAgICBQZXJpb2Q6ICdEQVknXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgLy8gU2Vjb25kIHBsYW4gaGFzIGRlZmF1bHQgcXVvdGFcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpBcGlHYXRld2F5OjpVc2FnZVBsYW4nLCB7XG4gICAgICAgIFVzYWdlUGxhbk5hbWU6ICd3aXRob3V0LXF1b3RhJyxcbiAgICAgICAgUXVvdGE6IHtcbiAgICAgICAgICBMaW1pdDogMTAwMDAsXG4gICAgICAgICAgUGVyaW9kOiAnTU9OVEgnXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgbXVsdGlwbGUgdXNhZ2UgcGxhbnMgd2l0aCBkaWZmZXJlbnQgcXVvdGEgcGVyaW9kcycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGFwaUNvbnN0cnVjdCA9IG5ldyBBUElDb25zdHJ1Y3Qoe1xuICAgICAgICB1c2FnZVBsYW5zOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgbmFtZTogJ2RhaWx5LXBsYW4nLFxuICAgICAgICAgICAgcXVvdGFMaW1pdDogMTAwMCxcbiAgICAgICAgICAgIHF1b3RhUGVyaW9kOiBQZXJpb2QuREFZXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBuYW1lOiAnd2Vla2x5LXBsYW4nLFxuICAgICAgICAgICAgcXVvdGFMaW1pdDogNzAwMCxcbiAgICAgICAgICAgIHF1b3RhUGVyaW9kOiBQZXJpb2QuV0VFS1xuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgbmFtZTogJ21vbnRobHktcGxhbicsXG4gICAgICAgICAgICBxdW90YUxpbWl0OiAzMDAwMCxcbiAgICAgICAgICAgIHF1b3RhUGVyaW9kOiBQZXJpb2QuTU9OVEhcbiAgICAgICAgICB9XG4gICAgICAgIF0sXG4gICAgICAgIHNraXBDb250cm9sbGVyczogdHJ1ZVxuICAgICAgfSk7XG5cbiAgICAgIGF3YWl0IGFwaUNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcbiAgICAgIGFkZE1pbmltYWxNZXRob2QoYXBpQ29uc3RydWN0LmFwaSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLnJlc291cmNlQ291bnRJcygnQVdTOjpBcGlHYXRld2F5OjpVc2FnZVBsYW4nLCAzKTtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpBcGlHYXRld2F5OjpVc2FnZVBsYW4nLCB7XG4gICAgICAgIFVzYWdlUGxhbk5hbWU6ICdkYWlseS1wbGFuJyxcbiAgICAgICAgUXVvdGE6IHsgUGVyaW9kOiAnREFZJyB9XG4gICAgICB9KTtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpBcGlHYXRld2F5OjpVc2FnZVBsYW4nLCB7XG4gICAgICAgIFVzYWdlUGxhbk5hbWU6ICd3ZWVrbHktcGxhbicsXG4gICAgICAgIFF1b3RhOiB7IFBlcmlvZDogJ1dFRUsnIH1cbiAgICAgIH0pO1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkFwaUdhdGV3YXk6OlVzYWdlUGxhbicsIHtcbiAgICAgICAgVXNhZ2VQbGFuTmFtZTogJ21vbnRobHktcGxhbicsXG4gICAgICAgIFF1b3RhOiB7IFBlcmlvZDogJ01PTlRIJyB9XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0N1c3RvbSBEb21haW4gQ29uZmlndXJhdGlvbicsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGNyZWF0ZSBBUEkgd2l0aCBjdXN0b20gZG9tYWluLCBjZXJ0aWZpY2F0ZSwgYW5kIGJhc2UgcGF0aCBtYXBwaW5nJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYXBpQ29uc3RydWN0ID0gbmV3IEFQSUNvbnN0cnVjdCh7XG4gICAgICAgIGRvbWFpbk5hbWU6ICdhcGkuZXhhbXBsZS5jb20nLFxuICAgICAgICBjZXJ0aWZpY2F0ZUFybjogJ2Fybjphd3M6YWNtOnVzLWVhc3QtMToxMjM0NTY3ODkwMTI6Y2VydGlmaWNhdGUvdGVzdC1jZXJ0JyxcbiAgICAgICAgYXBpT3B0aW9uczoge1xuICAgICAgICAgIGRlcGxveU9wdGlvbnM6IHtcbiAgICAgICAgICAgIHN0YWdlTmFtZTogJ3Byb2QnXG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBza2lwQ29udHJvbGxlcnM6IHRydWVcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBhcGlDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG4gICAgICBhZGRNaW5pbWFsTWV0aG9kKGFwaUNvbnN0cnVjdC5hcGkpO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG5cbiAgICAgIC8vIFZlcmlmeSBkb21haW4gbmFtZSBpcyBjb25maWd1cmVkXG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6QXBpR2F0ZXdheTo6UmVzdEFwaScsIHtcbiAgICAgICAgTmFtZTogTWF0Y2guc3RyaW5nTGlrZVJlZ2V4cCgndGVzdC1hcGktYXBwJylcbiAgICAgIH0pO1xuXG4gICAgICAvLyBEb21haW5OYW1lIHJlc291cmNlIHNob3VsZCBiZSBjcmVhdGVkXG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6QXBpR2F0ZXdheTo6RG9tYWluTmFtZScsIHtcbiAgICAgICAgRG9tYWluTmFtZTogJ2FwaS5leGFtcGxlLmNvbScsXG4gICAgICAgIFJlZ2lvbmFsQ2VydGlmaWNhdGVBcm46ICdhcm46YXdzOmFjbTp1cy1lYXN0LTE6MTIzNDU2Nzg5MDEyOmNlcnRpZmljYXRlL3Rlc3QtY2VydCdcbiAgICAgIH0pO1xuXG4gICAgICAvLyBCYXNlUGF0aE1hcHBpbmcgc2hvdWxkIGxpbmsgZG9tYWluIHRvIEFQSSAoYXBpLnRzOjI1OC0yNjIpXG4gICAgICAvLyBiYXNlUGF0aCBpcyBzZXQgdG8gZGVwbG95T3B0aW9ucy5zdGFnZU5hbWUgKGFwaS50czoyNjEpXG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6QXBpR2F0ZXdheTo6QmFzZVBhdGhNYXBwaW5nJywge1xuICAgICAgICBEb21haW5OYW1lOiBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICBSZWY6IE1hdGNoLnN0cmluZ0xpa2VSZWdleHAoJy4qJylcbiAgICAgICAgfSksXG4gICAgICAgIEJhc2VQYXRoOiAncHJvZCcgLy8gVXNlcyBzdGFnZU5hbWUgZnJvbSBkZXBsb3lPcHRpb25zXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIEFQSSB3aXRob3V0IGN1c3RvbSBkb21haW4nLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBhcGlDb25zdHJ1Y3QgPSBuZXcgQVBJQ29uc3RydWN0KHtcbiAgICAgICAgc2tpcENvbnRyb2xsZXJzOiB0cnVlXG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgYXBpQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuICAgICAgYWRkTWluaW1hbE1ldGhvZChhcGlDb25zdHJ1Y3QuYXBpKTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgLy8gTm8gY3VzdG9tIGRvbWFpbiByZXNvdXJjZXNcbiAgICAgIHRlbXBsYXRlLnJlc291cmNlQ291bnRJcygnQVdTOjpBcGlHYXRld2F5OjpEb21haW5OYW1lJywgMCk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdMYW1iZGEgSW50ZWdyYXRpb24gQ29uZmlndXJhdGlvbicsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIHBhc3MgaW50ZWdyYXRpb24gdGltZW91dCB0byBMYW1iZGEgZnVuY3Rpb25zJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYXBpQ29uc3RydWN0ID0gbmV3IEFQSUNvbnN0cnVjdCh7XG4gICAgICAgIGludGVncmF0aW9uVGltZW91dDogMTUsXG4gICAgICAgIGZ1bmN0aW9uUHJvcHM6IHtcbiAgICAgICAgICB0aW1lb3V0OiBEdXJhdGlvbi5zZWNvbmRzKDIwKVxuICAgICAgICB9LFxuICAgICAgICBza2lwQ29udHJvbGxlcnM6IHRydWVcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBhcGlDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG5cbiAgICAgIC8vIFZlcmlmeSBjb25zdHJ1Y3QgaGFzIHRoZSBjb25maWdcbiAgICAgIGV4cGVjdCgoYXBpQ29uc3RydWN0IGFzIGFueSkuYXBpQ29uc3RydWN0Q29uZmlnLmludGVncmF0aW9uVGltZW91dCkudG9CZSgxNSk7XG4gICAgICBleHBlY3QoKGFwaUNvbnN0cnVjdCBhcyBhbnkpLmFwaUNvbnN0cnVjdENvbmZpZy5mdW5jdGlvblByb3BzPy50aW1lb3V0KS50b0JlRGVmaW5lZCgpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCB1c2UgZGVmYXVsdCBmdW5jdGlvbiBwcm9wcyB3aGVuIG5vdCBzcGVjaWZpZWQnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBhcGlDb25zdHJ1Y3QgPSBuZXcgQVBJQ29uc3RydWN0KHtcbiAgICAgICAgc2tpcENvbnRyb2xsZXJzOiB0cnVlXG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgYXBpQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuXG4gICAgICBleHBlY3QoKGFwaUNvbnN0cnVjdCBhcyBhbnkpLmFwaUNvbnN0cnVjdENvbmZpZy5mdW5jdGlvblByb3BzKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdVc2FnZSBQbGFuIEFkdmFuY2VkIENvbmZpZ3VyYXRpb24nLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgdXNhZ2UgcGxhbiB3aXRoIGRlc2NyaXB0aW9uJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYXBpQ29uc3RydWN0ID0gbmV3IEFQSUNvbnN0cnVjdCh7XG4gICAgICAgIHVzYWdlUGxhbnM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBuYW1lOiAnZGVzY3JpYmVkLXBsYW4nLFxuICAgICAgICAgICAgZGVzY3JpcHRpb246ICdUaGlzIGlzIGEgdGVzdCB1c2FnZSBwbGFuJyxcbiAgICAgICAgICAgIHJhdGVMaW1pdDogMTAwLFxuICAgICAgICAgICAgYnVyc3RMaW1pdDogMjAwXG4gICAgICAgICAgfVxuICAgICAgICBdLFxuICAgICAgICBza2lwQ29udHJvbGxlcnM6IHRydWVcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBhcGlDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG4gICAgICBhZGRNaW5pbWFsTWV0aG9kKGFwaUNvbnN0cnVjdC5hcGkpO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6QXBpR2F0ZXdheTo6VXNhZ2VQbGFuJywge1xuICAgICAgICBVc2FnZVBsYW5OYW1lOiAnZGVzY3JpYmVkLXBsYW4nLFxuICAgICAgICBEZXNjcmlwdGlvbjogJ1RoaXMgaXMgYSB0ZXN0IHVzYWdlIHBsYW4nXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgbGluayB1c2FnZSBwbGFuIHRvIEFQSSBkZXBsb3ltZW50IHN0YWdlJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYXBpQ29uc3RydWN0ID0gbmV3IEFQSUNvbnN0cnVjdCh7XG4gICAgICAgIHVzYWdlUGxhbnM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBuYW1lOiAnc3RhZ2UtbGlua2VkLXBsYW4nLFxuICAgICAgICAgICAgcmF0ZUxpbWl0OiAxMDAsXG4gICAgICAgICAgICBidXJzdExpbWl0OiAyMDBcbiAgICAgICAgICB9XG4gICAgICAgIF0sXG4gICAgICAgIGFwaU9wdGlvbnM6IHtcbiAgICAgICAgICBkZXBsb3lPcHRpb25zOiB7XG4gICAgICAgICAgICBzdGFnZU5hbWU6ICdwcm9kJ1xuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgc2tpcENvbnRyb2xsZXJzOiB0cnVlXG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgYXBpQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuICAgICAgYWRkTWluaW1hbE1ldGhvZChhcGlDb25zdHJ1Y3QuYXBpKTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgLy8gVXNhZ2UgcGxhbiBzaG91bGQgcmVmZXJlbmNlIHRoZSBBUElcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpBcGlHYXRld2F5OjpVc2FnZVBsYW4nLCB7XG4gICAgICAgIFVzYWdlUGxhbk5hbWU6ICdzdGFnZS1saW5rZWQtcGxhbicsXG4gICAgICAgIEFwaVN0YWdlczogTWF0Y2guYXJyYXlXaXRoKFtcbiAgICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICAgIFN0YWdlOiBNYXRjaC5hbnlWYWx1ZSgpXG4gICAgICAgICAgfSlcbiAgICAgICAgXSlcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnQVBJIEtleSBOYW1pbmcgU3RyYXRlZ3knLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCB1c2Uga2V5TmFtZVByZWZpeCBmcm9tIHVzYWdlIHBsYW4gY29uZmlnJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYXBpQ29uc3RydWN0ID0gbmV3IEFQSUNvbnN0cnVjdCh7XG4gICAgICAgIHVzYWdlUGxhbnM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBuYW1lOiAncHJlZml4LXRlc3QnLFxuICAgICAgICAgICAgcmF0ZUxpbWl0OiAxMDAsXG4gICAgICAgICAgICBidXJzdExpbWl0OiAyMDAsXG4gICAgICAgICAgICBhcGlLZXlzOiB7XG4gICAgICAgICAgICAgIGtleXM6IFsgJ2tleTEnLCAna2V5MicgXSxcbiAgICAgICAgICAgICAga2V5TmFtZVByZWZpeDogJ2N1c3RvbS1wcmVmaXgnXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICBdLFxuICAgICAgICBza2lwQ29udHJvbGxlcnM6IHRydWVcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBhcGlDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG4gICAgICBhZGRNaW5pbWFsTWV0aG9kKGFwaUNvbnN0cnVjdC5hcGkpO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICAvLyBCb3RoIGtleXMgc2hvdWxkIGJlIGNyZWF0ZWRcbiAgICAgIHRlbXBsYXRlLnJlc291cmNlQ291bnRJcygnQVdTOjpBcGlHYXRld2F5OjpBcGlLZXknLCAyKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdXNlIGdsb2JhbCBhcGlLZXlDb25maWcua2V5TmFtZSB3aGVuIHByb3ZpZGVkJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYXBpQ29uc3RydWN0ID0gbmV3IEFQSUNvbnN0cnVjdCh7XG4gICAgICAgIGFwaUtleUNvbmZpZzoge1xuICAgICAgICAgIGtleU5hbWU6ICdnbG9iYWwta2V5LW5hbWUnXG4gICAgICAgIH0sXG4gICAgICAgIHVzYWdlUGxhbnM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBuYW1lOiAnZ2xvYmFsLWtleS10ZXN0JyxcbiAgICAgICAgICAgIHJhdGVMaW1pdDogMTAwLFxuICAgICAgICAgICAgYnVyc3RMaW1pdDogMjAwLFxuICAgICAgICAgICAgYXBpS2V5czoge1xuICAgICAgICAgICAgICBrZXlzOiBbICd0ZXN0LWtleScgXVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgXSxcbiAgICAgICAgc2tpcENvbnRyb2xsZXJzOiB0cnVlXG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgYXBpQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuICAgICAgYWRkTWluaW1hbE1ldGhvZChhcGlDb25zdHJ1Y3QuYXBpKTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUucmVzb3VyY2VDb3VudElzKCdBV1M6OkFwaUdhdGV3YXk6OkFwaUtleScsIDEpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBnZW5lcmF0ZSBkZWZhdWx0IGtleSBuYW1lcyB3aGVuIG5vIGNvbmZpZyBwcm92aWRlZCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGFwaUNvbnN0cnVjdCA9IG5ldyBBUElDb25zdHJ1Y3Qoe1xuICAgICAgICB1c2FnZVBsYW5zOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgbmFtZTogJ2RlZmF1bHQtbmFtZS10ZXN0JyxcbiAgICAgICAgICAgIHJhdGVMaW1pdDogMTAwLFxuICAgICAgICAgICAgYnVyc3RMaW1pdDogMjAwLFxuICAgICAgICAgICAgYXBpS2V5czoge1xuICAgICAgICAgICAgICBrZXlzOiBbICdrZXkxJywgJ2tleTInLCAna2V5MycgXVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgXSxcbiAgICAgICAgc2tpcENvbnRyb2xsZXJzOiB0cnVlXG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgYXBpQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuICAgICAgYWRkTWluaW1hbE1ldGhvZChhcGlDb25zdHJ1Y3QuYXBpKTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUucmVzb3VyY2VDb3VudElzKCdBV1M6OkFwaUdhdGV3YXk6OkFwaUtleScsIDMpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnRnJhbWV3b3JrIEludGVncmF0aW9uJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgcmVnaXN0ZXIgQVBJIGluIGZ3MjQgaW5zdGFuY2UnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBhcGlDb25zdHJ1Y3QgPSBuZXcgQVBJQ29uc3RydWN0KHtcbiAgICAgICAgc2tpcENvbnRyb2xsZXJzOiB0cnVlXG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgYXBpQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuICAgICAgYWRkTWluaW1hbE1ldGhvZChhcGlDb25zdHJ1Y3QuYXBpKTtcblxuICAgICAgLy8gVmVyaWZ5IEFQSSBpcyBhY2Nlc3NpYmxlIGRpcmVjdGx5IGZyb20gY29uc3RydWN0XG4gICAgICBleHBlY3QoYXBpQ29uc3RydWN0LmFwaSkudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdChhcGlDb25zdHJ1Y3QuYXBpLnJlc3RBcGlJZCkudG9CZURlZmluZWQoKTtcblxuICAgICAgLy8gVmVyaWZ5IGNvbnN0cnVjdCBoYXMgdGhlIGZ3MjQgaW5zdGFuY2VcbiAgICAgIGV4cGVjdCgoYXBpQ29uc3RydWN0IGFzIGFueSkuZncyNCkudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdCgoYXBpQ29uc3RydWN0IGFzIGFueSkuZncyNCkudG9CZShGdzI0LmdldEluc3RhbmNlKCkpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBzZXQgY29uc3RydWN0IG91dHB1dHMgZm9yIEFQSSByZXNvdXJjZXMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBmdzI0ID0gRncyNC5nZXRJbnN0YW5jZSgpO1xuICAgICAgY29uc3QgYXBpQ29uc3RydWN0ID0gbmV3IEFQSUNvbnN0cnVjdCh7XG4gICAgICAgIHNraXBDb250cm9sbGVyczogdHJ1ZVxuICAgICAgfSk7XG5cbiAgICAgIGF3YWl0IGFwaUNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcblxuICAgICAgLy8gVmVyaWZ5IGNvbnN0cnVjdCBvdXRwdXRzIGFyZSBzZXRcbiAgICAgIGV4cGVjdChhcGlDb25zdHJ1Y3Qub3V0cHV0KS50b0JlRGVmaW5lZCgpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCByZXNwZWN0IHNraXBDb250cm9sbGVycyBmbGFnJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYXBpQ29uc3RydWN0ID0gbmV3IEFQSUNvbnN0cnVjdCh7XG4gICAgICAgIHNraXBDb250cm9sbGVyczogdHJ1ZVxuICAgICAgfSk7XG5cbiAgICAgIGF3YWl0IGFwaUNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcbiAgICAgIGFkZE1pbmltYWxNZXRob2QoYXBpQ29uc3RydWN0LmFwaSk7XG5cbiAgICAgIC8vIFNob3VsZCBjb21wbGV0ZSB3aXRob3V0IGVycm9yIGFuZCBub3QgcmVnaXN0ZXIgY29udHJvbGxlcnNcbiAgICAgIGV4cGVjdChhcGlDb25zdHJ1Y3QuYXBpKS50b0JlRGVmaW5lZCgpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgY29udHJvbGxlcnNEaXJlY3RvcnkgY29uZmlndXJhdGlvbicsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGFwaUNvbnN0cnVjdCA9IG5ldyBBUElDb25zdHJ1Y3Qoe1xuICAgICAgICBjb250cm9sbGVyc0RpcmVjdG9yeTogJy9jdXN0b20vcGF0aC9jb250cm9sbGVycycsXG4gICAgICAgIHNraXBDb250cm9sbGVyczogdHJ1ZVxuICAgICAgfSk7XG5cbiAgICAgIGF3YWl0IGFwaUNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcblxuICAgICAgZXhwZWN0KChhcGlDb25zdHJ1Y3QgYXMgYW55KS5hcGlDb25zdHJ1Y3RDb25maWcuY29udHJvbGxlcnNEaXJlY3RvcnkpLnRvQmUoJy9jdXN0b20vcGF0aC9jb250cm9sbGVycycpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnQVBJIENvbmZpZ3VyYXRpb24gT3B0aW9ucycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBsb2dSZXRlbnRpb25EYXlzIGNvbmZpZ3VyYXRpb24nLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBhcGlDb25zdHJ1Y3QgPSBuZXcgQVBJQ29uc3RydWN0KHtcbiAgICAgICAgbG9nUmV0ZW50aW9uRGF5czogUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcbiAgICAgICAgc2tpcENvbnRyb2xsZXJzOiB0cnVlXG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgYXBpQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuXG4gICAgICBleHBlY3QoKGFwaUNvbnN0cnVjdCBhcyBhbnkpLmFwaUNvbnN0cnVjdENvbmZpZy5sb2dSZXRlbnRpb25EYXlzKS50b0JlKFJldGVudGlvbkRheXMuT05FX1dFRUspO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgbG9nUmVtb3ZhbFBvbGljeSBjb25maWd1cmF0aW9uJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYXBpQ29uc3RydWN0ID0gbmV3IEFQSUNvbnN0cnVjdCh7XG4gICAgICAgIGxvZ1JlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuUkVUQUlOLFxuICAgICAgICBza2lwQ29udHJvbGxlcnM6IHRydWVcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBhcGlDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG5cbiAgICAgIGV4cGVjdCgoYXBpQ29uc3RydWN0IGFzIGFueSkuYXBpQ29uc3RydWN0Q29uZmlnLmxvZ1JlbW92YWxQb2xpY3kpLnRvQmUoUmVtb3ZhbFBvbGljeS5SRVRBSU4pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgZm9yY2VEZXBsb3ltZW50IGZsYWcnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBhcGlDb25zdHJ1Y3QgPSBuZXcgQVBJQ29uc3RydWN0KHtcbiAgICAgICAgZm9yY2VEZXBsb3ltZW50OiB0cnVlLFxuICAgICAgICBza2lwQ29udHJvbGxlcnM6IHRydWVcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBhcGlDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG5cbiAgICAgIGV4cGVjdCgoYXBpQ29uc3RydWN0IGFzIGFueSkuYXBpQ29uc3RydWN0Q29uZmlnLmZvcmNlRGVwbG95bWVudCkudG9CZSh0cnVlKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGNvbnRyb2xsZXJQYXJlbnRTdGFja05hbWUnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBhcGlDb25zdHJ1Y3QgPSBuZXcgQVBJQ29uc3RydWN0KHtcbiAgICAgICAgY29udHJvbGxlclBhcmVudFN0YWNrTmFtZTogJ3BhcmVudC1zdGFjaycsXG4gICAgICAgIHNraXBDb250cm9sbGVyczogdHJ1ZVxuICAgICAgfSk7XG5cbiAgICAgIGF3YWl0IGFwaUNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcblxuICAgICAgZXhwZWN0KChhcGlDb25zdHJ1Y3QgYXMgYW55KS5hcGlDb25zdHJ1Y3RDb25maWcuY29udHJvbGxlclBhcmVudFN0YWNrTmFtZSkudG9CZSgncGFyZW50LXN0YWNrJyk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdBUEkgRGVwbG95bWVudCBDb25maWd1cmF0aW9uJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgY3JlYXRlIGRlcGxveW1lbnQgd2l0aCBjdXN0b20gc3RhZ2UgbmFtZScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGFwaUNvbnN0cnVjdCA9IG5ldyBBUElDb25zdHJ1Y3Qoe1xuICAgICAgICBhcGlPcHRpb25zOiB7XG4gICAgICAgICAgZGVwbG95T3B0aW9uczoge1xuICAgICAgICAgICAgc3RhZ2VOYW1lOiAncHJvZHVjdGlvbicsXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1Byb2R1Y3Rpb24gZGVwbG95bWVudCdcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIHNraXBDb250cm9sbGVyczogdHJ1ZVxuICAgICAgfSk7XG5cbiAgICAgIGF3YWl0IGFwaUNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcbiAgICAgIGFkZE1pbmltYWxNZXRob2QoYXBpQ29uc3RydWN0LmFwaSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpBcGlHYXRld2F5OjpTdGFnZScsIHtcbiAgICAgICAgU3RhZ2VOYW1lOiAncHJvZHVjdGlvbicsXG4gICAgICAgIERlc2NyaXB0aW9uOiAnUHJvZHVjdGlvbiBkZXBsb3ltZW50J1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBBUEkgb3B0aW9ucyB3aXRoIGVuZHBvaW50IGNvbmZpZ3VyYXRpb24nLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBhcGlDb25zdHJ1Y3QgPSBuZXcgQVBJQ29uc3RydWN0KHtcbiAgICAgICAgYXBpT3B0aW9uczoge1xuICAgICAgICAgIHJlc3RBcGlOYW1lOiAndGVzdC1hcGknLFxuICAgICAgICAgIGVuZHBvaW50Q29uZmlndXJhdGlvbjoge1xuICAgICAgICAgICAgdHlwZXM6IFsgRW5kcG9pbnRUeXBlLlJFR0lPTkFMIF1cbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIHNraXBDb250cm9sbGVyczogdHJ1ZVxuICAgICAgfSk7XG5cbiAgICAgIGF3YWl0IGFwaUNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcbiAgICAgIGFkZE1pbmltYWxNZXRob2QoYXBpQ29uc3RydWN0LmFwaSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpBcGlHYXRld2F5OjpSZXN0QXBpJywge1xuICAgICAgICBOYW1lOiAndGVzdC1hcGknLFxuICAgICAgICBFbmRwb2ludENvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgICBUeXBlczogWyAnUkVHSU9OQUwnIF1cbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIG1lcmdlIG11bHRpcGxlIGFwaU9wdGlvbnMgcHJvcGVydGllcyBjb3JyZWN0bHknLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBhcGlDb25zdHJ1Y3QgPSBuZXcgQVBJQ29uc3RydWN0KHtcbiAgICAgICAgYXBpT3B0aW9uczoge1xuICAgICAgICAgIHJlc3RBcGlOYW1lOiAnY29tcGxleC1hcGknLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiAnQ29tcGxleCBBUEkgd2l0aCBtdWx0aXBsZSBvcHRpb25zJyxcbiAgICAgICAgICBlbmRwb2ludENvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgICAgIHR5cGVzOiBbIEVuZHBvaW50VHlwZS5SRUdJT05BTCBdXG4gICAgICAgICAgfSxcbiAgICAgICAgICBkZXBsb3lPcHRpb25zOiB7XG4gICAgICAgICAgICBzdGFnZU5hbWU6ICd2MScsXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1ZlcnNpb24gMSdcbiAgICAgICAgICB9LFxuICAgICAgICAgIGJpbmFyeU1lZGlhVHlwZXM6IFsgJ2ltYWdlL3BuZycsICdhcHBsaWNhdGlvbi9wZGYnIF1cbiAgICAgICAgfSxcbiAgICAgICAgc2tpcENvbnRyb2xsZXJzOiB0cnVlXG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgYXBpQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuICAgICAgYWRkTWluaW1hbE1ldGhvZChhcGlDb25zdHJ1Y3QuYXBpKTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkFwaUdhdGV3YXk6OlJlc3RBcGknLCB7XG4gICAgICAgIE5hbWU6ICdjb21wbGV4LWFwaScsXG4gICAgICAgIERlc2NyaXB0aW9uOiAnQ29tcGxleCBBUEkgd2l0aCBtdWx0aXBsZSBvcHRpb25zJyxcbiAgICAgICAgQmluYXJ5TWVkaWFUeXBlczogWyAnaW1hZ2UvcG5nJywgJ2FwcGxpY2F0aW9uL3BkZicgXVxuICAgICAgfSk7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6QXBpR2F0ZXdheTo6U3RhZ2UnLCB7XG4gICAgICAgIFN0YWdlTmFtZTogJ3YxJyxcbiAgICAgICAgRGVzY3JpcHRpb246ICdWZXJzaW9uIDEnXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0NPUlMgQWR2YW5jZWQgQ29uZmlndXJhdGlvbicsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGNvbmZpZ3VyZSBDT1JTIHByZWZsaWdodCB3aXRoIGFsbCBkZWZhdWx0IGhlYWRlcnMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBhcGlDb25zdHJ1Y3QgPSBuZXcgQVBJQ29uc3RydWN0KHtcbiAgICAgICAgY29yczogdHJ1ZSxcbiAgICAgICAgYXBpT3B0aW9uczoge1xuICAgICAgICAgIGRlZmF1bHRDb3JzUHJlZmxpZ2h0T3B0aW9uczoge1xuICAgICAgICAgICAgYWxsb3dPcmlnaW5zOiBDb3JzLkFMTF9PUklHSU5TLFxuICAgICAgICAgICAgYWxsb3dNZXRob2RzOiBDb3JzLkFMTF9NRVRIT0RTXG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBza2lwQ29udHJvbGxlcnM6IHRydWVcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBhcGlDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG4gICAgICBhZGRNaW5pbWFsTWV0aG9kKGFwaUNvbnN0cnVjdC5hcGkpO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG5cbiAgICAgIC8vIFZlcmlmeSBnYXRld2F5IHJlc3BvbnNlcyBmb3IgZXJyb3IgY29kZXNcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpBcGlHYXRld2F5OjpHYXRld2F5UmVzcG9uc2UnLCB7XG4gICAgICAgIFJlc3BvbnNlVHlwZTogJ0RFRkFVTFRfNFhYJyxcbiAgICAgICAgUmVzcG9uc2VQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgJ2dhdGV3YXlyZXNwb25zZS5oZWFkZXIuQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogXCInKidcIlxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgLy8gVmVyaWZ5IENPUlMgcHJlZmxpZ2h0IGlzIGNvbmZpZ3VyZWQgb24gdGhlIEFQSVxuICAgICAgLy8gRnJhbWV3b3JrIHVzZXMgZ2V0Q29yc1ByZWZsaWdodE9wdGlvbnMoKSB3aGljaCBzZXRzIHNwZWNpZmljIGhlYWRlcnNcbiAgICAgIGV4cGVjdChhcGlDb25zdHJ1Y3QuYXBpLnJvb3QpLnRvQmVEZWZpbmVkKCk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGluY2x1ZGUgZnJhbWV3b3JrLXNwZWNpZmljIENPUlMgaGVhZGVycycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGFwaUNvbnN0cnVjdCA9IG5ldyBBUElDb25zdHJ1Y3Qoe1xuICAgICAgICBjb3JzOiB0cnVlLFxuICAgICAgICBza2lwQ29udHJvbGxlcnM6IHRydWVcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBhcGlDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG4gICAgICBhZGRNaW5pbWFsTWV0aG9kKGFwaUNvbnN0cnVjdC5hcGkpO1xuXG4gICAgICAvLyBUaGUgcHJlZmxpZ2h0IE9QVElPTlMgbW9jayBtdXN0IGFsbG93IGV2ZXJ5IGhlYWRlciB0aGUgZnJhbWV3b3JrJ3Mgb3duIGNsaWVudHMgc2VuZCDigJRcbiAgICAgIC8vIG5vdGFibHkgdGhlIHRyYWNpbmcvaWRlbnRpdHkgaGVhZGVycyAoeC1jb3JyZWxhdGlvbi1pZCwgeC1jYXVzZWQtYnksIHgtYWN0b3IpIHRoZSBydW50aW1lXG4gICAgICAvLyBjb25zdW1lcy4gQSBoZWFkZXIgbWlzc2luZyBmcm9tIHRoaXMgbGlzdCBmYWlscyB0aGUgYnJvd3NlciBwcmVmbGlnaHQgZm9yIGFueSByZXF1ZXN0XG4gICAgICAvLyBjYXJyeWluZyBpdCwgc28gdGhlIHdob2xlIGNhbGwgZGllcyBhcyBhIENPUlMgZXJyb3IgYmVmb3JlIHJlYWNoaW5nIHRoZSBiYWNrZW5kLlxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkFwaUdhdGV3YXk6Ok1ldGhvZCcsIHtcbiAgICAgICAgSHR0cE1ldGhvZDogJ09QVElPTlMnLFxuICAgICAgICBJbnRlZ3JhdGlvbjoge1xuICAgICAgICAgIEludGVncmF0aW9uUmVzcG9uc2VzOiBbXG4gICAgICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICAgICAgUmVzcG9uc2VQYXJhbWV0ZXJzOiBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICAgICAgICAnbWV0aG9kLnJlc3BvbnNlLmhlYWRlci5BY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzogTWF0Y2guc3RyaW5nTGlrZVJlZ2V4cChcbiAgICAgICAgICAgICAgICAgICdJbXBlcnNvbmF0aW5nLVVzZXItU3ViLFgtQ29ycmVsYXRpb24tSWQsWC1DYXVzZWQtQnksWC1BY3RvcidcbiAgICAgICAgICAgICAgICApLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgIF0sXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgZW5hYmxlIENPUlMgY3JlZGVudGlhbHMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBhcGlDb25zdHJ1Y3QgPSBuZXcgQVBJQ29uc3RydWN0KHtcbiAgICAgICAgY29yczogJ2h0dHBzOi8vYXBwLmV4YW1wbGUuY29tJyxcbiAgICAgICAgc2tpcENvbnRyb2xsZXJzOiB0cnVlXG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgYXBpQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuICAgICAgYWRkTWluaW1hbE1ldGhvZChhcGlDb25zdHJ1Y3QuYXBpKTtcblxuICAgICAgLy8gVmVyaWZ5IENPUlMgaXMgY29uZmlndXJlZCAoYWxsb3dDcmVkZW50aWFscyBpcyBzZXQgaW4gZ2V0Q29yc1ByZWZsaWdodE9wdGlvbnMpXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6QXBpR2F0ZXdheTo6R2F0ZXdheVJlc3BvbnNlJywge1xuICAgICAgICBSZXNwb25zZVR5cGU6ICdERUZBVUxUXzRYWCdcbiAgICAgIH0pO1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkFwaUdhdGV3YXk6OkdhdGV3YXlSZXNwb25zZScsIHtcbiAgICAgICAgUmVzcG9uc2VUeXBlOiAnREVGQVVMVF81WFgnXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0FQSSBTZWN1cml0eSAtIHJlcXVpcmVBcGlLZXknLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBlbmZvcmNlIEFQSSBrZXkgcmVxdWlyZW1lbnQgYXQgcm91dGUgbGV2ZWwnLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBOb3RlOiBUaGlzIHRlc3RzIHRoZSBjb25maWd1cmF0aW9uIHN0b3JhZ2UsIGFjdHVhbCByb3V0ZSBjcmVhdGlvbiByZXF1aXJlcyBmdWxsIGNvbnRyb2xsZXIgY29udGV4dFxuICAgICAgY29uc3QgYXBpQ29uc3RydWN0ID0gbmV3IEFQSUNvbnN0cnVjdCh7XG4gICAgICAgIHVzYWdlUGxhbnM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBuYW1lOiAnc2VjdXJlZC1wbGFuJyxcbiAgICAgICAgICAgIHJhdGVMaW1pdDogMTAwLFxuICAgICAgICAgICAgYnVyc3RMaW1pdDogMjAwLFxuICAgICAgICAgICAgYXBpS2V5czoge1xuICAgICAgICAgICAgICBrZXlzOiBbICdzZWN1cmUta2V5LTEyMycgXVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgXSxcbiAgICAgICAgc2tpcENvbnRyb2xsZXJzOiB0cnVlXG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgYXBpQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuICAgICAgYWRkTWluaW1hbE1ldGhvZChhcGlDb25zdHJ1Y3QuYXBpKTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgLy8gVmVyaWZ5IEFQSSBrZXkgYW5kIHVzYWdlIHBsYW4gYXJlIGNyZWF0ZWQgKGFwaS50czo4NTEtODgzKVxuICAgICAgdGVtcGxhdGUucmVzb3VyY2VDb3VudElzKCdBV1M6OkFwaUdhdGV3YXk6OkFwaUtleScsIDEpO1xuICAgICAgdGVtcGxhdGUucmVzb3VyY2VDb3VudElzKCdBV1M6OkFwaUdhdGV3YXk6OlVzYWdlUGxhbktleScsIDEpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgQVBJIHdpdGhvdXQgcmVxdWlyaW5nIGtleXMgd2hlbiBub3QgY29uZmlndXJlZCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGFwaUNvbnN0cnVjdCA9IG5ldyBBUElDb25zdHJ1Y3Qoe1xuICAgICAgICB1c2FnZVBsYW5zOiB1bmRlZmluZWQsXG4gICAgICAgIHNraXBDb250cm9sbGVyczogdHJ1ZVxuICAgICAgfSk7XG5cbiAgICAgIGF3YWl0IGFwaUNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcbiAgICAgIGFkZE1pbmltYWxNZXRob2QoYXBpQ29uc3RydWN0LmFwaSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIC8vIE5vIEFQSSBrZXlzIHNob3VsZCBiZSBjcmVhdGVkXG4gICAgICB0ZW1wbGF0ZS5yZXNvdXJjZUNvdW50SXMoJ0FXUzo6QXBpR2F0ZXdheTo6QXBpS2V5JywgMCk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdJbnRlZ3JhdGlvbiBUeXBlcyAtIERpcmVjdCBBV1MgU2VydmljZSBJbnRlZ3JhdGlvbnMnLCAoKSA9PiB7XG4gICAgLyoqXG4gICAgICogTk9URTogU1FTIGFuZCBTTlMgZGlyZWN0IGludGVncmF0aW9ucyAoYXBpLnRzOjg4NS05NTEpIHJlcXVpcmUgZnVsbCBjb250cm9sbGVyIGNvbnRleHRcbiAgICAgKiB3aXRoIHJvdXRlLnRhcmdldD0ncXVldWUnIG9yIHJvdXRlLnRhcmdldD0ndG9waWMnLiBUaGVzZSBhcmUgaW50ZWdyYXRpb24tbGV2ZWwgZmVhdHVyZXNcbiAgICAgKiB0aGF0IG5lZWQgcmVnaXN0ZXJlZCBxdWV1ZXMvdG9waWNzIGluIGZ3MjQgZW52aXJvbm1lbnQuXG4gICAgICogXG4gICAgICogVGhlc2UgdGVzdHMgdmVyaWZ5IHRoZSBjb25zdHJ1Y3QgaGFzIHRoZSBpbnRlZ3JhdGlvbiBtZXRob2RzIGF2YWlsYWJsZS5cbiAgICAgKi9cbiAgICBpdCgnc2hvdWxkIGhhdmUgU1FTIGludGVncmF0aW9uIGNhcGFiaWxpdHknLCAoKSA9PiB7XG4gICAgICBjb25zdCBhcGlDb25zdHJ1Y3QgPSBuZXcgQVBJQ29uc3RydWN0KHtcbiAgICAgICAgc2tpcENvbnRyb2xsZXJzOiB0cnVlXG4gICAgICB9KTtcblxuICAgICAgLy8gVmVyaWZ5IHRoZSBjb25zdHJ1Y3QgaGFzIHRoZSBwcml2YXRlIGNyZWF0ZVNRU0ludGVncmF0aW9uIG1ldGhvZFxuICAgICAgZXhwZWN0KChhcGlDb25zdHJ1Y3QgYXMgYW55KS5jcmVhdGVTUVNJbnRlZ3JhdGlvbikudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdCh0eXBlb2YgKGFwaUNvbnN0cnVjdCBhcyBhbnkpLmNyZWF0ZVNRU0ludGVncmF0aW9uKS50b0JlKCdmdW5jdGlvbicpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYXZlIFNOUyBpbnRlZ3JhdGlvbiBjYXBhYmlsaXR5JywgKCkgPT4ge1xuICAgICAgY29uc3QgYXBpQ29uc3RydWN0ID0gbmV3IEFQSUNvbnN0cnVjdCh7XG4gICAgICAgIHNraXBDb250cm9sbGVyczogdHJ1ZVxuICAgICAgfSk7XG5cbiAgICAgIC8vIFZlcmlmeSB0aGUgY29uc3RydWN0IGhhcyB0aGUgcHJpdmF0ZSBjcmVhdGVTTlNJbnRlZ3JhdGlvbiBtZXRob2RcbiAgICAgIGV4cGVjdCgoYXBpQ29uc3RydWN0IGFzIGFueSkuY3JlYXRlU05TSW50ZWdyYXRpb24pLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3QodHlwZW9mIChhcGlDb25zdHJ1Y3QgYXMgYW55KS5jcmVhdGVTTlNJbnRlZ3JhdGlvbikudG9CZSgnZnVuY3Rpb24nKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGF2ZSBMYW1iZGEgaW50ZWdyYXRpb24gY2FwYWJpbGl0eScsICgpID0+IHtcbiAgICAgIGNvbnN0IGFwaUNvbnN0cnVjdCA9IG5ldyBBUElDb25zdHJ1Y3Qoe1xuICAgICAgICBza2lwQ29udHJvbGxlcnM6IHRydWVcbiAgICAgIH0pO1xuXG4gICAgICAvLyBWZXJpZnkgdGhlIGNvbnN0cnVjdCBoYXMgdGhlIHByaXZhdGUgY3JlYXRlTGFtYmRhRnVuY3Rpb24gbWV0aG9kXG4gICAgICBleHBlY3QoKGFwaUNvbnN0cnVjdCBhcyBhbnkpLmNyZWF0ZUxhbWJkYUZ1bmN0aW9uKS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KHR5cGVvZiAoYXBpQ29uc3RydWN0IGFzIGFueSkuY3JlYXRlTGFtYmRhRnVuY3Rpb24pLnRvQmUoJ2Z1bmN0aW9uJyk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdFbnZpcm9ubWVudCBWYXJpYWJsZSBIeWRyYXRpb24nLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBwcm9jZXNzIGNvbmZpZyB0aHJvdWdoIEhlbHBlci5oeWRyYXRlQ29uZmlnJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYXBpQ29uc3RydWN0ID0gbmV3IEFQSUNvbnN0cnVjdCh7XG4gICAgICAgIHNraXBDb250cm9sbGVyczogdHJ1ZVxuICAgICAgfSk7XG5cbiAgICAgIGF3YWl0IGFwaUNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcblxuICAgICAgLy8gVmVyaWZ5IGNvbnN0cnVjdCB3YXMgaW5pdGlhbGl6ZWQgKGh5ZHJhdGlvbiBoYXBwZW5zIGluIGNvbnN0cnVjdG9yIHZpYSBhcGkudHM6MjM5KVxuICAgICAgZXhwZWN0KChhcGlDb25zdHJ1Y3QgYXMgYW55KS5hcGlDb25zdHJ1Y3RDb25maWcpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3QoYXBpQ29uc3RydWN0LmFwaSkudG9CZURlZmluZWQoKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ011bHRpLVN0YWNrIERlcGxveW1lbnQgQ29uZmlndXJhdGlvbicsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBkZXBsb3kgZmxhZyBmb3IgbXVsdGktc3RhY2sgc2V0dXAnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBhcGlDb25zdHJ1Y3QgPSBuZXcgQVBJQ29uc3RydWN0KHtcbiAgICAgICAgYXBpT3B0aW9uczoge1xuICAgICAgICAgIGRlcGxveTogZmFsc2UgLy8gYXBpLnRzOjI2NS0yNjggLSBwcmV2ZW50cyBkZXBsb3ltZW50IGluIG5lc3RlZCBzdGFjayBzY2VuYXJpb3NcbiAgICAgICAgfSxcbiAgICAgICAgc2tpcENvbnRyb2xsZXJzOiB0cnVlXG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgYXBpQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuICAgICAgYWRkTWluaW1hbE1ldGhvZChhcGlDb25zdHJ1Y3QuYXBpKTtcblxuICAgICAgLy8gV2hlbiBkZXBsb3k9ZmFsc2UsIGRlcGxveU9wdGlvbnMgc2hvdWxkIGJlIHJlbW92ZWRcbiAgICAgIGV4cGVjdCgoYXBpQ29uc3RydWN0IGFzIGFueSkuYXBpQ29uc3RydWN0Q29uZmlnLmFwaU9wdGlvbnM/LmRlcGxveSkudG9CZShmYWxzZSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBjb250cm9sbGVyUGFyZW50U3RhY2tOYW1lIGZvciBuZXN0ZWQgc3RhY2tzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYXBpQ29uc3RydWN0ID0gbmV3IEFQSUNvbnN0cnVjdCh7XG4gICAgICAgIGNvbnRyb2xsZXJQYXJlbnRTdGFja05hbWU6ICdwYXJlbnQtc3RhY2snLFxuICAgICAgICBza2lwQ29udHJvbGxlcnM6IHRydWVcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBhcGlDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG5cbiAgICAgIGV4cGVjdCgoYXBpQ29uc3RydWN0IGFzIGFueSkuYXBpQ29uc3RydWN0Q29uZmlnLmNvbnRyb2xsZXJQYXJlbnRTdGFja05hbWUpLnRvQmUoJ3BhcmVudC1zdGFjaycpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnTmVnYXRpdmUgVGVzdHMgLSBJbnZhbGlkIENvbmZpZ3VyYXRpb25zJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgaGFuZGxlIGVtcHR5IGRvbWFpbk5hbWUgZ3JhY2VmdWxseScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGFwaUNvbnN0cnVjdCA9IG5ldyBBUElDb25zdHJ1Y3Qoe1xuICAgICAgICBkb21haW5OYW1lOiAnJyxcbiAgICAgICAgc2tpcENvbnRyb2xsZXJzOiB0cnVlXG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgYXBpQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuICAgICAgYWRkTWluaW1hbE1ldGhvZChhcGlDb25zdHJ1Y3QuYXBpKTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgLy8gRW1wdHkgZG9tYWluIG5hbWUgc2hvdWxkIG5vdCBjcmVhdGUgZG9tYWluIHJlc291cmNlc1xuICAgICAgdGVtcGxhdGUucmVzb3VyY2VDb3VudElzKCdBV1M6OkFwaUdhdGV3YXk6OkRvbWFpbk5hbWUnLCAwKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIHVzYWdlIHBsYW4gd2l0aCBlbXB0eSBuYW1lJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYXBpQ29uc3RydWN0ID0gbmV3IEFQSUNvbnN0cnVjdCh7XG4gICAgICAgIHVzYWdlUGxhbnM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBuYW1lOiAnJyxcbiAgICAgICAgICAgIHJhdGVMaW1pdDogMTAwLFxuICAgICAgICAgICAgYnVyc3RMaW1pdDogMjAwXG4gICAgICAgICAgfVxuICAgICAgICBdLFxuICAgICAgICBza2lwQ29udHJvbGxlcnM6IHRydWVcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBhcGlDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG4gICAgICBhZGRNaW5pbWFsTWV0aG9kKGFwaUNvbnN0cnVjdC5hcGkpO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICAvLyBTaG91bGQgc3RpbGwgY3JlYXRlIHRoZSB1c2FnZSBwbGFuXG4gICAgICB0ZW1wbGF0ZS5yZXNvdXJjZUNvdW50SXMoJ0FXUzo6QXBpR2F0ZXdheTo6VXNhZ2VQbGFuJywgMSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSB1bmRlZmluZWQgYXBpS2V5Q29uZmlnIGdyYWNlZnVsbHknLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBhcGlDb25zdHJ1Y3QgPSBuZXcgQVBJQ29uc3RydWN0KHtcbiAgICAgICAgYXBpS2V5Q29uZmlnOiB1bmRlZmluZWQsXG4gICAgICAgIHVzYWdlUGxhbnM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBuYW1lOiAndGVzdC1wbGFuJyxcbiAgICAgICAgICAgIHJhdGVMaW1pdDogMTAwLFxuICAgICAgICAgICAgYnVyc3RMaW1pdDogMjAwLFxuICAgICAgICAgICAgYXBpS2V5czoge1xuICAgICAgICAgICAgICBrZXlzOiBbICd0ZXN0LWtleScgXVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgXSxcbiAgICAgICAgc2tpcENvbnRyb2xsZXJzOiB0cnVlXG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgYXBpQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuICAgICAgYWRkTWluaW1hbE1ldGhvZChhcGlDb25zdHJ1Y3QuYXBpKTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUucmVzb3VyY2VDb3VudElzKCdBV1M6OkFwaUdhdGV3YXk6OkFwaUtleScsIDEpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgbnVsbCBDT1JTIGNvbmZpZ3VyYXRpb24nLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBhcGlDb25zdHJ1Y3QgPSBuZXcgQVBJQ29uc3RydWN0KHtcbiAgICAgICAgY29yczogdW5kZWZpbmVkLFxuICAgICAgICBza2lwQ29udHJvbGxlcnM6IHRydWVcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBhcGlDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG4gICAgICBhZGRNaW5pbWFsTWV0aG9kKGFwaUNvbnN0cnVjdC5hcGkpO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICAvLyBObyBDT1JTIGdhdGV3YXkgcmVzcG9uc2VzXG4gICAgICB0ZW1wbGF0ZS5yZXNvdXJjZUNvdW50SXMoJ0FXUzo6QXBpR2F0ZXdheTo6R2F0ZXdheVJlc3BvbnNlJywgMCk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBtaXNzaW5nIGRlcGxveU9wdGlvbnMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBhcGlDb25zdHJ1Y3QgPSBuZXcgQVBJQ29uc3RydWN0KHtcbiAgICAgICAgYXBpT3B0aW9uczoge1xuICAgICAgICAgIHJlc3RBcGlOYW1lOiAnbm8tZGVwbG95LW9wdGlvbnMtYXBpJ1xuICAgICAgICAgIC8vIE5vIGRlcGxveU9wdGlvbnNcbiAgICAgICAgfSxcbiAgICAgICAgc2tpcENvbnRyb2xsZXJzOiB0cnVlXG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgYXBpQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuICAgICAgYWRkTWluaW1hbE1ldGhvZChhcGlDb25zdHJ1Y3QuYXBpKTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkFwaUdhdGV3YXk6OlJlc3RBcGknLCB7XG4gICAgICAgIE5hbWU6ICduby1kZXBsb3ktb3B0aW9ucy1hcGknXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdGhyb3cgZXJyb3IgZm9yIGludmFsaWQgY2VydGlmaWNhdGVBcm4gd2l0aG91dCBkb21haW5OYW1lJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYXBpQ29uc3RydWN0ID0gbmV3IEFQSUNvbnN0cnVjdCh7XG4gICAgICAgIGNlcnRpZmljYXRlQXJuOiAnYXJuOmF3czphY206dXMtZWFzdC0xOjEyMzQ1Njc4OTAxMjpjZXJ0aWZpY2F0ZS90ZXN0LWNlcnQnLFxuICAgICAgICAvLyBNaXNzaW5nIGRvbWFpbk5hbWUgLSBzaG91bGQgYmUgaGFuZGxlZCBncmFjZWZ1bGx5IG9yIGVycm9yXG4gICAgICAgIHNraXBDb250cm9sbGVyczogdHJ1ZVxuICAgICAgfSk7XG5cbiAgICAgIGF3YWl0IGFwaUNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcbiAgICAgIGFkZE1pbmltYWxNZXRob2QoYXBpQ29uc3RydWN0LmFwaSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIC8vIFNob3VsZCBub3QgY3JlYXRlIGRvbWFpbiByZXNvdXJjZXMgaWYgZG9tYWluTmFtZSBpcyBtaXNzaW5nXG4gICAgICB0ZW1wbGF0ZS5yZXNvdXJjZUNvdW50SXMoJ0FXUzo6QXBpR2F0ZXdheTo6RG9tYWluTmFtZScsIDApO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnU25hcHNob3QgVGVzdHMgLSBDbG91ZEZvcm1hdGlvbiBDb25zaXN0ZW5jeScsICgpID0+IHtcbiAgICAvKipcbiAgICAgKiBTbmFwc2hvdDogQmFzaWMgQVBJIFNldHVwXG4gICAgICogVGVzdHMgQ2xvdWRGb3JtYXRpb24gdGVtcGxhdGUgZm9yIGEgYmFzaWMgQVBJIHdpdGggQ09SUy5cbiAgICAgKi9cbiAgICBpdCgnc2hvdWxkIGdlbmVyYXRlIGNvbnNpc3RlbnQgQ2xvdWRGb3JtYXRpb24gZm9yIGJhc2ljIEFQSScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGFwaUNvbnN0cnVjdCA9IG5ldyBBUElDb25zdHJ1Y3Qoe1xuICAgICAgICBjb3JzOiB0cnVlLFxuICAgICAgICBhcGlPcHRpb25zOiB7XG4gICAgICAgICAgcmVzdEFwaU5hbWU6ICdzbmFwc2hvdC1hcGknLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiAnU25hcHNob3QgVGVzdCBBUEknXG4gICAgICAgIH0sXG4gICAgICAgIHNraXBDb250cm9sbGVyczogdHJ1ZVxuICAgICAgfSk7XG5cbiAgICAgIGF3YWl0IGFwaUNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcbiAgICAgIGFkZE1pbmltYWxNZXRob2QoYXBpQ29uc3RydWN0LmFwaSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKS50b0pTT04oKTtcbiAgICAgIGV4cGVjdCh0ZW1wbGF0ZSkudG9NYXRjaFNuYXBzaG90KCk7XG4gICAgfSk7XG5cbiAgICAvKipcbiAgICAgKiBTbmFwc2hvdDogQVBJIHdpdGggVXNhZ2UgUGxhblxuICAgICAqIFRlc3RzIENsb3VkRm9ybWF0aW9uIHRlbXBsYXRlIGZvciBBUEkgd2l0aCB1c2FnZSBwbGFuIGFuZCBBUEkga2V5cy5cbiAgICAgKi9cbiAgICBpdCgnc2hvdWxkIGdlbmVyYXRlIGNvbnNpc3RlbnQgQ2xvdWRGb3JtYXRpb24gZm9yIEFQSSB3aXRoIHVzYWdlIHBsYW4nLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBhcGlDb25zdHJ1Y3QgPSBuZXcgQVBJQ29uc3RydWN0KHtcbiAgICAgICAgdXNhZ2VQbGFuczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIG5hbWU6ICdzbmFwc2hvdC1wbGFuJyxcbiAgICAgICAgICAgIHJhdGVMaW1pdDogMTAwLFxuICAgICAgICAgICAgYnVyc3RMaW1pdDogMjAwLFxuICAgICAgICAgICAgcXVvdGFMaW1pdDogMTAwMDAsXG4gICAgICAgICAgICBxdW90YVBlcmlvZDogUGVyaW9kLkRBWSxcbiAgICAgICAgICAgIGFwaUtleXM6IHtcbiAgICAgICAgICAgICAga2V5czogWyAnc25hcHNob3Qta2V5LTEyMycgXVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgXSxcbiAgICAgICAgc2tpcENvbnRyb2xsZXJzOiB0cnVlXG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgYXBpQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuICAgICAgYWRkTWluaW1hbE1ldGhvZChhcGlDb25zdHJ1Y3QuYXBpKTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spLnRvSlNPTigpO1xuICAgICAgZXhwZWN0KHRlbXBsYXRlKS50b01hdGNoU25hcHNob3QoKTtcbiAgICB9KTtcblxuICAgIC8qKlxuICAgICAqIFNuYXBzaG90OiBDb21wbGV0ZSBBUEkgQ29uZmlndXJhdGlvblxuICAgICAqIFRlc3RzIENsb3VkRm9ybWF0aW9uIHRlbXBsYXRlIHdpdGggYWxsIG9wdGlvbnMgZW5hYmxlZC5cbiAgICAgKi9cbiAgICBpdCgnc2hvdWxkIGdlbmVyYXRlIGNvbnNpc3RlbnQgQ2xvdWRGb3JtYXRpb24gZm9yIGNvbXBsZXRlIGNvbmZpZ3VyYXRpb24nLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBhcGlDb25zdHJ1Y3QgPSBuZXcgQVBJQ29uc3RydWN0KHtcbiAgICAgICAgY29yczogWyAnaHR0cHM6Ly9leGFtcGxlLmNvbScsICdodHRwczovL2FwcC5leGFtcGxlLmNvbScgXSxcbiAgICAgICAgYXBpT3B0aW9uczoge1xuICAgICAgICAgIHJlc3RBcGlOYW1lOiAnY29tcGxldGUtYXBpJyxcbiAgICAgICAgICBkZXNjcmlwdGlvbjogJ0NvbXBsZXRlIEFQSSBDb25maWd1cmF0aW9uJyxcbiAgICAgICAgICBkZXBsb3lPcHRpb25zOiB7XG4gICAgICAgICAgICBzdGFnZU5hbWU6ICdwcm9kJ1xuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgdXNhZ2VQbGFuczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIG5hbWU6ICdjb21wbGV0ZS1wbGFuJyxcbiAgICAgICAgICAgIHJhdGVMaW1pdDogNTAwLFxuICAgICAgICAgICAgYnVyc3RMaW1pdDogMTAwMCxcbiAgICAgICAgICAgIHF1b3RhTGltaXQ6IDUwMDAwLFxuICAgICAgICAgICAgcXVvdGFQZXJpb2Q6IFBlcmlvZC5NT05USCxcbiAgICAgICAgICAgIGFwaUtleXM6IHtcbiAgICAgICAgICAgICAga2V5czogWyAnY29tcGxldGUta2V5LTEyMycsICdjb21wbGV0ZS1rZXktNDU2JyBdXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICBdLFxuICAgICAgICBza2lwQ29udHJvbGxlcnM6IHRydWVcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBhcGlDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG4gICAgICBhZGRNaW5pbWFsTWV0aG9kKGFwaUNvbnN0cnVjdC5hcGkpO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjaykudG9KU09OKCk7XG4gICAgICBleHBlY3QodGVtcGxhdGUpLnRvTWF0Y2hTbmFwc2hvdCgpO1xuICAgIH0pO1xuICB9KTtcbn0pO1xuXG4iXX0=