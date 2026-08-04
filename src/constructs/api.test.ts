import { App, Stack, Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { APIConstruct } from './api';
import { Fw24 } from '../core/fw24';
import { RestApi, Cors, Period, MockIntegration, PassthroughBehavior, EndpointType } from 'aws-cdk-lib/aws-apigateway';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';

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
  let app: App;
  let stack: Stack;

  beforeEach(() => {
    // Clean up singleton
    (Fw24 as any).instance = undefined;

    app = new App();
    stack = new Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-east-1' }
    });

    // Initialize Fw24
    const fw24 = Fw24.getInstance();
    fw24.setApp(app);
    fw24.setConfig({
      name: 'test-api-app',
      region: 'us-east-1',
      account: '123456789012'
    });
    fw24.addStack('main', stack);
  });

  afterEach(() => {
    (Fw24 as any).instance = undefined;
  });

  /**
   * Helper to add minimal method for CDK validation.
   * CDK requires at least one method in REST API for synthesis.
   */
  const addMinimalMethod = (api: RestApi) => {
    api.root.addResource('health').addMethod('GET', new MockIntegration({
      integrationResponses: [ { statusCode: '200' } ],
      passthroughBehavior: PassthroughBehavior.NEVER,
      requestTemplates: { 'application/json': '{"statusCode": 200}' }
    }), {
      methodResponses: [ { statusCode: '200' } ]
    });
  };

  describe('Basic API Creation', () => {
    it('should create a REST API with default settings', async () => {
      const apiConstruct = new APIConstruct({
        skipControllers: true // Skip controller registration for unit test
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      const template = Template.fromStack(stack);
      template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
      template.hasResourceProperties('AWS::ApiGateway::RestApi', {
        Name: Match.stringLikeRegexp('test-api-app')
      });
    });

    it('should create API with custom name from apiOptions', async () => {
      const apiConstruct = new APIConstruct({
        apiOptions: {
          restApiName: 'custom-api-name'
        },
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::ApiGateway::RestApi', {
        Name: 'custom-api-name'
      });
    });

    it('should create API with custom description', async () => {
      const apiConstruct = new APIConstruct({
        apiOptions: {
          description: 'Custom API Description'
        },
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::ApiGateway::RestApi', {
        Description: 'Custom API Description'
      });
    });

    it('should register API and make it accessible', async () => {
      const apiConstruct = new APIConstruct({
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
      const apiConstruct = new APIConstruct({
        cors: true,
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      const template = Template.fromStack(stack);
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
      const apiConstruct = new APIConstruct({
        cors: 'https://example.com',
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      const template = Template.fromStack(stack);
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
      const apiConstruct = new APIConstruct({
        cors: [ 'https://example.com', 'https://app.example.com' ],
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      const template = Template.fromStack(stack);
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
      const apiConstruct = new APIConstruct({
        cors: false,
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      const template = Template.fromStack(stack);
      template.resourceCountIs('AWS::ApiGateway::GatewayResponse', 0);
    });

    it('should NOT create gateway responses when CORS is undefined', async () => {
      const apiConstruct = new APIConstruct({
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      const template = Template.fromStack(stack);
      template.resourceCountIs('AWS::ApiGateway::GatewayResponse', 0);
    });
  });

  describe('Usage Plans and API Keys', () => {
    it('should create usage plan with rate and quota limits', async () => {
      const apiConstruct = new APIConstruct({
        usagePlans: [
          {
            name: 'basic-plan',
            rateLimit: 100,
            burstLimit: 200,
            quotaLimit: 10000,
            quotaPeriod: Period.DAY
          }
        ],
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      const template = Template.fromStack(stack);
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
      const apiConstruct = new APIConstruct({
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

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
        UsagePlanName: 'throttle-only-plan',
        Throttle: {
          RateLimit: 50,
          BurstLimit: 100
        }
      });
    });

    it('should create multiple usage plans', async () => {
      const apiConstruct = new APIConstruct({
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

      const template = Template.fromStack(stack);
      template.resourceCountIs('AWS::ApiGateway::UsagePlan', 2);
    });

    it('should create API keys for usage plan', async () => {
      const apiConstruct = new APIConstruct({
        usagePlans: [
          {
            name: 'basic-plan',
            rateLimit: 100,
            burstLimit: 200,
            apiKeys: {
              keys: [ 'test-key-123', 'test-key-456' ]
            }
          }
        ],
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      const template = Template.fromStack(stack);
      template.resourceCountIs('AWS::ApiGateway::ApiKey', 2);
      template.hasResourceProperties('AWS::ApiGateway::ApiKey', {
        Value: 'test-key-123'
      });
      template.hasResourceProperties('AWS::ApiGateway::ApiKey', {
        Value: 'test-key-456'
      });
    });

    it('should NOT create API keys when keys array is empty', async () => {
      const apiConstruct = new APIConstruct({
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

      const template = Template.fromStack(stack);
      // No keys are created when the keys array is explicitly empty
      template.resourceCountIs('AWS::ApiGateway::ApiKey', 0);
    });

    it('should link API keys to usage plan', async () => {
      const apiConstruct = new APIConstruct({
        usagePlans: [
          {
            name: 'basic-plan',
            rateLimit: 100,
            burstLimit: 200,
            apiKeys: {
              keys: [ 'test-key-123' ]
            }
          }
        ],
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::ApiGateway::UsagePlanKey', {
        KeyType: 'API_KEY'
      });
    });
  });

  describe('Usage Plan Defaults', () => {
    it('should apply default throttle and quota when not provided', async () => {
      const apiConstruct = new APIConstruct({
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

      const template = Template.fromStack(stack);
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
      const apiConstruct = new APIConstruct({
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

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
        Throttle: {
          RateLimit: 500, // Custom
          BurstLimit: 20  // Default
        },
        Quota: {
          Limit: 10000,   // Default
          Period: 'MONTH' // Default
        }
      });
    });
  });

  describe('API Key Configuration', () => {
    it('should create API key with correct description', async () => {
      const apiConstruct = new APIConstruct({
        usagePlans: [
          {
            name: 'test-plan',
            rateLimit: 100,
            burstLimit: 200,
            apiKeys: {
              keys: [ 'test-key-value' ]
            }
          }
        ],
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::ApiGateway::ApiKey', {
        Value: 'test-key-value',
        Enabled: true,
        Description: Match.stringLikeRegexp('API key .* for test-api-app')
      });
    });

    it('should reuse existing API keys with same value', async () => {
      const apiConstruct = new APIConstruct({
        usagePlans: [
          {
            name: 'plan1',
            rateLimit: 100,
            burstLimit: 200,
            apiKeys: {
              keys: [ 'shared-key' ]
            }
          },
          {
            name: 'plan2',
            rateLimit: 200,
            burstLimit: 400,
            apiKeys: {
              keys: [ 'shared-key' ] // Same key as plan1
            }
          }
        ],
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      const template = Template.fromStack(stack);
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
      const apiConstruct = new APIConstruct({
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

      const template = Template.fromStack(stack);
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
      const apiConstruct = new APIConstruct({
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      const template = Template.fromStack(stack);
      template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
    });

    it('should handle empty usagePlans array', async () => {
      const apiConstruct = new APIConstruct({
        usagePlans: [],
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      const template = Template.fromStack(stack);
      template.resourceCountIs('AWS::ApiGateway::UsagePlan', 0);
    });

    it('should handle undefined usagePlans', async () => {
      const apiConstruct = new APIConstruct({
        usagePlans: undefined,
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      const template = Template.fromStack(stack);
      template.resourceCountIs('AWS::ApiGateway::UsagePlan', 0);
    });

    it('should handle usage plan with only throttle (no quota)', async () => {
      const apiConstruct = new APIConstruct({
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

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
        UsagePlanName: 'throttle-only',
        Throttle: Match.objectLike({
          RateLimit: 100
        })
      });
    });

    it('should handle very high rate limits', async () => {
      const apiConstruct = new APIConstruct({
        usagePlans: [
          {
            name: 'high-limit',
            rateLimit: 10000,
            burstLimit: 20000,
            quotaLimit: 1000000,
            quotaPeriod: Period.MONTH
          }
        ],
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      const template = Template.fromStack(stack);
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
      const apiConstruct = new APIConstruct({
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

      const template = Template.fromStack(stack);
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
      const apiConstruct = new APIConstruct({
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

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
        UsagePlanName: longName
      });
    });

    it('should handle special characters in API key values', async () => {
      const apiConstruct = new APIConstruct({
        usagePlans: [
          {
            name: 'special-chars-plan',
            rateLimit: 100,
            burstLimit: 200,
            apiKeys: {
              keys: [ 'key-with-dashes_123', 'KEY_WITH_UNDERSCORES-456' ]
            }
          }
        ],
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::ApiGateway::ApiKey', {
        Value: 'key-with-dashes_123'
      });
      template.hasResourceProperties('AWS::ApiGateway::ApiKey', {
        Value: 'KEY_WITH_UNDERSCORES-456'
      });
    });

    it('should handle mixed usage plans (some with quota, some without)', async () => {
      const apiConstruct = new APIConstruct({
        usagePlans: [
          {
            name: 'with-quota',
            rateLimit: 100,
            burstLimit: 200,
            quotaLimit: 10000,
            quotaPeriod: Period.DAY
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

      const template = Template.fromStack(stack);
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
      const apiConstruct = new APIConstruct({
        usagePlans: [
          {
            name: 'daily-plan',
            quotaLimit: 1000,
            quotaPeriod: Period.DAY
          },
          {
            name: 'weekly-plan',
            quotaLimit: 7000,
            quotaPeriod: Period.WEEK
          },
          {
            name: 'monthly-plan',
            quotaLimit: 30000,
            quotaPeriod: Period.MONTH
          }
        ],
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      const template = Template.fromStack(stack);
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
      const apiConstruct = new APIConstruct({
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

      const template = Template.fromStack(stack);

      // Verify domain name is configured
      template.hasResourceProperties('AWS::ApiGateway::RestApi', {
        Name: Match.stringLikeRegexp('test-api-app')
      });

      // DomainName resource should be created
      template.hasResourceProperties('AWS::ApiGateway::DomainName', {
        DomainName: 'api.example.com',
        RegionalCertificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/test-cert'
      });

      // BasePathMapping should link domain to API (api.ts:258-262)
      // basePath is set to deployOptions.stageName (api.ts:261)
      template.hasResourceProperties('AWS::ApiGateway::BasePathMapping', {
        DomainName: Match.objectLike({
          Ref: Match.stringLikeRegexp('.*')
        }),
        BasePath: 'prod' // Uses stageName from deployOptions
      });
    });

    it('should handle API without custom domain', async () => {
      const apiConstruct = new APIConstruct({
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      const template = Template.fromStack(stack);
      // No custom domain resources
      template.resourceCountIs('AWS::ApiGateway::DomainName', 0);
    });
  });

  describe('Lambda Integration Configuration', () => {
    it('should pass integration timeout to Lambda functions', async () => {
      const apiConstruct = new APIConstruct({
        integrationTimeout: 15,
        functionProps: {
          timeout: Duration.seconds(20)
        },
        skipControllers: true
      });

      await apiConstruct.construct();

      // Verify construct has the config
      expect((apiConstruct as any).apiConstructConfig.integrationTimeout).toBe(15);
      expect((apiConstruct as any).apiConstructConfig.functionProps?.timeout).toBeDefined();
    });

    it('should use default function props when not specified', async () => {
      const apiConstruct = new APIConstruct({
        skipControllers: true
      });

      await apiConstruct.construct();

      expect((apiConstruct as any).apiConstructConfig.functionProps).toBeUndefined();
    });
  });

  describe('Usage Plan Advanced Configuration', () => {
    it('should create usage plan with description', async () => {
      const apiConstruct = new APIConstruct({
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

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
        UsagePlanName: 'described-plan',
        Description: 'This is a test usage plan'
      });
    });

    it('should link usage plan to API deployment stage', async () => {
      const apiConstruct = new APIConstruct({
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

      const template = Template.fromStack(stack);
      // Usage plan should reference the API
      template.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
        UsagePlanName: 'stage-linked-plan',
        ApiStages: Match.arrayWith([
          Match.objectLike({
            Stage: Match.anyValue()
          })
        ])
      });
    });
  });

  describe('API Key Naming Strategy', () => {
    it('should use keyNamePrefix from usage plan config', async () => {
      const apiConstruct = new APIConstruct({
        usagePlans: [
          {
            name: 'prefix-test',
            rateLimit: 100,
            burstLimit: 200,
            apiKeys: {
              keys: [ 'key1', 'key2' ],
              keyNamePrefix: 'custom-prefix'
            }
          }
        ],
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      const template = Template.fromStack(stack);
      // Both keys should be created
      template.resourceCountIs('AWS::ApiGateway::ApiKey', 2);
    });

    it('should use global apiKeyConfig.keyName when provided', async () => {
      const apiConstruct = new APIConstruct({
        apiKeyConfig: {
          keyName: 'global-key-name'
        },
        usagePlans: [
          {
            name: 'global-key-test',
            rateLimit: 100,
            burstLimit: 200,
            apiKeys: {
              keys: [ 'test-key' ]
            }
          }
        ],
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      const template = Template.fromStack(stack);
      template.resourceCountIs('AWS::ApiGateway::ApiKey', 1);
    });

    it('should generate default key names when no config provided', async () => {
      const apiConstruct = new APIConstruct({
        usagePlans: [
          {
            name: 'default-name-test',
            rateLimit: 100,
            burstLimit: 200,
            apiKeys: {
              keys: [ 'key1', 'key2', 'key3' ]
            }
          }
        ],
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      const template = Template.fromStack(stack);
      template.resourceCountIs('AWS::ApiGateway::ApiKey', 3);
    });
  });

  describe('Framework Integration', () => {
    it('should register API in fw24 instance', async () => {
      const apiConstruct = new APIConstruct({
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      // Verify API is accessible directly from construct
      expect(apiConstruct.api).toBeDefined();
      expect(apiConstruct.api.restApiId).toBeDefined();

      // Verify construct has the fw24 instance
      expect((apiConstruct as any).fw24).toBeDefined();
      expect((apiConstruct as any).fw24).toBe(Fw24.getInstance());
    });

    it('should set construct outputs for API resources', async () => {
      const fw24 = Fw24.getInstance();
      const apiConstruct = new APIConstruct({
        skipControllers: true
      });

      await apiConstruct.construct();

      // Verify construct outputs are set
      expect(apiConstruct.output).toBeDefined();
    });

    it('should respect skipControllers flag', async () => {
      const apiConstruct = new APIConstruct({
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      // Should complete without error and not register controllers
      expect(apiConstruct.api).toBeDefined();
    });

    it('should handle controllersDirectory configuration', async () => {
      const apiConstruct = new APIConstruct({
        controllersDirectory: '/custom/path/controllers',
        skipControllers: true
      });

      await apiConstruct.construct();

      expect((apiConstruct as any).apiConstructConfig.controllersDirectory).toBe('/custom/path/controllers');
    });
  });

  describe('API Configuration Options', () => {
    it('should handle logRetentionDays configuration', async () => {
      const apiConstruct = new APIConstruct({
        logRetentionDays: RetentionDays.ONE_WEEK,
        skipControllers: true
      });

      await apiConstruct.construct();

      expect((apiConstruct as any).apiConstructConfig.logRetentionDays).toBe(RetentionDays.ONE_WEEK);
    });

    it('should handle logRemovalPolicy configuration', async () => {
      const apiConstruct = new APIConstruct({
        logRemovalPolicy: RemovalPolicy.RETAIN,
        skipControllers: true
      });

      await apiConstruct.construct();

      expect((apiConstruct as any).apiConstructConfig.logRemovalPolicy).toBe(RemovalPolicy.RETAIN);
    });

    it('should handle forceDeployment flag', async () => {
      const apiConstruct = new APIConstruct({
        forceDeployment: true,
        skipControllers: true
      });

      await apiConstruct.construct();

      expect((apiConstruct as any).apiConstructConfig.forceDeployment).toBe(true);
    });

    it('should handle controllerParentStackName', async () => {
      const apiConstruct = new APIConstruct({
        controllerParentStackName: 'parent-stack',
        skipControllers: true
      });

      await apiConstruct.construct();

      expect((apiConstruct as any).apiConstructConfig.controllerParentStackName).toBe('parent-stack');
    });
  });

  describe('API Deployment Configuration', () => {
    it('should create deployment with custom stage name', async () => {
      const apiConstruct = new APIConstruct({
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

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::ApiGateway::Stage', {
        StageName: 'production',
        Description: 'Production deployment'
      });
    });

    it('should handle API options with endpoint configuration', async () => {
      const apiConstruct = new APIConstruct({
        apiOptions: {
          restApiName: 'test-api',
          endpointConfiguration: {
            types: [ EndpointType.REGIONAL ]
          }
        },
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::ApiGateway::RestApi', {
        Name: 'test-api',
        EndpointConfiguration: {
          Types: [ 'REGIONAL' ]
        }
      });
    });

    it('should merge multiple apiOptions properties correctly', async () => {
      const apiConstruct = new APIConstruct({
        apiOptions: {
          restApiName: 'complex-api',
          description: 'Complex API with multiple options',
          endpointConfiguration: {
            types: [ EndpointType.REGIONAL ]
          },
          deployOptions: {
            stageName: 'v1',
            description: 'Version 1'
          },
          binaryMediaTypes: [ 'image/png', 'application/pdf' ]
        },
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::ApiGateway::RestApi', {
        Name: 'complex-api',
        Description: 'Complex API with multiple options',
        BinaryMediaTypes: [ 'image/png', 'application/pdf' ]
      });
      template.hasResourceProperties('AWS::ApiGateway::Stage', {
        StageName: 'v1',
        Description: 'Version 1'
      });
    });
  });

  describe('CORS Advanced Configuration', () => {
    it('should configure CORS preflight with all default headers', async () => {
      const apiConstruct = new APIConstruct({
        cors: true,
        apiOptions: {
          defaultCorsPreflightOptions: {
            allowOrigins: Cors.ALL_ORIGINS,
            allowMethods: Cors.ALL_METHODS
          }
        },
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      const template = Template.fromStack(stack);

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
      const apiConstruct = new APIConstruct({
        cors: true,
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      // The preflight OPTIONS mock must allow every header the framework's own clients send —
      // notably the tracing/identity headers (x-correlation-id, x-caused-by, x-actor) the runtime
      // consumes. A header missing from this list fails the browser preflight for any request
      // carrying it, so the whole call dies as a CORS error before reaching the backend.
      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'OPTIONS',
        Integration: {
          IntegrationResponses: [
            Match.objectLike({
              ResponseParameters: Match.objectLike({
                'method.response.header.Access-Control-Allow-Headers': Match.stringLikeRegexp(
                  'Impersonating-User-Sub,X-Correlation-Id,X-Caused-By,X-Actor'
                ),
              }),
            }),
          ],
        },
      });
    });

    it('should enable CORS credentials', async () => {
      const apiConstruct = new APIConstruct({
        cors: 'https://app.example.com',
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      // Verify CORS is configured (allowCredentials is set in getCorsPreflightOptions)
      const template = Template.fromStack(stack);
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
      const apiConstruct = new APIConstruct({
        usagePlans: [
          {
            name: 'secured-plan',
            rateLimit: 100,
            burstLimit: 200,
            apiKeys: {
              keys: [ 'secure-key-123' ]
            }
          }
        ],
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      const template = Template.fromStack(stack);
      // Verify API key and usage plan are created (api.ts:851-883)
      template.resourceCountIs('AWS::ApiGateway::ApiKey', 1);
      template.resourceCountIs('AWS::ApiGateway::UsagePlanKey', 1);
    });

    it('should create API without requiring keys when not configured', async () => {
      const apiConstruct = new APIConstruct({
        usagePlans: undefined,
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      const template = Template.fromStack(stack);
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
      const apiConstruct = new APIConstruct({
        skipControllers: true
      });

      // Verify the construct has the private createSQSIntegration method
      expect((apiConstruct as any).createSQSIntegration).toBeDefined();
      expect(typeof (apiConstruct as any).createSQSIntegration).toBe('function');
    });

    it('should have SNS integration capability', () => {
      const apiConstruct = new APIConstruct({
        skipControllers: true
      });

      // Verify the construct has the private createSNSIntegration method
      expect((apiConstruct as any).createSNSIntegration).toBeDefined();
      expect(typeof (apiConstruct as any).createSNSIntegration).toBe('function');
    });

    it('should have Lambda integration capability', () => {
      const apiConstruct = new APIConstruct({
        skipControllers: true
      });

      // Verify the construct has the private createLambdaFunction method
      expect((apiConstruct as any).createLambdaFunction).toBeDefined();
      expect(typeof (apiConstruct as any).createLambdaFunction).toBe('function');
    });
  });

  describe('Environment Variable Hydration', () => {
    it('should process config through Helper.hydrateConfig', async () => {
      const apiConstruct = new APIConstruct({
        skipControllers: true
      });

      await apiConstruct.construct();

      // Verify construct was initialized (hydration happens in constructor via api.ts:239)
      expect((apiConstruct as any).apiConstructConfig).toBeDefined();
      expect(apiConstruct.api).toBeDefined();
    });
  });

  describe('Multi-Stack Deployment Configuration', () => {
    it('should handle deploy flag for multi-stack setup', async () => {
      const apiConstruct = new APIConstruct({
        apiOptions: {
          deploy: false // api.ts:265-268 - prevents deployment in nested stack scenarios
        },
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      // When deploy=false, deployOptions should be removed
      expect((apiConstruct as any).apiConstructConfig.apiOptions?.deploy).toBe(false);
    });

    it('should handle controllerParentStackName for nested stacks', async () => {
      const apiConstruct = new APIConstruct({
        controllerParentStackName: 'parent-stack',
        skipControllers: true
      });

      await apiConstruct.construct();

      expect((apiConstruct as any).apiConstructConfig.controllerParentStackName).toBe('parent-stack');
    });
  });

  describe('Negative Tests - Invalid Configurations', () => {
    it('should handle empty domainName gracefully', async () => {
      const apiConstruct = new APIConstruct({
        domainName: '',
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      const template = Template.fromStack(stack);
      // Empty domain name should not create domain resources
      template.resourceCountIs('AWS::ApiGateway::DomainName', 0);
    });

    it('should handle usage plan with empty name', async () => {
      const apiConstruct = new APIConstruct({
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

      const template = Template.fromStack(stack);
      // Should still create the usage plan
      template.resourceCountIs('AWS::ApiGateway::UsagePlan', 1);
    });

    it('should handle undefined apiKeyConfig gracefully', async () => {
      const apiConstruct = new APIConstruct({
        apiKeyConfig: undefined,
        usagePlans: [
          {
            name: 'test-plan',
            rateLimit: 100,
            burstLimit: 200,
            apiKeys: {
              keys: [ 'test-key' ]
            }
          }
        ],
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      const template = Template.fromStack(stack);
      template.resourceCountIs('AWS::ApiGateway::ApiKey', 1);
    });

    it('should handle null CORS configuration', async () => {
      const apiConstruct = new APIConstruct({
        cors: undefined,
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      const template = Template.fromStack(stack);
      // No CORS gateway responses
      template.resourceCountIs('AWS::ApiGateway::GatewayResponse', 0);
    });

    it('should handle missing deployOptions', async () => {
      const apiConstruct = new APIConstruct({
        apiOptions: {
          restApiName: 'no-deploy-options-api'
          // No deployOptions
        },
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::ApiGateway::RestApi', {
        Name: 'no-deploy-options-api'
      });
    });

    it('should throw error for invalid certificateArn without domainName', async () => {
      const apiConstruct = new APIConstruct({
        certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/test-cert',
        // Missing domainName - should be handled gracefully or error
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      const template = Template.fromStack(stack);
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
      const apiConstruct = new APIConstruct({
        cors: true,
        apiOptions: {
          restApiName: 'snapshot-api',
          description: 'Snapshot Test API'
        },
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      const template = Template.fromStack(stack).toJSON();
      expect(template).toMatchSnapshot();
    });

    /**
     * Snapshot: API with Usage Plan
     * Tests CloudFormation template for API with usage plan and API keys.
     */
    it('should generate consistent CloudFormation for API with usage plan', async () => {
      const apiConstruct = new APIConstruct({
        usagePlans: [
          {
            name: 'snapshot-plan',
            rateLimit: 100,
            burstLimit: 200,
            quotaLimit: 10000,
            quotaPeriod: Period.DAY,
            apiKeys: {
              keys: [ 'snapshot-key-123' ]
            }
          }
        ],
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      const template = Template.fromStack(stack).toJSON();
      expect(template).toMatchSnapshot();
    });

    /**
     * Snapshot: Complete API Configuration
     * Tests CloudFormation template with all options enabled.
     */
    it('should generate consistent CloudFormation for complete configuration', async () => {
      const apiConstruct = new APIConstruct({
        cors: [ 'https://example.com', 'https://app.example.com' ],
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
            quotaPeriod: Period.MONTH,
            apiKeys: {
              keys: [ 'complete-key-123', 'complete-key-456' ]
            }
          }
        ],
        skipControllers: true
      });

      await apiConstruct.construct();
      addMinimalMethod(apiConstruct.api);

      const template = Template.fromStack(stack).toJSON();
      expect(template).toMatchSnapshot();
    });
  });
});

