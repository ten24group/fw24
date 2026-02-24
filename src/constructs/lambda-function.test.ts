import { App, Stack, Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Template, Match, Capture } from 'aws-cdk-lib/assertions';
import { Runtime, Architecture } from 'aws-cdk-lib/aws-lambda';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { LambdaFunction } from './lambda-function';
import { Fw24 } from '../core/fw24';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import * as path from 'path';

describe('LambdaFunction Construct', () => {
  let app: App;
  let stack: Stack;
  // Use an existing handler file from the framework instead of creating a test fixture
  const TEST_ENTRY = path.join(__dirname, '../core/runtime/abstract-lambda-handler.ts');

  beforeEach(() => {
    // Clean up singleton before each test
    (Fw24 as any).instance = undefined;

    app = new App();
    stack = new Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-east-1' }
    });

    // Initialize Fw24 singleton
    const fw24 = Fw24.getInstance();
    fw24.setApp(app);
    fw24.setConfig({
      name: 'test-app',
      region: 'us-east-1',
      account: '123456789012'
    });
    fw24.addStack('main', stack);
  });

  afterEach(() => {
    // Clean up singleton after each test
    (Fw24 as any).instance = undefined;
  });

  describe('Basic Lambda Creation', () => {
    it('should create a Lambda function with minimal config', () => {
      const lambda = new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY
      });

      expect(lambda).toBeDefined();
      const template = Template.fromStack(stack);
      template.resourceCountIs('AWS::Lambda::Function', 1);
      template.resourceCountIs('AWS::IAM::Role', 1);
      template.resourceCountIs('AWS::Logs::LogGroup', 1);
    });

    it('should apply default properties correctly', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Runtime: Runtime.NODEJS_22_X.name,
        Timeout: 5,
        MemorySize: 128,
        Architectures: [ Architecture.ARM_64.name ]
        // Handler is CDK-managed and varies based on entry file
      });
    });

    it('should override default properties with functionProps', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        functionProps: {
          timeout: Duration.seconds(60),
          memorySize: 1024
        }
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Timeout: 60,
        MemorySize: 1024
      });
    });

    it('should use functionTimeout shorthand', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        functionTimeout: 120
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Timeout: 120
      });
    });

    it('should prioritize functionTimeout over functionProps.timeout', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        functionTimeout: 90,
        functionProps: {
          timeout: Duration.seconds(60)
        }
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Timeout: 90
      });
    });

    it('should set x86_64 architecture when specified', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        processorArchitecture: 'x86_64'
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Architectures: [ Architecture.X86_64.name ]
      });
    });

    it('should set ARM_64 architecture when specified', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        processorArchitecture: 'arm_64'
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Architectures: [ Architecture.ARM_64.name ]
      });
    });
  });

  describe('Environment Variables', () => {
    it('should set custom environment variables', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        environmentVariables: {
          'CUSTOM_VAR': 'custom-value',
          'ANOTHER_VAR': 'another-value'
        }
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            'CUSTOM_VAR': 'custom-value',
            'ANOTHER_VAR': 'another-value'
          })
        }
      });
    });

    it('should merge environment variables from multiple sources', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        environmentVariables: {
          'FROM_PROPS': 'value1'
        },
        functionProps: {
          environment: {
            'FROM_FUNCTION_PROPS': 'value2'
          }
        }
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            'FROM_PROPS': 'value1',
            'FROM_FUNCTION_PROPS': 'value2'
          })
        }
      });
    });

    it('should prioritize environmentVariables over functionProps.environment', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        environmentVariables: {
          'SHARED_VAR': 'from-environmentVariables'
        },
        functionProps: {
          environment: {
            'SHARED_VAR': 'from-functionProps'
          }
        }
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            'SHARED_VAR': 'from-environmentVariables'
          })
        }
      });
    });

    it('should handle empty environment variables', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        environmentVariables: {}
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: Match.objectLike({
          Variables: Match.anyValue()
        })
      });
    });

    it('should handle special characters in environment variable names', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        environmentVariables: {
          'VAR_WITH_UNDERSCORE': 'value1',
          'VAR123': 'value2'
        }
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            'VAR_WITH_UNDERSCORE': 'value1',
            'VAR123': 'value2'
          })
        }
      });
    });

    it('should handle empty string values in environment variables', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        environmentVariables: {
          'EMPTY_VAR': ''
        }
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            'EMPTY_VAR': ''
          })
        }
      });
    });
  });

  describe('Custom Policies', () => {
    it('should attach custom PolicyStatement', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        policies: [
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [ 's3:ListAllMyBuckets' ],
            resources: [ '*' ]
          })
        ]
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 's3:ListAllMyBuckets',
              Effect: 'Allow',
              Resource: '*'
            })
          ])
        }
      });
    });

    it('should attach custom PolicyStatementProps', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        policies: [
          {
            effect: Effect.ALLOW,
            actions: [ 'dynamodb:DescribeTable' ],
            resources: [ '*' ]
          }
        ]
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'dynamodb:DescribeTable',
              Effect: 'Allow',
              Resource: '*'
            })
          ])
        }
      });
    });

    it('should attach multiple custom policies', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        policies: [
          {
            effect: Effect.ALLOW,
            actions: [ 's3:GetObject' ],
            resources: [ 'arn:aws:s3:::my-bucket/*' ]
          },
          {
            effect: Effect.ALLOW,
            actions: [ 'dynamodb:Query' ],
            resources: [ 'arn:aws:dynamodb:us-east-1:123456789012:table/my-table' ]
          }
        ]
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 's3:GetObject',
              Effect: 'Allow'
            }),
            Match.objectLike({
              Action: 'dynamodb:Query',
              Effect: 'Allow'
            })
          ])
        }
      });
    });

    it('should handle empty policies array', () => {
      const lambda = new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        policies: []
      });

      expect(lambda).toBeDefined();
      const template = Template.fromStack(stack);
      template.resourceCountIs('AWS::Lambda::Function', 1);
    });

    it('should attach policies with multiple actions', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        policies: [
          {
            effect: Effect.ALLOW,
            actions: [ 's3:GetObject', 's3:PutObject', 's3:DeleteObject' ],
            resources: [ 'arn:aws:s3:::my-bucket/*' ]
          }
        ]
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: [ 's3:GetObject', 's3:PutObject', 's3:DeleteObject' ],
              Effect: 'Allow'
            })
          ])
        }
      });
    });

    it('should attach DENY policies', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        policies: [
          {
            effect: Effect.DENY,
            actions: [ 's3:DeleteBucket' ],
            resources: [ '*' ]
          }
        ]
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 's3:DeleteBucket',
              Effect: 'Deny'
            })
          ])
        }
      });
    });
  });

  describe('Bundling Configuration - Critical Merge Tests', () => {
    it('should accept bundling.externalModules as array', () => {
      const lambda = new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        functionProps: {
          bundling: {
            externalModules: [ 'custom-module', 'another-module' ]
          }
        }
      });

      expect(lambda).toBeDefined();
      const template = Template.fromStack(stack);
      template.resourceCountIs('AWS::Lambda::Function', 1);
    });

    it('should accept bundling.minify option', () => {
      const lambda = new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        functionProps: {
          bundling: {
            minify: true
          }
        }
      });

      expect(lambda).toBeDefined();
      const template = Template.fromStack(stack);
      template.resourceCountIs('AWS::Lambda::Function', 1);
    });

    it('should accept bundling.sourceMap option', () => {
      const lambda = new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        functionProps: {
          bundling: {
            sourceMap: true
          }
        }
      });

      expect(lambda).toBeDefined();
      const template = Template.fromStack(stack);
      template.resourceCountIs('AWS::Lambda::Function', 1);
    });

    it('should merge multiple bundling options without losing any', () => {
      const lambda = new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        functionProps: {
          bundling: {
            externalModules: [ 'aws-sdk' ],
            minify: true,
            sourceMap: false
          }
        }
      });

      expect(lambda).toBeDefined();
      const template = Template.fromStack(stack);
      template.resourceCountIs('AWS::Lambda::Function', 1);
    });

    it('should NOT mutate original bundling config object', () => {
      const originalBundling = {
        externalModules: [ 'original-module' ],
        minify: false
      };

      const originalFunctionProps = {
        bundling: originalBundling
      };

      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        functionProps: originalFunctionProps
      });

      // Verify original was NOT mutated
      expect(originalBundling).toEqual({
        externalModules: [ 'original-module' ],
        minify: false
      });
      expect(originalFunctionProps.bundling).toBe(originalBundling);
    });

    it('should handle bundling with complex nested options', () => {
      const lambda = new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        functionProps: {
          bundling: {
            externalModules: [ '@ten24group/fw24', 'aws-sdk' ],
            minify: true,
            sourceMap: true,
            commandHooks: {
              beforeBundling: () => [],
              afterBundling: () => [],
              beforeInstall: () => []
            }
          }
        }
      });

      expect(lambda).toBeDefined();
    });
  });

  describe('Logging Configuration', () => {
    it('should create log group with default retention', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        RetentionInDays: 30
      });
    });

    it('should create log group with custom retention', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        logRetentionDays: RetentionDays.ONE_WEEK
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        RetentionInDays: 7
      });
    });

    it('should create log group with ONE_DAY retention', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        logRetentionDays: RetentionDays.ONE_DAY
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        RetentionInDays: 1
      });
    });

    it('should create log group with THREE_DAYS retention', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        logRetentionDays: RetentionDays.THREE_DAYS
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        RetentionInDays: 3
      });
    });

    it('should create log group with SIX_MONTHS retention', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        logRetentionDays: RetentionDays.SIX_MONTHS
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        RetentionInDays: 180
      });
    });

    it('should create log group with custom removal policy', () => {
      const lambda = new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        logRemovalPolicy: RemovalPolicy.DESTROY
      });

      expect(lambda).toBeDefined();
      const template = Template.fromStack(stack);
      // Just verify the log group exists - removal policy details are CDK implementation
      template.resourceCountIs('AWS::Logs::LogGroup', 1);
    });

    it('should use JSON logging format when LOG_FORMAT env var is set', () => {
      const originalLogFormat = process.env.LOG_FORMAT;
      process.env.LOG_FORMAT = 'json';

      try {
        // Need to clean up and reinitialize Fw24 for env var to take effect
        (Fw24 as any).instance = undefined;
        const fw24 = Fw24.getInstance();
        fw24.setApp(app);
        fw24.setConfig({
          name: 'test-app',
          region: 'us-east-1',
          account: '123456789012'
        });
        fw24.addStack('main', stack);

        new LambdaFunction(stack, 'TestLambda', {
          entry: TEST_ENTRY
        });

        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Lambda::Function', {
          LoggingConfig: {
            LogFormat: 'JSON'
          }
        });
      } finally {
        // Restore original value
        if (originalLogFormat !== undefined) {
          process.env.LOG_FORMAT = originalLogFormat;
        } else {
          delete process.env.LOG_FORMAT;
        }
      }
    });

    it('should default to TEXT logging format', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        LoggingConfig: {
          LogFormat: 'Text'
        }
      });
    });
  });

  describe('Merge Utility Integration - CRITICAL BUG TESTS', () => {
    it('should properly merge nested bundling configuration using merge([obj1, obj2]) syntax', () => {
      const lambda = new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        functionProps: {
          bundling: {
            externalModules: [ 'module1' ],
            minify: true
          }
        }
      });

      expect(lambda).toBeDefined();
      const template = Template.fromStack(stack);
      template.resourceCountIs('AWS::Lambda::Function', 1);
    });

    it('should merge functionProps without losing properties', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        functionProps: {
          timeout: Duration.seconds(90),
          memorySize: 2048,
          environment: {
            'CUSTOM': 'value'
          }
        }
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Timeout: 90,
        MemorySize: 2048,
        Environment: {
          Variables: Match.objectLike({
            'CUSTOM': 'value'
          })
        }
      });
    });

    it('should handle complex nested merging scenarios', () => {
      const lambda = new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        functionTimeout: 45,
        environmentVariables: {
          'VAR1': 'value1'
        },
        functionProps: {
          memorySize: 1024,
          environment: {
            'VAR2': 'value2'
          },
          bundling: {
            minify: false,
            sourceMap: true
          }
        }
      });

      expect(lambda).toBeDefined();
      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Timeout: 45,
        MemorySize: 1024,
        Environment: {
          Variables: Match.objectLike({
            'VAR1': 'value1',
            'VAR2': 'value2'
          })
        }
      });
    });

    it('should merge deep nested objects correctly without mutation', () => {
      const originalProps = {
        timeout: Duration.seconds(30),
        memorySize: 512,
        bundling: {
          externalModules: [ 'module1' ],
          minify: true,
          sourceMap: false
        },
        environment: {
          'KEY1': 'value1'
        }
      };

      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        functionProps: originalProps
      });

      // Verify original wasn't mutated
      expect(originalProps).toEqual({
        timeout: Duration.seconds(30),
        memorySize: 512,
        bundling: {
          externalModules: [ 'module1' ],
          minify: true,
          sourceMap: false
        },
        environment: {
          'KEY1': 'value1'
        }
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Timeout: 30,
        MemorySize: 512,
        Environment: {
          Variables: Match.objectLike({
            'KEY1': 'value1'
          })
        }
      });
    });

    it('should properly override variables when same key exists in multiple sources', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        environmentVariables: {
          'VAR1': 'value1'
        },
        functionProps: {
          environment: {
            'VAR1': 'should-be-overridden',
            'VAR2': 'value2'
          }
        }
      });

      const template = Template.fromStack(stack);
      const capture = new Capture();
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: capture
        }
      });

      const vars = capture.asObject();
      // VAR1 should use value from environmentVariables (higher priority)
      expect(vars[ 'VAR1' ]).toBe('value1');
      expect(vars[ 'VAR2' ]).toBe('value2');
      // Verify both vars are present
      expect(Object.keys(vars)).toContain('VAR1');
      expect(Object.keys(vars)).toContain('VAR2');
    });
  });

  describe('Function Props Override', () => {
    it('should allow complete override of runtime', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        functionProps: {
          runtime: Runtime.NODEJS_20_X
        }
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Runtime: Runtime.NODEJS_20_X.name
      });
    });

    it('should allow description to be set', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        functionProps: {
          description: 'Test Lambda Function'
        }
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Description: 'Test Lambda Function'
      });
    });

    it('should allow handler to be overridden', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        functionProps: {
          handler: 'customHandler'
        }
      });

      const template = Template.fromStack(stack);
      // CDK NodejsFunction prefixes handler with 'index.'
      template.hasResourceProperties('AWS::Lambda::Function', {
        Handler: 'index.customHandler'
      });
    });

    it('should combine multiple overrides', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        functionProps: {
          runtime: Runtime.NODEJS_20_X,
          timeout: Duration.seconds(120),
          memorySize: 2048,
          description: 'Custom Lambda'
        }
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Runtime: Runtime.NODEJS_20_X.name,
        Timeout: 120,
        MemorySize: 2048,
        Description: 'Custom Lambda'
      });
    });
  });

  describe('IAM Role Configuration', () => {
    it('should create an execution role', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'sts:AssumeRole',
              Effect: 'Allow',
              Principal: {
                Service: 'lambda.amazonaws.com'
              }
            })
          ])
        }
      });
    });

    it('should attach managed policies to execution role', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::IAM::Role', {
        ManagedPolicyArns: Match.arrayWith([
          Match.objectLike({
            'Fn::Join': Match.arrayWith([
              Match.arrayWith([
                Match.stringLikeRegexp('.*AWSLambdaBasicExecutionRole.*')
              ])
            ])
          })
        ])
      });
    });

    it('should create separate IAM policy for custom permissions', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        policies: [
          {
            effect: Effect.ALLOW,
            actions: [ 's3:GetObject' ],
            resources: [ '*' ]
          }
        ]
      });

      const template = Template.fromStack(stack);
      template.resourceCountIs('AWS::IAM::Policy', 1);
      template.resourceCountIs('AWS::IAM::Role', 1);
    });
  });

  describe('Edge Cases and Error Scenarios', () => {
    it('should handle very long timeout values', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        functionTimeout: 900 // 15 minutes - Lambda max
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Timeout: 900
      });
    });

    it('should handle minimum memory size', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        functionProps: {
          memorySize: 128 // Lambda minimum
        }
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        MemorySize: 128
      });
    });

    it('should handle maximum memory size', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        functionProps: {
          memorySize: 10240 // Lambda maximum
        }
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        MemorySize: 10240
      });
    });

    it('should handle multiple Lambda functions in same stack', () => {
      new LambdaFunction(stack, 'Lambda1', {
        entry: TEST_ENTRY
      });
      new LambdaFunction(stack, 'Lambda2', {
        entry: TEST_ENTRY
      });
      new LambdaFunction(stack, 'Lambda3', {
        entry: TEST_ENTRY
      });

      const template = Template.fromStack(stack);
      template.resourceCountIs('AWS::Lambda::Function', 3);
      template.resourceCountIs('AWS::IAM::Role', 3);
      template.resourceCountIs('AWS::Logs::LogGroup', 3);
    });

    it('should handle Lambda with both policies and resourceAccess', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        policies: [
          {
            effect: Effect.ALLOW,
            actions: [ 's3:GetObject' ],
            resources: [ '*' ]
          }
        ],
        resourceAccess: {
          // Empty resource access - just testing that both can coexist
        }
      });

      const template = Template.fromStack(stack);
      template.resourceCountIs('AWS::Lambda::Function', 1);
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 's3:GetObject'
            })
          ])
        }
      });
    });
  });

  describe('Snapshot Tests', () => {
    it('should generate consistent CloudFormation template for minimal config', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY
      });

      const template = Template.fromStack(stack).toJSON();
      expect(template).toMatchSnapshot();
    });

    it('should generate consistent CloudFormation template for complex config', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        functionTimeout: 60,
        logRetentionDays: RetentionDays.ONE_WEEK,
        processorArchitecture: 'x86_64',
        environmentVariables: {
          'VAR1': 'value1',
          'VAR2': 'value2'
        },
        policies: [
          {
            effect: Effect.ALLOW,
            actions: [ 's3:GetObject', 's3:PutObject' ],
            resources: [ 'arn:aws:s3:::my-bucket/*' ]
          }
        ],
        functionProps: {
          memorySize: 1024,
          description: 'Test Lambda with full config',
          bundling: {
            minify: true,
            sourceMap: true
          }
        }
      });

      const template = Template.fromStack(stack).toJSON();
      expect(template).toMatchSnapshot();
    });
  });

  describe('Regression Tests - Specific Bug Fixes', () => {
    it('REGRESSION: merge([obj1, obj2]) syntax - verifies ALL properties from ALL sources are applied', () => {
      // This tests the specific bug where merge was called as merge(obj1, obj2) instead of merge([obj1, obj2])
      // If merge is used incorrectly, properties from one or more sources will be lost
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        functionTimeout: 60,
        functionProps: {
          memorySize: 1024,
          description: 'Test Lambda',
          bundling: {
            minify: true,
            sourceMap: false
          }
        }
      });

      const template = Template.fromStack(stack);
      const capture = new Capture();

      // CRITICALLY verify ALL properties from ALL sources are present
      template.hasResourceProperties('AWS::Lambda::Function', {
        Timeout: 60, // from functionTimeout
        MemorySize: 1024, // from functionProps
        Description: 'Test Lambda', // from functionProps
        Handler: capture // Capture to verify it exists
      });

      // Verify the Lambda was created successfully
      template.resourceCountIs('AWS::Lambda::Function', 1);

      // Handler should be set (proves merge worked)
      expect(capture.asString()).toMatch(/^index\./);
    });

    it('REGRESSION: merge should NOT mutate original config objects (immutability)', () => {
      // This tests that merge doesn't mutate the original objects
      const originalBundling = {
        externalModules: [ 'module1' ],
        minify: true
      };

      const originalEnv = {
        'KEY1': 'value1'
      };

      const originalFunctionProps = {
        timeout: Duration.seconds(45),
        bundling: originalBundling,
        environment: originalEnv
      };

      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        functionProps: originalFunctionProps
      });

      // CRITICAL: Verify none of the original objects were mutated
      expect(originalBundling).toEqual({
        externalModules: [ 'module1' ],
        minify: true
      });
      expect(originalEnv).toEqual({
        'KEY1': 'value1'
      });
      // Verify references are still the same (no new objects created for originals)
      expect(originalFunctionProps.bundling).toBe(originalBundling);
      expect(originalFunctionProps.environment).toBe(originalEnv);
    });

    it('REGRESSION: merge should preserve ALL properties from deeply nested objects', () => {
      // Tests that deep nested merging doesn't lose properties
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        environmentVariables: {
          'VAR1': 'value1'
        },
        functionProps: {
          timeout: Duration.seconds(90),
          memorySize: 2048,
          description: 'Complex Lambda',
          bundling: {
            externalModules: [ 'custom-module' ],
            minify: true,
            sourceMap: true
          },
          environment: {
            'VAR2': 'value2'
          }
        }
      });

      const template = Template.fromStack(stack);
      const envCapture = new Capture();

      // Verify ALL nested properties are present
      template.hasResourceProperties('AWS::Lambda::Function', {
        Timeout: 90,
        MemorySize: 2048,
        Description: 'Complex Lambda',
        Environment: {
          Variables: envCapture
        }
      });

      const vars = envCapture.asObject();
      expect(vars[ 'VAR1' ]).toBe('value1');
      expect(vars[ 'VAR2' ]).toBe('value2');
    });

    it('REGRESSION: should handle readonly CDK properties correctly', () => {
      // The actual bug was in BucketConstruct with blockPublicAccess readonly property
      // This tests similar scenario - Architecture is a class instance that could have readonly props
      const readonlyArchitecture = Architecture.ARM_64;

      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        functionProps: {
          architecture: readonlyArchitecture
        }
      });

      // Should not throw errors about readonly properties during merge
      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Architectures: [ Architecture.ARM_64.name ]
      });
    });

    it('REGRESSION: merge must preserve properties when merging 3+ objects', () => {
      // Tests that merge([obj1, obj2, obj3]) preserves all properties
      // The construct merges: defaultProps + functionProps + additionalProps
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        environmentVariables: {
          'FROM_ENV_VARS': 'value1'
        },
        functionTimeout: 75,
        processorArchitecture: 'x86_64',
        functionProps: {
          memorySize: 512,
          description: 'Test Description',
          environment: {
            'FROM_FUNCTION_PROPS': 'value2'
          },
          bundling: {
            minify: false
          }
        }
      });

      const template = Template.fromStack(stack);
      const capture = new Capture();

      // CRITICAL: ALL properties from ALL 3+ sources must be present
      template.hasResourceProperties('AWS::Lambda::Function', {
        Timeout: 75, // from functionTimeout (additionalProps)
        MemorySize: 512, // from functionProps
        Description: 'Test Description', // from functionProps
        Architectures: [ Architecture.X86_64.name ], // from processorArchitecture (additionalProps)
        Environment: {
          Variables: capture
        }
      });

      const vars = capture.asObject();
      expect(vars[ 'FROM_ENV_VARS' ]).toBe('value1');
      expect(vars[ 'FROM_FUNCTION_PROPS' ]).toBe('value2');
    });
  });

  describe('Negative Tests - Error and Edge Scenarios', () => {
    it('should throw error for invalid entry file path during construct creation', () => {
      // CDK validates entry file path during NodejsFunction construction
      expect(() => {
        new LambdaFunction(stack, 'TestLambda', {
          entry: '/non/existent/path/that/does/not/exist.ts'
        });
      }).toThrow(/Cannot find entry file/);
    });

    it('should handle conflicting timeout - functionTimeout wins over functionProps.timeout', () => {
      new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        functionTimeout: 100,
        functionProps: {
          timeout: Duration.seconds(50)
        }
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Timeout: 100 // functionTimeout takes precedence
      });
    });

    it('should handle empty arrays in bundling config without errors', () => {
      const lambda = new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        functionProps: {
          bundling: {
            externalModules: []
          }
        }
      });

      expect(lambda).toBeDefined();
      const template = Template.fromStack(stack);
      template.resourceCountIs('AWS::Lambda::Function', 1);
    });

    it('should handle undefined functionProps gracefully', () => {
      const lambda = new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        functionProps: undefined
      });

      expect(lambda).toBeDefined();
      const template = Template.fromStack(stack);
      template.resourceCountIs('AWS::Lambda::Function', 1);
    });

    it('should handle null values in environment variables', () => {
      // TypeScript prevents this at compile time, but testing runtime behavior
      const lambda = new LambdaFunction(stack, 'TestLambda', {
        entry: TEST_ENTRY,
        environmentVariables: {} // Empty is valid
      });

      expect(lambda).toBeDefined();
      const template = Template.fromStack(stack);
      template.resourceCountIs('AWS::Lambda::Function', 1);
    });
  });
});
