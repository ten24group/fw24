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
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
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
exports.DynamoDBConstruct = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_dynamodb_1 = require("aws-cdk-lib/aws-dynamodb");
const aws_lambda_1 = require("aws-cdk-lib/aws-lambda");
const aws_lambda_event_sources_1 = require("aws-cdk-lib/aws-lambda-event-sources");
const node_path_1 = require("node:path");
const interfaces_1 = require("../audit/interfaces");
const fw24_1 = require("../core/fw24");
const construct_1 = require("../interfaces/construct");
const logging_1 = require("../logging");
const interfaces_2 = require("../search/indexer/interfaces");
const keys_1 = require("../utils/keys");
const lambda_function_1 = require("./lambda-function");
const queue_lambda_1 = require("./queue-lambda");
const topic_1 = require("./topic");
class DynamoDBConstruct {
    dynamoDBConfig;
    logger = (0, logging_1.createLogger)(DynamoDBConstruct.name);
    fw24 = fw24_1.Fw24.getInstance();
    name = DynamoDBConstruct.name;
    dependencies = [];
    output;
    mainStack;
    /**
     * Constructs a new instance of the DynamoDB class.
     * @param dynamoDBConfig The configuration object for DynamoDB.
     * @example
     * const dynamoDBConfig = {
     *   region: 'us-west-2',
     *   tableName: 'myTable'
     * };
     * const dynamoDB = new DynamoDB(dynamoDBConfig);
     */
    constructor(dynamoDBConfig) {
        this.dynamoDBConfig = dynamoDBConfig;
    }
    // construct method to create the stack
    async construct() {
        const fw24 = fw24_1.Fw24.getInstance();
        this.mainStack = fw24.getStack(this.dynamoDBConfig.stackName, this.dynamoDBConfig.parentStackName);
        const appQualifiedTableName = (0, keys_1.ensureNoSpecialChars)((0, keys_1.ensureSuffix)(this.dynamoDBConfig.table.name, `table`));
        this.logger.debug("appQualifiedTableName:", appQualifiedTableName);
        // See https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_dynamodb-readme.html
        const tableInstance = new aws_dynamodb_1.TableV2(this.mainStack, appQualifiedTableName, this.dynamoDBConfig.table.props);
        // Output the table instance
        this.fw24.setConstructOutput(this, appQualifiedTableName, tableInstance, construct_1.OutputType.TABLE, 'tableName');
        this.fw24.setEnvironmentVariable(appQualifiedTableName, tableInstance.tableName, 'table');
        // Register the table instance as a global container
        fw24.addDynamoTable(appQualifiedTableName, tableInstance);
        const hasAuditEnabled = this.dynamoDBConfig.table.audit?.enabled;
        const hasSearchIndexingEnabled = this.dynamoDBConfig.table.searchIndexing?.some(config => config.enabled);
        const hasStreamEnabled = this.dynamoDBConfig.table.stream?.enabled;
        // Track configured features for summary
        const features = [];
        // Setup stream processing if enabled or audit is enabled or search indexing is enabled and stream ARN exists
        if (hasStreamEnabled || hasAuditEnabled || hasSearchIndexingEnabled) {
            if (tableInstance.tableStreamArn) {
                this.setupStreamProcessing(tableInstance);
                if (hasStreamEnabled)
                    features.push('stream');
            }
            else {
                this.logger.warn(`Stream ARN not found for table ${this.dynamoDBConfig.table.name}, cannot set up stream processing`);
            }
        }
        if (this.dynamoDBConfig.table.audit?.enabled) {
            await this.setupAuditProcessing(this.dynamoDBConfig.table.audit, tableInstance);
            features.push('audit');
        }
        if (hasSearchIndexingEnabled) {
            for (const config of this.dynamoDBConfig.table.searchIndexing || []) {
                await this.setupSearchIndexingProcessing(config, tableInstance);
            }
            features.push('search-indexing');
        }
        // Summary
        if (features.length > 0) {
            this.logger.info(`✅ Table "${this.dynamoDBConfig.table.name}" configured with ${features.length} feature(s): ${features.join(', ')}`);
        }
        else {
            this.logger.info(`✅ Table "${this.dynamoDBConfig.table.name}" configured (basic setup)`);
        }
    }
    getStreamTopicName() {
        return `${this.dynamoDBConfig.table.name}-stream`;
    }
    setupStreamProcessing(tableInstance) {
        const streamConfig = this.dynamoDBConfig.table.stream || {};
        // Create SNS topic for stream events
        const topicName = streamConfig.topic?.name || this.getStreamTopicName();
        const isFifo = streamConfig.topic?.props?.fifo ?? false;
        const streamTopicConfig = [{
                topicName,
                topicProps: {
                    displayName: `Stream events for ${this.dynamoDBConfig.table.name}`,
                    fifo: isFifo,
                    ...streamConfig.topic?.props
                }
            }];
        new topic_1.TopicConstruct(streamTopicConfig).construct();
        // Create Lambda to process stream and publish to SNS
        const streamProcessor = new lambda_function_1.LambdaFunction(this.mainStack, `${this.fw24.appName}-stream-processor`, {
            entry: (0, node_path_1.join)(__dirname, '../core/runtime/dynamodb-stream-processor.js'),
            environmentVariables: {
                TOPIC_NAME: topicName,
                TOPIC_TYPE: isFifo ? 'fifo' : 'standard'
            },
            resourceAccess: {
                topics: [{
                        name: topicName,
                        access: ['publish']
                    }]
            }
        });
        // Grant permissions and add event source
        tableInstance.grantStreamRead(streamProcessor);
        streamProcessor.addEventSource(new aws_lambda_event_sources_1.DynamoEventSource(tableInstance, {
            ...streamConfig.processor,
            startingPosition: streamConfig.processor?.startingPosition ?? aws_lambda_1.StartingPosition.LATEST,
            batchSize: streamConfig.processor?.batchSize ?? 5,
            bisectBatchOnError: streamConfig.processor?.bisectBatchOnError ?? true,
            retryAttempts: streamConfig.processor?.retryAttempts ?? 3
        }));
        this.logger.debug('Stream processing setup completed for table:', this.dynamoDBConfig.table.name);
    }
    async setupStreamEventConsumers(tableInstance, consumerName, config, defaultHandlerEntry, environmentVariables, resourceAccess) {
        if (!tableInstance.tableStreamArn) {
            this.logger.warn(`Stream ARN not found for table ${this.dynamoDBConfig.table.name}, cannot set up ${consumerName}`);
            return;
        }
        const queueConfig = this.extractQueueConfig(config);
        // Validate configuration
        this.validateQueueConfig(config, consumerName);
        if (queueConfig.type === 'handler') {
            await this.setupWithQueueHandler(queueConfig.queueHandlerPath, consumerName, environmentVariables, queueConfig.functionProps);
        }
        else if (queueConfig.type === 'existing') {
            this.setupWithExistingQueue(queueConfig.existingQueueName, consumerName);
        }
        else {
            const commonConfig = this.buildCommonLambdaConfig(defaultHandlerEntry, environmentVariables, resourceAccess, queueConfig.functionProps);
            this.setupWithNewQueue(queueConfig, consumerName, commonConfig);
        }
        this.logger.debug(`${consumerName} setup completed for table:`, this.dynamoDBConfig.table.name);
    }
    validateQueueConfig(config, consumerName) {
        const isSearchConfig = 'engineConfig' in config;
        if (isSearchConfig) {
            const searchConfig = config;
            if (searchConfig.existingQueueName) {
                if (searchConfig.queueName) {
                    this.logger.warn(`${consumerName}: Both 'existingQueueName' and 'queueName' provided. Using existing queue '${searchConfig.existingQueueName}', ignoring queueName.`);
                }
                if (searchConfig.queueProps) {
                    this.logger.warn(`${consumerName}: 'queueProps' provided with 'existingQueueName'. Queue properties are ignored when using existing queues.`);
                }
                if (searchConfig.functionProps) {
                    this.logger.warn(`${consumerName}: 'functionProps' provided with 'existingQueueName'. Function properties are ignored when using existing queues (they have their own handlers).`);
                }
            }
        }
        else {
            const auditConfig = config;
            if (auditConfig.existingQueueName) {
                if (auditConfig.queueName) {
                    this.logger.warn(`${consumerName}: Both 'existingQueueName' and 'queueName' provided. Using existing queue '${auditConfig.existingQueueName}', ignoring queueName.`);
                }
                if (auditConfig.queueProps) {
                    this.logger.warn(`${consumerName}: 'queueProps' provided with 'existingQueueName'. Queue properties are ignored when using existing queues.`);
                }
                if (auditConfig.functionProps) {
                    this.logger.warn(`${consumerName}: 'functionProps' provided with 'existingQueueName'. Function properties are ignored when using existing queues (they have their own handlers).`);
                }
            }
        }
    }
    extractQueueConfig(config) {
        // SearchIndexingConfig is distinguished by having engineConfig (required field)
        const isSearchConfig = 'engineConfig' in config;
        if (isSearchConfig) {
            const searchConfig = config;
            if ('queueHandlerPath' in searchConfig && searchConfig.queueHandlerPath) {
                return {
                    type: 'handler',
                    queueHandlerPath: searchConfig.queueHandlerPath,
                    functionProps: searchConfig.functionProps,
                };
            }
            else if ('existingQueueName' in searchConfig && searchConfig.existingQueueName) {
                return {
                    type: 'existing',
                    existingQueueName: searchConfig.existingQueueName,
                };
            }
            else {
                return {
                    type: 'new',
                    functionProps: searchConfig.functionProps,
                    queueProps: searchConfig.queueProps,
                    sqsEventSourceProps: searchConfig.sqsEventSourceProps,
                    customQueueName: searchConfig.queueName,
                };
            }
        }
        else {
            // AuditConfig
            const auditConfig = config;
            if (auditConfig.queueHandlerPath) {
                return {
                    type: 'handler',
                    queueHandlerPath: auditConfig.queueHandlerPath,
                    functionProps: auditConfig.functionProps,
                };
            }
            else if (auditConfig.existingQueueName) {
                return {
                    type: 'existing',
                    existingQueueName: auditConfig.existingQueueName,
                };
            }
            else {
                return {
                    type: 'new',
                    functionProps: auditConfig.functionProps,
                    queueProps: auditConfig.queueProps,
                    sqsEventSourceProps: auditConfig.sqsEventSourceProps,
                    customQueueName: auditConfig.queueName,
                };
            }
        }
    }
    buildCommonLambdaConfig(defaultHandlerEntry, environmentVariables, resourceAccess, functionProps) {
        return {
            entry: defaultHandlerEntry,
            environmentVariables,
            resourceAccess,
            functionProps,
        };
    }
    setupWithExistingQueue(existingQueueName, consumerName) {
        this.logger.info(`Using existing framework queue '${existingQueueName}' for ${consumerName}. The queue must be configured to subscribe to topic '${this.getStreamTopicName()}' in its @Queue setup.`);
        // Just validate the queue exists - DON'T modify it or subscribe it to anything
        try {
            this.fw24.getQueueByName(existingQueueName, this.mainStack, `${this.fw24.appName}-${consumerName}-existing`);
            this.logger.info(`${consumerName} validation completed - existing queue ${existingQueueName} found for table:`, this.dynamoDBConfig.table.name);
        }
        catch (error) {
            this.logger.error(`Queue '${existingQueueName}' not found for ${consumerName}. Ensure it's defined with @Queue('${existingQueueName}') decorator.`);
            throw error;
        }
    }
    async setupWithQueueHandler(queueHandlerPath, consumerName, environmentVariables, functionProps) {
        this.logger.info(`Loading queue handler from: ${queueHandlerPath}`);
        // Dynamic import (same pattern as QueueConstruct uses via Helper.registerHandlers)
        const absolutePath = (0, node_path_1.resolve)(queueHandlerPath);
        const queueModule = await Promise.resolve(`${absolutePath}`).then(s => __importStar(require(s)));
        // Find queue class (same logic as Helper.registerHandlers)
        let QueueClass;
        for (const exportedItem of Object.values(queueModule)) {
            if (typeof exportedItem === "function" && exportedItem.name !== "handler") {
                QueueClass = exportedItem;
                break;
            }
        }
        if (!QueueClass) {
            throw new Error(`No queue class found in ${queueHandlerPath}`);
        }
        // Instantiate to get config (same as QueueConstruct does)
        const handlerInstance = new QueueClass();
        const queueName = handlerInstance.queueName;
        const queueConfig = handlerInstance.queueConfig || {};
        // Validate manual registration flag
        if (!queueConfig.manualRegistration) {
            throw new Error(`Queue '${queueName}' must have manualRegistration: true in its @Queue config to use queueHandlerPath`);
        }
        this.logger.info(`Creating queue ${queueName} for ${consumerName}`);
        // Merge environment variables
        const mergedEnvVars = {
            ...environmentVariables,
            ...this.fw24.resolveEnvVariables(queueConfig.env)
        };
        // Merge function props (same pattern as QueueConstruct)
        // functionProps from searchIndexing/audit config take precedence
        const mergedFunctionProps = { ...queueConfig.functionProps, ...functionProps };
        // Create queue + lambda (same pattern as QueueConstruct, but with subscription to stream topic)
        const queue = new queue_lambda_1.QueueLambda(this.mainStack, `${queueName}-queue`, {
            queueName: queueName,
            queueProps: queueConfig.queueProps,
            visibilityTimeoutSeconds: queueConfig.visibilityTimeoutSeconds,
            receiveMessageWaitTimeSeconds: queueConfig.receiveMessageWaitTimeSeconds,
            retentionPeriodDays: queueConfig.retentionPeriodDays,
            maxReceiveCount: queueConfig.maxReceiveCount,
            sqsEventSourceProps: queueConfig.sqsEventSourceProps,
            subscriptions: {
                topics: [{
                        name: this.getStreamTopicName(),
                        filters: [],
                    }],
            },
            lambdaFunctionProps: {
                entry: absolutePath,
                environmentVariables: mergedEnvVars,
                resourceAccess: queueConfig.resourceAccess,
                functionProps: mergedFunctionProps,
                functionTimeout: queueConfig.functionTimeout,
                policies: queueConfig.policies,
                logRemovalPolicy: queueConfig.logRemovalPolicy,
                logRetentionDays: queueConfig.logRetentionDays,
            }
        });
        // Register output (same as QueueConstruct does)
        this.fw24.setConstructOutput(this, queueName, queue, construct_1.OutputType.QUEUE, 'queueName');
        this.logger.info(`${consumerName} queue created successfully: ${queueName}`);
    }
    setupWithNewQueue(queueConfig, consumerName, lambdaConfig) {
        const queueName = queueConfig.customQueueName || `${this.dynamoDBConfig.table.name}-${consumerName}`;
        const eventSourceProps = this.buildSqsEventSourceProps(queueConfig.sqsEventSourceProps);
        new queue_lambda_1.QueueLambda(this.mainStack, `${this.fw24.appName}-${consumerName}-queue`, {
            queueName: queueName,
            lambdaFunctionProps: lambdaConfig,
            queueProps: queueConfig.queueProps || {},
            subscriptions: {
                topics: [{
                        name: this.getStreamTopicName(),
                        filters: [],
                    }],
            },
            sqsEventSourceProps: eventSourceProps,
        });
    }
    buildSqsEventSourceProps(customProps) {
        return {
            batchSize: customProps?.batchSize || 5,
            maxBatchingWindow: customProps?.maxBatchingWindow || aws_cdk_lib_1.Duration.seconds(5),
            reportBatchItemFailures: customProps?.reportBatchItemFailures || true,
            ...customProps,
        };
    }
    async setupAuditProcessing(config, tableInstance) {
        // Only entity filtering env vars - observability handles backend routing
        const envVars = {};
        if (config.allowedEntityNames && config.allowedEntityNames.length > 0) {
            envVars[interfaces_1.AUDIT_ENV_KEYS.ALLOWED_ENTITY_NAMES] = config.allowedEntityNames.join(',');
        }
        if (config.excludedEntityNames && config.excludedEntityNames.length > 0) {
            envVars[interfaces_1.AUDIT_ENV_KEYS.EXCLUDED_ENTITY_NAMES] = config.excludedEntityNames.join(',');
        }
        // No resource access needed - observability system handles its own table access via global resource access
        await this.setupStreamEventConsumers(tableInstance, 'entity-audit', config, (0, node_path_1.join)(__dirname, '../audit/function/dynamodb-stream-handler.js'), envVars, {} // No additional resource access - observability handles it
        );
        this.logger.info('Audit processing enabled (observability-backed)', {
            table: this.dynamoDBConfig.table.name,
            allowedEntities: config.allowedEntityNames,
            excludedEntities: config.excludedEntityNames
        });
    }
    async setupSearchIndexingProcessing(config, tableInstance) {
        // Set search indexing configuration in environment variables for lambda functions
        this.logger.debug('Setting up search indexing processing for table:', this.dynamoDBConfig.table.name);
        const appQualifiedTableName = (0, keys_1.ensureNoSpecialChars)((0, keys_1.ensureSuffix)(this.dynamoDBConfig.table.name, `table`));
        const { enabled, engineConfig: { type: engineType, host: engineHost, masterKey: engineMasterKey } } = config;
        const envVars = {
            // pointer to the actual table name env variable
            [interfaces_2.SEARCH_INDEXER_ENV_KEYS.TABLE_NAME_ENV_KEY]: appQualifiedTableName,
            // actual table name
            [appQualifiedTableName]: this.fw24.getEnvironmentVariable(appQualifiedTableName, 'table'),
            [interfaces_2.SEARCH_INDEXER_ENV_KEYS.ENABLED]: enabled?.toString() || 'false',
            [interfaces_2.SEARCH_INDEXER_ENV_KEYS.MEILI_HOST]: engineHost || engineType === 'meili' ? this.fw24.getEnvironmentVariable(interfaces_2.SEARCH_INDEXER_ENV_KEYS.MEILI_HOST) : undefined,
            [interfaces_2.SEARCH_INDEXER_ENV_KEYS.MEILI_MASTER_KEY]: engineMasterKey || engineType === 'meili' ? this.fw24.getEnvironmentVariable(interfaces_2.SEARCH_INDEXER_ENV_KEYS.MEILI_MASTER_KEY) : undefined,
        };
        if (config.allowedEntityNames && config.allowedEntityNames.length > 0) {
            envVars[interfaces_2.SEARCH_INDEXER_ENV_KEYS.ALLOWED_ENTITY_NAMES] = config.allowedEntityNames.join(',');
        }
        if (config.excludedEntityNames && config.excludedEntityNames.length > 0) {
            envVars[interfaces_2.SEARCH_INDEXER_ENV_KEYS.EXCLUDED_ENTITY_NAMES] = config.excludedEntityNames.join(',');
        }
        // Create QueueLambda for processing search indexing events from the stream topic
        await this.setupStreamEventConsumers(tableInstance, 'search-indexer', config, (0, node_path_1.join)(__dirname, '../search/indexer/functions/default-dynamo-stream-search-indexer-handler.js'), envVars, {} // No base resource access
        );
        // TODO: look into it later
        // const systemControllerPath = '/system/search';
        // if (!this.fw24.hasSystemController(systemControllerPath)) {
        //     this.fw24.registerSystemController({
        //         path: systemControllerPath,
        //         filePath: join(__dirname, '../search/system/search-controller.js'),
        //     });
        //     this.logger.info('Search system controller registered.');
        // }
    }
}
exports.DynamoDBConstruct = DynamoDBConstruct;
__decorate([
    (0, logging_1.LogDuration)()
], DynamoDBConstruct.prototype, "construct", null);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHluYW1vZGIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY29uc3RydWN0cy9keW5hbW9kYi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSw2Q0FBNkQ7QUFDN0QsMkRBQWlFO0FBQ2pFLHVEQUEwRDtBQUMxRCxtRkFBc0g7QUFLdEgseUNBQTBDO0FBRTFDLG9EQUFxRDtBQUNyRCx1Q0FBb0M7QUFDcEMsdURBQXlGO0FBRXpGLHdDQUF1RDtBQUN2RCw2REFBdUU7QUFFdkUsd0NBQW1FO0FBQ25FLHVEQUF3RTtBQUN4RSxpREFBNkM7QUFDN0MsbUNBQWdFO0FBbVdoRSxNQUFhLGlCQUFpQjtJQW9CRztJQW5CcEIsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxpQkFBaUIsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUM5QyxJQUFJLEdBQVMsV0FBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO0lBRXpDLElBQUksR0FBVyxpQkFBaUIsQ0FBQyxJQUFJLENBQUM7SUFDdEMsWUFBWSxHQUFhLEVBQUUsQ0FBQztJQUM1QixNQUFNLENBQXVCO0lBRTdCLFNBQVMsQ0FBUztJQUVsQjs7Ozs7Ozs7O09BU0c7SUFDSCxZQUE2QixjQUErQjtRQUEvQixtQkFBYyxHQUFkLGNBQWMsQ0FBaUI7SUFBSSxDQUFDO0lBRWpFLHVDQUF1QztJQUUxQixBQUFOLEtBQUssQ0FBQyxTQUFTO1FBQ2xCLE1BQU0sSUFBSSxHQUFHLFdBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztRQUNoQyxJQUFJLENBQUMsU0FBUyxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxTQUFTLEVBQUUsSUFBSSxDQUFDLGNBQWMsQ0FBQyxlQUFlLENBQUMsQ0FBQztRQUNuRyxNQUFNLHFCQUFxQixHQUFHLElBQUEsMkJBQW9CLEVBQUMsSUFBQSxtQkFBWSxFQUFDLElBQUks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LElBQUEscUJBQVcsR0FBRTtrREFxRGIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBEdXJhdGlvbiwgUmVtb3ZhbFBvbGljeSwgU3RhY2sgfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCB7IFRhYmxlUHJvcHNWMiwgVGFibGVWMiB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGJcIjtcbmltcG9ydCB7IFN0YXJ0aW5nUG9zaXRpb24gfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxhbWJkYVwiO1xuaW1wb3J0IHsgRHluYW1vRXZlbnRTb3VyY2UsIER5bmFtb0V2ZW50U291cmNlUHJvcHMsIFNxc0V2ZW50U291cmNlUHJvcHMgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ldmVudC1zb3VyY2VzXCI7XG5pbXBvcnQgeyBOb2RlanNGdW5jdGlvbiwgTm9kZWpzRnVuY3Rpb25Qcm9wcyB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLW5vZGVqc1wiO1xuaW1wb3J0IHsgTG9nR3JvdXAsIExvZ0dyb3VwUHJvcHMsIFJldGVudGlvbkRheXMgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxvZ3NcIjtcbmltcG9ydCB7IFRvcGljUHJvcHMgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLXNuc1wiO1xuaW1wb3J0IHsgUXVldWUsIFF1ZXVlUHJvcHMgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLXNxc1wiO1xuaW1wb3J0IHsgam9pbiwgcmVzb2x2ZSB9IGZyb20gXCJub2RlOnBhdGhcIjtcblxuaW1wb3J0IHsgQVVESVRfRU5WX0tFWVMgfSBmcm9tIFwiLi4vYXVkaXQvaW50ZXJmYWNlc1wiO1xuaW1wb3J0IHsgRncyNCB9IGZyb20gXCIuLi9jb3JlL2Z3MjRcIjtcbmltcG9ydCB7IEZXMjRDb25zdHJ1Y3QsIEZXMjRDb25zdHJ1Y3RPdXRwdXQsIE91dHB1dFR5cGUgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3RcIjtcbmltcG9ydCB7IElDb25zdHJ1Y3RDb25maWcgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3QtY29uZmlnXCI7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIsIExvZ0R1cmF0aW9uIH0gZnJvbSBcIi4uL2xvZ2dpbmdcIjtcbmltcG9ydCB7IFNFQVJDSF9JTkRFWEVSX0VOVl9LRVlTIH0gZnJvbSBcIi4uL3NlYXJjaC9pbmRleGVyL2ludGVyZmFjZXNcIjtcbmltcG9ydCB7IHJlbW92ZUVtcHR5IH0gZnJvbSBcIi4uL3V0aWxzXCI7XG5pbXBvcnQgeyBlbnN1cmVOb1NwZWNpYWxDaGFycywgZW5zdXJlU3VmZml4IH0gZnJvbSBcIi4uL3V0aWxzL2tleXNcIjtcbmltcG9ydCB7IExhbWJkYUZ1bmN0aW9uLCBMYW1iZGFGdW5jdGlvblByb3BzIH0gZnJvbSBcIi4vbGFtYmRhLWZ1bmN0aW9uXCI7XG5pbXBvcnQgeyBRdWV1ZUxhbWJkYSB9IGZyb20gXCIuL3F1ZXVlLWxhbWJkYVwiO1xuaW1wb3J0IHsgSVRvcGljQ29uc3RydWN0Q29uZmlnLCBUb3BpY0NvbnN0cnVjdCB9IGZyb20gXCIuL3RvcGljXCI7XG5cbmludGVyZmFjZSBOZXdRdWV1ZUNvbmZpZyB7XG4gICAgdHlwZTogJ25ldyc7XG4gICAgZnVuY3Rpb25Qcm9wcz86IE5vZGVqc0Z1bmN0aW9uUHJvcHM7XG4gICAgcXVldWVQcm9wcz86IFF1ZXVlUHJvcHM7XG4gICAgc3FzRXZlbnRTb3VyY2VQcm9wcz86IFNxc0V2ZW50U291cmNlUHJvcHM7XG4gICAgY3VzdG9tUXVldWVOYW1lPzogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgRXhpc3RpbmdRdWV1ZUNvbmZpZyB7XG4gICAgdHlwZTogJ2V4aXN0aW5nJztcbiAgICBleGlzdGluZ1F1ZXVlTmFtZTogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgSGFuZGxlclF1ZXVlQ29uZmlnIHtcbiAgICB0eXBlOiAnaGFuZGxlcic7XG4gICAgcXVldWVIYW5kbGVyUGF0aDogc3RyaW5nO1xuICAgIGZ1bmN0aW9uUHJvcHM/OiBOb2RlanNGdW5jdGlvblByb3BzO1xufVxuXG50eXBlIFF1ZXVlQ29uZmlnID0gTmV3UXVldWVDb25maWcgfCBFeGlzdGluZ1F1ZXVlQ29uZmlnIHwgSGFuZGxlclF1ZXVlQ29uZmlnO1xuXG5leHBvcnQgdHlwZSBTZWFyY2hFbmdpbmVDb25maWcgPSB7XG4gICAgdHlwZTogJ21laWxpJyxcbiAgICBob3N0OiBzdHJpbmcsXG4gICAgbWFzdGVyS2V5OiBzdHJpbmdcbn1cbi8vIHVuY29tbWVudCB3aGVuIGltcGxlbWVudGVkXG4vLyB9IHwge1xuLy8gICAgIHR5cGU6ICdlbGFzdGljc2VhcmNoJywgLy8gbm90IGltcGxlbWVudGVkIHlldFxuLy8gICAgIGhvc3Q6IHN0cmluZyxcbi8vICAgICBhcGlLZXk6IHN0cmluZ1xuLy8gfSB8IHtcbi8vICAgICB0eXBlOiAnYWxnb2xpYScsIC8vIG5vdCBpbXBsZW1lbnRlZCB5ZXRcbi8vICAgICBhcHBJZDogc3RyaW5nLFxuLy8gICAgIGFwaUtleTogc3RyaW5nXG4vLyB9XG5cbi8qKlxuICogQ29uZmlndXJhdGlvbiBmb3Igc2VhcmNoIGluZGV4aW5nLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFNlYXJjaEluZGV4aW5nQ29uZmlnIGV4dGVuZHMgSUNvbnN0cnVjdENvbmZpZyB7XG4gICAgLyoqXG4gICAgICogV2hldGhlciB0byBlbmFibGUgc2VhcmNoIGluZGV4aW5nLlxuICAgICAqIEBkZWZhdWx0IGZhbHNlXG4gICAgICovXG4gICAgZW5hYmxlZD86IGJvb2xlYW47XG4gICAgLyoqXG4gICAgICogTGlzdCBvZiBhbGxvd2VkIGVudGl0eSBuYW1lcyB0byBiZSBpbmRleGVkLlxuICAgICAqIElmIG5vdCBwcm92aWRlZCwgYWxsIGVudGl0aWVzIHdpbGwgYmUgaW5kZXhlZCBleGNlcHQgdGhvc2UgaW4gZXhjbHVkZWRFbnRpdHlOYW1lcyBvciBzeXN0ZW0gZW50aXRpZXMuXG4gICAgICogVGFrZXMgcHJlY2VkZW5jZSBvdmVyIGV4Y2x1ZGVkRW50aXR5TmFtZXMgaWYgYm90aCBhcmUgcHJvdmlkZWQuXG4gICAgICovXG4gICAgYWxsb3dlZEVudGl0eU5hbWVzPzogc3RyaW5nW107XG4gICAgLyoqXG4gICAgICogTGlzdCBvZiBlbnRpdHkgbmFtZXMgdG8gZXhjbHVkZSBmcm9tIGluZGV4aW5nLlxuICAgICAqIElmIGFsbG93ZWRFbnRpdHlOYW1lcyBpcyBwcm92aWRlZCwgdGhpcyBmaWVsZCBpcyBpZ25vcmVkLlxuICAgICAqIElmIG5laXRoZXIgYWxsb3dlZEVudGl0eU5hbWVzIG5vciBleGNsdWRlZEVudGl0eU5hbWVzIGlzIHByb3ZpZGVkLCBkZWZhdWx0cyB0byBleGNsdWRpbmcgc3lzdGVtIGVudGl0aWVzIGxpa2UgJ2F1ZGl0TG9nJy5cbiAgICAgKi9cbiAgICBleGNsdWRlZEVudGl0eU5hbWVzPzogc3RyaW5nW107XG4gICAgLyoqXG4gICAgICogU2VhcmNoIGVuZ2luZSBjb25maWd1cmF0aW9uIHRoYXQgZGVmaW5lcyB3aGljaCBzZWFyY2ggcHJvdmlkZXIgdG8gdXNlIGFuZCBpdHMgY29ubmVjdGlvbiBkZXRhaWxzLlxuICAgICAqIFxuICAgICAqIEN1cnJlbnRseSBzdXBwb3J0cyBNZWlsaVNlYXJjaCB3aXRoIHBsYW5zIHRvIGV4dGVuZCB0byBFbGFzdGljc2VhcmNoIGFuZCBBbGdvbGlhLlxuICAgICAqIFxuICAgICAqIEBleGFtcGxlXG4gICAgICogYGBgdHlwZXNjcmlwdFxuICAgICAqIGVuZ2luZUNvbmZpZzoge1xuICAgICAqICAgdHlwZTogJ21laWxpJyxcbiAgICAgKiAgIGhvc3Q6ICdodHRwczovL3lvdXItbWVpbGlzZWFyY2gtaW5zdGFuY2UuY29tJyxcbiAgICAgKiAgIG1hc3RlcktleTogJ3lvdXItbWFzdGVyLWtleSdcbiAgICAgKiB9XG4gICAgICogYGBgXG4gICAgICovXG4gICAgZW5naW5lQ29uZmlnOiBTZWFyY2hFbmdpbmVDb25maWc7XG4gICAgLyoqXG4gICAgICogQ3VzdG9tIGZ1bmN0aW9uIHByb3BlcnRpZXMgZm9yIHRoZSBzZWFyY2ggaW5kZXhpbmcgTGFtYmRhLlxuICAgICAqIEFsbG93cyBvdmVycmlkaW5nIGZ1bmN0aW9uIGNvbmZpZ3VyYXRpb24gbGlrZSBWUEMsIG1lbW9yeSwgdGltZW91dCwgZXRjLlxuICAgICAqIFxuICAgICAqICoqTm90ZToqKiBcbiAgICAgKiAtIFByb3BlcnRpZXMgc3BlY2lmaWVkIGhlcmUgd2lsbCBvdmVycmlkZSB0aGUgcXVldWUncyBAUXVldWUgZGVjb3JhdG9yIGZ1bmN0aW9uUHJvcHNcbiAgICAgKiAtIElnbm9yZWQgd2hlbiBgZXhpc3RpbmdRdWV1ZU5hbWVgIGlzIHByb3ZpZGVkIChleGlzdGluZyBxdWV1ZXMgaGF2ZSB0aGVpciBvd24gaGFuZGxlcnMpXG4gICAgICovXG4gICAgZnVuY3Rpb25Qcm9wcz86IE5vZGVqc0Z1bmN0aW9uUHJvcHM7XG4gICAgLyoqXG4gICAgICogQ3VzdG9tIHF1ZXVlIG5hbWUgZm9yIGNyZWF0aW5nIGEgbmV3IHNlYXJjaCBpbmRleGluZyBxdWV1ZS5cbiAgICAgKiBJZiBub3QgcHJvdmlkZWQsIGRlZmF1bHRzIHRvIGAke3RhYmxlTmFtZX0tc2VhcmNoLWluZGV4ZXJgXG4gICAgICogXG4gICAgICogKipOb3RlOioqIENhbm5vdCBiZSB1c2VkIHdpdGggYGV4aXN0aW5nUXVldWVOYW1lYFxuICAgICAqL1xuICAgIHF1ZXVlTmFtZT86IHN0cmluZztcbiAgICAvKipcbiAgICAgKiBOYW1lIG9mIGFuIGV4aXN0aW5nIGZyYW1ld29yay1tYW5hZ2VkIHF1ZXVlIHRvIHVzZSBmb3Igc2VhcmNoIGluZGV4aW5nIHByb2Nlc3NpbmcuXG4gICAgICogXG4gICAgICogKipJbXBvcnRhbnQ6KiogVGhlIGV4aXN0aW5nIHF1ZXVlIG11c3Q6XG4gICAgICogLSBCZSBkZWZpbmVkIHdpdGggQFF1ZXVlKCdRdWV1ZU5hbWUnKSBkZWNvcmF0b3IgaW4geW91ciBzcmMvcXVldWVzIGRpcmVjdG9yeVxuICAgICAqIC0gQWxyZWFkeSBiZSByZWdpc3RlcmVkIGJ5IHRoZSBmcmFtZXdvcmsncyBRdWV1ZUNvbnN0cnVjdFxuICAgICAqIC0gQmUgY29uZmlndXJlZCB0byBzdWJzY3JpYmUgdG8gdGhlIHN0cmVhbSB0b3BpYyBpbiBpdHMgQFF1ZXVlIHN1YnNjcmlwdGlvbnNcbiAgICAgKiBcbiAgICAgKiAqKkV4YW1wbGU6KiogXG4gICAgICogYGBgdHlwZXNjcmlwdFxuICAgICAqIEBRdWV1ZSgnTWVpbGlzZWFyY2hTeW5jJywge1xuICAgICAqICAgc3Vic2NyaXB0aW9uczoge1xuICAgICAqICAgICB0b3BpY3M6IFt7IG5hbWU6ICdteVRhYmxlLXN0cmVhbScgfV1cbiAgICAgKiAgIH1cbiAgICAgKiB9KVxuICAgICAqIGV4cG9ydCBjbGFzcyBNZWlsaXNlYXJjaFN5bmMgZXh0ZW5kcyBCYXNlU2VhcmNoSW5kZXhlciB7IC4uLiB9XG4gICAgICogYGBgXG4gICAgICogVGhlbiB1c2U6IGBleGlzdGluZ1F1ZXVlTmFtZTogJ01laWxpc2VhcmNoU3luYydgXG4gICAgICogXG4gICAgICogKipOb3RlOioqIENhbm5vdCBiZSB1c2VkIHdpdGggYHF1ZXVlTmFtZWAgb3IgYHF1ZXVlUHJvcHNgXG4gICAgICovXG4gICAgZXhpc3RpbmdRdWV1ZU5hbWU/OiBzdHJpbmc7XG4gICAgLyoqXG4gICAgICogUGF0aCB0byBxdWV1ZSBoYW5kbGVyIGZpbGUgZm9yIG1hbnVhbCByZWdpc3RyYXRpb24uXG4gICAgICogVGhlIHF1ZXVlIGhhbmRsZXIgbXVzdCBoYXZlIGBtYW51YWxSZWdpc3RyYXRpb246IHRydWVgIGluIGl0cyBAUXVldWUgY29uZmlnLlxuICAgICAqIER5bmFtb0RCIGNvbnN0cnVjdCB3aWxsIGNyZWF0ZSB0aGUgcXVldWUgYW5kIGF1dG9tYXRpY2FsbHkgc3Vic2NyaWJlIGl0IHRvIHRoZSBzdHJlYW0gdG9waWMuXG4gICAgICogXG4gICAgICogKipFeGFtcGxlOioqXG4gICAgICogYGBgdHlwZXNjcmlwdFxuICAgICAqIC8vIEluIHNyYy9xdWV1ZXMvbWVpbGlzZWFyY2gtc3luYy50czpcbiAgICAgKiBAUXVldWUoJ01laWxpc2VhcmNoU3luYycsIHtcbiAgICAgKiAgIG1hbnVhbFJlZ2lzdHJhdGlvbjogdHJ1ZSxcbiAgICAgKiAgIHJlc291cmNlQWNjZXNzOiB7IHRhYmxlczogWydwbHVzZmFuJ10gfSxcbiAgICAgKiAgIC8vIC4uLiBvdGhlciBxdWV1ZSBjb25maWdcbiAgICAgKiB9KVxuICAgICAqIGV4cG9ydCBjbGFzcyBNZWlsaXNlYXJjaFN5bmMgZXh0ZW5kcyBCYXNlU2VhcmNoSW5kZXhlciB7IC4uLiB9XG4gICAgICogXG4gICAgICogLy8gSW4gaW5kZXgudHM6XG4gICAgICogc2VhcmNoSW5kZXhpbmc6IFt7XG4gICAgICogICBlbmFibGVkOiB0cnVlLFxuICAgICAqICAgcXVldWVIYW5kbGVyUGF0aDogJy4vc3JjL3F1ZXVlcy9tZWlsaXNlYXJjaC1zeW5jLnRzJyxcbiAgICAgKiAgIGVuZ2luZUNvbmZpZzogeyB0eXBlOiAnbWVpbGknLCBob3N0OiAnLi4uJywgbWFzdGVyS2V5OiAnLi4uJyB9XG4gICAgICogfV1cbiAgICAgKiBgYGBcbiAgICAgKiBcbiAgICAgKiAqKk5vdGU6KiogQ2Fubm90IGJlIHVzZWQgd2l0aCBgcXVldWVOYW1lYCwgYGV4aXN0aW5nUXVldWVOYW1lYCwgb3IgYGxhbWJkYUZ1bmN0aW9uUHJvcHNgXG4gICAgICovXG4gICAgcXVldWVIYW5kbGVyUGF0aD86IHN0cmluZztcbiAgICAvKipcbiAgICAgKiBTZWFyY2ggaW5kZXhpbmcgcXVldWUgcHJvcGVydGllcyAob25seSB1c2VkIHdoZW4gY3JlYXRpbmcgYSBuZXcgcXVldWUpXG4gICAgICogXG4gICAgICogKipOb3RlOioqIElnbm9yZWQgd2hlbiBgZXhpc3RpbmdRdWV1ZU5hbWVgIG9yIGBxdWV1ZUhhbmRsZXJQYXRoYCBpcyBwcm92aWRlZFxuICAgICAqL1xuICAgIHF1ZXVlUHJvcHM/OiBRdWV1ZVByb3BzO1xuICAgIC8qKlxuICAgICAqIFNRUyBldmVudCBzb3VyY2UgcHJvcGVydGllcyBmb3Igc2VhcmNoIGluZGV4aW5nXG4gICAgICovXG4gICAgc3FzRXZlbnRTb3VyY2VQcm9wcz86IFNxc0V2ZW50U291cmNlUHJvcHM7XG59XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgY29uZmlndXJhdGlvbiBmb3IgYSBEeW5hbW9EQiB0YWJsZS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJRHluYW1vREJDb25maWcgZXh0ZW5kcyBJQ29uc3RydWN0Q29uZmlnIHtcbiAgICB0YWJsZToge1xuICAgICAgICAvKipcbiAgICAgICAgICogVGhlIG5hbWUgb2YgdGhlIER5bmFtb0RCIHRhYmxlLlxuICAgICAgICAgKi9cbiAgICAgICAgbmFtZTogc3RyaW5nO1xuICAgICAgICAvKipcbiAgICAgICAgICogVGhlIHByb3BlcnRpZXMgZm9yIHRoZSBEeW5hbW9EQiB0YWJsZS5cbiAgICAgICAgICovXG4gICAgICAgIHByb3BzOiBUYWJsZVByb3BzVjI7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBTdHJlYW0gcHJvY2Vzc2luZyBjb25maWd1cmF0aW9uXG4gICAgICAgICAqL1xuICAgICAgICBzdHJlYW0/OiB7XG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICAqIEVuYWJsZSBzdHJlYW0gcHJvY2Vzc2luZ1xuICAgICAgICAgICAgICovXG4gICAgICAgICAgICBlbmFibGVkPzogYm9vbGVhbjtcbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICogU05TIHRvcGljIGNvbmZpZ3VyYXRpb24gZm9yIHN0cmVhbSBldmVudHNcbiAgICAgICAgICAgICAqL1xuICAgICAgICAgICAgdG9waWM/OiB7XG4gICAgICAgICAgICAgICAgLyoqXG4gICAgICAgICAgICAgICAgICogVG9waWMgbmFtZS4gRGVmYXVsdHMgdG8ge3RhYmxlTmFtZX0tc3RyZWFtXG4gICAgICAgICAgICAgICAgICovXG4gICAgICAgICAgICAgICAgbmFtZT86IHN0cmluZztcbiAgICAgICAgICAgICAgICAvKipcbiAgICAgICAgICAgICAgICAgKiBUb3BpYyBwcm9wZXJ0aWVzXG4gICAgICAgICAgICAgICAgICovXG4gICAgICAgICAgICAgICAgcHJvcHM/OiBUb3BpY1Byb3BzO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICogU3RyZWFtIHByb2Nlc3NvciBMYW1iZGEgY29uZmlndXJhdGlvblxuICAgICAgICAgICAgICovXG4gICAgICAgICAgICBwcm9jZXNzb3I/OiBEeW5hbW9FdmVudFNvdXJjZVByb3BzO1xuICAgICAgICB9O1xuICAgICAgICAvKipcbiAgICAgICAgICogQXVkaXQgY29uZmlndXJhdGlvbiBmb3IgdGhlIER5bmFtb0RCIHRhYmxlLlxuICAgICAgICAgKi9cbiAgICAgICAgYXVkaXQ/OiBBdWRpdENvbmZpZztcbiAgICAgICAgLyoqXG4gICAgICAgICAqIFNlYXJjaCBpbmRleGluZyBjb25maWd1cmF0aW9uIGZvciB0aGUgRHluYW1vREIgdGFibGUuXG4gICAgICAgICAqL1xuICAgICAgICBzZWFyY2hJbmRleGluZz86IFNlYXJjaEluZGV4aW5nQ29uZmlnW107XG4gICAgfTtcbn1cblxuLyoqXG4gKiBAcGFyYW0gZHluYW1vREJDb25maWcgVGhlIGNvbmZpZ3VyYXRpb24gb2JqZWN0IGZvciBEeW5hbW9EQi5cbiAqIEBleGFtcGxlXG4gKiBgYGB0c1xuICogXG4gKiBjb25zdCBkeW5hbW9EQkNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICogICB0YWJsZToge1xuICogICAgIG5hbWU6ICdteVRhYmxlJyxcbiAqICAgICBwcm9wczoge1xuICogICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6ICdTVFJJTkcnIH0sXG4gKiAgICAgICBzb3J0S2V5OiB7IG5hbWU6ICd0aW1lc3RhbXAnLCB0eXBlOiAnTlVNQkVSJyB9LFxuICogICAgICAgYmlsbGluZ01vZGU6ICdQQVlfUEVSX1JFUVVFU1QnLFxuICogICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWVxuICogICAgIH1cbiAqICAgfVxuICogfTtcbiAqIFxuICogY29uc3QgZHluYW1vREIgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoZHluYW1vREJDb25maWcpO1xuICogXG4gKiBhcHAudXNlKGR5bmFtb0RCKTtcbiAqIFxuICogYGBgXG4gKiBcbiAqIEF1ZGl0IGxvZ2dpbmcgKHZpYSBvYnNlcnZhYmlsaXR5IHN5c3RlbSk6XG4gKiBgYGB0c1xuICogYXVkaXQ6IHtcbiAqICAgZW5hYmxlZDogdHJ1ZSxcbiAqICAgYWxsb3dlZEVudGl0eU5hbWVzOiBbJ3VzZXInLCAnb3JkZXInLCAncGF5bWVudCddLFxuICogICAvLyBCYWNrZW5kIHJvdXRpbmcgY29uZmlndXJlZCB2aWEgb2JzZXJ2YWJpbGl0eSBESSBsYXllclxuICogfVxuICogYGBgXG4gKiBcbiAqIEN1c3RvbSBhdWRpdCBxdWV1ZTpcbiAqIGBgYHRzXG4gKiBhdWRpdDoge1xuICogICBlbmFibGVkOiB0cnVlLFxuICogICBhbGxvd2VkRW50aXR5TmFtZXM6IFsndXNlcicsICdvcmRlciddLFxuICogICBxdWV1ZU5hbWU6ICdteS1jdXN0b20tYXVkaXQtcXVldWUnXG4gKiB9XG4gKiBgYGBcbiAqIFxuICogQ3VzdG9tIHNlYXJjaCBpbmRleGluZyBxdWV1ZTpcbiAqIGBgYHRzXG4gKiBzZWFyY2hJbmRleGluZzogW3tcbiAqICAgZW5hYmxlZDogdHJ1ZSxcbiAqICAgZW5naW5lQ29uZmlnOiB7XG4gKiAgICAgdHlwZTogJ21laWxpJyxcbiAqICAgICBob3N0OiAnaHR0cHM6Ly9tZWlsaXNlYXJjaC5leGFtcGxlLmNvbScsXG4gKiAgICAgbWFzdGVyS2V5OiAnbWFzdGVyLWtleSdcbiAqICAgfSxcbiAqICAgcXVldWVOYW1lOiAnbXktY3VzdG9tLXNlYXJjaC1xdWV1ZSdcbiAqIH1dXG4gKiBgYGBcbiAqIFxuICogRXhpc3RpbmcgZnJhbWV3b3JrLW1hbmFnZWQgc2VhcmNoIGluZGV4aW5nIHF1ZXVlOlxuICogYGBgdHNcbiAqIC8vIEZpcnN0IGRlZmluZSB0aGUgcXVldWUgaGFuZGxlcjpcbiAqIC8vIEBRdWV1ZSgnTWVpbGlzZWFyY2hTeW5jJywgeyBzdWJzY3JpcHRpb25zOiB7IHRvcGljczogW3sgbmFtZTogJ215VGFibGUtc3RyZWFtJyB9XSB9IH0pXG4gKiAvLyBleHBvcnQgY2xhc3MgTWVpbGlzZWFyY2hTeW5jIGV4dGVuZHMgQmFzZVNlYXJjaEluZGV4ZXIgeyAuLi4gfVxuICogXG4gKiBzZWFyY2hJbmRleGluZzogW3tcbiAqICAgZW5hYmxlZDogdHJ1ZSxcbiAqICAgZW5naW5lQ29uZmlnOiB7XG4gKiAgICAgdHlwZTogJ21laWxpJyxcbiAqICAgICBob3N0OiAnaHR0cHM6Ly9tZWlsaXNlYXJjaC5leGFtcGxlLmNvbScsIFxuICogICAgIG1hc3RlcktleTogJ21hc3Rlci1rZXknXG4gKiAgIH0sXG4gKiAgIGV4aXN0aW5nUXVldWVOYW1lOiAnTWVpbGlzZWFyY2hTeW5jJyAgLy8gUmVmZXJlbmNlcyB0aGUgQFF1ZXVlKCdNZWlsaXNlYXJjaFN5bmMnKVxuICogfV1cbiAqIGBgYFxuICovXG5cblxuLyoqXG4gKiBDb25maWd1cmF0aW9uIGZvciBhdWRpdCBsb2dnaW5nIHZpYSBEeW5hbW9EQiBzdHJlYW1zLlxuICogXG4gKiBBdWRpdCBldmVudHMgYXJlIGNhcHR1cmVkIGJ5IHRoZSBvYnNlcnZhYmlsaXR5IHN5c3RlbSAtIHRoaXMgY29uZmlnIG9ubHkgY29udHJvbHM6XG4gKiAtIFdoaWNoIGVudGl0aWVzIHRvIGF1ZGl0IChlbnRpdHkgZmlsdGVyaW5nKVxuICogLSBTdHJlYW0gcHJvY2Vzc2luZyBxdWV1ZSBjb25maWd1cmF0aW9uXG4gKiBcbiAqIEJhY2tlbmQgcm91dGluZyAoRHluYW1vREIsIENsb3VkV2F0Y2gsIE9URUwpIGlzIGNvbmZpZ3VyZWQgdmlhIG9ic2VydmFiaWxpdHk6XG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBJbiB5b3VyIERJIGxheWVyOlxuICogaW1wb3J0IHsgY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZyB9IGZyb20gJ0B0ZW4yNGdyb3VwL2Z3MjQvb2JzZXJ2YWJpbGl0eSc7XG4gKiBcbiAqIERJQ29udGFpbmVyLlJPT1QucmVnaXN0ZXJDb25maWdQcm92aWRlcih7XG4gKiAgIHByb3ZpZGU6ICdvYnNlcnZhYmlsaXR5JyxcbiAqICAgdXNlQ29uZmlnOiBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnKHtcbiAqICAgICBiYWNrZW5kczogW1xuICogICAgICAgeyB0eXBlOiAnZHluYW1vZGInfSxcbiAqICAgICAgIHsgdHlwZTogJ2Nsb3Vkd2F0Y2gnfVxuICogICAgIF1cbiAqICAgfSksXG4gKiAgIHByaW9yaXR5OiAxMFxuICogfSk7XG4gKiBgYGBcbiAqL1xuaW50ZXJmYWNlIEF1ZGl0Q29uZmlnIGV4dGVuZHMgSUNvbnN0cnVjdENvbmZpZyB7XG4gICAgLyoqXG4gICAgICogV2hldGhlciB0byBlbmFibGUgYXVkaXQgbG9nZ2luZyBmb3IgRHluYW1vREIgc3RyZWFtcy5cbiAgICAgKiBAZGVmYXVsdCBmYWxzZVxuICAgICAqL1xuICAgIGVuYWJsZWQ/OiBib29sZWFuO1xuXG4gICAgLyoqXG4gICAgICogTGlzdCBvZiBhbGxvd2VkIGVudGl0eSBuYW1lcyB0byBiZSBhdWRpdGVkLlxuICAgICAqIElmIG5vdCBwcm92aWRlZCwgYWxsIGVudGl0aWVzIHdpbGwgYmUgYXVkaXRlZCBleGNlcHQgdGhvc2UgaW4gZXhjbHVkZWRFbnRpdHlOYW1lcyBvciBzeXN0ZW0gZW50aXRpZXMuXG4gICAgICogVGFrZXMgcHJlY2VkZW5jZSBvdmVyIGV4Y2x1ZGVkRW50aXR5TmFtZXMgaWYgYm90aCBhcmUgcHJvdmlkZWQuXG4gICAgICovXG4gICAgYWxsb3dlZEVudGl0eU5hbWVzPzogc3RyaW5nW107XG5cbiAgICAvKipcbiAgICAgKiBMaXN0IG9mIGVudGl0eSBuYW1lcyB0byBleGNsdWRlIGZyb20gYXVkaXRpbmcuXG4gICAgICogSWYgYWxsb3dlZEVudGl0eU5hbWVzIGlzIHByb3ZpZGVkLCB0aGlzIGZpZWxkIGlzIGlnbm9yZWQuXG4gICAgICogSWYgbmVpdGhlciBhbGxvd2VkRW50aXR5TmFtZXMgbm9yIGV4Y2x1ZGVkRW50aXR5TmFtZXMgaXMgcHJvdmlkZWQsIFxuICAgICAqIGRlZmF1bHRzIHRvIGV4Y2x1ZGluZyBzeXN0ZW0gZW50aXRpZXMgbGlrZSAnYXVkaXRMb2cnIGFuZCAnb2JzZXJ2YWJpbGl0eUxvZycuXG4gICAgICovXG4gICAgZXhjbHVkZWRFbnRpdHlOYW1lcz86IHN0cmluZ1tdO1xuXG4gICAgLyoqXG4gICAgICogQ3VzdG9tIGZ1bmN0aW9uIHByb3BlcnRpZXMgZm9yIHRoZSBhdWRpdCBMYW1iZGEuXG4gICAgICogQWxsb3dzIG92ZXJyaWRpbmcgZnVuY3Rpb24gY29uZmlndXJhdGlvbiBsaWtlIFZQQywgbWVtb3J5LCB0aW1lb3V0LCBldGMuXG4gICAgICovXG4gICAgZnVuY3Rpb25Qcm9wcz86IE5vZGVqc0Z1bmN0aW9uUHJvcHM7XG5cbiAgICAvKipcbiAgICAgKiBDdXN0b20gcXVldWUgbmFtZSBmb3IgY3JlYXRpbmcgYSBuZXcgYXVkaXQgcXVldWUuXG4gICAgICogSWYgbm90IHByb3ZpZGVkLCBkZWZhdWx0cyB0byBgJHt0YWJsZU5hbWV9LWVudGl0eS1hdWRpdGBcbiAgICAgKi9cbiAgICBxdWV1ZU5hbWU/OiBzdHJpbmc7XG5cbiAgICAvKipcbiAgICAgKiBOYW1lIG9mIGFuIGV4aXN0aW5nIGZyYW1ld29yay1tYW5hZ2VkIHF1ZXVlIHRvIHVzZSBmb3IgYXVkaXQgcHJvY2Vzc2luZy5cbiAgICAgKiBUaGUgZXhpc3RpbmcgcXVldWUgbXVzdCBiZSBkZWZpbmVkIHdpdGggQFF1ZXVlIGRlY29yYXRvciBhbmQgc3Vic2NyaWJlIHRvIHRoZSBzdHJlYW0gdG9waWMuXG4gICAgICovXG4gICAgZXhpc3RpbmdRdWV1ZU5hbWU/OiBzdHJpbmc7XG5cbiAgICAvKipcbiAgICAgKiBQYXRoIHRvIHF1ZXVlIGhhbmRsZXIgZmlsZSBmb3IgbWFudWFsIHJlZ2lzdHJhdGlvbi5cbiAgICAgKiBUaGUgcXVldWUgaGFuZGxlciBtdXN0IGhhdmUgYG1hbnVhbFJlZ2lzdHJhdGlvbjogdHJ1ZWAgaW4gaXRzIEBRdWV1ZSBjb25maWcuXG4gICAgICovXG4gICAgcXVldWVIYW5kbGVyUGF0aD86IHN0cmluZztcblxuICAgIC8qKlxuICAgICAqIEF1ZGl0IHF1ZXVlIHByb3BlcnRpZXMgKG9ubHkgdXNlZCB3aGVuIGNyZWF0aW5nIGEgbmV3IHF1ZXVlKVxuICAgICAqL1xuICAgIHF1ZXVlUHJvcHM/OiBRdWV1ZVByb3BzO1xuXG4gICAgLyoqXG4gICAgICogU1FTIGV2ZW50IHNvdXJjZSBwcm9wZXJ0aWVzXG4gICAgICovXG4gICAgc3FzRXZlbnRTb3VyY2VQcm9wcz86IFNxc0V2ZW50U291cmNlUHJvcHM7XG59XG5cbmV4cG9ydCBjbGFzcyBEeW5hbW9EQkNvbnN0cnVjdCBpbXBsZW1lbnRzIEZXMjRDb25zdHJ1Y3Qge1xuICAgIHJlYWRvbmx5IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihEeW5hbW9EQkNvbnN0cnVjdC5uYW1lKTtcbiAgICByZWFkb25seSBmdzI0OiBGdzI0ID0gRncyNC5nZXRJbnN0YW5jZSgpO1xuXG4gICAgbmFtZTogc3RyaW5nID0gRHluYW1vREJDb25zdHJ1Y3QubmFtZTtcbiAgICBkZXBlbmRlbmNpZXM6IHN0cmluZ1tdID0gW107XG4gICAgb3V0cHV0ITogRlcyNENvbnN0cnVjdE91dHB1dDtcblxuICAgIG1haW5TdGFjayE6IFN0YWNrO1xuXG4gICAgLyoqXG4gICAgICogQ29uc3RydWN0cyBhIG5ldyBpbnN0YW5jZSBvZiB0aGUgRHluYW1vREIgY2xhc3MuXG4gICAgICogQHBhcmFtIGR5bmFtb0RCQ29uZmlnIFRoZSBjb25maWd1cmF0aW9uIG9iamVjdCBmb3IgRHluYW1vREIuXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBjb25zdCBkeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgKiAgIHJlZ2lvbjogJ3VzLXdlc3QtMicsXG4gICAgICogICB0YWJsZU5hbWU6ICdteVRhYmxlJ1xuICAgICAqIH07XG4gICAgICogY29uc3QgZHluYW1vREIgPSBuZXcgRHluYW1vREIoZHluYW1vREJDb25maWcpO1xuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgZHluYW1vREJDb25maWc6IElEeW5hbW9EQkNvbmZpZykgeyB9XG5cbiAgICAvLyBjb25zdHJ1Y3QgbWV0aG9kIHRvIGNyZWF0ZSB0aGUgc3RhY2tcbiAgICBATG9nRHVyYXRpb24oKVxuICAgIHB1YmxpYyBhc3luYyBjb25zdHJ1Y3QoKSB7XG4gICAgICAgIGNvbnN0IGZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG4gICAgICAgIHRoaXMubWFpblN0YWNrID0gZncyNC5nZXRTdGFjayh0aGlzLmR5bmFtb0RCQ29uZmlnLnN0YWNrTmFtZSwgdGhpcy5keW5hbW9EQkNvbmZpZy5wYXJlbnRTdGFja05hbWUpO1xuICAgICAgICBjb25zdCBhcHBRdWFsaWZpZWRUYWJsZU5hbWUgPSBlbnN1cmVOb1NwZWNpYWxDaGFycyhlbnN1cmVTdWZmaXgodGhpcy5keW5hbW9EQkNvbmZpZy50YWJsZS5uYW1lLCBgdGFibGVgKSk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJhcHBRdWFsaWZpZWRUYWJsZU5hbWU6XCIsIGFwcFF1YWxpZmllZFRhYmxlTmFtZSk7XG5cbiAgICAgICAgLy8gU2VlIGh0dHBzOi8vZG9jcy5hd3MuYW1hem9uLmNvbS9jZGsvYXBpL3YyL2RvY3MvYXdzLWNkay1saWIuYXdzX2R5bmFtb2RiLXJlYWRtZS5odG1sXG4gICAgICAgIGNvbnN0IHRhYmxlSW5zdGFuY2UgPSBuZXcgVGFibGVWMih0aGlzLm1haW5TdGFjaywgYXBwUXVhbGlmaWVkVGFibGVOYW1lLCB0aGlzLmR5bmFtb0RCQ29uZmlnLnRhYmxlLnByb3BzKTtcblxuICAgICAgICAvLyBPdXRwdXQgdGhlIHRhYmxlIGluc3RhbmNlXG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgYXBwUXVhbGlmaWVkVGFibGVOYW1lLCB0YWJsZUluc3RhbmNlLCBPdXRwdXRUeXBlLlRBQkxFLCAndGFibGVOYW1lJyk7XG4gICAgICAgIHRoaXMuZncyNC5zZXRFbnZpcm9ubWVudFZhcmlhYmxlKGFwcFF1YWxpZmllZFRhYmxlTmFtZSwgdGFibGVJbnN0YW5jZS50YWJsZU5hbWUsICd0YWJsZScpO1xuXG4gICAgICAgIC8vIFJlZ2lzdGVyIHRoZSB0YWJsZSBpbnN0YW5jZSBhcyBhIGdsb2JhbCBjb250YWluZXJcbiAgICAgICAgZncyNC5hZGREeW5hbW9UYWJsZShhcHBRdWFsaWZpZWRUYWJsZU5hbWUsIHRhYmxlSW5zdGFuY2UpO1xuXG4gICAgICAgIGNvbnN0IGhhc0F1ZGl0RW5hYmxlZCA9IHRoaXMuZHluYW1vREJDb25maWcudGFibGUuYXVkaXQ/LmVuYWJsZWQ7XG4gICAgICAgIGNvbnN0IGhhc1NlYXJjaEluZGV4aW5nRW5hYmxlZCA9IHRoaXMuZHluYW1vREJDb25maWcudGFibGUuc2VhcmNoSW5kZXhpbmc/LnNvbWUoY29uZmlnID0+IGNvbmZpZy5lbmFibGVkKTtcbiAgICAgICAgY29uc3QgaGFzU3RyZWFtRW5hYmxlZCA9IHRoaXMuZHluYW1vREJDb25maWcudGFibGUuc3RyZWFtPy5lbmFibGVkO1xuXG4gICAgICAgIC8vIFRyYWNrIGNvbmZpZ3VyZWQgZmVhdHVyZXMgZm9yIHN1bW1hcnlcbiAgICAgICAgY29uc3QgZmVhdHVyZXM6IHN0cmluZ1tdID0gW107XG5cbiAgICAgICAgLy8gU2V0dXAgc3RyZWFtIHByb2Nlc3NpbmcgaWYgZW5hYmxlZCBvciBhdWRpdCBpcyBlbmFibGVkIG9yIHNlYXJjaCBpbmRleGluZyBpcyBlbmFibGVkIGFuZCBzdHJlYW0gQVJOIGV4aXN0c1xuICAgICAgICBpZiAoaGFzU3RyZWFtRW5hYmxlZCB8fCBoYXNBdWRpdEVuYWJsZWQgfHwgaGFzU2VhcmNoSW5kZXhpbmdFbmFibGVkKSB7XG4gICAgICAgICAgICBpZiAodGFibGVJbnN0YW5jZS50YWJsZVN0cmVhbUFybikge1xuICAgICAgICAgICAgICAgIHRoaXMuc2V0dXBTdHJlYW1Qcm9jZXNzaW5nKHRhYmxlSW5zdGFuY2UpO1xuICAgICAgICAgICAgICAgIGlmIChoYXNTdHJlYW1FbmFibGVkKSBmZWF0dXJlcy5wdXNoKCdzdHJlYW0nKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgU3RyZWFtIEFSTiBub3QgZm91bmQgZm9yIHRhYmxlICR7dGhpcy5keW5hbW9EQkNvbmZpZy50YWJsZS5uYW1lfSwgY2Fubm90IHNldCB1cCBzdHJlYW0gcHJvY2Vzc2luZ2ApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRoaXMuZHluYW1vREJDb25maWcudGFibGUuYXVkaXQ/LmVuYWJsZWQpIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuc2V0dXBBdWRpdFByb2Nlc3NpbmcodGhpcy5keW5hbW9EQkNvbmZpZy50YWJsZS5hdWRpdCwgdGFibGVJbnN0YW5jZSk7XG4gICAgICAgICAgICBmZWF0dXJlcy5wdXNoKCdhdWRpdCcpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGhhc1NlYXJjaEluZGV4aW5nRW5hYmxlZCkge1xuICAgICAgICAgICAgZm9yIChjb25zdCBjb25maWcgb2YgdGhpcy5keW5hbW9EQkNvbmZpZy50YWJsZS5zZWFyY2hJbmRleGluZyB8fCBbXSkge1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuc2V0dXBTZWFyY2hJbmRleGluZ1Byb2Nlc3NpbmcoY29uZmlnLCB0YWJsZUluc3RhbmNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGZlYXR1cmVzLnB1c2goJ3NlYXJjaC1pbmRleGluZycpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gU3VtbWFyeVxuICAgICAgICBpZiAoZmVhdHVyZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhg4pyFIFRhYmxlIFwiJHt0aGlzLmR5bmFtb0RCQ29uZmlnLnRhYmxlLm5hbWV9XCIgY29uZmlndXJlZCB3aXRoICR7ZmVhdHVyZXMubGVuZ3RofSBmZWF0dXJlKHMpOiAke2ZlYXR1cmVzLmpvaW4oJywgJyl9YCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGDinIUgVGFibGUgXCIke3RoaXMuZHluYW1vREJDb25maWcudGFibGUubmFtZX1cIiBjb25maWd1cmVkIChiYXNpYyBzZXR1cClgKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgZ2V0U3RyZWFtVG9waWNOYW1lKCk6IHN0cmluZyB7XG4gICAgICAgIHJldHVybiBgJHt0aGlzLmR5bmFtb0RCQ29uZmlnLnRhYmxlLm5hbWV9LXN0cmVhbWA7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBzZXR1cFN0cmVhbVByb2Nlc3NpbmcodGFibGVJbnN0YW5jZTogVGFibGVWMik6IHZvaWQge1xuICAgICAgICBjb25zdCBzdHJlYW1Db25maWcgPSB0aGlzLmR5bmFtb0RCQ29uZmlnLnRhYmxlLnN0cmVhbSB8fCB7fTtcblxuICAgICAgICAvLyBDcmVhdGUgU05TIHRvcGljIGZvciBzdHJlYW0gZXZlbnRzXG4gICAgICAgIGNvbnN0IHRvcGljTmFtZSA9IHN0cmVhbUNvbmZpZy50b3BpYz8ubmFtZSB8fCB0aGlzLmdldFN0cmVhbVRvcGljTmFtZSgpO1xuXG4gICAgICAgIGNvbnN0IGlzRmlmbyA9IHN0cmVhbUNvbmZpZy50b3BpYz8ucHJvcHM/LmZpZm8gPz8gZmFsc2U7XG4gICAgICAgIGNvbnN0IHN0cmVhbVRvcGljQ29uZmlnOiBJVG9waWNDb25zdHJ1Y3RDb25maWdbXSA9IFsge1xuICAgICAgICAgICAgdG9waWNOYW1lLFxuICAgICAgICAgICAgdG9waWNQcm9wczoge1xuICAgICAgICAgICAgICAgIGRpc3BsYXlOYW1lOiBgU3RyZWFtIGV2ZW50cyBmb3IgJHt0aGlzLmR5bmFtb0RCQ29uZmlnLnRhYmxlLm5hbWV9YCxcbiAgICAgICAgICAgICAgICBmaWZvOiBpc0ZpZm8sXG4gICAgICAgICAgICAgICAgLi4uc3RyZWFtQ29uZmlnLnRvcGljPy5wcm9wc1xuICAgICAgICAgICAgfVxuICAgICAgICB9IF07XG5cbiAgICAgICAgbmV3IFRvcGljQ29uc3RydWN0KHN0cmVhbVRvcGljQ29uZmlnKS5jb25zdHJ1Y3QoKTtcblxuICAgICAgICAvLyBDcmVhdGUgTGFtYmRhIHRvIHByb2Nlc3Mgc3RyZWFtIGFuZCBwdWJsaXNoIHRvIFNOU1xuICAgICAgICBjb25zdCBzdHJlYW1Qcm9jZXNzb3IgPSBuZXcgTGFtYmRhRnVuY3Rpb24odGhpcy5tYWluU3RhY2ssIGAke3RoaXMuZncyNC5hcHBOYW1lfS1zdHJlYW0tcHJvY2Vzc29yYCwge1xuICAgICAgICAgICAgZW50cnk6IGpvaW4oX19kaXJuYW1lLCAnLi4vY29yZS9ydW50aW1lL2R5bmFtb2RiLXN0cmVhbS1wcm9jZXNzb3IuanMnKSxcbiAgICAgICAgICAgIGVudmlyb25tZW50VmFyaWFibGVzOiB7XG4gICAgICAgICAgICAgICAgVE9QSUNfTkFNRTogdG9waWNOYW1lLFxuICAgICAgICAgICAgICAgIFRPUElDX1RZUEU6IGlzRmlmbyA/ICdmaWZvJyA6ICdzdGFuZGFyZCdcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICByZXNvdXJjZUFjY2Vzczoge1xuICAgICAgICAgICAgICAgIHRvcGljczogWyB7XG4gICAgICAgICAgICAgICAgICAgIG5hbWU6IHRvcGljTmFtZSxcbiAgICAgICAgICAgICAgICAgICAgYWNjZXNzOiBbICdwdWJsaXNoJyBdXG4gICAgICAgICAgICAgICAgfSBdXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pIGFzIE5vZGVqc0Z1bmN0aW9uO1xuXG4gICAgICAgIC8vIEdyYW50IHBlcm1pc3Npb25zIGFuZCBhZGQgZXZlbnQgc291cmNlXG4gICAgICAgIHRhYmxlSW5zdGFuY2UuZ3JhbnRTdHJlYW1SZWFkKHN0cmVhbVByb2Nlc3Nvcik7XG4gICAgICAgIHN0cmVhbVByb2Nlc3Nvci5hZGRFdmVudFNvdXJjZShuZXcgRHluYW1vRXZlbnRTb3VyY2UodGFibGVJbnN0YW5jZSwge1xuICAgICAgICAgICAgLi4uc3RyZWFtQ29uZmlnLnByb2Nlc3NvcixcbiAgICAgICAgICAgIHN0YXJ0aW5nUG9zaXRpb246IHN0cmVhbUNvbmZpZy5wcm9jZXNzb3I/LnN0YXJ0aW5nUG9zaXRpb24gPz8gU3RhcnRpbmdQb3NpdGlvbi5MQVRFU1QsXG4gICAgICAgICAgICBiYXRjaFNpemU6IHN0cmVhbUNvbmZpZy5wcm9jZXNzb3I/LmJhdGNoU2l6ZSA/PyA1LFxuICAgICAgICAgICAgYmlzZWN0QmF0Y2hPbkVycm9yOiBzdHJlYW1Db25maWcucHJvY2Vzc29yPy5iaXNlY3RCYXRjaE9uRXJyb3IgPz8gdHJ1ZSxcbiAgICAgICAgICAgIHJldHJ5QXR0ZW1wdHM6IHN0cmVhbUNvbmZpZy5wcm9jZXNzb3I/LnJldHJ5QXR0ZW1wdHMgPz8gM1xuICAgICAgICB9KSk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ1N0cmVhbSBwcm9jZXNzaW5nIHNldHVwIGNvbXBsZXRlZCBmb3IgdGFibGU6JywgdGhpcy5keW5hbW9EQkNvbmZpZy50YWJsZS5uYW1lKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIHNldHVwU3RyZWFtRXZlbnRDb25zdW1lcnMoXG4gICAgICAgIHRhYmxlSW5zdGFuY2U6IFRhYmxlVjIsXG4gICAgICAgIGNvbnN1bWVyTmFtZTogc3RyaW5nLFxuICAgICAgICBjb25maWc6IEF1ZGl0Q29uZmlnIHwgU2VhcmNoSW5kZXhpbmdDb25maWcsXG4gICAgICAgIGRlZmF1bHRIYW5kbGVyRW50cnk6IHN0cmluZyxcbiAgICAgICAgZW52aXJvbm1lbnRWYXJpYWJsZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sXG4gICAgICAgIHJlc291cmNlQWNjZXNzPzogYW55LFxuICAgICk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBpZiAoIXRhYmxlSW5zdGFuY2UudGFibGVTdHJlYW1Bcm4pIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYFN0cmVhbSBBUk4gbm90IGZvdW5kIGZvciB0YWJsZSAke3RoaXMuZHluYW1vREJDb25maWcudGFibGUubmFtZX0sIGNhbm5vdCBzZXQgdXAgJHtjb25zdW1lck5hbWV9YCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBxdWV1ZUNvbmZpZyA9IHRoaXMuZXh0cmFjdFF1ZXVlQ29uZmlnKGNvbmZpZyk7XG5cbiAgICAgICAgLy8gVmFsaWRhdGUgY29uZmlndXJhdGlvblxuICAgICAgICB0aGlzLnZhbGlkYXRlUXVldWVDb25maWcoY29uZmlnLCBjb25zdW1lck5hbWUpO1xuXG4gICAgICAgIGlmIChxdWV1ZUNvbmZpZy50eXBlID09PSAnaGFuZGxlcicpIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuc2V0dXBXaXRoUXVldWVIYW5kbGVyKHF1ZXVlQ29uZmlnLnF1ZXVlSGFuZGxlclBhdGgsIGNvbnN1bWVyTmFtZSwgZW52aXJvbm1lbnRWYXJpYWJsZXMsIHF1ZXVlQ29uZmlnLmZ1bmN0aW9uUHJvcHMpO1xuICAgICAgICB9IGVsc2UgaWYgKHF1ZXVlQ29uZmlnLnR5cGUgPT09ICdleGlzdGluZycpIHtcbiAgICAgICAgICAgIHRoaXMuc2V0dXBXaXRoRXhpc3RpbmdRdWV1ZShxdWV1ZUNvbmZpZy5leGlzdGluZ1F1ZXVlTmFtZSwgY29uc3VtZXJOYW1lKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnN0IGNvbW1vbkNvbmZpZyA9IHRoaXMuYnVpbGRDb21tb25MYW1iZGFDb25maWcoZGVmYXVsdEhhbmRsZXJFbnRyeSwgZW52aXJvbm1lbnRWYXJpYWJsZXMsIHJlc291cmNlQWNjZXNzLCBxdWV1ZUNvbmZpZy5mdW5jdGlvblByb3BzKTtcbiAgICAgICAgICAgIHRoaXMuc2V0dXBXaXRoTmV3UXVldWUocXVldWVDb25maWcsIGNvbnN1bWVyTmFtZSwgY29tbW9uQ29uZmlnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGAke2NvbnN1bWVyTmFtZX0gc2V0dXAgY29tcGxldGVkIGZvciB0YWJsZTpgLCB0aGlzLmR5bmFtb0RCQ29uZmlnLnRhYmxlLm5hbWUpO1xuICAgIH1cblxuICAgIHByaXZhdGUgdmFsaWRhdGVRdWV1ZUNvbmZpZyhjb25maWc6IEF1ZGl0Q29uZmlnIHwgU2VhcmNoSW5kZXhpbmdDb25maWcsIGNvbnN1bWVyTmFtZTogc3RyaW5nKTogdm9pZCB7XG4gICAgICAgIGNvbnN0IGlzU2VhcmNoQ29uZmlnID0gJ2VuZ2luZUNvbmZpZycgaW4gY29uZmlnO1xuXG4gICAgICAgIGlmIChpc1NlYXJjaENvbmZpZykge1xuICAgICAgICAgICAgY29uc3Qgc2VhcmNoQ29uZmlnID0gY29uZmlnO1xuICAgICAgICAgICAgaWYgKHNlYXJjaENvbmZpZy5leGlzdGluZ1F1ZXVlTmFtZSkge1xuICAgICAgICAgICAgICAgIGlmIChzZWFyY2hDb25maWcucXVldWVOYW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYCR7Y29uc3VtZXJOYW1lfTogQm90aCAnZXhpc3RpbmdRdWV1ZU5hbWUnIGFuZCAncXVldWVOYW1lJyBwcm92aWRlZC4gVXNpbmcgZXhpc3RpbmcgcXVldWUgJyR7c2VhcmNoQ29uZmlnLmV4aXN0aW5nUXVldWVOYW1lfScsIGlnbm9yaW5nIHF1ZXVlTmFtZS5gKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKHNlYXJjaENvbmZpZy5xdWV1ZVByb3BzKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYCR7Y29uc3VtZXJOYW1lfTogJ3F1ZXVlUHJvcHMnIHByb3ZpZGVkIHdpdGggJ2V4aXN0aW5nUXVldWVOYW1lJy4gUXVldWUgcHJvcGVydGllcyBhcmUgaWdub3JlZCB3aGVuIHVzaW5nIGV4aXN0aW5nIHF1ZXVlcy5gKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKHNlYXJjaENvbmZpZy5mdW5jdGlvblByb3BzKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYCR7Y29uc3VtZXJOYW1lfTogJ2Z1bmN0aW9uUHJvcHMnIHByb3ZpZGVkIHdpdGggJ2V4aXN0aW5nUXVldWVOYW1lJy4gRnVuY3Rpb24gcHJvcGVydGllcyBhcmUgaWdub3JlZCB3aGVuIHVzaW5nIGV4aXN0aW5nIHF1ZXVlcyAodGhleSBoYXZlIHRoZWlyIG93biBoYW5kbGVycykuYCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc3QgYXVkaXRDb25maWcgPSBjb25maWc7XG4gICAgICAgICAgICBpZiAoYXVkaXRDb25maWcuZXhpc3RpbmdRdWV1ZU5hbWUpIHtcbiAgICAgICAgICAgICAgICBpZiAoYXVkaXRDb25maWcucXVldWVOYW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYCR7Y29uc3VtZXJOYW1lfTogQm90aCAnZXhpc3RpbmdRdWV1ZU5hbWUnIGFuZCAncXVldWVOYW1lJyBwcm92aWRlZC4gVXNpbmcgZXhpc3RpbmcgcXVldWUgJyR7YXVkaXRDb25maWcuZXhpc3RpbmdRdWV1ZU5hbWV9JywgaWdub3JpbmcgcXVldWVOYW1lLmApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoYXVkaXRDb25maWcucXVldWVQcm9wcykge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGAke2NvbnN1bWVyTmFtZX06ICdxdWV1ZVByb3BzJyBwcm92aWRlZCB3aXRoICdleGlzdGluZ1F1ZXVlTmFtZScuIFF1ZXVlIHByb3BlcnRpZXMgYXJlIGlnbm9yZWQgd2hlbiB1c2luZyBleGlzdGluZyBxdWV1ZXMuYCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChhdWRpdENvbmZpZy5mdW5jdGlvblByb3BzKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYCR7Y29uc3VtZXJOYW1lfTogJ2Z1bmN0aW9uUHJvcHMnIHByb3ZpZGVkIHdpdGggJ2V4aXN0aW5nUXVldWVOYW1lJy4gRnVuY3Rpb24gcHJvcGVydGllcyBhcmUgaWdub3JlZCB3aGVuIHVzaW5nIGV4aXN0aW5nIHF1ZXVlcyAodGhleSBoYXZlIHRoZWlyIG93biBoYW5kbGVycykuYCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBleHRyYWN0UXVldWVDb25maWcoY29uZmlnOiBBdWRpdENvbmZpZyB8IFNlYXJjaEluZGV4aW5nQ29uZmlnKTogUXVldWVDb25maWcge1xuICAgICAgICAvLyBTZWFyY2hJbmRleGluZ0NvbmZpZyBpcyBkaXN0aW5ndWlzaGVkIGJ5IGhhdmluZyBlbmdpbmVDb25maWcgKHJlcXVpcmVkIGZpZWxkKVxuICAgICAgICBjb25zdCBpc1NlYXJjaENvbmZpZyA9ICdlbmdpbmVDb25maWcnIGluIGNvbmZpZztcblxuICAgICAgICBpZiAoaXNTZWFyY2hDb25maWcpIHtcbiAgICAgICAgICAgIGNvbnN0IHNlYXJjaENvbmZpZyA9IGNvbmZpZztcblxuICAgICAgICAgICAgaWYgKCdxdWV1ZUhhbmRsZXJQYXRoJyBpbiBzZWFyY2hDb25maWcgJiYgc2VhcmNoQ29uZmlnLnF1ZXVlSGFuZGxlclBhdGgpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnaGFuZGxlcicsXG4gICAgICAgICAgICAgICAgICAgIHF1ZXVlSGFuZGxlclBhdGg6IHNlYXJjaENvbmZpZy5xdWV1ZUhhbmRsZXJQYXRoLFxuICAgICAgICAgICAgICAgICAgICBmdW5jdGlvblByb3BzOiBzZWFyY2hDb25maWcuZnVuY3Rpb25Qcm9wcyxcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfSBlbHNlIGlmICgnZXhpc3RpbmdRdWV1ZU5hbWUnIGluIHNlYXJjaENvbmZpZyAmJiBzZWFyY2hDb25maWcuZXhpc3RpbmdRdWV1ZU5hbWUpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnZXhpc3RpbmcnLFxuICAgICAgICAgICAgICAgICAgICBleGlzdGluZ1F1ZXVlTmFtZTogc2VhcmNoQ29uZmlnLmV4aXN0aW5nUXVldWVOYW1lLFxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIHR5cGU6ICduZXcnLFxuICAgICAgICAgICAgICAgICAgICBmdW5jdGlvblByb3BzOiBzZWFyY2hDb25maWcuZnVuY3Rpb25Qcm9wcyxcbiAgICAgICAgICAgICAgICAgICAgcXVldWVQcm9wczogc2VhcmNoQ29uZmlnLnF1ZXVlUHJvcHMsXG4gICAgICAgICAgICAgICAgICAgIHNxc0V2ZW50U291cmNlUHJvcHM6IHNlYXJjaENvbmZpZy5zcXNFdmVudFNvdXJjZVByb3BzLFxuICAgICAgICAgICAgICAgICAgICBjdXN0b21RdWV1ZU5hbWU6IHNlYXJjaENvbmZpZy5xdWV1ZU5hbWUsXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIEF1ZGl0Q29uZmlnXG4gICAgICAgICAgICBjb25zdCBhdWRpdENvbmZpZyA9IGNvbmZpZztcblxuICAgICAgICAgICAgaWYgKGF1ZGl0Q29uZmlnLnF1ZXVlSGFuZGxlclBhdGgpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnaGFuZGxlcicsXG4gICAgICAgICAgICAgICAgICAgIHF1ZXVlSGFuZGxlclBhdGg6IGF1ZGl0Q29uZmlnLnF1ZXVlSGFuZGxlclBhdGgsXG4gICAgICAgICAgICAgICAgICAgIGZ1bmN0aW9uUHJvcHM6IGF1ZGl0Q29uZmlnLmZ1bmN0aW9uUHJvcHMsXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoYXVkaXRDb25maWcuZXhpc3RpbmdRdWV1ZU5hbWUpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnZXhpc3RpbmcnLFxuICAgICAgICAgICAgICAgICAgICBleGlzdGluZ1F1ZXVlTmFtZTogYXVkaXRDb25maWcuZXhpc3RpbmdRdWV1ZU5hbWUsXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ25ldycsXG4gICAgICAgICAgICAgICAgICAgIGZ1bmN0aW9uUHJvcHM6IGF1ZGl0Q29uZmlnLmZ1bmN0aW9uUHJvcHMsXG4gICAgICAgICAgICAgICAgICAgIHF1ZXVlUHJvcHM6IGF1ZGl0Q29uZmlnLnF1ZXVlUHJvcHMsXG4gICAgICAgICAgICAgICAgICAgIHNxc0V2ZW50U291cmNlUHJvcHM6IGF1ZGl0Q29uZmlnLnNxc0V2ZW50U291cmNlUHJvcHMsXG4gICAgICAgICAgICAgICAgICAgIGN1c3RvbVF1ZXVlTmFtZTogYXVkaXRDb25maWcucXVldWVOYW1lLFxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGJ1aWxkQ29tbW9uTGFtYmRhQ29uZmlnKFxuICAgICAgICBkZWZhdWx0SGFuZGxlckVudHJ5OiBzdHJpbmcsXG4gICAgICAgIGVudmlyb25tZW50VmFyaWFibGVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+LFxuICAgICAgICByZXNvdXJjZUFjY2VzczogYW55LFxuICAgICAgICBmdW5jdGlvblByb3BzPzogTm9kZWpzRnVuY3Rpb25Qcm9wc1xuICAgICk6IExhbWJkYUZ1bmN0aW9uUHJvcHMge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgZW50cnk6IGRlZmF1bHRIYW5kbGVyRW50cnksXG4gICAgICAgICAgICBlbnZpcm9ubWVudFZhcmlhYmxlcyxcbiAgICAgICAgICAgIHJlc291cmNlQWNjZXNzLFxuICAgICAgICAgICAgZnVuY3Rpb25Qcm9wcyxcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHNldHVwV2l0aEV4aXN0aW5nUXVldWUoXG4gICAgICAgIGV4aXN0aW5nUXVldWVOYW1lOiBzdHJpbmcsXG4gICAgICAgIGNvbnN1bWVyTmFtZTogc3RyaW5nXG4gICAgKTogdm9pZCB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFVzaW5nIGV4aXN0aW5nIGZyYW1ld29yayBxdWV1ZSAnJHtleGlzdGluZ1F1ZXVlTmFtZX0nIGZvciAke2NvbnN1bWVyTmFtZX0uIFRoZSBxdWV1ZSBtdXN0IGJlIGNvbmZpZ3VyZWQgdG8gc3Vic2NyaWJlIHRvIHRvcGljICcke3RoaXMuZ2V0U3RyZWFtVG9waWNOYW1lKCl9JyBpbiBpdHMgQFF1ZXVlIHNldHVwLmApO1xuXG4gICAgICAgIC8vIEp1c3QgdmFsaWRhdGUgdGhlIHF1ZXVlIGV4aXN0cyAtIERPTidUIG1vZGlmeSBpdCBvciBzdWJzY3JpYmUgaXQgdG8gYW55dGhpbmdcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHRoaXMuZncyNC5nZXRRdWV1ZUJ5TmFtZShcbiAgICAgICAgICAgICAgICBleGlzdGluZ1F1ZXVlTmFtZSxcbiAgICAgICAgICAgICAgICB0aGlzLm1haW5TdGFjayxcbiAgICAgICAgICAgICAgICBgJHt0aGlzLmZ3MjQuYXBwTmFtZX0tJHtjb25zdW1lck5hbWV9LWV4aXN0aW5nYFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYCR7Y29uc3VtZXJOYW1lfSB2YWxpZGF0aW9uIGNvbXBsZXRlZCAtIGV4aXN0aW5nIHF1ZXVlICR7ZXhpc3RpbmdRdWV1ZU5hbWV9IGZvdW5kIGZvciB0YWJsZTpgLCB0aGlzLmR5bmFtb0RCQ29uZmlnLnRhYmxlLm5hbWUpO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYFF1ZXVlICcke2V4aXN0aW5nUXVldWVOYW1lfScgbm90IGZvdW5kIGZvciAke2NvbnN1bWVyTmFtZX0uIEVuc3VyZSBpdCdzIGRlZmluZWQgd2l0aCBAUXVldWUoJyR7ZXhpc3RpbmdRdWV1ZU5hbWV9JykgZGVjb3JhdG9yLmApO1xuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIHNldHVwV2l0aFF1ZXVlSGFuZGxlcihcbiAgICAgICAgcXVldWVIYW5kbGVyUGF0aDogc3RyaW5nLFxuICAgICAgICBjb25zdW1lck5hbWU6IHN0cmluZyxcbiAgICAgICAgZW52aXJvbm1lbnRWYXJpYWJsZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sXG4gICAgICAgIGZ1bmN0aW9uUHJvcHM/OiBOb2RlanNGdW5jdGlvblByb3BzXG4gICAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYExvYWRpbmcgcXVldWUgaGFuZGxlciBmcm9tOiAke3F1ZXVlSGFuZGxlclBhdGh9YCk7XG5cbiAgICAgICAgLy8gRHluYW1pYyBpbXBvcnQgKHNhbWUgcGF0dGVybiBhcyBRdWV1ZUNvbnN0cnVjdCB1c2VzIHZpYSBIZWxwZXIucmVnaXN0ZXJIYW5kbGVycylcbiAgICAgICAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZShxdWV1ZUhhbmRsZXJQYXRoKTtcbiAgICAgICAgY29uc3QgcXVldWVNb2R1bGUgPSBhd2FpdCBpbXBvcnQoYWJzb2x1dGVQYXRoKTtcblxuICAgICAgICAvLyBGaW5kIHF1ZXVlIGNsYXNzIChzYW1lIGxvZ2ljIGFzIEhlbHBlci5yZWdpc3RlckhhbmRsZXJzKVxuICAgICAgICBsZXQgUXVldWVDbGFzczogKG5ldyAoLi4uYXJnczogYW55W10pID0+IGFueSkgfCB1bmRlZmluZWQ7XG4gICAgICAgIGZvciAoY29uc3QgZXhwb3J0ZWRJdGVtIG9mIE9iamVjdC52YWx1ZXMocXVldWVNb2R1bGUpKSB7XG4gICAgICAgICAgICBpZiAodHlwZW9mIGV4cG9ydGVkSXRlbSA9PT0gXCJmdW5jdGlvblwiICYmIGV4cG9ydGVkSXRlbS5uYW1lICE9PSBcImhhbmRsZXJcIikge1xuICAgICAgICAgICAgICAgIFF1ZXVlQ2xhc3MgPSBleHBvcnRlZEl0ZW0gYXMgbmV3ICguLi5hcmdzOiBhbnlbXSkgPT4gYW55O1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFRdWV1ZUNsYXNzKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHF1ZXVlIGNsYXNzIGZvdW5kIGluICR7cXVldWVIYW5kbGVyUGF0aH1gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEluc3RhbnRpYXRlIHRvIGdldCBjb25maWcgKHNhbWUgYXMgUXVldWVDb25zdHJ1Y3QgZG9lcylcbiAgICAgICAgY29uc3QgaGFuZGxlckluc3RhbmNlID0gbmV3IFF1ZXVlQ2xhc3MoKTtcbiAgICAgICAgY29uc3QgcXVldWVOYW1lID0gaGFuZGxlckluc3RhbmNlLnF1ZXVlTmFtZTtcbiAgICAgICAgY29uc3QgcXVldWVDb25maWcgPSBoYW5kbGVySW5zdGFuY2UucXVldWVDb25maWcgfHwge307XG5cbiAgICAgICAgLy8gVmFsaWRhdGUgbWFudWFsIHJlZ2lzdHJhdGlvbiBmbGFnXG4gICAgICAgIGlmICghcXVldWVDb25maWcubWFudWFsUmVnaXN0cmF0aW9uKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgICAgICAgYFF1ZXVlICcke3F1ZXVlTmFtZX0nIG11c3QgaGF2ZSBtYW51YWxSZWdpc3RyYXRpb246IHRydWUgaW4gaXRzIEBRdWV1ZSBjb25maWcgdG8gdXNlIHF1ZXVlSGFuZGxlclBhdGhgXG4gICAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgQ3JlYXRpbmcgcXVldWUgJHtxdWV1ZU5hbWV9IGZvciAke2NvbnN1bWVyTmFtZX1gKTtcblxuICAgICAgICAvLyBNZXJnZSBlbnZpcm9ubWVudCB2YXJpYWJsZXNcbiAgICAgICAgY29uc3QgbWVyZ2VkRW52VmFycyA9IHtcbiAgICAgICAgICAgIC4uLmVudmlyb25tZW50VmFyaWFibGVzLFxuICAgICAgICAgICAgLi4udGhpcy5mdzI0LnJlc29sdmVFbnZWYXJpYWJsZXMocXVldWVDb25maWcuZW52KVxuICAgICAgICB9O1xuXG4gICAgICAgIC8vIE1lcmdlIGZ1bmN0aW9uIHByb3BzIChzYW1lIHBhdHRlcm4gYXMgUXVldWVDb25zdHJ1Y3QpXG4gICAgICAgIC8vIGZ1bmN0aW9uUHJvcHMgZnJvbSBzZWFyY2hJbmRleGluZy9hdWRpdCBjb25maWcgdGFrZSBwcmVjZWRlbmNlXG4gICAgICAgIGNvbnN0IG1lcmdlZEZ1bmN0aW9uUHJvcHMgPSB7IC4uLnF1ZXVlQ29uZmlnLmZ1bmN0aW9uUHJvcHMsIC4uLmZ1bmN0aW9uUHJvcHMgfTtcblxuICAgICAgICAvLyBDcmVhdGUgcXVldWUgKyBsYW1iZGEgKHNhbWUgcGF0dGVybiBhcyBRdWV1ZUNvbnN0cnVjdCwgYnV0IHdpdGggc3Vic2NyaXB0aW9uIHRvIHN0cmVhbSB0b3BpYylcbiAgICAgICAgY29uc3QgcXVldWUgPSBuZXcgUXVldWVMYW1iZGEodGhpcy5tYWluU3RhY2ssIGAke3F1ZXVlTmFtZX0tcXVldWVgLCB7XG4gICAgICAgICAgICBxdWV1ZU5hbWU6IHF1ZXVlTmFtZSxcbiAgICAgICAgICAgIHF1ZXVlUHJvcHM6IHF1ZXVlQ29uZmlnLnF1ZXVlUHJvcHMsXG4gICAgICAgICAgICB2aXNpYmlsaXR5VGltZW91dFNlY29uZHM6IHF1ZXVlQ29uZmlnLnZpc2liaWxpdHlUaW1lb3V0U2Vjb25kcyxcbiAgICAgICAgICAgIHJlY2VpdmVNZXNzYWdlV2FpdFRpbWVTZWNvbmRzOiBxdWV1ZUNvbmZpZy5yZWNlaXZlTWVzc2FnZVdhaXRUaW1lU2Vjb25kcyxcbiAgICAgICAgICAgIHJldGVudGlvblBlcmlvZERheXM6IHF1ZXVlQ29uZmlnLnJldGVudGlvblBlcmlvZERheXMsXG4gICAgICAgICAgICBtYXhSZWNlaXZlQ291bnQ6IHF1ZXVlQ29uZmlnLm1heFJlY2VpdmVDb3VudCxcbiAgICAgICAgICAgIHNxc0V2ZW50U291cmNlUHJvcHM6IHF1ZXVlQ29uZmlnLnNxc0V2ZW50U291cmNlUHJvcHMsXG4gICAgICAgICAgICBzdWJzY3JpcHRpb25zOiB7XG4gICAgICAgICAgICAgICAgdG9waWNzOiBbIHtcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogdGhpcy5nZXRTdHJlYW1Ub3BpY05hbWUoKSxcbiAgICAgICAgICAgICAgICAgICAgZmlsdGVyczogW10sXG4gICAgICAgICAgICAgICAgfSBdLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGxhbWJkYUZ1bmN0aW9uUHJvcHM6IHtcbiAgICAgICAgICAgICAgICBlbnRyeTogYWJzb2x1dGVQYXRoLFxuICAgICAgICAgICAgICAgIGVudmlyb25tZW50VmFyaWFibGVzOiBtZXJnZWRFbnZWYXJzLFxuICAgICAgICAgICAgICAgIHJlc291cmNlQWNjZXNzOiBxdWV1ZUNvbmZpZy5yZXNvdXJjZUFjY2VzcyxcbiAgICAgICAgICAgICAgICBmdW5jdGlvblByb3BzOiBtZXJnZWRGdW5jdGlvblByb3BzLFxuICAgICAgICAgICAgICAgIGZ1bmN0aW9uVGltZW91dDogcXVldWVDb25maWcuZnVuY3Rpb25UaW1lb3V0LFxuICAgICAgICAgICAgICAgIHBvbGljaWVzOiBxdWV1ZUNvbmZpZy5wb2xpY2llcyxcbiAgICAgICAgICAgICAgICBsb2dSZW1vdmFsUG9saWN5OiBxdWV1ZUNvbmZpZy5sb2dSZW1vdmFsUG9saWN5LFxuICAgICAgICAgICAgICAgIGxvZ1JldGVudGlvbkRheXM6IHF1ZXVlQ29uZmlnLmxvZ1JldGVudGlvbkRheXMsXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pIGFzIFF1ZXVlO1xuXG4gICAgICAgIC8vIFJlZ2lzdGVyIG91dHB1dCAoc2FtZSBhcyBRdWV1ZUNvbnN0cnVjdCBkb2VzKVxuICAgICAgICB0aGlzLmZ3MjQuc2V0Q29uc3RydWN0T3V0cHV0KHRoaXMsIHF1ZXVlTmFtZSwgcXVldWUsIE91dHB1dFR5cGUuUVVFVUUsICdxdWV1ZU5hbWUnKTtcblxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGAke2NvbnN1bWVyTmFtZX0gcXVldWUgY3JlYXRlZCBzdWNjZXNzZnVsbHk6ICR7cXVldWVOYW1lfWApO1xuICAgIH1cblxuICAgIHByaXZhdGUgc2V0dXBXaXRoTmV3UXVldWUoXG4gICAgICAgIHF1ZXVlQ29uZmlnOiBOZXdRdWV1ZUNvbmZpZyxcbiAgICAgICAgY29uc3VtZXJOYW1lOiBzdHJpbmcsXG4gICAgICAgIGxhbWJkYUNvbmZpZzogTGFtYmRhRnVuY3Rpb25Qcm9wc1xuICAgICk6IHZvaWQge1xuICAgICAgICBjb25zdCBxdWV1ZU5hbWUgPSBxdWV1ZUNvbmZpZy5jdXN0b21RdWV1ZU5hbWUgfHwgYCR7dGhpcy5keW5hbW9EQkNvbmZpZy50YWJsZS5uYW1lfS0ke2NvbnN1bWVyTmFtZX1gO1xuICAgICAgICBjb25zdCBldmVudFNvdXJjZVByb3BzID0gdGhpcy5idWlsZFNxc0V2ZW50U291cmNlUHJvcHMocXVldWVDb25maWcuc3FzRXZlbnRTb3VyY2VQcm9wcyk7XG5cbiAgICAgICAgbmV3IFF1ZXVlTGFtYmRhKHRoaXMubWFpblN0YWNrLCBgJHt0aGlzLmZ3MjQuYXBwTmFtZX0tJHtjb25zdW1lck5hbWV9LXF1ZXVlYCwge1xuICAgICAgICAgICAgcXVldWVOYW1lOiBxdWV1ZU5hbWUsXG4gICAgICAgICAgICBsYW1iZGFGdW5jdGlvblByb3BzOiBsYW1iZGFDb25maWcsXG4gICAgICAgICAgICBxdWV1ZVByb3BzOiBxdWV1ZUNvbmZpZy5xdWV1ZVByb3BzIHx8IHt9LFxuICAgICAgICAgICAgc3Vic2NyaXB0aW9uczoge1xuICAgICAgICAgICAgICAgIHRvcGljczogWyB7XG4gICAgICAgICAgICAgICAgICAgIG5hbWU6IHRoaXMuZ2V0U3RyZWFtVG9waWNOYW1lKCksXG4gICAgICAgICAgICAgICAgICAgIGZpbHRlcnM6IFtdLFxuICAgICAgICAgICAgICAgIH0gXSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBzcXNFdmVudFNvdXJjZVByb3BzOiBldmVudFNvdXJjZVByb3BzLFxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGJ1aWxkU3FzRXZlbnRTb3VyY2VQcm9wcyhjdXN0b21Qcm9wcz86IFNxc0V2ZW50U291cmNlUHJvcHMpOiBTcXNFdmVudFNvdXJjZVByb3BzIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGJhdGNoU2l6ZTogY3VzdG9tUHJvcHM/LmJhdGNoU2l6ZSB8fCA1LFxuICAgICAgICAgICAgbWF4QmF0Y2hpbmdXaW5kb3c6IGN1c3RvbVByb3BzPy5tYXhCYXRjaGluZ1dpbmRvdyB8fCBEdXJhdGlvbi5zZWNvbmRzKDUpLFxuICAgICAgICAgICAgcmVwb3J0QmF0Y2hJdGVtRmFpbHVyZXM6IGN1c3RvbVByb3BzPy5yZXBvcnRCYXRjaEl0ZW1GYWlsdXJlcyB8fCB0cnVlLFxuICAgICAgICAgICAgLi4uY3VzdG9tUHJvcHMsXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBzZXR1cEF1ZGl0UHJvY2Vzc2luZyhjb25maWc6IEF1ZGl0Q29uZmlnLCB0YWJsZUluc3RhbmNlOiBUYWJsZVYyKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIC8vIE9ubHkgZW50aXR5IGZpbHRlcmluZyBlbnYgdmFycyAtIG9ic2VydmFiaWxpdHkgaGFuZGxlcyBiYWNrZW5kIHJvdXRpbmdcbiAgICAgICAgY29uc3QgZW52VmFyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9O1xuXG4gICAgICAgIGlmIChjb25maWcuYWxsb3dlZEVudGl0eU5hbWVzICYmIGNvbmZpZy5hbGxvd2VkRW50aXR5TmFtZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgZW52VmFyc1sgQVVESVRfRU5WX0tFWVMuQUxMT1dFRF9FTlRJVFlfTkFNRVMgXSA9IGNvbmZpZy5hbGxvd2VkRW50aXR5TmFtZXMuam9pbignLCcpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGNvbmZpZy5leGNsdWRlZEVudGl0eU5hbWVzICYmIGNvbmZpZy5leGNsdWRlZEVudGl0eU5hbWVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIGVudlZhcnNbIEFVRElUX0VOVl9LRVlTLkVYQ0xVREVEX0VOVElUWV9OQU1FUyBdID0gY29uZmlnLmV4Y2x1ZGVkRW50aXR5TmFtZXMuam9pbignLCcpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gTm8gcmVzb3VyY2UgYWNjZXNzIG5lZWRlZCAtIG9ic2VydmFiaWxpdHkgc3lzdGVtIGhhbmRsZXMgaXRzIG93biB0YWJsZSBhY2Nlc3MgdmlhIGdsb2JhbCByZXNvdXJjZSBhY2Nlc3NcbiAgICAgICAgYXdhaXQgdGhpcy5zZXR1cFN0cmVhbUV2ZW50Q29uc3VtZXJzKFxuICAgICAgICAgICAgdGFibGVJbnN0YW5jZSxcbiAgICAgICAgICAgICdlbnRpdHktYXVkaXQnLFxuICAgICAgICAgICAgY29uZmlnLFxuICAgICAgICAgICAgam9pbihfX2Rpcm5hbWUsICcuLi9hdWRpdC9mdW5jdGlvbi9keW5hbW9kYi1zdHJlYW0taGFuZGxlci5qcycpLFxuICAgICAgICAgICAgZW52VmFycyxcbiAgICAgICAgICAgIHt9IC8vIE5vIGFkZGl0aW9uYWwgcmVzb3VyY2UgYWNjZXNzIC0gb2JzZXJ2YWJpbGl0eSBoYW5kbGVzIGl0XG4gICAgICAgICk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbygnQXVkaXQgcHJvY2Vzc2luZyBlbmFibGVkIChvYnNlcnZhYmlsaXR5LWJhY2tlZCknLCB7XG4gICAgICAgICAgICB0YWJsZTogdGhpcy5keW5hbW9EQkNvbmZpZy50YWJsZS5uYW1lLFxuICAgICAgICAgICAgYWxsb3dlZEVudGl0aWVzOiBjb25maWcuYWxsb3dlZEVudGl0eU5hbWVzLFxuICAgICAgICAgICAgZXhjbHVkZWRFbnRpdGllczogY29uZmlnLmV4Y2x1ZGVkRW50aXR5TmFtZXNcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBzZXR1cFNlYXJjaEluZGV4aW5nUHJvY2Vzc2luZyhjb25maWc6IFNlYXJjaEluZGV4aW5nQ29uZmlnLCB0YWJsZUluc3RhbmNlOiBUYWJsZVYyKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIC8vIFNldCBzZWFyY2ggaW5kZXhpbmcgY29uZmlndXJhdGlvbiBpbiBlbnZpcm9ubWVudCB2YXJpYWJsZXMgZm9yIGxhbWJkYSBmdW5jdGlvbnNcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ1NldHRpbmcgdXAgc2VhcmNoIGluZGV4aW5nIHByb2Nlc3NpbmcgZm9yIHRhYmxlOicsIHRoaXMuZHluYW1vREJDb25maWcudGFibGUubmFtZSk7XG5cbiAgICAgICAgY29uc3QgYXBwUXVhbGlmaWVkVGFibGVOYW1lID0gZW5zdXJlTm9TcGVjaWFsQ2hhcnMoZW5zdXJlU3VmZml4KHRoaXMuZHluYW1vREJDb25maWcudGFibGUubmFtZSwgYHRhYmxlYCkpO1xuXG4gICAgICAgIGNvbnN0IHsgZW5hYmxlZCwgZW5naW5lQ29uZmlnOiB7IHR5cGU6IGVuZ2luZVR5cGUsIGhvc3Q6IGVuZ2luZUhvc3QsIG1hc3RlcktleTogZW5naW5lTWFzdGVyS2V5IH0gfSA9IGNvbmZpZztcblxuICAgICAgICBjb25zdCBlbnZWYXJzID0ge1xuICAgICAgICAgICAgLy8gcG9pbnRlciB0byB0aGUgYWN0dWFsIHRhYmxlIG5hbWUgZW52IHZhcmlhYmxlXG4gICAgICAgICAgICBbIFNFQVJDSF9JTkRFWEVSX0VOVl9LRVlTLlRBQkxFX05BTUVfRU5WX0tFWSBdOiBhcHBRdWFsaWZpZWRUYWJsZU5hbWUsXG4gICAgICAgICAgICAvLyBhY3R1YWwgdGFibGUgbmFtZVxuICAgICAgICAgICAgWyBhcHBRdWFsaWZpZWRUYWJsZU5hbWUgXTogdGhpcy5mdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUoYXBwUXVhbGlmaWVkVGFibGVOYW1lLCAndGFibGUnKSxcblxuICAgICAgICAgICAgWyBTRUFSQ0hfSU5ERVhFUl9FTlZfS0VZUy5FTkFCTEVEIF06IGVuYWJsZWQ/LnRvU3RyaW5nKCkgfHwgJ2ZhbHNlJyxcbiAgICAgICAgICAgIFsgU0VBUkNIX0lOREVYRVJfRU5WX0tFWVMuTUVJTElfSE9TVCBdOiBlbmdpbmVIb3N0IHx8IGVuZ2luZVR5cGUgPT09ICdtZWlsaScgPyB0aGlzLmZ3MjQuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZShTRUFSQ0hfSU5ERVhFUl9FTlZfS0VZUy5NRUlMSV9IT1NUKSA6IHVuZGVmaW5lZCxcbiAgICAgICAgICAgIFsgU0VBUkNIX0lOREVYRVJfRU5WX0tFWVMuTUVJTElfTUFTVEVSX0tFWSBdOiBlbmdpbmVNYXN0ZXJLZXkgfHwgZW5naW5lVHlwZSA9PT0gJ21laWxpJyA/IHRoaXMuZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKFNFQVJDSF9JTkRFWEVSX0VOVl9LRVlTLk1FSUxJX01BU1RFUl9LRVkpIDogdW5kZWZpbmVkLFxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGNvbmZpZy5hbGxvd2VkRW50aXR5TmFtZXMgJiYgY29uZmlnLmFsbG93ZWRFbnRpdHlOYW1lcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICBlbnZWYXJzWyBTRUFSQ0hfSU5ERVhFUl9FTlZfS0VZUy5BTExPV0VEX0VOVElUWV9OQU1FUyBdID0gY29uZmlnLmFsbG93ZWRFbnRpdHlOYW1lcy5qb2luKCcsJyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoY29uZmlnLmV4Y2x1ZGVkRW50aXR5TmFtZXMgJiYgY29uZmlnLmV4Y2x1ZGVkRW50aXR5TmFtZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgZW52VmFyc1sgU0VBUkNIX0lOREVYRVJfRU5WX0tFWVMuRVhDTFVERURfRU5USVRZX05BTUVTIF0gPSBjb25maWcuZXhjbHVkZWRFbnRpdHlOYW1lcy5qb2luKCcsJyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDcmVhdGUgUXVldWVMYW1iZGEgZm9yIHByb2Nlc3Npbmcgc2VhcmNoIGluZGV4aW5nIGV2ZW50cyBmcm9tIHRoZSBzdHJlYW0gdG9waWNcbiAgICAgICAgYXdhaXQgdGhpcy5zZXR1cFN0cmVhbUV2ZW50Q29uc3VtZXJzKFxuICAgICAgICAgICAgdGFibGVJbnN0YW5jZSxcbiAgICAgICAgICAgICdzZWFyY2gtaW5kZXhlcicsXG4gICAgICAgICAgICBjb25maWcsXG4gICAgICAgICAgICBqb2luKF9fZGlybmFtZSwgJy4uL3NlYXJjaC9pbmRleGVyL2Z1bmN0aW9ucy9kZWZhdWx0LWR5bmFtby1zdHJlYW0tc2VhcmNoLWluZGV4ZXItaGFuZGxlci5qcycpLFxuICAgICAgICAgICAgZW52VmFycyxcbiAgICAgICAgICAgIHt9ICAvLyBObyBiYXNlIHJlc291cmNlIGFjY2Vzc1xuICAgICAgICApO1xuXG4gICAgICAgIC8vIFRPRE86IGxvb2sgaW50byBpdCBsYXRlclxuICAgICAgICAvLyBjb25zdCBzeXN0ZW1Db250cm9sbGVyUGF0aCA9ICcvc3lzdGVtL3NlYXJjaCc7XG4gICAgICAgIC8vIGlmICghdGhpcy5mdzI0Lmhhc1N5c3RlbUNvbnRyb2xsZXIoc3lzdGVtQ29udHJvbGxlclBhdGgpKSB7XG4gICAgICAgIC8vICAgICB0aGlzLmZ3MjQucmVnaXN0ZXJTeXN0ZW1Db250cm9sbGVyKHtcbiAgICAgICAgLy8gICAgICAgICBwYXRoOiBzeXN0ZW1Db250cm9sbGVyUGF0aCxcbiAgICAgICAgLy8gICAgICAgICBmaWxlUGF0aDogam9pbihfX2Rpcm5hbWUsICcuLi9zZWFyY2gvc3lzdGVtL3NlYXJjaC1jb250cm9sbGVyLmpzJyksXG4gICAgICAgIC8vICAgICB9KTtcbiAgICAgICAgLy8gICAgIHRoaXMubG9nZ2VyLmluZm8oJ1NlYXJjaCBzeXN0ZW0gY29udHJvbGxlciByZWdpc3RlcmVkLicpO1xuICAgICAgICAvLyB9XG4gICAgfVxuXG59XG4iXX0=