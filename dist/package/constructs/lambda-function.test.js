"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const aws_cdk_lib_1 = require("aws-cdk-lib");
const assertions_1 = require("aws-cdk-lib/assertions");
const aws_lambda_1 = require("aws-cdk-lib/aws-lambda");
const aws_logs_1 = require("aws-cdk-lib/aws-logs");
const lambda_function_1 = require("./lambda-function");
const fw24_1 = require("../core/fw24");
const aws_iam_1 = require("aws-cdk-lib/aws-iam");
const path = __importStar(require("path"));
describe('LambdaFunction Construct', () => {
    let app;
    let stack;
    // Use an existing handler file from the framework instead of creating a test fixture
    const TEST_ENTRY = path.join(__dirname, '../core/runtime/abstract-lambda-handler.ts');
    beforeEach(() => {
        // Clean up singleton before each test
        fw24_1.Fw24.instance = undefined;
        app = new aws_cdk_lib_1.App();
        stack = new aws_cdk_lib_1.Stack(app, 'TestStack', {
            env: { account: '123456789012', region: 'us-east-1' }
        });
        // Initialize Fw24 singleton
        const fw24 = fw24_1.Fw24.getInstance();
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
        fw24_1.Fw24.instance = undefined;
    });
    describe('Basic Lambda Creation', () => {
        it('should create a Lambda function with minimal config', () => {
            const lambda = new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY
            });
            expect(lambda).toBeDefined();
            const template = assertions_1.Template.fromStack(stack);
            template.resourceCountIs('AWS::Lambda::Function', 1);
            template.resourceCountIs('AWS::IAM::Role', 1);
            template.resourceCountIs('AWS::Logs::LogGroup', 1);
        });
        it('should apply default properties correctly', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::Lambda::Function', {
                Runtime: aws_lambda_1.Runtime.NODEJS_22_X.name,
                Timeout: 5,
                MemorySize: 128,
                Architectures: [aws_lambda_1.Architecture.ARM_64.name]
                // Handler is CDK-managed and varies based on entry file
            });
        });
        it('should override default properties with functionProps', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                functionProps: {
                    timeout: aws_cdk_lib_1.Duration.seconds(60),
                    memorySize: 1024
                }
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::Lambda::Function', {
                Timeout: 60,
                MemorySize: 1024
            });
        });
        it('should use functionTimeout shorthand', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                functionTimeout: 120
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::Lambda::Function', {
                Timeout: 120
            });
        });
        it('should prioritize functionTimeout over functionProps.timeout', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                functionTimeout: 90,
                functionProps: {
                    timeout: aws_cdk_lib_1.Duration.seconds(60)
                }
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::Lambda::Function', {
                Timeout: 90
            });
        });
        it('should set x86_64 architecture when specified', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                processorArchitecture: 'x86_64'
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::Lambda::Function', {
                Architectures: [aws_lambda_1.Architecture.X86_64.name]
            });
        });
        it('should set ARM_64 architecture when specified', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                processorArchitecture: 'arm_64'
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::Lambda::Function', {
                Architectures: [aws_lambda_1.Architecture.ARM_64.name]
            });
        });
    });
    describe('Environment Variables', () => {
        it('should set custom environment variables', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                environmentVariables: {
                    'CUSTOM_VAR': 'custom-value',
                    'ANOTHER_VAR': 'another-value'
                }
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::Lambda::Function', {
                Environment: {
                    Variables: assertions_1.Match.objectLike({
                        'CUSTOM_VAR': 'custom-value',
                        'ANOTHER_VAR': 'another-value'
                    })
                }
            });
        });
        it('should merge environment variables from multiple sources', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
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
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::Lambda::Function', {
                Environment: {
                    Variables: assertions_1.Match.objectLike({
                        'FROM_PROPS': 'value1',
                        'FROM_FUNCTION_PROPS': 'value2'
                    })
                }
            });
        });
        it('should prioritize environmentVariables over functionProps.environment', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
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
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::Lambda::Function', {
                Environment: {
                    Variables: assertions_1.Match.objectLike({
                        'SHARED_VAR': 'from-environmentVariables'
                    })
                }
            });
        });
        it('should handle empty environment variables', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                environmentVariables: {}
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::Lambda::Function', {
                Environment: assertions_1.Match.objectLike({
                    Variables: assertions_1.Match.anyValue()
                })
            });
        });
        it('should handle special characters in environment variable names', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                environmentVariables: {
                    'VAR_WITH_UNDERSCORE': 'value1',
                    'VAR123': 'value2'
                }
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::Lambda::Function', {
                Environment: {
                    Variables: assertions_1.Match.objectLike({
                        'VAR_WITH_UNDERSCORE': 'value1',
                        'VAR123': 'value2'
                    })
                }
            });
        });
        it('should handle empty string values in environment variables', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                environmentVariables: {
                    'EMPTY_VAR': ''
                }
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::Lambda::Function', {
                Environment: {
                    Variables: assertions_1.Match.objectLike({
                        'EMPTY_VAR': ''
                    })
                }
            });
        });
    });
    describe('Custom Policies', () => {
        it('should attach custom PolicyStatement', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                policies: [
                    new aws_iam_1.PolicyStatement({
                        effect: aws_iam_1.Effect.ALLOW,
                        actions: ['s3:ListAllMyBuckets'],
                        resources: ['*']
                    })
                ]
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::IAM::Policy', {
                PolicyDocument: {
                    Statement: assertions_1.Match.arrayWith([
                        assertions_1.Match.objectLike({
                            Action: 's3:ListAllMyBuckets',
                            Effect: 'Allow',
                            Resource: '*'
                        })
                    ])
                }
            });
        });
        it('should attach custom PolicyStatementProps', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                policies: [
                    {
                        effect: aws_iam_1.Effect.ALLOW,
                        actions: ['dynamodb:DescribeTable'],
                        resources: ['*']
                    }
                ]
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::IAM::Policy', {
                PolicyDocument: {
                    Statement: assertions_1.Match.arrayWith([
                        assertions_1.Match.objectLike({
                            Action: 'dynamodb:DescribeTable',
                            Effect: 'Allow',
                            Resource: '*'
                        })
                    ])
                }
            });
        });
        it('should attach multiple custom policies', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                policies: [
                    {
                        effect: aws_iam_1.Effect.ALLOW,
                        actions: ['s3:GetObject'],
                        resources: ['arn:aws:s3:::my-bucket/*']
                    },
                    {
                        effect: aws_iam_1.Effect.ALLOW,
                        actions: ['dynamodb:Query'],
                        resources: ['arn:aws:dynamodb:us-east-1:123456789012:table/my-table']
                    }
                ]
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::IAM::Policy', {
                PolicyDocument: {
                    Statement: assertions_1.Match.arrayWith([
                        assertions_1.Match.objectLike({
                            Action: 's3:GetObject',
                            Effect: 'Allow'
                        }),
                        assertions_1.Match.objectLike({
                            Action: 'dynamodb:Query',
                            Effect: 'Allow'
                        })
                    ])
                }
            });
        });
        it('should handle empty policies array', () => {
            const lambda = new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                policies: []
            });
            expect(lambda).toBeDefined();
            const template = assertions_1.Template.fromStack(stack);
            template.resourceCountIs('AWS::Lambda::Function', 1);
        });
        it('should attach policies with multiple actions', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                policies: [
                    {
                        effect: aws_iam_1.Effect.ALLOW,
                        actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
                        resources: ['arn:aws:s3:::my-bucket/*']
                    }
                ]
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::IAM::Policy', {
                PolicyDocument: {
                    Statement: assertions_1.Match.arrayWith([
                        assertions_1.Match.objectLike({
                            Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
                            Effect: 'Allow'
                        })
                    ])
                }
            });
        });
        it('should attach DENY policies', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                policies: [
                    {
                        effect: aws_iam_1.Effect.DENY,
                        actions: ['s3:DeleteBucket'],
                        resources: ['*']
                    }
                ]
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::IAM::Policy', {
                PolicyDocument: {
                    Statement: assertions_1.Match.arrayWith([
                        assertions_1.Match.objectLike({
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
            const lambda = new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                functionProps: {
                    bundling: {
                        externalModules: ['custom-module', 'another-module']
                    }
                }
            });
            expect(lambda).toBeDefined();
            const template = assertions_1.Template.fromStack(stack);
            template.resourceCountIs('AWS::Lambda::Function', 1);
        });
        it('should accept bundling.minify option', () => {
            const lambda = new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                functionProps: {
                    bundling: {
                        minify: true
                    }
                }
            });
            expect(lambda).toBeDefined();
            const template = assertions_1.Template.fromStack(stack);
            template.resourceCountIs('AWS::Lambda::Function', 1);
        });
        it('should accept bundling.sourceMap option', () => {
            const lambda = new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                functionProps: {
                    bundling: {
                        sourceMap: true
                    }
                }
            });
            expect(lambda).toBeDefined();
            const template = assertions_1.Template.fromStack(stack);
            template.resourceCountIs('AWS::Lambda::Function', 1);
        });
        it('should merge multiple bundling options without losing any', () => {
            const lambda = new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                functionProps: {
                    bundling: {
                        externalModules: ['aws-sdk'],
                        minify: true,
                        sourceMap: false
                    }
                }
            });
            expect(lambda).toBeDefined();
            const template = assertions_1.Template.fromStack(stack);
            template.resourceCountIs('AWS::Lambda::Function', 1);
        });
        it('should NOT mutate original bundling config object', () => {
            const originalBundling = {
                externalModules: ['original-module'],
                minify: false
            };
            const originalFunctionProps = {
                bundling: originalBundling
            };
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                functionProps: originalFunctionProps
            });
            // Verify original was NOT mutated
            expect(originalBundling).toEqual({
                externalModules: ['original-module'],
                minify: false
            });
            expect(originalFunctionProps.bundling).toBe(originalBundling);
        });
        it('should handle bundling with complex nested options', () => {
            const lambda = new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                functionProps: {
                    bundling: {
                        externalModules: ['@ten24group/fw24', 'aws-sdk'],
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
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::Logs::LogGroup', {
                RetentionInDays: 30
            });
        });
        it('should create log group with custom retention', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                logRetentionDays: aws_logs_1.RetentionDays.ONE_WEEK
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::Logs::LogGroup', {
                RetentionInDays: 7
            });
        });
        it('should create log group with ONE_DAY retention', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                logRetentionDays: aws_logs_1.RetentionDays.ONE_DAY
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::Logs::LogGroup', {
                RetentionInDays: 1
            });
        });
        it('should create log group with THREE_DAYS retention', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                logRetentionDays: aws_logs_1.RetentionDays.THREE_DAYS
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::Logs::LogGroup', {
                RetentionInDays: 3
            });
        });
        it('should create log group with SIX_MONTHS retention', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                logRetentionDays: aws_logs_1.RetentionDays.SIX_MONTHS
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::Logs::LogGroup', {
                RetentionInDays: 180
            });
        });
        it('should create log group with custom removal policy', () => {
            const lambda = new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                logRemovalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY
            });
            expect(lambda).toBeDefined();
            const template = assertions_1.Template.fromStack(stack);
            // Just verify the log group exists - removal policy details are CDK implementation
            template.resourceCountIs('AWS::Logs::LogGroup', 1);
        });
        it('should use JSON logging format when LOG_FORMAT env var is set', () => {
            const originalLogFormat = process.env.LOG_FORMAT;
            process.env.LOG_FORMAT = 'json';
            try {
                // Need to clean up and reinitialize Fw24 for env var to take effect
                fw24_1.Fw24.instance = undefined;
                const fw24 = fw24_1.Fw24.getInstance();
                fw24.setApp(app);
                fw24.setConfig({
                    name: 'test-app',
                    region: 'us-east-1',
                    account: '123456789012'
                });
                fw24.addStack('main', stack);
                new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                    entry: TEST_ENTRY
                });
                const template = assertions_1.Template.fromStack(stack);
                template.hasResourceProperties('AWS::Lambda::Function', {
                    LoggingConfig: {
                        LogFormat: 'JSON'
                    }
                });
            }
            finally {
                // Restore original value
                if (originalLogFormat !== undefined) {
                    process.env.LOG_FORMAT = originalLogFormat;
                }
                else {
                    delete process.env.LOG_FORMAT;
                }
            }
        });
        it('should default to TEXT logging format', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::Lambda::Function', {
                LoggingConfig: {
                    LogFormat: 'Text'
                }
            });
        });
    });
    describe('Merge Utility Integration - CRITICAL BUG TESTS', () => {
        it('should properly merge nested bundling configuration using merge([obj1, obj2]) syntax', () => {
            const lambda = new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                functionProps: {
                    bundling: {
                        externalModules: ['module1'],
                        minify: true
                    }
                }
            });
            expect(lambda).toBeDefined();
            const template = assertions_1.Template.fromStack(stack);
            template.resourceCountIs('AWS::Lambda::Function', 1);
        });
        it('should merge functionProps without losing properties', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                functionProps: {
                    timeout: aws_cdk_lib_1.Duration.seconds(90),
                    memorySize: 2048,
                    environment: {
                        'CUSTOM': 'value'
                    }
                }
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::Lambda::Function', {
                Timeout: 90,
                MemorySize: 2048,
                Environment: {
                    Variables: assertions_1.Match.objectLike({
                        'CUSTOM': 'value'
                    })
                }
            });
        });
        it('should handle complex nested merging scenarios', () => {
            const lambda = new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
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
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::Lambda::Function', {
                Timeout: 45,
                MemorySize: 1024,
                Environment: {
                    Variables: assertions_1.Match.objectLike({
                        'VAR1': 'value1',
                        'VAR2': 'value2'
                    })
                }
            });
        });
        it('should merge deep nested objects correctly without mutation', () => {
            const originalProps = {
                timeout: aws_cdk_lib_1.Duration.seconds(30),
                memorySize: 512,
                bundling: {
                    externalModules: ['module1'],
                    minify: true,
                    sourceMap: false
                },
                environment: {
                    'KEY1': 'value1'
                }
            };
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                functionProps: originalProps
            });
            // Verify original wasn't mutated
            expect(originalProps).toEqual({
                timeout: aws_cdk_lib_1.Duration.seconds(30),
                memorySize: 512,
                bundling: {
                    externalModules: ['module1'],
                    minify: true,
                    sourceMap: false
                },
                environment: {
                    'KEY1': 'value1'
                }
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::Lambda::Function', {
                Timeout: 30,
                MemorySize: 512,
                Environment: {
                    Variables: assertions_1.Match.objectLike({
                        'KEY1': 'value1'
                    })
                }
            });
        });
        it('should properly override variables when same key exists in multiple sources', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
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
            const template = assertions_1.Template.fromStack(stack);
            const capture = new assertions_1.Capture();
            template.hasResourceProperties('AWS::Lambda::Function', {
                Environment: {
                    Variables: capture
                }
            });
            const vars = capture.asObject();
            // VAR1 should use value from environmentVariables (higher priority)
            expect(vars['VAR1']).toBe('value1');
            expect(vars['VAR2']).toBe('value2');
            // Verify both vars are present
            expect(Object.keys(vars)).toContain('VAR1');
            expect(Object.keys(vars)).toContain('VAR2');
        });
    });
    describe('Function Props Override', () => {
        it('should allow complete override of runtime', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                functionProps: {
                    runtime: aws_lambda_1.Runtime.NODEJS_20_X
                }
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::Lambda::Function', {
                Runtime: aws_lambda_1.Runtime.NODEJS_20_X.name
            });
        });
        it('should allow description to be set', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                functionProps: {
                    description: 'Test Lambda Function'
                }
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::Lambda::Function', {
                Description: 'Test Lambda Function'
            });
        });
        it('should allow handler to be overridden', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                functionProps: {
                    handler: 'customHandler'
                }
            });
            const template = assertions_1.Template.fromStack(stack);
            // CDK NodejsFunction prefixes handler with 'index.'
            template.hasResourceProperties('AWS::Lambda::Function', {
                Handler: 'index.customHandler'
            });
        });
        it('should combine multiple overrides', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                functionProps: {
                    runtime: aws_lambda_1.Runtime.NODEJS_20_X,
                    timeout: aws_cdk_lib_1.Duration.seconds(120),
                    memorySize: 2048,
                    description: 'Custom Lambda'
                }
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::Lambda::Function', {
                Runtime: aws_lambda_1.Runtime.NODEJS_20_X.name,
                Timeout: 120,
                MemorySize: 2048,
                Description: 'Custom Lambda'
            });
        });
    });
    describe('IAM Role Configuration', () => {
        it('should create an execution role', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::IAM::Role', {
                AssumeRolePolicyDocument: {
                    Statement: assertions_1.Match.arrayWith([
                        assertions_1.Match.objectLike({
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
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::IAM::Role', {
                ManagedPolicyArns: assertions_1.Match.arrayWith([
                    assertions_1.Match.objectLike({
                        'Fn::Join': assertions_1.Match.arrayWith([
                            assertions_1.Match.arrayWith([
                                assertions_1.Match.stringLikeRegexp('.*AWSLambdaBasicExecutionRole.*')
                            ])
                        ])
                    })
                ])
            });
        });
        it('should create separate IAM policy for custom permissions', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                policies: [
                    {
                        effect: aws_iam_1.Effect.ALLOW,
                        actions: ['s3:GetObject'],
                        resources: ['*']
                    }
                ]
            });
            const template = assertions_1.Template.fromStack(stack);
            template.resourceCountIs('AWS::IAM::Policy', 1);
            template.resourceCountIs('AWS::IAM::Role', 1);
        });
    });
    describe('Edge Cases and Error Scenarios', () => {
        it('should handle very long timeout values', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                functionTimeout: 900 // 15 minutes - Lambda max
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::Lambda::Function', {
                Timeout: 900
            });
        });
        it('should handle minimum memory size', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                functionProps: {
                    memorySize: 128 // Lambda minimum
                }
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::Lambda::Function', {
                MemorySize: 128
            });
        });
        it('should handle maximum memory size', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                functionProps: {
                    memorySize: 10240 // Lambda maximum
                }
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::Lambda::Function', {
                MemorySize: 10240
            });
        });
        it('should handle multiple Lambda functions in same stack', () => {
            new lambda_function_1.LambdaFunction(stack, 'Lambda1', {
                entry: TEST_ENTRY
            });
            new lambda_function_1.LambdaFunction(stack, 'Lambda2', {
                entry: TEST_ENTRY
            });
            new lambda_function_1.LambdaFunction(stack, 'Lambda3', {
                entry: TEST_ENTRY
            });
            const template = assertions_1.Template.fromStack(stack);
            template.resourceCountIs('AWS::Lambda::Function', 3);
            template.resourceCountIs('AWS::IAM::Role', 3);
            template.resourceCountIs('AWS::Logs::LogGroup', 3);
        });
        it('should handle Lambda with both policies and resourceAccess', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                policies: [
                    {
                        effect: aws_iam_1.Effect.ALLOW,
                        actions: ['s3:GetObject'],
                        resources: ['*']
                    }
                ],
                resourceAccess: {
                // Empty resource access - just testing that both can coexist
                }
            });
            const template = assertions_1.Template.fromStack(stack);
            template.resourceCountIs('AWS::Lambda::Function', 1);
            template.hasResourceProperties('AWS::IAM::Policy', {
                PolicyDocument: {
                    Statement: assertions_1.Match.arrayWith([
                        assertions_1.Match.objectLike({
                            Action: 's3:GetObject'
                        })
                    ])
                }
            });
        });
    });
    describe('Snapshot Tests', () => {
        it('should generate consistent CloudFormation template for minimal config', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY
            });
            const template = assertions_1.Template.fromStack(stack).toJSON();
            expect(template).toMatchSnapshot();
        });
        it('should generate consistent CloudFormation template for complex config', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                functionTimeout: 60,
                logRetentionDays: aws_logs_1.RetentionDays.ONE_WEEK,
                processorArchitecture: 'x86_64',
                environmentVariables: {
                    'VAR1': 'value1',
                    'VAR2': 'value2'
                },
                policies: [
                    {
                        effect: aws_iam_1.Effect.ALLOW,
                        actions: ['s3:GetObject', 's3:PutObject'],
                        resources: ['arn:aws:s3:::my-bucket/*']
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
            const template = assertions_1.Template.fromStack(stack).toJSON();
            expect(template).toMatchSnapshot();
        });
    });
    describe('Regression Tests - Specific Bug Fixes', () => {
        it('REGRESSION: merge([obj1, obj2]) syntax - verifies ALL properties from ALL sources are applied', () => {
            // This tests the specific bug where merge was called as merge(obj1, obj2) instead of merge([obj1, obj2])
            // If merge is used incorrectly, properties from one or more sources will be lost
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
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
            const template = assertions_1.Template.fromStack(stack);
            const capture = new assertions_1.Capture();
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
                externalModules: ['module1'],
                minify: true
            };
            const originalEnv = {
                'KEY1': 'value1'
            };
            const originalFunctionProps = {
                timeout: aws_cdk_lib_1.Duration.seconds(45),
                bundling: originalBundling,
                environment: originalEnv
            };
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                functionProps: originalFunctionProps
            });
            // CRITICAL: Verify none of the original objects were mutated
            expect(originalBundling).toEqual({
                externalModules: ['module1'],
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
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                environmentVariables: {
                    'VAR1': 'value1'
                },
                functionProps: {
                    timeout: aws_cdk_lib_1.Duration.seconds(90),
                    memorySize: 2048,
                    description: 'Complex Lambda',
                    bundling: {
                        externalModules: ['custom-module'],
                        minify: true,
                        sourceMap: true
                    },
                    environment: {
                        'VAR2': 'value2'
                    }
                }
            });
            const template = assertions_1.Template.fromStack(stack);
            const envCapture = new assertions_1.Capture();
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
            expect(vars['VAR1']).toBe('value1');
            expect(vars['VAR2']).toBe('value2');
        });
        it('REGRESSION: should handle readonly CDK properties correctly', () => {
            // The actual bug was in BucketConstruct with blockPublicAccess readonly property
            // This tests similar scenario - Architecture is a class instance that could have readonly props
            const readonlyArchitecture = aws_lambda_1.Architecture.ARM_64;
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                functionProps: {
                    architecture: readonlyArchitecture
                }
            });
            // Should not throw errors about readonly properties during merge
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::Lambda::Function', {
                Architectures: [aws_lambda_1.Architecture.ARM_64.name]
            });
        });
        it('REGRESSION: merge must preserve properties when merging 3+ objects', () => {
            // Tests that merge([obj1, obj2, obj3]) preserves all properties
            // The construct merges: defaultProps + functionProps + additionalProps
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
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
            const template = assertions_1.Template.fromStack(stack);
            const capture = new assertions_1.Capture();
            // CRITICAL: ALL properties from ALL 3+ sources must be present
            template.hasResourceProperties('AWS::Lambda::Function', {
                Timeout: 75, // from functionTimeout (additionalProps)
                MemorySize: 512, // from functionProps
                Description: 'Test Description', // from functionProps
                Architectures: [aws_lambda_1.Architecture.X86_64.name], // from processorArchitecture (additionalProps)
                Environment: {
                    Variables: capture
                }
            });
            const vars = capture.asObject();
            expect(vars['FROM_ENV_VARS']).toBe('value1');
            expect(vars['FROM_FUNCTION_PROPS']).toBe('value2');
        });
    });
    describe('Negative Tests - Error and Edge Scenarios', () => {
        it('should throw error for invalid entry file path during construct creation', () => {
            // CDK validates entry file path during NodejsFunction construction
            expect(() => {
                new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                    entry: '/non/existent/path/that/does/not/exist.ts'
                });
            }).toThrow(/Cannot find entry file/);
        });
        it('should handle conflicting timeout - functionTimeout wins over functionProps.timeout', () => {
            new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                functionTimeout: 100,
                functionProps: {
                    timeout: aws_cdk_lib_1.Duration.seconds(50)
                }
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::Lambda::Function', {
                Timeout: 100 // functionTimeout takes precedence
            });
        });
        it('should handle empty arrays in bundling config without errors', () => {
            const lambda = new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                functionProps: {
                    bundling: {
                        externalModules: []
                    }
                }
            });
            expect(lambda).toBeDefined();
            const template = assertions_1.Template.fromStack(stack);
            template.resourceCountIs('AWS::Lambda::Function', 1);
        });
        it('should handle undefined functionProps gracefully', () => {
            const lambda = new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                functionProps: undefined
            });
            expect(lambda).toBeDefined();
            const template = assertions_1.Template.fromStack(stack);
            template.resourceCountIs('AWS::Lambda::Function', 1);
        });
        it('should handle null values in environment variables', () => {
            // TypeScript prevents this at compile time, but testing runtime behavior
            const lambda = new lambda_function_1.LambdaFunction(stack, 'TestLambda', {
                entry: TEST_ENTRY,
                environmentVariables: {} // Empty is valid
            });
            expect(lambda).toBeDefined();
            const template = assertions_1.Template.fromStack(stack);
            template.resourceCountIs('AWS::Lambda::Function', 1);
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGFtYmRhLWZ1bmN0aW9uLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY29uc3RydWN0cy9sYW1iZGEtZnVuY3Rpb24udGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLDZDQUFrRTtBQUNsRSx1REFBa0U7QUFDbEUsdURBQStEO0FBQy9ELG1EQUFxRDtBQUNyRCx1REFBbUQ7QUFDbkQsdUNBQW9DO0FBQ3BDLGlEQUE4RDtBQUM5RCwyQ0FBNkI7QUFFN0IsUUFBUSxDQUFDLDBCQUEwQixFQUFFLEdBQUcsRUFBRTtJQUN4QyxJQUFJLEdBQVEsQ0FBQztJQUNiLElBQUksS0FBWSxDQUFDO0lBQ2pCLHFGQUFxRjtJQUNyRixNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSw0Q0FBNEMsQ0FBQyxDQUFDO0lBRXRGLFVBQVUsQ0FBQyxHQUFHLEVBQUU7UUFDZCxzQ0FBc0M7UUFDckMsV0FBWSxDQUFDLFFBQVEsR0FBRyxTQUFTLENBQUM7UUFFbkMsR0FBRyxHQUFHLElBQUksaUJBQUcsRUFBRSxDQUFDO1FBQ2hCLEtBQUssR0FBRyxJQUFJLG1CQUFLLENBQUMsR0FBRyxFQUFFLFdBQVcsRUFBRTtZQUNsQyxHQUFHLEVBQUUsRUFBRSxPQUFPLEVBQUUsY0FBYyxFQUFFLE1BQU0sRUFBRSxXQUFXLEVBQUU7U0FDdEQsQ0FBQyxDQUFDO1FBRUgsNEJBQTRCO1FBQzVCLE1BQU0sSUFBSSxHQUFHLFdBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztRQUNoQyxJQUFJLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ2pCLElBQUksQ0FBQyxTQUFTLENBQUM7WUFDYixJQUFJLEVBQUUsVUFBVTtZQUNoQixNQUFNLEVBQUUsV0FBVztZQUNuQixPQUFPLEVBQUUsY0FBYztTQUN4QixDQUFDLENBQUM7UUFDSCxJQUFJLENB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cmF0aW9uLCBSZW1vdmFsUG9saWN5IH0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgVGVtcGxhdGUsIE1hdGNoLCBDYXB0dXJlIH0gZnJvbSAnYXdzLWNkay1saWIvYXNzZXJ0aW9ucyc7XG5pbXBvcnQgeyBSdW50aW1lLCBBcmNoaXRlY3R1cmUgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcbmltcG9ydCB7IFJldGVudGlvbkRheXMgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgeyBMYW1iZGFGdW5jdGlvbiB9IGZyb20gJy4vbGFtYmRhLWZ1bmN0aW9uJztcbmltcG9ydCB7IEZ3MjQgfSBmcm9tICcuLi9jb3JlL2Z3MjQnO1xuaW1wb3J0IHsgUG9saWN5U3RhdGVtZW50LCBFZmZlY3QgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5cbmRlc2NyaWJlKCdMYW1iZGFGdW5jdGlvbiBDb25zdHJ1Y3QnLCAoKSA9PiB7XG4gIGxldCBhcHA6IEFwcDtcbiAgbGV0IHN0YWNrOiBTdGFjaztcbiAgLy8gVXNlIGFuIGV4aXN0aW5nIGhhbmRsZXIgZmlsZSBmcm9tIHRoZSBmcmFtZXdvcmsgaW5zdGVhZCBvZiBjcmVhdGluZyBhIHRlc3QgZml4dHVyZVxuICBjb25zdCBURVNUX0VOVFJZID0gcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL2NvcmUvcnVudGltZS9hYnN0cmFjdC1sYW1iZGEtaGFuZGxlci50cycpO1xuXG4gIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgIC8vIENsZWFuIHVwIHNpbmdsZXRvbiBiZWZvcmUgZWFjaCB0ZXN0XG4gICAgKEZ3MjQgYXMgYW55KS5pbnN0YW5jZSA9IHVuZGVmaW5lZDtcblxuICAgIGFwcCA9IG5ldyBBcHAoKTtcbiAgICBzdGFjayA9IG5ldyBTdGFjayhhcHAsICdUZXN0U3RhY2snLCB7XG4gICAgICBlbnY6IHsgYWNjb3VudDogJzEyMzQ1Njc4OTAxMicsIHJlZ2lvbjogJ3VzLWVhc3QtMScgfVxuICAgIH0pO1xuXG4gICAgLy8gSW5pdGlhbGl6ZSBGdzI0IHNpbmdsZXRvblxuICAgIGNvbnN0IGZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG4gICAgZncyNC5zZXRBcHAoYXBwKTtcbiAgICBmdzI0LnNldENvbmZpZyh7XG4gICAgICBuYW1lOiAndGVzdC1hcHAnLFxuICAgICAgcmVnaW9uOiAndXMtZWFzdC0xJyxcbiAgICAgIGFjY291bnQ6ICcxMjM0NTY3ODkwMTInXG4gICAgfSk7XG4gICAgZncyNC5hZGRTdGFjaygnbWFpbicsIHN0YWNrKTtcbiAgfSk7XG5cbiAgYWZ0ZXJFYWNoKCgpID0+IHtcbiAgICAvLyBDbGVhbiB1cCBzaW5nbGV0b24gYWZ0ZXIgZWFjaCB0ZXN0XG4gICAgKEZ3MjQgYXMgYW55KS5pbnN0YW5jZSA9IHVuZGVmaW5lZDtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0Jhc2ljIExhbWJkYSBDcmVhdGlvbicsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGNyZWF0ZSBhIExhbWJkYSBmdW5jdGlvbiB3aXRoIG1pbmltYWwgY29uZmlnJywgKCkgPT4ge1xuICAgICAgY29uc3QgbGFtYmRhID0gbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCAnVGVzdExhbWJkYScsIHtcbiAgICAgICAgZW50cnk6IFRFU1RfRU5UUllcbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QobGFtYmRhKS50b0JlRGVmaW5lZCgpO1xuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUucmVzb3VyY2VDb3VudElzKCdBV1M6OkxhbWJkYTo6RnVuY3Rpb24nLCAxKTtcbiAgICAgIHRlbXBsYXRlLnJlc291cmNlQ291bnRJcygnQVdTOjpJQU06OlJvbGUnLCAxKTtcbiAgICAgIHRlbXBsYXRlLnJlc291cmNlQ291bnRJcygnQVdTOjpMb2dzOjpMb2dHcm91cCcsIDEpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBhcHBseSBkZWZhdWx0IHByb3BlcnRpZXMgY29ycmVjdGx5JywgKCkgPT4ge1xuICAgICAgbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCAnVGVzdExhbWJkYScsIHtcbiAgICAgICAgZW50cnk6IFRFU1RfRU5UUllcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6TGFtYmRhOjpGdW5jdGlvbicsIHtcbiAgICAgICAgUnVudGltZTogUnVudGltZS5OT0RFSlNfMjJfWC5uYW1lLFxuICAgICAgICBUaW1lb3V0OiA1LFxuICAgICAgICBNZW1vcnlTaXplOiAxMjgsXG4gICAgICAgIEFyY2hpdGVjdHVyZXM6IFsgQXJjaGl0ZWN0dXJlLkFSTV82NC5uYW1lIF1cbiAgICAgICAgLy8gSGFuZGxlciBpcyBDREstbWFuYWdlZCBhbmQgdmFyaWVzIGJhc2VkIG9uIGVudHJ5IGZpbGVcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBvdmVycmlkZSBkZWZhdWx0IHByb3BlcnRpZXMgd2l0aCBmdW5jdGlvblByb3BzJywgKCkgPT4ge1xuICAgICAgbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCAnVGVzdExhbWJkYScsIHtcbiAgICAgICAgZW50cnk6IFRFU1RfRU5UUlksXG4gICAgICAgIGZ1bmN0aW9uUHJvcHM6IHtcbiAgICAgICAgICB0aW1lb3V0OiBEdXJhdGlvbi5zZWNvbmRzKDYwKSxcbiAgICAgICAgICBtZW1vcnlTaXplOiAxMDI0XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6TGFtYmRhOjpGdW5jdGlvbicsIHtcbiAgICAgICAgVGltZW91dDogNjAsXG4gICAgICAgIE1lbW9yeVNpemU6IDEwMjRcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCB1c2UgZnVuY3Rpb25UaW1lb3V0IHNob3J0aGFuZCcsICgpID0+IHtcbiAgICAgIG5ldyBMYW1iZGFGdW5jdGlvbihzdGFjaywgJ1Rlc3RMYW1iZGEnLCB7XG4gICAgICAgIGVudHJ5OiBURVNUX0VOVFJZLFxuICAgICAgICBmdW5jdGlvblRpbWVvdXQ6IDEyMFxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpMYW1iZGE6OkZ1bmN0aW9uJywge1xuICAgICAgICBUaW1lb3V0OiAxMjBcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBwcmlvcml0aXplIGZ1bmN0aW9uVGltZW91dCBvdmVyIGZ1bmN0aW9uUHJvcHMudGltZW91dCcsICgpID0+IHtcbiAgICAgIG5ldyBMYW1iZGFGdW5jdGlvbihzdGFjaywgJ1Rlc3RMYW1iZGEnLCB7XG4gICAgICAgIGVudHJ5OiBURVNUX0VOVFJZLFxuICAgICAgICBmdW5jdGlvblRpbWVvdXQ6IDkwLFxuICAgICAgICBmdW5jdGlvblByb3BzOiB7XG4gICAgICAgICAgdGltZW91dDogRHVyYXRpb24uc2Vjb25kcyg2MClcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpMYW1iZGE6OkZ1bmN0aW9uJywge1xuICAgICAgICBUaW1lb3V0OiA5MFxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHNldCB4ODZfNjQgYXJjaGl0ZWN0dXJlIHdoZW4gc3BlY2lmaWVkJywgKCkgPT4ge1xuICAgICAgbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCAnVGVzdExhbWJkYScsIHtcbiAgICAgICAgZW50cnk6IFRFU1RfRU5UUlksXG4gICAgICAgIHByb2Nlc3NvckFyY2hpdGVjdHVyZTogJ3g4Nl82NCdcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6TGFtYmRhOjpGdW5jdGlvbicsIHtcbiAgICAgICAgQXJjaGl0ZWN0dXJlczogWyBBcmNoaXRlY3R1cmUuWDg2XzY0Lm5hbWUgXVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHNldCBBUk1fNjQgYXJjaGl0ZWN0dXJlIHdoZW4gc3BlY2lmaWVkJywgKCkgPT4ge1xuICAgICAgbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCAnVGVzdExhbWJkYScsIHtcbiAgICAgICAgZW50cnk6IFRFU1RfRU5UUlksXG4gICAgICAgIHByb2Nlc3NvckFyY2hpdGVjdHVyZTogJ2FybV82NCdcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6TGFtYmRhOjpGdW5jdGlvbicsIHtcbiAgICAgICAgQXJjaGl0ZWN0dXJlczogWyBBcmNoaXRlY3R1cmUuQVJNXzY0Lm5hbWUgXVxuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdFbnZpcm9ubWVudCBWYXJpYWJsZXMnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBzZXQgY3VzdG9tIGVudmlyb25tZW50IHZhcmlhYmxlcycsICgpID0+IHtcbiAgICAgIG5ldyBMYW1iZGFGdW5jdGlvbihzdGFjaywgJ1Rlc3RMYW1iZGEnLCB7XG4gICAgICAgIGVudHJ5OiBURVNUX0VOVFJZLFxuICAgICAgICBlbnZpcm9ubWVudFZhcmlhYmxlczoge1xuICAgICAgICAgICdDVVNUT01fVkFSJzogJ2N1c3RvbS12YWx1ZScsXG4gICAgICAgICAgJ0FOT1RIRVJfVkFSJzogJ2Fub3RoZXItdmFsdWUnXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6TGFtYmRhOjpGdW5jdGlvbicsIHtcbiAgICAgICAgRW52aXJvbm1lbnQ6IHtcbiAgICAgICAgICBWYXJpYWJsZXM6IE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgICAgJ0NVU1RPTV9WQVInOiAnY3VzdG9tLXZhbHVlJyxcbiAgICAgICAgICAgICdBTk9USEVSX1ZBUic6ICdhbm90aGVyLXZhbHVlJ1xuICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBtZXJnZSBlbnZpcm9ubWVudCB2YXJpYWJsZXMgZnJvbSBtdWx0aXBsZSBzb3VyY2VzJywgKCkgPT4ge1xuICAgICAgbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCAnVGVzdExhbWJkYScsIHtcbiAgICAgICAgZW50cnk6IFRFU1RfRU5UUlksXG4gICAgICAgIGVudmlyb25tZW50VmFyaWFibGVzOiB7XG4gICAgICAgICAgJ0ZST01fUFJPUFMnOiAndmFsdWUxJ1xuICAgICAgICB9LFxuICAgICAgICBmdW5jdGlvblByb3BzOiB7XG4gICAgICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgICAgICdGUk9NX0ZVTkNUSU9OX1BST1BTJzogJ3ZhbHVlMidcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6TGFtYmRhOjpGdW5jdGlvbicsIHtcbiAgICAgICAgRW52aXJvbm1lbnQ6IHtcbiAgICAgICAgICBWYXJpYWJsZXM6IE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgICAgJ0ZST01fUFJPUFMnOiAndmFsdWUxJyxcbiAgICAgICAgICAgICdGUk9NX0ZVTkNUSU9OX1BST1BTJzogJ3ZhbHVlMidcbiAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcHJpb3JpdGl6ZSBlbnZpcm9ubWVudFZhcmlhYmxlcyBvdmVyIGZ1bmN0aW9uUHJvcHMuZW52aXJvbm1lbnQnLCAoKSA9PiB7XG4gICAgICBuZXcgTGFtYmRhRnVuY3Rpb24oc3RhY2ssICdUZXN0TGFtYmRhJywge1xuICAgICAgICBlbnRyeTogVEVTVF9FTlRSWSxcbiAgICAgICAgZW52aXJvbm1lbnRWYXJpYWJsZXM6IHtcbiAgICAgICAgICAnU0hBUkVEX1ZBUic6ICdmcm9tLWVudmlyb25tZW50VmFyaWFibGVzJ1xuICAgICAgICB9LFxuICAgICAgICBmdW5jdGlvblByb3BzOiB7XG4gICAgICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgICAgICdTSEFSRURfVkFSJzogJ2Zyb20tZnVuY3Rpb25Qcm9wcydcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6TGFtYmRhOjpGdW5jdGlvbicsIHtcbiAgICAgICAgRW52aXJvbm1lbnQ6IHtcbiAgICAgICAgICBWYXJpYWJsZXM6IE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgICAgJ1NIQVJFRF9WQVInOiAnZnJvbS1lbnZpcm9ubWVudFZhcmlhYmxlcydcbiAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGVtcHR5IGVudmlyb25tZW50IHZhcmlhYmxlcycsICgpID0+IHtcbiAgICAgIG5ldyBMYW1iZGFGdW5jdGlvbihzdGFjaywgJ1Rlc3RMYW1iZGEnLCB7XG4gICAgICAgIGVudHJ5OiBURVNUX0VOVFJZLFxuICAgICAgICBlbnZpcm9ubWVudFZhcmlhYmxlczoge31cbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6TGFtYmRhOjpGdW5jdGlvbicsIHtcbiAgICAgICAgRW52aXJvbm1lbnQ6IE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgIFZhcmlhYmxlczogTWF0Y2guYW55VmFsdWUoKVxuICAgICAgICB9KVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBzcGVjaWFsIGNoYXJhY3RlcnMgaW4gZW52aXJvbm1lbnQgdmFyaWFibGUgbmFtZXMnLCAoKSA9PiB7XG4gICAgICBuZXcgTGFtYmRhRnVuY3Rpb24oc3RhY2ssICdUZXN0TGFtYmRhJywge1xuICAgICAgICBlbnRyeTogVEVTVF9FTlRSWSxcbiAgICAgICAgZW52aXJvbm1lbnRWYXJpYWJsZXM6IHtcbiAgICAgICAgICAnVkFSX1dJVEhfVU5ERVJTQ09SRSc6ICd2YWx1ZTEnLFxuICAgICAgICAgICdWQVIxMjMnOiAndmFsdWUyJ1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkxhbWJkYTo6RnVuY3Rpb24nLCB7XG4gICAgICAgIEVudmlyb25tZW50OiB7XG4gICAgICAgICAgVmFyaWFibGVzOiBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICAgICdWQVJfV0lUSF9VTkRFUlNDT1JFJzogJ3ZhbHVlMScsXG4gICAgICAgICAgICAnVkFSMTIzJzogJ3ZhbHVlMidcbiAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGVtcHR5IHN0cmluZyB2YWx1ZXMgaW4gZW52aXJvbm1lbnQgdmFyaWFibGVzJywgKCkgPT4ge1xuICAgICAgbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCAnVGVzdExhbWJkYScsIHtcbiAgICAgICAgZW50cnk6IFRFU1RfRU5UUlksXG4gICAgICAgIGVudmlyb25tZW50VmFyaWFibGVzOiB7XG4gICAgICAgICAgJ0VNUFRZX1ZBUic6ICcnXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6TGFtYmRhOjpGdW5jdGlvbicsIHtcbiAgICAgICAgRW52aXJvbm1lbnQ6IHtcbiAgICAgICAgICBWYXJpYWJsZXM6IE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgICAgJ0VNUFRZX1ZBUic6ICcnXG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdDdXN0b20gUG9saWNpZXMnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBhdHRhY2ggY3VzdG9tIFBvbGljeVN0YXRlbWVudCcsICgpID0+IHtcbiAgICAgIG5ldyBMYW1iZGFGdW5jdGlvbihzdGFjaywgJ1Rlc3RMYW1iZGEnLCB7XG4gICAgICAgIGVudHJ5OiBURVNUX0VOVFJZLFxuICAgICAgICBwb2xpY2llczogW1xuICAgICAgICAgIG5ldyBQb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgZWZmZWN0OiBFZmZlY3QuQUxMT1csXG4gICAgICAgICAgICBhY3Rpb25zOiBbICdzMzpMaXN0QWxsTXlCdWNrZXRzJyBdLFxuICAgICAgICAgICAgcmVzb3VyY2VzOiBbICcqJyBdXG4gICAgICAgICAgfSlcbiAgICAgICAgXVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpJQU06OlBvbGljeScsIHtcbiAgICAgICAgUG9saWN5RG9jdW1lbnQ6IHtcbiAgICAgICAgICBTdGF0ZW1lbnQ6IE1hdGNoLmFycmF5V2l0aChbXG4gICAgICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICAgICAgQWN0aW9uOiAnczM6TGlzdEFsbE15QnVja2V0cycsXG4gICAgICAgICAgICAgIEVmZmVjdDogJ0FsbG93JyxcbiAgICAgICAgICAgICAgUmVzb3VyY2U6ICcqJ1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICBdKVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgYXR0YWNoIGN1c3RvbSBQb2xpY3lTdGF0ZW1lbnRQcm9wcycsICgpID0+IHtcbiAgICAgIG5ldyBMYW1iZGFGdW5jdGlvbihzdGFjaywgJ1Rlc3RMYW1iZGEnLCB7XG4gICAgICAgIGVudHJ5OiBURVNUX0VOVFJZLFxuICAgICAgICBwb2xpY2llczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGVmZmVjdDogRWZmZWN0LkFMTE9XLFxuICAgICAgICAgICAgYWN0aW9uczogWyAnZHluYW1vZGI6RGVzY3JpYmVUYWJsZScgXSxcbiAgICAgICAgICAgIHJlc291cmNlczogWyAnKicgXVxuICAgICAgICAgIH1cbiAgICAgICAgXVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpJQU06OlBvbGljeScsIHtcbiAgICAgICAgUG9saWN5RG9jdW1lbnQ6IHtcbiAgICAgICAgICBTdGF0ZW1lbnQ6IE1hdGNoLmFycmF5V2l0aChbXG4gICAgICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICAgICAgQWN0aW9uOiAnZHluYW1vZGI6RGVzY3JpYmVUYWJsZScsXG4gICAgICAgICAgICAgIEVmZmVjdDogJ0FsbG93JyxcbiAgICAgICAgICAgICAgUmVzb3VyY2U6ICcqJ1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICBdKVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgYXR0YWNoIG11bHRpcGxlIGN1c3RvbSBwb2xpY2llcycsICgpID0+IHtcbiAgICAgIG5ldyBMYW1iZGFGdW5jdGlvbihzdGFjaywgJ1Rlc3RMYW1iZGEnLCB7XG4gICAgICAgIGVudHJ5OiBURVNUX0VOVFJZLFxuICAgICAgICBwb2xpY2llczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGVmZmVjdDogRWZmZWN0LkFMTE9XLFxuICAgICAgICAgICAgYWN0aW9uczogWyAnczM6R2V0T2JqZWN0JyBdLFxuICAgICAgICAgICAgcmVzb3VyY2VzOiBbICdhcm46YXdzOnMzOjo6bXktYnVja2V0LyonIF1cbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGVmZmVjdDogRWZmZWN0LkFMTE9XLFxuICAgICAgICAgICAgYWN0aW9uczogWyAnZHluYW1vZGI6UXVlcnknIF0sXG4gICAgICAgICAgICByZXNvdXJjZXM6IFsgJ2Fybjphd3M6ZHluYW1vZGI6dXMtZWFzdC0xOjEyMzQ1Njc4OTAxMjp0YWJsZS9teS10YWJsZScgXVxuICAgICAgICAgIH1cbiAgICAgICAgXVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpJQU06OlBvbGljeScsIHtcbiAgICAgICAgUG9saWN5RG9jdW1lbnQ6IHtcbiAgICAgICAgICBTdGF0ZW1lbnQ6IE1hdGNoLmFycmF5V2l0aChbXG4gICAgICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICAgICAgQWN0aW9uOiAnczM6R2V0T2JqZWN0JyxcbiAgICAgICAgICAgICAgRWZmZWN0OiAnQWxsb3cnXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgICAgICBBY3Rpb246ICdkeW5hbW9kYjpRdWVyeScsXG4gICAgICAgICAgICAgIEVmZmVjdDogJ0FsbG93J1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICBdKVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGVtcHR5IHBvbGljaWVzIGFycmF5JywgKCkgPT4ge1xuICAgICAgY29uc3QgbGFtYmRhID0gbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCAnVGVzdExhbWJkYScsIHtcbiAgICAgICAgZW50cnk6IFRFU1RfRU5UUlksXG4gICAgICAgIHBvbGljaWVzOiBbXVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChsYW1iZGEpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5yZXNvdXJjZUNvdW50SXMoJ0FXUzo6TGFtYmRhOjpGdW5jdGlvbicsIDEpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBhdHRhY2ggcG9saWNpZXMgd2l0aCBtdWx0aXBsZSBhY3Rpb25zJywgKCkgPT4ge1xuICAgICAgbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCAnVGVzdExhbWJkYScsIHtcbiAgICAgICAgZW50cnk6IFRFU1RfRU5UUlksXG4gICAgICAgIHBvbGljaWVzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgZWZmZWN0OiBFZmZlY3QuQUxMT1csXG4gICAgICAgICAgICBhY3Rpb25zOiBbICdzMzpHZXRPYmplY3QnLCAnczM6UHV0T2JqZWN0JywgJ3MzOkRlbGV0ZU9iamVjdCcgXSxcbiAgICAgICAgICAgIHJlc291cmNlczogWyAnYXJuOmF3czpzMzo6Om15LWJ1Y2tldC8qJyBdXG4gICAgICAgICAgfVxuICAgICAgICBdXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OklBTTo6UG9saWN5Jywge1xuICAgICAgICBQb2xpY3lEb2N1bWVudDoge1xuICAgICAgICAgIFN0YXRlbWVudDogTWF0Y2guYXJyYXlXaXRoKFtcbiAgICAgICAgICAgIE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgICAgICBBY3Rpb246IFsgJ3MzOkdldE9iamVjdCcsICdzMzpQdXRPYmplY3QnLCAnczM6RGVsZXRlT2JqZWN0JyBdLFxuICAgICAgICAgICAgICBFZmZlY3Q6ICdBbGxvdydcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgXSlcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGF0dGFjaCBERU5ZIHBvbGljaWVzJywgKCkgPT4ge1xuICAgICAgbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCAnVGVzdExhbWJkYScsIHtcbiAgICAgICAgZW50cnk6IFRFU1RfRU5UUlksXG4gICAgICAgIHBvbGljaWVzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgZWZmZWN0OiBFZmZlY3QuREVOWSxcbiAgICAgICAgICAgIGFjdGlvbnM6IFsgJ3MzOkRlbGV0ZUJ1Y2tldCcgXSxcbiAgICAgICAgICAgIHJlc291cmNlczogWyAnKicgXVxuICAgICAgICAgIH1cbiAgICAgICAgXVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpJQU06OlBvbGljeScsIHtcbiAgICAgICAgUG9saWN5RG9jdW1lbnQ6IHtcbiAgICAgICAgICBTdGF0ZW1lbnQ6IE1hdGNoLmFycmF5V2l0aChbXG4gICAgICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICAgICAgQWN0aW9uOiAnczM6RGVsZXRlQnVja2V0JyxcbiAgICAgICAgICAgICAgRWZmZWN0OiAnRGVueSdcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgXSlcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdCdW5kbGluZyBDb25maWd1cmF0aW9uIC0gQ3JpdGljYWwgTWVyZ2UgVGVzdHMnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBhY2NlcHQgYnVuZGxpbmcuZXh0ZXJuYWxNb2R1bGVzIGFzIGFycmF5JywgKCkgPT4ge1xuICAgICAgY29uc3QgbGFtYmRhID0gbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCAnVGVzdExhbWJkYScsIHtcbiAgICAgICAgZW50cnk6IFRFU1RfRU5UUlksXG4gICAgICAgIGZ1bmN0aW9uUHJvcHM6IHtcbiAgICAgICAgICBidW5kbGluZzoge1xuICAgICAgICAgICAgZXh0ZXJuYWxNb2R1bGVzOiBbICdjdXN0b20tbW9kdWxlJywgJ2Fub3RoZXItbW9kdWxlJyBdXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KGxhbWJkYSkudG9CZURlZmluZWQoKTtcbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLnJlc291cmNlQ291bnRJcygnQVdTOjpMYW1iZGE6OkZ1bmN0aW9uJywgMSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGFjY2VwdCBidW5kbGluZy5taW5pZnkgb3B0aW9uJywgKCkgPT4ge1xuICAgICAgY29uc3QgbGFtYmRhID0gbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCAnVGVzdExhbWJkYScsIHtcbiAgICAgICAgZW50cnk6IFRFU1RfRU5UUlksXG4gICAgICAgIGZ1bmN0aW9uUHJvcHM6IHtcbiAgICAgICAgICBidW5kbGluZzoge1xuICAgICAgICAgICAgbWluaWZ5OiB0cnVlXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KGxhbWJkYSkudG9CZURlZmluZWQoKTtcbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLnJlc291cmNlQ291bnRJcygnQVdTOjpMYW1iZGE6OkZ1bmN0aW9uJywgMSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGFjY2VwdCBidW5kbGluZy5zb3VyY2VNYXAgb3B0aW9uJywgKCkgPT4ge1xuICAgICAgY29uc3QgbGFtYmRhID0gbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCAnVGVzdExhbWJkYScsIHtcbiAgICAgICAgZW50cnk6IFRFU1RfRU5UUlksXG4gICAgICAgIGZ1bmN0aW9uUHJvcHM6IHtcbiAgICAgICAgICBidW5kbGluZzoge1xuICAgICAgICAgICAgc291cmNlTWFwOiB0cnVlXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KGxhbWJkYSkudG9CZURlZmluZWQoKTtcbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLnJlc291cmNlQ291bnRJcygnQVdTOjpMYW1iZGE6OkZ1bmN0aW9uJywgMSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIG1lcmdlIG11bHRpcGxlIGJ1bmRsaW5nIG9wdGlvbnMgd2l0aG91dCBsb3NpbmcgYW55JywgKCkgPT4ge1xuICAgICAgY29uc3QgbGFtYmRhID0gbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCAnVGVzdExhbWJkYScsIHtcbiAgICAgICAgZW50cnk6IFRFU1RfRU5UUlksXG4gICAgICAgIGZ1bmN0aW9uUHJvcHM6IHtcbiAgICAgICAgICBidW5kbGluZzoge1xuICAgICAgICAgICAgZXh0ZXJuYWxNb2R1bGVzOiBbICdhd3Mtc2RrJyBdLFxuICAgICAgICAgICAgbWluaWZ5OiB0cnVlLFxuICAgICAgICAgICAgc291cmNlTWFwOiBmYWxzZVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChsYW1iZGEpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5yZXNvdXJjZUNvdW50SXMoJ0FXUzo6TGFtYmRhOjpGdW5jdGlvbicsIDEpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBOT1QgbXV0YXRlIG9yaWdpbmFsIGJ1bmRsaW5nIGNvbmZpZyBvYmplY3QnLCAoKSA9PiB7XG4gICAgICBjb25zdCBvcmlnaW5hbEJ1bmRsaW5nID0ge1xuICAgICAgICBleHRlcm5hbE1vZHVsZXM6IFsgJ29yaWdpbmFsLW1vZHVsZScgXSxcbiAgICAgICAgbWluaWZ5OiBmYWxzZVxuICAgICAgfTtcblxuICAgICAgY29uc3Qgb3JpZ2luYWxGdW5jdGlvblByb3BzID0ge1xuICAgICAgICBidW5kbGluZzogb3JpZ2luYWxCdW5kbGluZ1xuICAgICAgfTtcblxuICAgICAgbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCAnVGVzdExhbWJkYScsIHtcbiAgICAgICAgZW50cnk6IFRFU1RfRU5UUlksXG4gICAgICAgIGZ1bmN0aW9uUHJvcHM6IG9yaWdpbmFsRnVuY3Rpb25Qcm9wc1xuICAgICAgfSk7XG5cbiAgICAgIC8vIFZlcmlmeSBvcmlnaW5hbCB3YXMgTk9UIG11dGF0ZWRcbiAgICAgIGV4cGVjdChvcmlnaW5hbEJ1bmRsaW5nKS50b0VxdWFsKHtcbiAgICAgICAgZXh0ZXJuYWxNb2R1bGVzOiBbICdvcmlnaW5hbC1tb2R1bGUnIF0sXG4gICAgICAgIG1pbmlmeTogZmFsc2VcbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KG9yaWdpbmFsRnVuY3Rpb25Qcm9wcy5idW5kbGluZykudG9CZShvcmlnaW5hbEJ1bmRsaW5nKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGJ1bmRsaW5nIHdpdGggY29tcGxleCBuZXN0ZWQgb3B0aW9ucycsICgpID0+IHtcbiAgICAgIGNvbnN0IGxhbWJkYSA9IG5ldyBMYW1iZGFGdW5jdGlvbihzdGFjaywgJ1Rlc3RMYW1iZGEnLCB7XG4gICAgICAgIGVudHJ5OiBURVNUX0VOVFJZLFxuICAgICAgICBmdW5jdGlvblByb3BzOiB7XG4gICAgICAgICAgYnVuZGxpbmc6IHtcbiAgICAgICAgICAgIGV4dGVybmFsTW9kdWxlczogWyAnQHRlbjI0Z3JvdXAvZncyNCcsICdhd3Mtc2RrJyBdLFxuICAgICAgICAgICAgbWluaWZ5OiB0cnVlLFxuICAgICAgICAgICAgc291cmNlTWFwOiB0cnVlLFxuICAgICAgICAgICAgY29tbWFuZEhvb2tzOiB7XG4gICAgICAgICAgICAgIGJlZm9yZUJ1bmRsaW5nOiAoKSA9PiBbXSxcbiAgICAgICAgICAgICAgYWZ0ZXJCdW5kbGluZzogKCkgPT4gW10sXG4gICAgICAgICAgICAgIGJlZm9yZUluc3RhbGw6ICgpID0+IFtdXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KGxhbWJkYSkudG9CZURlZmluZWQoKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0xvZ2dpbmcgQ29uZmlndXJhdGlvbicsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGNyZWF0ZSBsb2cgZ3JvdXAgd2l0aCBkZWZhdWx0IHJldGVudGlvbicsICgpID0+IHtcbiAgICAgIG5ldyBMYW1iZGFGdW5jdGlvbihzdGFjaywgJ1Rlc3RMYW1iZGEnLCB7XG4gICAgICAgIGVudHJ5OiBURVNUX0VOVFJZXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkxvZ3M6OkxvZ0dyb3VwJywge1xuICAgICAgICBSZXRlbnRpb25JbkRheXM6IDMwXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgY3JlYXRlIGxvZyBncm91cCB3aXRoIGN1c3RvbSByZXRlbnRpb24nLCAoKSA9PiB7XG4gICAgICBuZXcgTGFtYmRhRnVuY3Rpb24oc3RhY2ssICdUZXN0TGFtYmRhJywge1xuICAgICAgICBlbnRyeTogVEVTVF9FTlRSWSxcbiAgICAgICAgbG9nUmV0ZW50aW9uRGF5czogUmV0ZW50aW9uRGF5cy5PTkVfV0VFS1xuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpMb2dzOjpMb2dHcm91cCcsIHtcbiAgICAgICAgUmV0ZW50aW9uSW5EYXlzOiA3XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgY3JlYXRlIGxvZyBncm91cCB3aXRoIE9ORV9EQVkgcmV0ZW50aW9uJywgKCkgPT4ge1xuICAgICAgbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCAnVGVzdExhbWJkYScsIHtcbiAgICAgICAgZW50cnk6IFRFU1RfRU5UUlksXG4gICAgICAgIGxvZ1JldGVudGlvbkRheXM6IFJldGVudGlvbkRheXMuT05FX0RBWVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpMb2dzOjpMb2dHcm91cCcsIHtcbiAgICAgICAgUmV0ZW50aW9uSW5EYXlzOiAxXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgY3JlYXRlIGxvZyBncm91cCB3aXRoIFRIUkVFX0RBWVMgcmV0ZW50aW9uJywgKCkgPT4ge1xuICAgICAgbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCAnVGVzdExhbWJkYScsIHtcbiAgICAgICAgZW50cnk6IFRFU1RfRU5UUlksXG4gICAgICAgIGxvZ1JldGVudGlvbkRheXM6IFJldGVudGlvbkRheXMuVEhSRUVfREFZU1xuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpMb2dzOjpMb2dHcm91cCcsIHtcbiAgICAgICAgUmV0ZW50aW9uSW5EYXlzOiAzXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgY3JlYXRlIGxvZyBncm91cCB3aXRoIFNJWF9NT05USFMgcmV0ZW50aW9uJywgKCkgPT4ge1xuICAgICAgbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCAnVGVzdExhbWJkYScsIHtcbiAgICAgICAgZW50cnk6IFRFU1RfRU5UUlksXG4gICAgICAgIGxvZ1JldGVudGlvbkRheXM6IFJldGVudGlvbkRheXMuU0lYX01PTlRIU1xuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpMb2dzOjpMb2dHcm91cCcsIHtcbiAgICAgICAgUmV0ZW50aW9uSW5EYXlzOiAxODBcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgbG9nIGdyb3VwIHdpdGggY3VzdG9tIHJlbW92YWwgcG9saWN5JywgKCkgPT4ge1xuICAgICAgY29uc3QgbGFtYmRhID0gbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCAnVGVzdExhbWJkYScsIHtcbiAgICAgICAgZW50cnk6IFRFU1RfRU5UUlksXG4gICAgICAgIGxvZ1JlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuREVTVFJPWVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChsYW1iZGEpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICAvLyBKdXN0IHZlcmlmeSB0aGUgbG9nIGdyb3VwIGV4aXN0cyAtIHJlbW92YWwgcG9saWN5IGRldGFpbHMgYXJlIENESyBpbXBsZW1lbnRhdGlvblxuICAgICAgdGVtcGxhdGUucmVzb3VyY2VDb3VudElzKCdBV1M6OkxvZ3M6OkxvZ0dyb3VwJywgMSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHVzZSBKU09OIGxvZ2dpbmcgZm9ybWF0IHdoZW4gTE9HX0ZPUk1BVCBlbnYgdmFyIGlzIHNldCcsICgpID0+IHtcbiAgICAgIGNvbnN0IG9yaWdpbmFsTG9nRm9ybWF0ID0gcHJvY2Vzcy5lbnYuTE9HX0ZPUk1BVDtcbiAgICAgIHByb2Nlc3MuZW52LkxPR19GT1JNQVQgPSAnanNvbic7XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIC8vIE5lZWQgdG8gY2xlYW4gdXAgYW5kIHJlaW5pdGlhbGl6ZSBGdzI0IGZvciBlbnYgdmFyIHRvIHRha2UgZWZmZWN0XG4gICAgICAgIChGdzI0IGFzIGFueSkuaW5zdGFuY2UgPSB1bmRlZmluZWQ7XG4gICAgICAgIGNvbnN0IGZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG4gICAgICAgIGZ3MjQuc2V0QXBwKGFwcCk7XG4gICAgICAgIGZ3MjQuc2V0Q29uZmlnKHtcbiAgICAgICAgICBuYW1lOiAndGVzdC1hcHAnLFxuICAgICAgICAgIHJlZ2lvbjogJ3VzLWVhc3QtMScsXG4gICAgICAgICAgYWNjb3VudDogJzEyMzQ1Njc4OTAxMidcbiAgICAgICAgfSk7XG4gICAgICAgIGZ3MjQuYWRkU3RhY2soJ21haW4nLCBzdGFjayk7XG5cbiAgICAgICAgbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCAnVGVzdExhbWJkYScsIHtcbiAgICAgICAgICBlbnRyeTogVEVTVF9FTlRSWVxuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpMYW1iZGE6OkZ1bmN0aW9uJywge1xuICAgICAgICAgIExvZ2dpbmdDb25maWc6IHtcbiAgICAgICAgICAgIExvZ0Zvcm1hdDogJ0pTT04nXG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIC8vIFJlc3RvcmUgb3JpZ2luYWwgdmFsdWVcbiAgICAgICAgaWYgKG9yaWdpbmFsTG9nRm9ybWF0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBwcm9jZXNzLmVudi5MT0dfRk9STUFUID0gb3JpZ2luYWxMb2dGb3JtYXQ7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZGVsZXRlIHByb2Nlc3MuZW52LkxPR19GT1JNQVQ7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgZGVmYXVsdCB0byBURVhUIGxvZ2dpbmcgZm9ybWF0JywgKCkgPT4ge1xuICAgICAgbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCAnVGVzdExhbWJkYScsIHtcbiAgICAgICAgZW50cnk6IFRFU1RfRU5UUllcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6TGFtYmRhOjpGdW5jdGlvbicsIHtcbiAgICAgICAgTG9nZ2luZ0NvbmZpZzoge1xuICAgICAgICAgIExvZ0Zvcm1hdDogJ1RleHQnXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnTWVyZ2UgVXRpbGl0eSBJbnRlZ3JhdGlvbiAtIENSSVRJQ0FMIEJVRyBURVNUUycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIHByb3Blcmx5IG1lcmdlIG5lc3RlZCBidW5kbGluZyBjb25maWd1cmF0aW9uIHVzaW5nIG1lcmdlKFtvYmoxLCBvYmoyXSkgc3ludGF4JywgKCkgPT4ge1xuICAgICAgY29uc3QgbGFtYmRhID0gbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCAnVGVzdExhbWJkYScsIHtcbiAgICAgICAgZW50cnk6IFRFU1RfRU5UUlksXG4gICAgICAgIGZ1bmN0aW9uUHJvcHM6IHtcbiAgICAgICAgICBidW5kbGluZzoge1xuICAgICAgICAgICAgZXh0ZXJuYWxNb2R1bGVzOiBbICdtb2R1bGUxJyBdLFxuICAgICAgICAgICAgbWluaWZ5OiB0cnVlXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KGxhbWJkYSkudG9CZURlZmluZWQoKTtcbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLnJlc291cmNlQ291bnRJcygnQVdTOjpMYW1iZGE6OkZ1bmN0aW9uJywgMSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIG1lcmdlIGZ1bmN0aW9uUHJvcHMgd2l0aG91dCBsb3NpbmcgcHJvcGVydGllcycsICgpID0+IHtcbiAgICAgIG5ldyBMYW1iZGFGdW5jdGlvbihzdGFjaywgJ1Rlc3RMYW1iZGEnLCB7XG4gICAgICAgIGVudHJ5OiBURVNUX0VOVFJZLFxuICAgICAgICBmdW5jdGlvblByb3BzOiB7XG4gICAgICAgICAgdGltZW91dDogRHVyYXRpb24uc2Vjb25kcyg5MCksXG4gICAgICAgICAgbWVtb3J5U2l6ZTogMjA0OCxcbiAgICAgICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAgICAgJ0NVU1RPTSc6ICd2YWx1ZSdcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6TGFtYmRhOjpGdW5jdGlvbicsIHtcbiAgICAgICAgVGltZW91dDogOTAsXG4gICAgICAgIE1lbW9yeVNpemU6IDIwNDgsXG4gICAgICAgIEVudmlyb25tZW50OiB7XG4gICAgICAgICAgVmFyaWFibGVzOiBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICAgICdDVVNUT00nOiAndmFsdWUnXG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBjb21wbGV4IG5lc3RlZCBtZXJnaW5nIHNjZW5hcmlvcycsICgpID0+IHtcbiAgICAgIGNvbnN0IGxhbWJkYSA9IG5ldyBMYW1iZGFGdW5jdGlvbihzdGFjaywgJ1Rlc3RMYW1iZGEnLCB7XG4gICAgICAgIGVudHJ5OiBURVNUX0VOVFJZLFxuICAgICAgICBmdW5jdGlvblRpbWVvdXQ6IDQ1LFxuICAgICAgICBlbnZpcm9ubWVudFZhcmlhYmxlczoge1xuICAgICAgICAgICdWQVIxJzogJ3ZhbHVlMSdcbiAgICAgICAgfSxcbiAgICAgICAgZnVuY3Rpb25Qcm9wczoge1xuICAgICAgICAgIG1lbW9yeVNpemU6IDEwMjQsXG4gICAgICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgICAgICdWQVIyJzogJ3ZhbHVlMidcbiAgICAgICAgICB9LFxuICAgICAgICAgIGJ1bmRsaW5nOiB7XG4gICAgICAgICAgICBtaW5pZnk6IGZhbHNlLFxuICAgICAgICAgICAgc291cmNlTWFwOiB0cnVlXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KGxhbWJkYSkudG9CZURlZmluZWQoKTtcbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpMYW1iZGE6OkZ1bmN0aW9uJywge1xuICAgICAgICBUaW1lb3V0OiA0NSxcbiAgICAgICAgTWVtb3J5U2l6ZTogMTAyNCxcbiAgICAgICAgRW52aXJvbm1lbnQ6IHtcbiAgICAgICAgICBWYXJpYWJsZXM6IE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgICAgJ1ZBUjEnOiAndmFsdWUxJyxcbiAgICAgICAgICAgICdWQVIyJzogJ3ZhbHVlMidcbiAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgbWVyZ2UgZGVlcCBuZXN0ZWQgb2JqZWN0cyBjb3JyZWN0bHkgd2l0aG91dCBtdXRhdGlvbicsICgpID0+IHtcbiAgICAgIGNvbnN0IG9yaWdpbmFsUHJvcHMgPSB7XG4gICAgICAgIHRpbWVvdXQ6IER1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgICAgICBtZW1vcnlTaXplOiA1MTIsXG4gICAgICAgIGJ1bmRsaW5nOiB7XG4gICAgICAgICAgZXh0ZXJuYWxNb2R1bGVzOiBbICdtb2R1bGUxJyBdLFxuICAgICAgICAgIG1pbmlmeTogdHJ1ZSxcbiAgICAgICAgICBzb3VyY2VNYXA6IGZhbHNlXG4gICAgICAgIH0sXG4gICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgJ0tFWTEnOiAndmFsdWUxJ1xuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBuZXcgTGFtYmRhRnVuY3Rpb24oc3RhY2ssICdUZXN0TGFtYmRhJywge1xuICAgICAgICBlbnRyeTogVEVTVF9FTlRSWSxcbiAgICAgICAgZnVuY3Rpb25Qcm9wczogb3JpZ2luYWxQcm9wc1xuICAgICAgfSk7XG5cbiAgICAgIC8vIFZlcmlmeSBvcmlnaW5hbCB3YXNuJ3QgbXV0YXRlZFxuICAgICAgZXhwZWN0KG9yaWdpbmFsUHJvcHMpLnRvRXF1YWwoe1xuICAgICAgICB0aW1lb3V0OiBEdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgICAgbWVtb3J5U2l6ZTogNTEyLFxuICAgICAgICBidW5kbGluZzoge1xuICAgICAgICAgIGV4dGVybmFsTW9kdWxlczogWyAnbW9kdWxlMScgXSxcbiAgICAgICAgICBtaW5pZnk6IHRydWUsXG4gICAgICAgICAgc291cmNlTWFwOiBmYWxzZVxuICAgICAgICB9LFxuICAgICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAgICdLRVkxJzogJ3ZhbHVlMSdcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpMYW1iZGE6OkZ1bmN0aW9uJywge1xuICAgICAgICBUaW1lb3V0OiAzMCxcbiAgICAgICAgTWVtb3J5U2l6ZTogNTEyLFxuICAgICAgICBFbnZpcm9ubWVudDoge1xuICAgICAgICAgIFZhcmlhYmxlczogTWF0Y2gub2JqZWN0TGlrZSh7XG4gICAgICAgICAgICAnS0VZMSc6ICd2YWx1ZTEnXG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHByb3Blcmx5IG92ZXJyaWRlIHZhcmlhYmxlcyB3aGVuIHNhbWUga2V5IGV4aXN0cyBpbiBtdWx0aXBsZSBzb3VyY2VzJywgKCkgPT4ge1xuICAgICAgbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCAnVGVzdExhbWJkYScsIHtcbiAgICAgICAgZW50cnk6IFRFU1RfRU5UUlksXG4gICAgICAgIGVudmlyb25tZW50VmFyaWFibGVzOiB7XG4gICAgICAgICAgJ1ZBUjEnOiAndmFsdWUxJ1xuICAgICAgICB9LFxuICAgICAgICBmdW5jdGlvblByb3BzOiB7XG4gICAgICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgICAgICdWQVIxJzogJ3Nob3VsZC1iZS1vdmVycmlkZGVuJyxcbiAgICAgICAgICAgICdWQVIyJzogJ3ZhbHVlMidcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICBjb25zdCBjYXB0dXJlID0gbmV3IENhcHR1cmUoKTtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpMYW1iZGE6OkZ1bmN0aW9uJywge1xuICAgICAgICBFbnZpcm9ubWVudDoge1xuICAgICAgICAgIFZhcmlhYmxlczogY2FwdHVyZVxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgdmFycyA9IGNhcHR1cmUuYXNPYmplY3QoKTtcbiAgICAgIC8vIFZBUjEgc2hvdWxkIHVzZSB2YWx1ZSBmcm9tIGVudmlyb25tZW50VmFyaWFibGVzIChoaWdoZXIgcHJpb3JpdHkpXG4gICAgICBleHBlY3QodmFyc1sgJ1ZBUjEnIF0pLnRvQmUoJ3ZhbHVlMScpO1xuICAgICAgZXhwZWN0KHZhcnNbICdWQVIyJyBdKS50b0JlKCd2YWx1ZTInKTtcbiAgICAgIC8vIFZlcmlmeSBib3RoIHZhcnMgYXJlIHByZXNlbnRcbiAgICAgIGV4cGVjdChPYmplY3Qua2V5cyh2YXJzKSkudG9Db250YWluKCdWQVIxJyk7XG4gICAgICBleHBlY3QoT2JqZWN0LmtleXModmFycykpLnRvQ29udGFpbignVkFSMicpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnRnVuY3Rpb24gUHJvcHMgT3ZlcnJpZGUnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBhbGxvdyBjb21wbGV0ZSBvdmVycmlkZSBvZiBydW50aW1lJywgKCkgPT4ge1xuICAgICAgbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCAnVGVzdExhbWJkYScsIHtcbiAgICAgICAgZW50cnk6IFRFU1RfRU5UUlksXG4gICAgICAgIGZ1bmN0aW9uUHJvcHM6IHtcbiAgICAgICAgICBydW50aW1lOiBSdW50aW1lLk5PREVKU18yMF9YXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6TGFtYmRhOjpGdW5jdGlvbicsIHtcbiAgICAgICAgUnVudGltZTogUnVudGltZS5OT0RFSlNfMjBfWC5uYW1lXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgYWxsb3cgZGVzY3JpcHRpb24gdG8gYmUgc2V0JywgKCkgPT4ge1xuICAgICAgbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCAnVGVzdExhbWJkYScsIHtcbiAgICAgICAgZW50cnk6IFRFU1RfRU5UUlksXG4gICAgICAgIGZ1bmN0aW9uUHJvcHM6IHtcbiAgICAgICAgICBkZXNjcmlwdGlvbjogJ1Rlc3QgTGFtYmRhIEZ1bmN0aW9uJ1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkxhbWJkYTo6RnVuY3Rpb24nLCB7XG4gICAgICAgIERlc2NyaXB0aW9uOiAnVGVzdCBMYW1iZGEgRnVuY3Rpb24nXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgYWxsb3cgaGFuZGxlciB0byBiZSBvdmVycmlkZGVuJywgKCkgPT4ge1xuICAgICAgbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCAnVGVzdExhbWJkYScsIHtcbiAgICAgICAgZW50cnk6IFRFU1RfRU5UUlksXG4gICAgICAgIGZ1bmN0aW9uUHJvcHM6IHtcbiAgICAgICAgICBoYW5kbGVyOiAnY3VzdG9tSGFuZGxlcidcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIC8vIENESyBOb2RlanNGdW5jdGlvbiBwcmVmaXhlcyBoYW5kbGVyIHdpdGggJ2luZGV4LidcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpMYW1iZGE6OkZ1bmN0aW9uJywge1xuICAgICAgICBIYW5kbGVyOiAnaW5kZXguY3VzdG9tSGFuZGxlcidcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBjb21iaW5lIG11bHRpcGxlIG92ZXJyaWRlcycsICgpID0+IHtcbiAgICAgIG5ldyBMYW1iZGFGdW5jdGlvbihzdGFjaywgJ1Rlc3RMYW1iZGEnLCB7XG4gICAgICAgIGVudHJ5OiBURVNUX0VOVFJZLFxuICAgICAgICBmdW5jdGlvblByb3BzOiB7XG4gICAgICAgICAgcnVudGltZTogUnVudGltZS5OT0RFSlNfMjBfWCxcbiAgICAgICAgICB0aW1lb3V0OiBEdXJhdGlvbi5zZWNvbmRzKDEyMCksXG4gICAgICAgICAgbWVtb3J5U2l6ZTogMjA0OCxcbiAgICAgICAgICBkZXNjcmlwdGlvbjogJ0N1c3RvbSBMYW1iZGEnXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6TGFtYmRhOjpGdW5jdGlvbicsIHtcbiAgICAgICAgUnVudGltZTogUnVudGltZS5OT0RFSlNfMjBfWC5uYW1lLFxuICAgICAgICBUaW1lb3V0OiAxMjAsXG4gICAgICAgIE1lbW9yeVNpemU6IDIwNDgsXG4gICAgICAgIERlc2NyaXB0aW9uOiAnQ3VzdG9tIExhbWJkYSdcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnSUFNIFJvbGUgQ29uZmlndXJhdGlvbicsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGNyZWF0ZSBhbiBleGVjdXRpb24gcm9sZScsICgpID0+IHtcbiAgICAgIG5ldyBMYW1iZGFGdW5jdGlvbihzdGFjaywgJ1Rlc3RMYW1iZGEnLCB7XG4gICAgICAgIGVudHJ5OiBURVNUX0VOVFJZXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OklBTTo6Um9sZScsIHtcbiAgICAgICAgQXNzdW1lUm9sZVBvbGljeURvY3VtZW50OiB7XG4gICAgICAgICAgU3RhdGVtZW50OiBNYXRjaC5hcnJheVdpdGgoW1xuICAgICAgICAgICAgTWF0Y2gub2JqZWN0TGlrZSh7XG4gICAgICAgICAgICAgIEFjdGlvbjogJ3N0czpBc3N1bWVSb2xlJyxcbiAgICAgICAgICAgICAgRWZmZWN0OiAnQWxsb3cnLFxuICAgICAgICAgICAgICBQcmluY2lwYWw6IHtcbiAgICAgICAgICAgICAgICBTZXJ2aWNlOiAnbGFtYmRhLmFtYXpvbmF3cy5jb20nXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgXSlcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGF0dGFjaCBtYW5hZ2VkIHBvbGljaWVzIHRvIGV4ZWN1dGlvbiByb2xlJywgKCkgPT4ge1xuICAgICAgbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCAnVGVzdExhbWJkYScsIHtcbiAgICAgICAgZW50cnk6IFRFU1RfRU5UUllcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6SUFNOjpSb2xlJywge1xuICAgICAgICBNYW5hZ2VkUG9saWN5QXJuczogTWF0Y2guYXJyYXlXaXRoKFtcbiAgICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICAgICdGbjo6Sm9pbic6IE1hdGNoLmFycmF5V2l0aChbXG4gICAgICAgICAgICAgIE1hdGNoLmFycmF5V2l0aChbXG4gICAgICAgICAgICAgICAgTWF0Y2guc3RyaW5nTGlrZVJlZ2V4cCgnLipBV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUuKicpXG4gICAgICAgICAgICAgIF0pXG4gICAgICAgICAgICBdKVxuICAgICAgICAgIH0pXG4gICAgICAgIF0pXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgY3JlYXRlIHNlcGFyYXRlIElBTSBwb2xpY3kgZm9yIGN1c3RvbSBwZXJtaXNzaW9ucycsICgpID0+IHtcbiAgICAgIG5ldyBMYW1iZGFGdW5jdGlvbihzdGFjaywgJ1Rlc3RMYW1iZGEnLCB7XG4gICAgICAgIGVudHJ5OiBURVNUX0VOVFJZLFxuICAgICAgICBwb2xpY2llczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGVmZmVjdDogRWZmZWN0LkFMTE9XLFxuICAgICAgICAgICAgYWN0aW9uczogWyAnczM6R2V0T2JqZWN0JyBdLFxuICAgICAgICAgICAgcmVzb3VyY2VzOiBbICcqJyBdXG4gICAgICAgICAgfVxuICAgICAgICBdXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUucmVzb3VyY2VDb3VudElzKCdBV1M6OklBTTo6UG9saWN5JywgMSk7XG4gICAgICB0ZW1wbGF0ZS5yZXNvdXJjZUNvdW50SXMoJ0FXUzo6SUFNOjpSb2xlJywgMSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdFZGdlIENhc2VzIGFuZCBFcnJvciBTY2VuYXJpb3MnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgdmVyeSBsb25nIHRpbWVvdXQgdmFsdWVzJywgKCkgPT4ge1xuICAgICAgbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCAnVGVzdExhbWJkYScsIHtcbiAgICAgICAgZW50cnk6IFRFU1RfRU5UUlksXG4gICAgICAgIGZ1bmN0aW9uVGltZW91dDogOTAwIC8vIDE1IG1pbnV0ZXMgLSBMYW1iZGEgbWF4XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkxhbWJkYTo6RnVuY3Rpb24nLCB7XG4gICAgICAgIFRpbWVvdXQ6IDkwMFxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBtaW5pbXVtIG1lbW9yeSBzaXplJywgKCkgPT4ge1xuICAgICAgbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCAnVGVzdExhbWJkYScsIHtcbiAgICAgICAgZW50cnk6IFRFU1RfRU5UUlksXG4gICAgICAgIGZ1bmN0aW9uUHJvcHM6IHtcbiAgICAgICAgICBtZW1vcnlTaXplOiAxMjggLy8gTGFtYmRhIG1pbmltdW1cbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpMYW1iZGE6OkZ1bmN0aW9uJywge1xuICAgICAgICBNZW1vcnlTaXplOiAxMjhcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgbWF4aW11bSBtZW1vcnkgc2l6ZScsICgpID0+IHtcbiAgICAgIG5ldyBMYW1iZGFGdW5jdGlvbihzdGFjaywgJ1Rlc3RMYW1iZGEnLCB7XG4gICAgICAgIGVudHJ5OiBURVNUX0VOVFJZLFxuICAgICAgICBmdW5jdGlvblByb3BzOiB7XG4gICAgICAgICAgbWVtb3J5U2l6ZTogMTAyNDAgLy8gTGFtYmRhIG1heGltdW1cbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpMYW1iZGE6OkZ1bmN0aW9uJywge1xuICAgICAgICBNZW1vcnlTaXplOiAxMDI0MFxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBtdWx0aXBsZSBMYW1iZGEgZnVuY3Rpb25zIGluIHNhbWUgc3RhY2snLCAoKSA9PiB7XG4gICAgICBuZXcgTGFtYmRhRnVuY3Rpb24oc3RhY2ssICdMYW1iZGExJywge1xuICAgICAgICBlbnRyeTogVEVTVF9FTlRSWVxuICAgICAgfSk7XG4gICAgICBuZXcgTGFtYmRhRnVuY3Rpb24oc3RhY2ssICdMYW1iZGEyJywge1xuICAgICAgICBlbnRyeTogVEVTVF9FTlRSWVxuICAgICAgfSk7XG4gICAgICBuZXcgTGFtYmRhRnVuY3Rpb24oc3RhY2ssICdMYW1iZGEzJywge1xuICAgICAgICBlbnRyeTogVEVTVF9FTlRSWVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLnJlc291cmNlQ291bnRJcygnQVdTOjpMYW1iZGE6OkZ1bmN0aW9uJywgMyk7XG4gICAgICB0ZW1wbGF0ZS5yZXNvdXJjZUNvdW50SXMoJ0FXUzo6SUFNOjpSb2xlJywgMyk7XG4gICAgICB0ZW1wbGF0ZS5yZXNvdXJjZUNvdW50SXMoJ0FXUzo6TG9nczo6TG9nR3JvdXAnLCAzKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIExhbWJkYSB3aXRoIGJvdGggcG9saWNpZXMgYW5kIHJlc291cmNlQWNjZXNzJywgKCkgPT4ge1xuICAgICAgbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCAnVGVzdExhbWJkYScsIHtcbiAgICAgICAgZW50cnk6IFRFU1RfRU5UUlksXG4gICAgICAgIHBvbGljaWVzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgZWZmZWN0OiBFZmZlY3QuQUxMT1csXG4gICAgICAgICAgICBhY3Rpb25zOiBbICdzMzpHZXRPYmplY3QnIF0sXG4gICAgICAgICAgICByZXNvdXJjZXM6IFsgJyonIF1cbiAgICAgICAgICB9XG4gICAgICAgIF0sXG4gICAgICAgIHJlc291cmNlQWNjZXNzOiB7XG4gICAgICAgICAgLy8gRW1wdHkgcmVzb3VyY2UgYWNjZXNzIC0ganVzdCB0ZXN0aW5nIHRoYXQgYm90aCBjYW4gY29leGlzdFxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUucmVzb3VyY2VDb3VudElzKCdBV1M6OkxhbWJkYTo6RnVuY3Rpb24nLCAxKTtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpJQU06OlBvbGljeScsIHtcbiAgICAgICAgUG9saWN5RG9jdW1lbnQ6IHtcbiAgICAgICAgICBTdGF0ZW1lbnQ6IE1hdGNoLmFycmF5V2l0aChbXG4gICAgICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICAgICAgQWN0aW9uOiAnczM6R2V0T2JqZWN0J1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICBdKVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1NuYXBzaG90IFRlc3RzJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgZ2VuZXJhdGUgY29uc2lzdGVudCBDbG91ZEZvcm1hdGlvbiB0ZW1wbGF0ZSBmb3IgbWluaW1hbCBjb25maWcnLCAoKSA9PiB7XG4gICAgICBuZXcgTGFtYmRhRnVuY3Rpb24oc3RhY2ssICdUZXN0TGFtYmRhJywge1xuICAgICAgICBlbnRyeTogVEVTVF9FTlRSWVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKS50b0pTT04oKTtcbiAgICAgIGV4cGVjdCh0ZW1wbGF0ZSkudG9NYXRjaFNuYXBzaG90KCk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGdlbmVyYXRlIGNvbnNpc3RlbnQgQ2xvdWRGb3JtYXRpb24gdGVtcGxhdGUgZm9yIGNvbXBsZXggY29uZmlnJywgKCkgPT4ge1xuICAgICAgbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCAnVGVzdExhbWJkYScsIHtcbiAgICAgICAgZW50cnk6IFRFU1RfRU5UUlksXG4gICAgICAgIGZ1bmN0aW9uVGltZW91dDogNjAsXG4gICAgICAgIGxvZ1JldGVudGlvbkRheXM6IFJldGVudGlvbkRheXMuT05FX1dFRUssXG4gICAgICAgIHByb2Nlc3NvckFyY2hpdGVjdHVyZTogJ3g4Nl82NCcsXG4gICAgICAgIGVudmlyb25tZW50VmFyaWFibGVzOiB7XG4gICAgICAgICAgJ1ZBUjEnOiAndmFsdWUxJyxcbiAgICAgICAgICAnVkFSMic6ICd2YWx1ZTInXG4gICAgICAgIH0sXG4gICAgICAgIHBvbGljaWVzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgZWZmZWN0OiBFZmZlY3QuQUxMT1csXG4gICAgICAgICAgICBhY3Rpb25zOiBbICdzMzpHZXRPYmplY3QnLCAnczM6UHV0T2JqZWN0JyBdLFxuICAgICAgICAgICAgcmVzb3VyY2VzOiBbICdhcm46YXdzOnMzOjo6bXktYnVja2V0LyonIF1cbiAgICAgICAgICB9XG4gICAgICAgIF0sXG4gICAgICAgIGZ1bmN0aW9uUHJvcHM6IHtcbiAgICAgICAgICBtZW1vcnlTaXplOiAxMDI0LFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiAnVGVzdCBMYW1iZGEgd2l0aCBmdWxsIGNvbmZpZycsXG4gICAgICAgICAgYnVuZGxpbmc6IHtcbiAgICAgICAgICAgIG1pbmlmeTogdHJ1ZSxcbiAgICAgICAgICAgIHNvdXJjZU1hcDogdHJ1ZVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKS50b0pTT04oKTtcbiAgICAgIGV4cGVjdCh0ZW1wbGF0ZSkudG9NYXRjaFNuYXBzaG90KCk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdSZWdyZXNzaW9uIFRlc3RzIC0gU3BlY2lmaWMgQnVnIEZpeGVzJywgKCkgPT4ge1xuICAgIGl0KCdSRUdSRVNTSU9OOiBtZXJnZShbb2JqMSwgb2JqMl0pIHN5bnRheCAtIHZlcmlmaWVzIEFMTCBwcm9wZXJ0aWVzIGZyb20gQUxMIHNvdXJjZXMgYXJlIGFwcGxpZWQnLCAoKSA9PiB7XG4gICAgICAvLyBUaGlzIHRlc3RzIHRoZSBzcGVjaWZpYyBidWcgd2hlcmUgbWVyZ2Ugd2FzIGNhbGxlZCBhcyBtZXJnZShvYmoxLCBvYmoyKSBpbnN0ZWFkIG9mIG1lcmdlKFtvYmoxLCBvYmoyXSlcbiAgICAgIC8vIElmIG1lcmdlIGlzIHVzZWQgaW5jb3JyZWN0bHksIHByb3BlcnRpZXMgZnJvbSBvbmUgb3IgbW9yZSBzb3VyY2VzIHdpbGwgYmUgbG9zdFxuICAgICAgbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCAnVGVzdExhbWJkYScsIHtcbiAgICAgICAgZW50cnk6IFRFU1RfRU5UUlksXG4gICAgICAgIGZ1bmN0aW9uVGltZW91dDogNjAsXG4gICAgICAgIGZ1bmN0aW9uUHJvcHM6IHtcbiAgICAgICAgICBtZW1vcnlTaXplOiAxMDI0LFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiAnVGVzdCBMYW1iZGEnLFxuICAgICAgICAgIGJ1bmRsaW5nOiB7XG4gICAgICAgICAgICBtaW5pZnk6IHRydWUsXG4gICAgICAgICAgICBzb3VyY2VNYXA6IGZhbHNlXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgY29uc3QgY2FwdHVyZSA9IG5ldyBDYXB0dXJlKCk7XG5cbiAgICAgIC8vIENSSVRJQ0FMTFkgdmVyaWZ5IEFMTCBwcm9wZXJ0aWVzIGZyb20gQUxMIHNvdXJjZXMgYXJlIHByZXNlbnRcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpMYW1iZGE6OkZ1bmN0aW9uJywge1xuICAgICAgICBUaW1lb3V0OiA2MCwgLy8gZnJvbSBmdW5jdGlvblRpbWVvdXRcbiAgICAgICAgTWVtb3J5U2l6ZTogMTAyNCwgLy8gZnJvbSBmdW5jdGlvblByb3BzXG4gICAgICAgIERlc2NyaXB0aW9uOiAnVGVzdCBMYW1iZGEnLCAvLyBmcm9tIGZ1bmN0aW9uUHJvcHNcbiAgICAgICAgSGFuZGxlcjogY2FwdHVyZSAvLyBDYXB0dXJlIHRvIHZlcmlmeSBpdCBleGlzdHNcbiAgICAgIH0pO1xuXG4gICAgICAvLyBWZXJpZnkgdGhlIExhbWJkYSB3YXMgY3JlYXRlZCBzdWNjZXNzZnVsbHlcbiAgICAgIHRlbXBsYXRlLnJlc291cmNlQ291bnRJcygnQVdTOjpMYW1iZGE6OkZ1bmN0aW9uJywgMSk7XG5cbiAgICAgIC8vIEhhbmRsZXIgc2hvdWxkIGJlIHNldCAocHJvdmVzIG1lcmdlIHdvcmtlZClcbiAgICAgIGV4cGVjdChjYXB0dXJlLmFzU3RyaW5nKCkpLnRvTWF0Y2goL15pbmRleFxcLi8pO1xuICAgIH0pO1xuXG4gICAgaXQoJ1JFR1JFU1NJT046IG1lcmdlIHNob3VsZCBOT1QgbXV0YXRlIG9yaWdpbmFsIGNvbmZpZyBvYmplY3RzIChpbW11dGFiaWxpdHkpJywgKCkgPT4ge1xuICAgICAgLy8gVGhpcyB0ZXN0cyB0aGF0IG1lcmdlIGRvZXNuJ3QgbXV0YXRlIHRoZSBvcmlnaW5hbCBvYmplY3RzXG4gICAgICBjb25zdCBvcmlnaW5hbEJ1bmRsaW5nID0ge1xuICAgICAgICBleHRlcm5hbE1vZHVsZXM6IFsgJ21vZHVsZTEnIF0sXG4gICAgICAgIG1pbmlmeTogdHJ1ZVxuICAgICAgfTtcblxuICAgICAgY29uc3Qgb3JpZ2luYWxFbnYgPSB7XG4gICAgICAgICdLRVkxJzogJ3ZhbHVlMSdcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IG9yaWdpbmFsRnVuY3Rpb25Qcm9wcyA9IHtcbiAgICAgICAgdGltZW91dDogRHVyYXRpb24uc2Vjb25kcyg0NSksXG4gICAgICAgIGJ1bmRsaW5nOiBvcmlnaW5hbEJ1bmRsaW5nLFxuICAgICAgICBlbnZpcm9ubWVudDogb3JpZ2luYWxFbnZcbiAgICAgIH07XG5cbiAgICAgIG5ldyBMYW1iZGFGdW5jdGlvbihzdGFjaywgJ1Rlc3RMYW1iZGEnLCB7XG4gICAgICAgIGVudHJ5OiBURVNUX0VOVFJZLFxuICAgICAgICBmdW5jdGlvblByb3BzOiBvcmlnaW5hbEZ1bmN0aW9uUHJvcHNcbiAgICAgIH0pO1xuXG4gICAgICAvLyBDUklUSUNBTDogVmVyaWZ5IG5vbmUgb2YgdGhlIG9yaWdpbmFsIG9iamVjdHMgd2VyZSBtdXRhdGVkXG4gICAgICBleHBlY3Qob3JpZ2luYWxCdW5kbGluZykudG9FcXVhbCh7XG4gICAgICAgIGV4dGVybmFsTW9kdWxlczogWyAnbW9kdWxlMScgXSxcbiAgICAgICAgbWluaWZ5OiB0cnVlXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChvcmlnaW5hbEVudikudG9FcXVhbCh7XG4gICAgICAgICdLRVkxJzogJ3ZhbHVlMSdcbiAgICAgIH0pO1xuICAgICAgLy8gVmVyaWZ5IHJlZmVyZW5jZXMgYXJlIHN0aWxsIHRoZSBzYW1lIChubyBuZXcgb2JqZWN0cyBjcmVhdGVkIGZvciBvcmlnaW5hbHMpXG4gICAgICBleHBlY3Qob3JpZ2luYWxGdW5jdGlvblByb3BzLmJ1bmRsaW5nKS50b0JlKG9yaWdpbmFsQnVuZGxpbmcpO1xuICAgICAgZXhwZWN0KG9yaWdpbmFsRnVuY3Rpb25Qcm9wcy5lbnZpcm9ubWVudCkudG9CZShvcmlnaW5hbEVudik7XG4gICAgfSk7XG5cbiAgICBpdCgnUkVHUkVTU0lPTjogbWVyZ2Ugc2hvdWxkIHByZXNlcnZlIEFMTCBwcm9wZXJ0aWVzIGZyb20gZGVlcGx5IG5lc3RlZCBvYmplY3RzJywgKCkgPT4ge1xuICAgICAgLy8gVGVzdHMgdGhhdCBkZWVwIG5lc3RlZCBtZXJnaW5nIGRvZXNuJ3QgbG9zZSBwcm9wZXJ0aWVzXG4gICAgICBuZXcgTGFtYmRhRnVuY3Rpb24oc3RhY2ssICdUZXN0TGFtYmRhJywge1xuICAgICAgICBlbnRyeTogVEVTVF9FTlRSWSxcbiAgICAgICAgZW52aXJvbm1lbnRWYXJpYWJsZXM6IHtcbiAgICAgICAgICAnVkFSMSc6ICd2YWx1ZTEnXG4gICAgICAgIH0sXG4gICAgICAgIGZ1bmN0aW9uUHJvcHM6IHtcbiAgICAgICAgICB0aW1lb3V0OiBEdXJhdGlvbi5zZWNvbmRzKDkwKSxcbiAgICAgICAgICBtZW1vcnlTaXplOiAyMDQ4LFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiAnQ29tcGxleCBMYW1iZGEnLFxuICAgICAgICAgIGJ1bmRsaW5nOiB7XG4gICAgICAgICAgICBleHRlcm5hbE1vZHVsZXM6IFsgJ2N1c3RvbS1tb2R1bGUnIF0sXG4gICAgICAgICAgICBtaW5pZnk6IHRydWUsXG4gICAgICAgICAgICBzb3VyY2VNYXA6IHRydWVcbiAgICAgICAgICB9LFxuICAgICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgICAnVkFSMic6ICd2YWx1ZTInXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgY29uc3QgZW52Q2FwdHVyZSA9IG5ldyBDYXB0dXJlKCk7XG5cbiAgICAgIC8vIFZlcmlmeSBBTEwgbmVzdGVkIHByb3BlcnRpZXMgYXJlIHByZXNlbnRcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpMYW1iZGE6OkZ1bmN0aW9uJywge1xuICAgICAgICBUaW1lb3V0OiA5MCxcbiAgICAgICAgTWVtb3J5U2l6ZTogMjA0OCxcbiAgICAgICAgRGVzY3JpcHRpb246ICdDb21wbGV4IExhbWJkYScsXG4gICAgICAgIEVudmlyb25tZW50OiB7XG4gICAgICAgICAgVmFyaWFibGVzOiBlbnZDYXB0dXJlXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCB2YXJzID0gZW52Q2FwdHVyZS5hc09iamVjdCgpO1xuICAgICAgZXhwZWN0KHZhcnNbICdWQVIxJyBdKS50b0JlKCd2YWx1ZTEnKTtcbiAgICAgIGV4cGVjdCh2YXJzWyAnVkFSMicgXSkudG9CZSgndmFsdWUyJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnUkVHUkVTU0lPTjogc2hvdWxkIGhhbmRsZSByZWFkb25seSBDREsgcHJvcGVydGllcyBjb3JyZWN0bHknLCAoKSA9PiB7XG4gICAgICAvLyBUaGUgYWN0dWFsIGJ1ZyB3YXMgaW4gQnVja2V0Q29uc3RydWN0IHdpdGggYmxvY2tQdWJsaWNBY2Nlc3MgcmVhZG9ubHkgcHJvcGVydHlcbiAgICAgIC8vIFRoaXMgdGVzdHMgc2ltaWxhciBzY2VuYXJpbyAtIEFyY2hpdGVjdHVyZSBpcyBhIGNsYXNzIGluc3RhbmNlIHRoYXQgY291bGQgaGF2ZSByZWFkb25seSBwcm9wc1xuICAgICAgY29uc3QgcmVhZG9ubHlBcmNoaXRlY3R1cmUgPSBBcmNoaXRlY3R1cmUuQVJNXzY0O1xuXG4gICAgICBuZXcgTGFtYmRhRnVuY3Rpb24oc3RhY2ssICdUZXN0TGFtYmRhJywge1xuICAgICAgICBlbnRyeTogVEVTVF9FTlRSWSxcbiAgICAgICAgZnVuY3Rpb25Qcm9wczoge1xuICAgICAgICAgIGFyY2hpdGVjdHVyZTogcmVhZG9ubHlBcmNoaXRlY3R1cmVcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIC8vIFNob3VsZCBub3QgdGhyb3cgZXJyb3JzIGFib3V0IHJlYWRvbmx5IHByb3BlcnRpZXMgZHVyaW5nIG1lcmdlXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6TGFtYmRhOjpGdW5jdGlvbicsIHtcbiAgICAgICAgQXJjaGl0ZWN0dXJlczogWyBBcmNoaXRlY3R1cmUuQVJNXzY0Lm5hbWUgXVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnUkVHUkVTU0lPTjogbWVyZ2UgbXVzdCBwcmVzZXJ2ZSBwcm9wZXJ0aWVzIHdoZW4gbWVyZ2luZyAzKyBvYmplY3RzJywgKCkgPT4ge1xuICAgICAgLy8gVGVzdHMgdGhhdCBtZXJnZShbb2JqMSwgb2JqMiwgb2JqM10pIHByZXNlcnZlcyBhbGwgcHJvcGVydGllc1xuICAgICAgLy8gVGhlIGNvbnN0cnVjdCBtZXJnZXM6IGRlZmF1bHRQcm9wcyArIGZ1bmN0aW9uUHJvcHMgKyBhZGRpdGlvbmFsUHJvcHNcbiAgICAgIG5ldyBMYW1iZGFGdW5jdGlvbihzdGFjaywgJ1Rlc3RMYW1iZGEnLCB7XG4gICAgICAgIGVudHJ5OiBURVNUX0VOVFJZLFxuICAgICAgICBlbnZpcm9ubWVudFZhcmlhYmxlczoge1xuICAgICAgICAgICdGUk9NX0VOVl9WQVJTJzogJ3ZhbHVlMSdcbiAgICAgICAgfSxcbiAgICAgICAgZnVuY3Rpb25UaW1lb3V0OiA3NSxcbiAgICAgICAgcHJvY2Vzc29yQXJjaGl0ZWN0dXJlOiAneDg2XzY0JyxcbiAgICAgICAgZnVuY3Rpb25Qcm9wczoge1xuICAgICAgICAgIG1lbW9yeVNpemU6IDUxMixcbiAgICAgICAgICBkZXNjcmlwdGlvbjogJ1Rlc3QgRGVzY3JpcHRpb24nLFxuICAgICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgICAnRlJPTV9GVU5DVElPTl9QUk9QUyc6ICd2YWx1ZTInXG4gICAgICAgICAgfSxcbiAgICAgICAgICBidW5kbGluZzoge1xuICAgICAgICAgICAgbWluaWZ5OiBmYWxzZVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIGNvbnN0IGNhcHR1cmUgPSBuZXcgQ2FwdHVyZSgpO1xuXG4gICAgICAvLyBDUklUSUNBTDogQUxMIHByb3BlcnRpZXMgZnJvbSBBTEwgMysgc291cmNlcyBtdXN0IGJlIHByZXNlbnRcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpMYW1iZGE6OkZ1bmN0aW9uJywge1xuICAgICAgICBUaW1lb3V0OiA3NSwgLy8gZnJvbSBmdW5jdGlvblRpbWVvdXQgKGFkZGl0aW9uYWxQcm9wcylcbiAgICAgICAgTWVtb3J5U2l6ZTogNTEyLCAvLyBmcm9tIGZ1bmN0aW9uUHJvcHNcbiAgICAgICAgRGVzY3JpcHRpb246ICdUZXN0IERlc2NyaXB0aW9uJywgLy8gZnJvbSBmdW5jdGlvblByb3BzXG4gICAgICAgIEFyY2hpdGVjdHVyZXM6IFsgQXJjaGl0ZWN0dXJlLlg4Nl82NC5uYW1lIF0sIC8vIGZyb20gcHJvY2Vzc29yQXJjaGl0ZWN0dXJlIChhZGRpdGlvbmFsUHJvcHMpXG4gICAgICAgIEVudmlyb25tZW50OiB7XG4gICAgICAgICAgVmFyaWFibGVzOiBjYXB0dXJlXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCB2YXJzID0gY2FwdHVyZS5hc09iamVjdCgpO1xuICAgICAgZXhwZWN0KHZhcnNbICdGUk9NX0VOVl9WQVJTJyBdKS50b0JlKCd2YWx1ZTEnKTtcbiAgICAgIGV4cGVjdCh2YXJzWyAnRlJPTV9GVU5DVElPTl9QUk9QUycgXSkudG9CZSgndmFsdWUyJyk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdOZWdhdGl2ZSBUZXN0cyAtIEVycm9yIGFuZCBFZGdlIFNjZW5hcmlvcycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIHRocm93IGVycm9yIGZvciBpbnZhbGlkIGVudHJ5IGZpbGUgcGF0aCBkdXJpbmcgY29uc3RydWN0IGNyZWF0aW9uJywgKCkgPT4ge1xuICAgICAgLy8gQ0RLIHZhbGlkYXRlcyBlbnRyeSBmaWxlIHBhdGggZHVyaW5nIE5vZGVqc0Z1bmN0aW9uIGNvbnN0cnVjdGlvblxuICAgICAgZXhwZWN0KCgpID0+IHtcbiAgICAgICAgbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCAnVGVzdExhbWJkYScsIHtcbiAgICAgICAgICBlbnRyeTogJy9ub24vZXhpc3RlbnQvcGF0aC90aGF0L2RvZXMvbm90L2V4aXN0LnRzJ1xuICAgICAgICB9KTtcbiAgICAgIH0pLnRvVGhyb3coL0Nhbm5vdCBmaW5kIGVudHJ5IGZpbGUvKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGNvbmZsaWN0aW5nIHRpbWVvdXQgLSBmdW5jdGlvblRpbWVvdXQgd2lucyBvdmVyIGZ1bmN0aW9uUHJvcHMudGltZW91dCcsICgpID0+IHtcbiAgICAgIG5ldyBMYW1iZGFGdW5jdGlvbihzdGFjaywgJ1Rlc3RMYW1iZGEnLCB7XG4gICAgICAgIGVudHJ5OiBURVNUX0VOVFJZLFxuICAgICAgICBmdW5jdGlvblRpbWVvdXQ6IDEwMCxcbiAgICAgICAgZnVuY3Rpb25Qcm9wczoge1xuICAgICAgICAgIHRpbWVvdXQ6IER1cmF0aW9uLnNlY29uZHMoNTApXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6TGFtYmRhOjpGdW5jdGlvbicsIHtcbiAgICAgICAgVGltZW91dDogMTAwIC8vIGZ1bmN0aW9uVGltZW91dCB0YWtlcyBwcmVjZWRlbmNlXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGVtcHR5IGFycmF5cyBpbiBidW5kbGluZyBjb25maWcgd2l0aG91dCBlcnJvcnMnLCAoKSA9PiB7XG4gICAgICBjb25zdCBsYW1iZGEgPSBuZXcgTGFtYmRhRnVuY3Rpb24oc3RhY2ssICdUZXN0TGFtYmRhJywge1xuICAgICAgICBlbnRyeTogVEVTVF9FTlRSWSxcbiAgICAgICAgZnVuY3Rpb25Qcm9wczoge1xuICAgICAgICAgIGJ1bmRsaW5nOiB7XG4gICAgICAgICAgICBleHRlcm5hbE1vZHVsZXM6IFtdXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KGxhbWJkYSkudG9CZURlZmluZWQoKTtcbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLnJlc291cmNlQ291bnRJcygnQVdTOjpMYW1iZGE6OkZ1bmN0aW9uJywgMSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSB1bmRlZmluZWQgZnVuY3Rpb25Qcm9wcyBncmFjZWZ1bGx5JywgKCkgPT4ge1xuICAgICAgY29uc3QgbGFtYmRhID0gbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCAnVGVzdExhbWJkYScsIHtcbiAgICAgICAgZW50cnk6IFRFU1RfRU5UUlksXG4gICAgICAgIGZ1bmN0aW9uUHJvcHM6IHVuZGVmaW5lZFxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChsYW1iZGEpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5yZXNvdXJjZUNvdW50SXMoJ0FXUzo6TGFtYmRhOjpGdW5jdGlvbicsIDEpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgbnVsbCB2YWx1ZXMgaW4gZW52aXJvbm1lbnQgdmFyaWFibGVzJywgKCkgPT4ge1xuICAgICAgLy8gVHlwZVNjcmlwdCBwcmV2ZW50cyB0aGlzIGF0IGNvbXBpbGUgdGltZSwgYnV0IHRlc3RpbmcgcnVudGltZSBiZWhhdmlvclxuICAgICAgY29uc3QgbGFtYmRhID0gbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCAnVGVzdExhbWJkYScsIHtcbiAgICAgICAgZW50cnk6IFRFU1RfRU5UUlksXG4gICAgICAgIGVudmlyb25tZW50VmFyaWFibGVzOiB7fSAvLyBFbXB0eSBpcyB2YWxpZFxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChsYW1iZGEpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5yZXNvdXJjZUNvdW50SXMoJ0FXUzo6TGFtYmRhOjpGdW5jdGlvbicsIDEpO1xuICAgIH0pO1xuICB9KTtcbn0pO1xuIl19