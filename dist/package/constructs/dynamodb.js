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
const layer_1 = require("./layer");
class DynamoDBConstruct {
    dynamoDBConfig;
    logger = (0, logging_1.createLogger)(DynamoDBConstruct.name);
    fw24 = fw24_1.Fw24.getInstance();
    name = DynamoDBConstruct.name;
    dependencies = [layer_1.LayerConstruct.name]; // Wait for layers so entry packages are registered
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHluYW1vZGIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY29uc3RydWN0cy9keW5hbW9kYi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSw2Q0FBNkQ7QUFDN0QsMkRBQWlFO0FBQ2pFLHVEQUEwRDtBQUMxRCxtRkFBc0g7QUFLdEgseUNBQTBDO0FBRTFDLG9EQUFxRDtBQUNyRCx1Q0FBb0M7QUFDcEMsdURBQXlGO0FBRXpGLHdDQUF1RDtBQUN2RCw2REFBdUU7QUFFdkUsd0NBQW1FO0FBQ25FLHVEQUF3RTtBQUN4RSxpREFBNkM7QUFDN0MsbUNBQWdFO0FBQ2hFLG1DQUF5QztBQW1XekMsTUFBYSxpQkFBaUI7SUFvQkc7SUFuQnBCLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsaUJBQWlCLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDOUMsSUFBSSxHQUFTLFdBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztJQUV6QyxJQUFJLEdBQVcsaUJBQWlCLENBQUMsSUFBSSxDQUFDO0lBQ3RDLFlBQVksR0FBYSxDQUFFLHNCQUFjLENBQUMsSUFBSSxDQUFFLENBQUMsQ0FBRSxtREFBbUQ7SUFDdEcsTUFBTSxDQUF1QjtJQUU3QixTQUFTLENBQVM7SUFFbEI7Ozs7Ozs7OztPQVNHO0lBQ0gsWUFBNkIsY0FBK0I7UUFBL0IsbUJBQWMsR0FBZCxjQUFjLENBQWlCO0lBQUksQ0FBQztJQUVqRSx1Q0FBdUM7SUFFMUIsQUFBTixLQUFLLENBQUMsU0FBUztRQUNsQixNQUFNLElBQUksR0FBRyxXQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7UUFDaEMsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsU0FBUyxFQUFFLElBQUksQ0FBQyxjQUFjLENBQUMsZUFBZSxDQUFDLENBQUM7UUFDbkcsTUFBTSxxQkFBcUIsR0FBRyxJQUFBLDJCQUFvQixFQUFDLElBQUEsbUJBQVksRUFBQyxJQUFJLENBQUMsY0FBYyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsT0FBTyxDQUFDLENBQUMsQ0FBQztRQUUxRyxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyx3QkFBd0IsRUFBRSxxQkFBcUIsQ0FBQyxDQUFDO1FBRW5FLHVGQUF1RjtRQUN2RixNQUFNLGFBQWEsR0FBRyxJQUFJLHNCQUFPLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxxQkFBcUIsRUFBRSxJQUFJLENBQUMsY0FBYyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUUxRyw0QkFBNEI7UUFDNUIsSUFBSSxDQUFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLEVBQUUscUJBQXFCLEVBQUUsYUFBYSxFQUFFLHNCQUFVLENBQUMsS0FBSyxFQUFFLFdBQVcsQ0FBQyxDQUFDO1FBQ3hHLElBQUksQ0FBQyxJQUFJLENBQUMsc0JBQXNCLENBQUMscUJBQXFCLEVBQUUsYUFBYSxDQUFDLFNBQVMsRUFBRSxPQUFPLENBQUMsQ0FBQztRQUUxRixvREFBb0Q7UUFDcEQsSUFBSSxDQUFDLGNBQWMsQ0FBQyxxQkFBcUIsRUFBRSxhQUFhLENBQUMsQ0FBQztRQUUxRCxNQUFNLGVBQWUsR0FBRyxJQUFJLENBQUMsY0FBYyxDQUFDLEtBQUssQ0FBQyxLQUFLLEVBQUUsT0FBTyxDQUFDO1FBQ2pFLE1BQU0sd0JBQXdCLEdBQUcsSUFBSSxDQUFDLGNBQWMsQ0FBQyxLQUFLLENBQUMsY0FBYyxFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUMxRyxNQUFNLGdCQUFnQixHQUFHLElBQUksQ0FBQyxjQUFjLENBQUMsS0FBSyxDQUFDLE1BQU0sRUFBRSxPQUFPLENBQUM7UUFFbkUsd0NBQXdDO1FBQ3hDLE1BQU0sUUFBUSxHQUFhLEVBQUUsQ0FBQztRQUU5Qiw2R0FBNkc7UUFDN0csSUFBSSxnQkFBZ0IsSUFBSSxlQUFlLElBQUksd0JBQXdCLEVBQUUsQ0FBQztZQUNsRSxJQUFJLGFBQWEsQ0FBQyxjQUFjLEVBQUUsQ0FBQztnQkFDL0IsSUFBSSxDQUFDLHFCQUFxQixDQUFDLGFBQWEsQ0FBQyxDQUFDO2dCQUMxQyxJQUFJLGdCQUFnQjtvQkFBRSxRQUFRLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1lBQ2xELENBQUM7aUJBQU0sQ0FBQztnQkFDSixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxrQ0FBa0MsSUFBSSxDQUFDLGNBQWMsQ0FBQyxLQUFLLENBQUMsSUFBSSxtQ0FBbUMsQ0FBQyxDQUFDO1lBQzFILENBQUM7UUFDTCxDQUFDO1FBRUQsSUFBSSxJQUFJLENBQUMsY0FBYyxDQUFDLEtBQUssQ0FBQyxLQUFLLEVBQUUsT0FBTyxFQUFFLENBQUM7WUFDM0MsTUFBTSxJQUFJLENBQUMsb0JBQW9CLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxLQUFLLENBQUMsS0FBSyxFQUFFLGFBQWEsQ0FBQyxDQUFDO1lBQ2hGLFFBQVEsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDM0IsQ0FBQztRQUVELElBQUksd0JBQXdCLEVBQUUsQ0FBQztZQUMzQixLQUFLLE1BQU0sTUFBTSxJQUFJLElBQUksQ0FBQyxjQUFjLENBQUMsS0FBSyxDQUFDLGNBQWMsSUFBSSxFQUFFLEVBQUUsQ0FBQztnQkFDbEUsTUFBTSxJQUFJLENBQUMsNkJBQTZCLENBQUMsTUFBTSxFQUFFLGFBQWEsQ0FBQyxDQUFDO1lBQ3BFLENBQUM7WUFDRCxRQUFRLENBQUMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLENBQUM7UUFDckMsQ0FBQztRQUVELFVBQVU7UUFDVixJQUFJLFFBQVEsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDdEIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsWUFBWSxJQUFJLENBQUMsY0FBYyxDQUFDLEtBQUssQ0FBQyxJQUFJLHFCQUFxQixRQUFRLENBQUMsTUFBTSxnQkFBZ0IsUUFBUSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUM7UUFDMUksQ0FBQzthQUFNLENBQUM7WUFDSixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxZQUFZLElBQUksQ0FBQyxjQUFjLENBQUMsS0FBSyxDQUFDLElBQUksNEJBQTRCLENBQUMsQ0FBQztRQUM3RixDQUFDO0lBQ0wsQ0FBQztJQUVPLGtCQUFrQjtRQUN0QixPQUFPLEdBQUcsSUFBSSxDQUFDLGNBQWMsQ0FBQyxLQUFLLENBQUMsSUFBSSxTQUFTLENBQUM7SUFDdEQsQ0FBQztJQUVPLHFCQUFxQixDQUFDLGFBQXNCO1FBQ2hELE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxjQUFjLENBQUMsS0FBSyxDQUFDLE1BQU0sSUFBSSxFQUFFLENBQUM7UUFFNUQscUNBQXFDO1FBQ3JDLE1BQU0sU0FBUyxHQUFHLFlBQVksQ0FBQyxLQUFLLEVBQUUsSUFBSSxJQUFJLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxDQUFDO1FBRXhFLE1BQU0sTUFBTSxHQUFHLFlBQVksQ0FBQyxLQUFLLEVBQUUsS0FBSyxFQUFFLElBQUksSUFBSSxLQUFLLENBQUM7UUFDeEQsTUFBTSxpQkFBaUIsR0FBNEIsQ0FBRTtnQkFDakQsU0FBUztnQkFDVCxVQUFVLEVBQUU7b0JBQ1IsV0FBVyxFQUFFLHFCQUFxQixJQUFJLENBQUMsY0FBYyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUU7b0JBQ2xFLElBQUksRUFBRSxNQUFNO29CQUNaLEdBQUcsWUFBWSxDQUFDLEtBQUssRUFBRSxLQUFLO2lCQUMvQjthQUNKLENBQUUsQ0FBQztRQUVKLElBQUksc0JBQWMsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLFNBQVMsRUFBRSxDQUFDO1FBRWxELHFEQUFxRDtRQUNyRCxNQUFNLGVBQWUsR0FBRyxJQUFJLGdDQUFjLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxtQkFBbUIsRUFBRTtZQUNoRyxLQUFLLEVBQUUsSUFBQSxnQkFBSSxFQUFDLFNBQVMsRUFBRSw4Q0FBOEMsQ0FBQztZQUN0RSxvQkFBb0IsRUFBRTtnQkFDbEIsVUFBVSxFQUFFLFNBQVM7Z0JBQ3JCLFVBQVUsRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsVUFBVTthQUMzQztZQUNELGNBQWMsRUFBRTtnQkFDWixNQUFNLEVBQUUsQ0FBRTt3QkFDTixJQUFJLEVBQUUsU0FBUzt3QkFDZixNQUFNLEVBQUUsQ0FBRSxTQUFTLENBQUU7cUJBQ3hCLENBQUU7YUFDTjtTQUNKLENBQW1CLENBQUM7UUFFckIseUNBQXlDO1FBQ3pDLGFBQWEsQ0FBQyxlQUFlLENBQUMsZUFBZSxDQUFDLENBQUM7UUFDL0MsZUFBZSxDQUFDLGNBQWMsQ0FBQyxJQUFJLDRDQUFpQixDQUFDLGFBQWEsRUFBRTtZQUNoRSxHQUFHLFlBQVksQ0FBQyxTQUFTO1lBQ3pCLGdCQUFnQixFQUFFLFlBQVksQ0FBQyxTQUFTLEVBQUUsZ0JBQWdCLElBQUksNkJBQWdCLENBQUMsTUFBTTtZQUNyRixTQUFTLEVBQUUsWUFBWSxDQUFDLFNBQVMsRUFBRSxTQUFTLElBQUksQ0FBQztZQUNqRCxrQkFBa0IsRUFBRSxZQUFZLENBQUMsU0FBUyxFQUFFLGtCQUFrQixJQUFJLElBQUk7WUFDdEUsYUFBYSxFQUFFLFlBQVksQ0FBQyxTQUFTLEVBQUUsYUFBYSxJQUFJLENBQUM7U0FDNUQsQ0FBQyxDQUFDLENBQUM7UUFFSixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyw4Q0FBOEMsRUFBRSxJQUFJLENBQUMsY0FBYyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUN0RyxDQUFDO0lBRU8sS0FBSyxDQUFDLHlCQUF5QixDQUNuQyxhQUFzQixFQUN0QixZQUFvQixFQUNwQixNQUEwQyxFQUMxQyxtQkFBMkIsRUFDM0Isb0JBQTRDLEVBQzVDLGNBQW9CO1FBRXBCLElBQUksQ0FBQyxhQUFhLENBQUMsY0FBYyxFQUFFLENBQUM7WUFDaEMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsa0NBQWtDLElBQUksQ0FBQyxjQUFjLENBQUMsS0FBSyxDQUFDLElBQUksbUJBQW1CLFlBQVksRUFBRSxDQUFDLENBQUM7WUFDcEgsT0FBTztRQUNYLENBQUM7UUFFRCxNQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsa0JBQWtCLENBQUMsTUFBTSxDQUFDLENBQUM7UUFFcEQseUJBQXlCO1FBQ3pCLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxNQUFNLEVBQUUsWUFBWSxDQUFDLENBQUM7UUFFL0MsSUFBSSxXQUFXLENBQUMsSUFBSSxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQ2pDLE1BQU0sSUFBSSxDQUFDLHFCQUFxQixDQUFDLFdBQVcsQ0FBQyxnQkFBZ0IsRUFBRSxZQUFZLEVBQUUsb0JBQW9CLEVBQUUsV0FBVyxDQUFDLGFBQWEsQ0FBQyxDQUFDO1FBQ2xJLENBQUM7YUFBTSxJQUFJLFdBQVcsQ0FBQyxJQUFJLEtBQUssVUFBVSxFQUFFLENBQUM7WUFDekMsSUFBSSxDQUFDLHNCQUFzQixDQUFDLFdBQVcsQ0FBQyxpQkFBaUIsRUFBRSxZQUFZLENBQUMsQ0FBQztRQUM3RSxDQUFDO2FBQU0sQ0FBQztZQUNKLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxtQkFBbUIsRUFBRSxvQkFBb0IsRUFBRSxjQUFjLEVBQUUsV0FBVyxDQUFDLGFBQWEsQ0FBQyxDQUFDO1lBQ3hJLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxXQUFXLEVBQUUsWUFBWSxFQUFFLFlBQVksQ0FBQyxDQUFDO1FBQ3BFLENBQUM7UUFFRCxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLFlBQVksNkJBQTZCLEVBQUUsSUFBSSxDQUFDLGNBQWMsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDcEcsQ0FBQztJQUVPLG1CQUFtQixDQUFDLE1BQTBDLEVBQUUsWUFBb0I7UUFDeEYsTUFBTSxjQUFjLEdBQUcsY0FBYyxJQUFJLE1BQU0sQ0FBQztRQUVoRCxJQUFJLGNBQWMsRUFBRSxDQUFDO1lBQ2pCLE1BQU0sWUFBWSxHQUFHLE1BQU0sQ0FBQztZQUM1QixJQUFJLFlBQVksQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO2dCQUNqQyxJQUFJLFlBQVksQ0FBQyxTQUFTLEVBQUUsQ0FBQztvQkFDekIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxZQUFZLDhFQUE4RSxZQUFZLENBQUMsaUJBQWlCLHdCQUF3QixDQUFDLENBQUM7Z0JBQzFLLENBQUM7Z0JBQ0QsSUFBSSxZQUFZLENBQUMsVUFBVSxFQUFFLENBQUM7b0JBQzFCLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUcsWUFBWSw0R0FBNEcsQ0FBQyxDQUFDO2dCQUNsSixDQUFDO2dCQUNELElBQUksWUFBWSxDQUFDLGFBQWEsRUFBRSxDQUFDO29CQUM3QixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHLFlBQVksaUpBQWlKLENBQUMsQ0FBQztnQkFDdkwsQ0FBQztZQUNMLENBQUM7UUFDTCxDQUFDO2FBQU0sQ0FBQztZQUNKLE1BQU0sV0FBVyxHQUFHLE1BQU0sQ0FBQztZQUMzQixJQUFJLFdBQVcsQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO2dCQUNoQyxJQUFJLFdBQVcsQ0FBQyxTQUFTLEVBQUUsQ0FBQztvQkFDeEIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxZQUFZLDhFQUE4RSxXQUFXLENBQUMsaUJBQWlCLHdCQUF3QixDQUFDLENBQUM7Z0JBQ3pLLENBQUM7Z0JBQ0QsSUFBSSxXQUFXLENBQUMsVUFBVSxFQUFFLENBQUM7b0JBQ3pCLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUcsWUFBWSw0R0FBNEcsQ0FBQyxDQUFDO2dCQUNsSixDQUFDO2dCQUNELElBQUksV0FBVyxDQUFDLGFBQWEsRUFBRSxDQUFDO29CQUM1QixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHLFlBQVksaUpBQWlKLENBQUMsQ0FBQztnQkFDdkwsQ0FBQztZQUNMLENBQUM7UUFDTCxDQUFDO0lBQ0wsQ0FBQztJQUVPLGtCQUFrQixDQUFDLE1BQTBDO1FBQ2pFLGdGQUFnRjtRQUNoRixNQUFNLGNBQWMsR0FBRyxjQUFjLElBQUksTUFBTSxDQUFDO1FBRWhELElBQUksY0FBYyxFQUFFLENBQUM7WUFDakIsTUFBTSxZQUFZLEdBQUcsTUFBTSxDQUFDO1lBRTVCLElBQUksa0JBQWtCLElBQUksWUFBWSxJQUFJLFlBQVksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO2dCQUN0RSxPQUFPO29CQUNILElBQUksRUFBRSxTQUFTO29CQUNmLGdCQUFnQixFQUFFLFlBQVksQ0FBQyxnQkFBZ0I7b0JBQy9DLGFBQWEsRUFBRSxZQUFZLENBQUMsYUFBYTtpQkFDNUMsQ0FBQztZQUNOLENBQUM7aUJBQU0sSUFBSSxtQkFBbUIsSUFBSSxZQUFZLElBQUksWUFBWSxDQUFDLGlCQUFpQixFQUFFLENBQUM7Z0JBQy9FLE9BQU87b0JBQ0gsSUFBSSxFQUFFLFVBQVU7b0JBQ2hCLGlCQUFpQixFQUFFLFlBQVksQ0FBQyxpQkFBaUI7aUJBQ3BELENBQUM7WUFDTixDQUFDO2lCQUFNLENBQUM7Z0JBQ0osT0FBTztvQkFDSCxJQUFJLEVBQUUsS0FBSztvQkFDWCxhQUFhLEVBQUUsWUFBWSxDQUFDLGFBQWE7b0JBQ3pDLFVBQVUsRUFBRSxZQUFZLENBQUMsVUFBVTtvQkFDbkMsbUJBQW1CLEVBQUUsWUFBWSxDQUFDLG1CQUFtQjtvQkFDckQsZUFBZSxFQUFFLFlBQVksQ0FBQyxTQUFTO2lCQUMxQyxDQUFDO1lBQ04sQ0FBQztRQUNMLENBQUM7YUFBTSxDQUFDO1lBQ0osY0FBYztZQUNkLE1BQU0sV0FBVyxHQUFHLE1BQU0sQ0FBQztZQUUzQixJQUFJLFdBQVcsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO2dCQUMvQixPQUFPO29CQUNILElBQUksRUFBRSxTQUFTO29CQUNmLGdCQUFnQixFQUFFLFdBQVcsQ0FBQyxnQkFBZ0I7b0JBQzlDLGFBQWEsRUFBRSxXQUFXLENBQUMsYUFBYTtpQkFDM0MsQ0FBQztZQUNOLENBQUM7aUJBQU0sSUFBSSxXQUFXLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztnQkFDdkMsT0FBTztvQkFDSCxJQUFJLEVBQUUsVUFBVTtvQkFDaEIsaUJBQWlCLEVBQUUsV0FBVyxDQUFDLGlCQUFpQjtpQkFDbkQsQ0FBQztZQUNOLENBQUM7aUJBQU0sQ0FBQztnQkFDSixPQUFPO29CQUNILElBQUksRUFBRSxLQUFLO29CQUNYLGFBQWEsRUFBRSxXQUFXLENBQUMsYUFBYTtvQkFDeEMsVUFBVSxFQUFFLFdBQVcsQ0FBQyxVQUFVO29CQUNsQyxtQkFBbUIsRUFBRSxXQUFXLENBQUMsbUJBQW1CO29CQUNwRCxlQUFlLEVBQUUsV0FBVyxDQUFDLFNBQVM7aUJBQ3pDLENBQUM7WUFDTixDQUFDO1FBQ0wsQ0FBQztJQUNMLENBQUM7SUFFTyx1QkFBdUIsQ0FDM0IsbUJBQTJCLEVBQzNCLG9CQUE0QyxFQUM1QyxjQUFtQixFQUNuQixhQUFtQztRQUVuQyxPQUFPO1lBQ0gsS0FBSyxFQUFFLG1CQUFtQjtZQUMxQixvQkFBb0I7WUFDcEIsY0FBYztZQUNkLGFBQWE7U0FDaEIsQ0FBQztJQUNOLENBQUM7SUFFTyxzQkFBc0IsQ0FDMUIsaUJBQXlCLEVBQ3pCLFlBQW9CO1FBRXBCLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLG1DQUFtQyxpQkFBaUIsU0FBUyxZQUFZLHlEQUF5RCxJQUFJLENBQUMsa0JBQWtCLEVBQUUsd0JBQXdCLENBQUMsQ0FBQztRQUV0TSwrRUFBK0U7UUFDL0UsSUFBSSxDQUFDO1lBQ0QsSUFBSSxDQUFDLElBQUksQ0FBQyxjQUFjLENBQ3BCLGlCQUFpQixFQUNqQixJQUFJLENBQUMsU0FBUyxFQUNkLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLElBQUksWUFBWSxXQUFXLENBQ2xELENBQUM7WUFDRixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHLFlBQVksMENBQTBDLGlCQUFpQixtQkFBbUIsRUFBRSxJQUFJLENBQUMsY0FBYyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUNwSixDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNiLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLFVBQVUsaUJBQWlCLG1CQUFtQixZQUFZLHNDQUFzQyxpQkFBaUIsZUFBZSxDQUFDLENBQUM7WUFDcEosTUFBTSxLQUFLLENBQUM7UUFDaEIsQ0FBQztJQUNMLENBQUM7SUFFTyxLQUFLLENBQUMscUJBQXFCLENBQy9CLGdCQUF3QixFQUN4QixZQUFvQixFQUNwQixvQkFBNEMsRUFDNUMsYUFBbUM7UUFFbkMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsK0JBQStCLGdCQUFnQixFQUFFLENBQUMsQ0FBQztRQUVwRSxtRkFBbUY7UUFDbkYsTUFBTSxZQUFZLEdBQUcsSUFBQSxtQkFBTyxFQUFDLGdCQUFnQixDQUFDLENBQUM7UUFDL0MsTUFBTSxXQUFXLEdBQUcseUJBQWEsWUFBWSx1Q0FBQyxDQUFDO1FBRS9DLDJEQUEyRDtRQUMzRCxJQUFJLFVBQXFELENBQUM7UUFDMUQsS0FBSyxNQUFNLFlBQVksSUFBSSxNQUFNLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUM7WUFDcEQsSUFBSSxPQUFPLFlBQVksS0FBSyxVQUFVLElBQUksWUFBWSxDQUFDLElBQUksS0FBSyxTQUFTLEVBQUUsQ0FBQztnQkFDeEUsVUFBVSxHQUFHLFlBQTJDLENBQUM7Z0JBQ3pELE1BQU07WUFDVixDQUFDO1FBQ0wsQ0FBQztRQUVELElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUNkLE1BQU0sSUFBSSxLQUFLLENBQUMsMkJBQTJCLGdCQUFnQixFQUFFLENBQUMsQ0FBQztRQUNuRSxDQUFDO1FBRUQsMERBQTBEO1FBQzFELE1BQU0sZUFBZSxHQUFHLElBQUksVUFBVSxFQUFFLENBQUM7UUFDekMsTUFBTSxTQUFTLEdBQUcsZUFBZSxDQUFDLFNBQVMsQ0FBQztRQUM1QyxNQUFNLFdBQVcsR0FBRyxlQUFlLENBQUMsV0FBVyxJQUFJLEVBQUUsQ0FBQztRQUV0RCxvQ0FBb0M7UUFDcEMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxrQkFBa0IsRUFBRSxDQUFDO1lBQ2xDLE1BQU0sSUFBSSxLQUFLLENBQ1gsVUFBVSxTQUFTLG1GQUFtRixDQUN6RyxDQUFDO1FBQ04sQ0FBQztRQUVELElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLGtCQUFrQixTQUFTLFFBQVEsWUFBWSxFQUFFLENBQUMsQ0FBQztRQUVwRSw4QkFBOEI7UUFDOUIsTUFBTSxhQUFhLEdBQUc7WUFDbEIsR0FBRyxvQkFBb0I7WUFDdkIsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLG1CQUFtQixDQUFDLFdBQVcsQ0FBQyxHQUFHLENBQUM7U0FDcEQsQ0FBQztRQUVGLHdEQUF3RDtRQUN4RCxpRUFBaUU7UUFDakUsTUFBTSxtQkFBbUIsR0FBRyxFQUFFLEdBQUcsV0FBVyxDQUFDLGFBQWEsRUFBRSxHQUFHLGFBQWEsRUFBRSxDQUFDO1FBRS9FLGdHQUFnRztRQUNoRyxNQUFNLEtBQUssR0FBRyxJQUFJLDBCQUFXLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxHQUFHLFNBQVMsUUFBUSxFQUFFO1lBQ2hFLFNBQVMsRUFBRSxTQUFTO1lBQ3BCLFVBQVUsRUFBRSxXQUFXLENBQUMsVUFBVTtZQUNsQyx3QkFBd0IsRUFBRSxXQUFXLENBQUMsd0JBQXdCO1lBQzlELDZCQUE2QixFQUFFLFdBQVcsQ0FBQyw2QkFBNkI7WUFDeEUsbUJBQW1CLEVBQUUsV0FBVyxDQUFDLG1CQUFtQjtZQUNwRCxlQUFlLEVBQUUsV0FBVyxDQUFDLGVBQWU7WUFDNUMsbUJBQW1CLEVBQUUsV0FBVyxDQUFDLG1CQUFtQjtZQUNwRCxhQUFhLEVBQUU7Z0JBQ1gsTUFBTSxFQUFFLENBQUU7d0JBQ04sSUFBSSxFQUFFLElBQUksQ0FBQyxrQkFBa0IsRUFBRTt3QkFDL0IsT0FBTyxFQUFFLEVBQUU7cUJBQ2QsQ0FBRTthQUNOO1lBQ0QsbUJBQW1CLEVBQUU7Z0JBQ2pCLEtBQUssRUFBRSxZQUFZO2dCQUNuQixvQkFBb0IsRUFBRSxhQUFhO2dCQUNuQyxjQUFjLEVBQUUsV0FBVyxDQUFDLGNBQWM7Z0JBQzFDLGFBQWEsRUFBRSxtQkFBbUI7Z0JBQ2xDLGVBQWUsRUFBRSxXQUFXLENBQUMsZUFBZTtnQkFDNUMsUUFBUSxFQUFFLFdBQVcsQ0FBQyxRQUFRO2dCQUM5QixnQkFBZ0IsRUFBRSxXQUFXLENBQUMsZ0JBQWdCO2dCQUM5QyxnQkFBZ0IsRUFBRSxXQUFXLENBQUMsZ0JBQWdCO2FBQ2pEO1NBQ0osQ0FBVSxDQUFDO1FBRVosZ0RBQWdEO1FBQ2hELElBQUksQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsSUFBSSxFQUFFLFNBQVMsRUFBRSxLQUFLLEVBQUUsc0JBQVUsQ0FBQyxLQUFLLEVBQUUsV0FBVyxDQUFDLENBQUM7UUFFcEYsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxZQUFZLGdDQUFnQyxTQUFTLEVBQUUsQ0FBQyxDQUFDO0lBQ2pGLENBQUM7SUFFTyxpQkFBaUIsQ0FDckIsV0FBMkIsRUFDM0IsWUFBb0IsRUFDcEIsWUFBaUM7UUFFakMsTUFBTSxTQUFTLEdBQUcsV0FBVyxDQUFDLGVBQWUsSUFBSSxHQUFHLElBQUksQ0FBQyxjQUFjLENBQUMsS0FBSyxDQUFDLElBQUksSUFBSSxZQUFZLEVBQUUsQ0FBQztRQUNyRyxNQUFNLGdCQUFnQixHQUFHLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxXQUFXLENBQUMsbUJBQW1CLENBQUMsQ0FBQztRQUV4RixJQUFJLDBCQUFXLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxJQUFJLFlBQVksUUFBUSxFQUFFO1lBQzFFLFNBQVMsRUFBRSxTQUFTO1lBQ3BCLG1CQUFtQixFQUFFLFlBQVk7WUFDakMsVUFBVSxFQUFFLFdBQVcsQ0FBQyxVQUFVLElBQUksRUFBRTtZQUN4QyxhQUFhLEVBQUU7Z0JBQ1gsTUFBTSxFQUFFLENBQUU7d0JBQ04sSUFBSSxFQUFFLElBQUksQ0FBQyxrQkFBa0IsRUFBRTt3QkFDL0IsT0FBTyxFQUFFLEVBQUU7cUJBQ2QsQ0FBRTthQUNOO1lBQ0QsbUJBQW1CLEVBQUUsZ0JBQWdCO1NBQ3hDLENBQUMsQ0FBQztJQUNQLENBQUM7SUFFTyx3QkFBd0IsQ0FBQyxXQUFpQztRQUM5RCxPQUFPO1lBQ0gsU0FBUyxFQUFFLFdBQVcsRUFBRSxTQUFTLElBQUksQ0FBQztZQUN0QyxpQkFBaUIsRUFBRSxXQUFXLEVBQUUsaUJBQWlCLElBQUksc0JBQVEsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDO1lBQ3hFLHVCQUF1QixFQUFFLFdBQVcsRUFBRSx1QkFBdUIsSUFBSSxJQUFJO1lBQ3JFLEdBQUcsV0FBVztTQUNqQixDQUFDO0lBQ04sQ0FBQztJQUVPLEtBQUssQ0FBQyxvQkFBb0IsQ0FBQyxNQUFtQixFQUFFLGFBQXNCO1FBQzFFLHlFQUF5RTtRQUN6RSxNQUFNLE9BQU8sR0FBMkIsRUFBRSxDQUFDO1FBRTNDLElBQUksTUFBTSxDQUFDLGtCQUFrQixJQUFJLE1BQU0sQ0FBQyxrQkFBa0IsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDcEUsT0FBTyxDQUFFLDJCQUFjLENBQUMsb0JBQW9CLENBQUUsR0FBRyxNQUFNLENBQUMsa0JBQWtCLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ3pGLENBQUM7UUFFRCxJQUFJLE1BQU0sQ0FBQyxtQkFBbUIsSUFBSSxNQUFNLENBQUMsbUJBQW1CLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ3RFLE9BQU8sQ0FBRSwyQkFBYyxDQUFDLHFCQUFxQixDQUFFLEdBQUcsTUFBTSxDQUFDLG1CQUFtQixDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUMzRixDQUFDO1FBRUQsMkdBQTJHO1FBQzNHLE1BQU0sSUFBSSxDQUFDLHlCQUF5QixDQUNoQyxhQUFhLEVBQ2IsY0FBYyxFQUNkLE1BQU0sRUFDTixJQUFBLGdCQUFJLEVBQUMsU0FBUyxFQUFFLDhDQUE4QyxDQUFDLEVBQy9ELE9BQU8sRUFDUCxFQUFFLENBQUMsMkRBQTJEO1NBQ2pFLENBQUM7UUFFRixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxpREFBaUQsRUFBRTtZQUNoRSxLQUFLLEVBQUUsSUFBSSxDQUFDLGNBQWMsQ0FBQyxLQUFLLENBQUMsSUFBSTtZQUNyQyxlQUFlLEVBQUUsTUFBTSxDQUFDLGtCQUFrQjtZQUMxQyxnQkFBZ0IsRUFBRSxNQUFNLENBQUMsbUJBQW1CO1NBQy9DLENBQUMsQ0FBQztJQUNQLENBQUM7SUFFTyxLQUFLLENBQUMsNkJBQTZCLENBQUMsTUFBNEIsRUFBRSxhQUFzQjtRQUM1RixrRkFBa0Y7UUFDbEYsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsa0RBQWtELEVBQUUsSUFBSSxDQUFDLGNBQWMsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUM7UUFFdEcsTUFBTSxxQkFBcUIsR0FBRyxJQUFBLDJCQUFvQixFQUFDLElBQUEsbUJBQVksRUFBQyxJQUFJLENBQUMsY0FBYyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsT0FBTyxDQUFDLENBQUMsQ0FBQztRQUUxRyxNQUFNLEVBQUUsT0FBTyxFQUFFLFlBQVksRUFBRSxFQUFFLElBQUksRUFBRSxVQUFVLEVBQUUsSUFBSSxFQUFFLFVBQVUsRUFBRSxTQUFTLEVBQUUsZUFBZSxFQUFFLEVBQUUsR0FBRyxNQUFNLENBQUM7UUFFN0csTUFBTSxPQUFPLEdBQUc7WUFDWixnREFBZ0Q7WUFDaEQsQ0FBRSxvQ0FBdUIsQ0FBQyxrQkFBa0IsQ0FBRSxFQUFFLHFCQUFxQjtZQUNyRSxvQkFBb0I7WUFDcEIsQ0FBRSxxQkFBcUIsQ0FBRSxFQUFFLElBQUksQ0FBQyxJQUFJLENBQUMsc0JBQXNCLENBQUMscUJBQXFCLEVBQUUsT0FBTyxDQUFDO1lBRTNGLENBQUUsb0NBQXVCLENBQUMsT0FBTyxDQUFFLEVBQUUsT0FBTyxFQUFFLFFBQVEsRUFBRSxJQUFJLE9BQU87WUFDbkUsQ0FBRSxvQ0FBdUIsQ0FBQyxVQUFVLENBQUUsRUFBRSxVQUFVLElBQUksVUFBVSxLQUFLLE9BQU8sQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxvQ0FBdUIsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUztZQUMvSixDQUFFLG9DQUF1QixDQUFDLGdCQUFnQixDQUFFLEVBQUUsZUFBZSxJQUFJLFVBQVUsS0FBSyxPQUFPLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsc0JBQXNCLENBQUMsb0NBQXVCLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUztTQUNuTCxDQUFBO1FBRUQsSUFBSSxNQUFNLENBQUMsa0JBQWtCLElBQUksTUFBTSxDQUFDLGtCQUFrQixDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUNwRSxPQUFPLENBQUUsb0NBQXVCLENBQUMsb0JBQW9CLENBQUUsR0FBRyxNQUFNLENBQUMsa0JBQWtCLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ2xHLENBQUM7UUFFRCxJQUFJLE1BQU0sQ0FBQyxtQkFBbUIsSUFBSSxNQUFNLENBQUMsbUJBQW1CLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ3RFLE9BQU8sQ0FBRSxvQ0FBdUIsQ0FBQyxxQkFBcUIsQ0FBRSxHQUFHLE1BQU0sQ0FBQyxtQkFBbUIsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDcEcsQ0FBQztRQUVELGlGQUFpRjtRQUNqRixNQUFNLElBQUksQ0FBQyx5QkFBeUIsQ0FDaEMsYUFBYSxFQUNiLGdCQUFnQixFQUNoQixNQUFNLEVBQ04sSUFBQSxnQkFBSSxFQUFDLFNBQVMsRUFBRSw2RUFBNkUsQ0FBQyxFQUM5RixPQUFPLEVBQ1AsRUFBRSxDQUFFLDBCQUEwQjtTQUNqQyxDQUFDO1FBRUYsMkJBQTJCO1FBQzNCLGlEQUFpRDtRQUNqRCw4REFBOEQ7UUFDOUQsMkNBQTJDO1FBQzNDLHNDQUFzQztRQUN0Qyw4RUFBOEU7UUFDOUUsVUFBVTtRQUNWLGdFQUFnRTtRQUNoRSxJQUFJO0lBQ1IsQ0FBQztDQUVKO0FBcGRELDhDQW9kQztBQTViZ0I7SUFEWixJQUFBLHFCQUFXLEdBQUU7a0RBcURiIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgRHVyYXRpb24sIFJlbW92YWxQb2xpY3ksIFN0YWNrIH0gZnJvbSBcImF3cy1jZGstbGliXCI7XG5pbXBvcnQgeyBUYWJsZVByb3BzVjIsIFRhYmxlVjIgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWR5bmFtb2RiXCI7XG5pbXBvcnQgeyBTdGFydGluZ1Bvc2l0aW9uIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1sYW1iZGFcIjtcbmltcG9ydCB7IER5bmFtb0V2ZW50U291cmNlLCBEeW5hbW9FdmVudFNvdXJjZVByb3BzLCBTcXNFdmVudFNvdXJjZVByb3BzIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1sYW1iZGEtZXZlbnQtc291cmNlc1wiO1xuaW1wb3J0IHsgTm9kZWpzRnVuY3Rpb24sIE5vZGVqc0Z1bmN0aW9uUHJvcHMgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ub2RlanNcIjtcbmltcG9ydCB7IExvZ0dyb3VwLCBMb2dHcm91cFByb3BzLCBSZXRlbnRpb25EYXlzIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1sb2dzXCI7XG5pbXBvcnQgeyBUb3BpY1Byb3BzIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1zbnNcIjtcbmltcG9ydCB7IFF1ZXVlLCBRdWV1ZVByb3BzIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1zcXNcIjtcbmltcG9ydCB7IGpvaW4sIHJlc29sdmUgfSBmcm9tIFwibm9kZTpwYXRoXCI7XG5cbmltcG9ydCB7IEFVRElUX0VOVl9LRVlTIH0gZnJvbSBcIi4uL2F1ZGl0L2ludGVyZmFjZXNcIjtcbmltcG9ydCB7IEZ3MjQgfSBmcm9tIFwiLi4vY29yZS9mdzI0XCI7XG5pbXBvcnQgeyBGVzI0Q29uc3RydWN0LCBGVzI0Q29uc3RydWN0T3V0cHV0LCBPdXRwdXRUeXBlIH0gZnJvbSBcIi4uL2ludGVyZmFjZXMvY29uc3RydWN0XCI7XG5pbXBvcnQgeyBJQ29uc3RydWN0Q29uZmlnIH0gZnJvbSBcIi4uL2ludGVyZmFjZXMvY29uc3RydWN0LWNvbmZpZ1wiO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyLCBMb2dEdXJhdGlvbiB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBTRUFSQ0hfSU5ERVhFUl9FTlZfS0VZUyB9IGZyb20gXCIuLi9zZWFyY2gvaW5kZXhlci9pbnRlcmZhY2VzXCI7XG5pbXBvcnQgeyByZW1vdmVFbXB0eSB9IGZyb20gXCIuLi91dGlsc1wiO1xuaW1wb3J0IHsgZW5zdXJlTm9TcGVjaWFsQ2hhcnMsIGVuc3VyZVN1ZmZpeCB9IGZyb20gXCIuLi91dGlscy9rZXlzXCI7XG5pbXBvcnQgeyBMYW1iZGFGdW5jdGlvbiwgTGFtYmRhRnVuY3Rpb25Qcm9wcyB9IGZyb20gXCIuL2xhbWJkYS1mdW5jdGlvblwiO1xuaW1wb3J0IHsgUXVldWVMYW1iZGEgfSBmcm9tIFwiLi9xdWV1ZS1sYW1iZGFcIjtcbmltcG9ydCB7IElUb3BpY0NvbnN0cnVjdENvbmZpZywgVG9waWNDb25zdHJ1Y3QgfSBmcm9tIFwiLi90b3BpY1wiO1xuaW1wb3J0IHsgTGF5ZXJDb25zdHJ1Y3QgfSBmcm9tIFwiLi9sYXllclwiO1xuXG5pbnRlcmZhY2UgTmV3UXVldWVDb25maWcge1xuICAgIHR5cGU6ICduZXcnO1xuICAgIGZ1bmN0aW9uUHJvcHM/OiBOb2RlanNGdW5jdGlvblByb3BzO1xuICAgIHF1ZXVlUHJvcHM/OiBRdWV1ZVByb3BzO1xuICAgIHNxc0V2ZW50U291cmNlUHJvcHM/OiBTcXNFdmVudFNvdXJjZVByb3BzO1xuICAgIGN1c3RvbVF1ZXVlTmFtZT86IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIEV4aXN0aW5nUXVldWVDb25maWcge1xuICAgIHR5cGU6ICdleGlzdGluZyc7XG4gICAgZXhpc3RpbmdRdWV1ZU5hbWU6IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIEhhbmRsZXJRdWV1ZUNvbmZpZyB7XG4gICAgdHlwZTogJ2hhbmRsZXInO1xuICAgIHF1ZXVlSGFuZGxlclBhdGg6IHN0cmluZztcbiAgICBmdW5jdGlvblByb3BzPzogTm9kZWpzRnVuY3Rpb25Qcm9wcztcbn1cblxudHlwZSBRdWV1ZUNvbmZpZyA9IE5ld1F1ZXVlQ29uZmlnIHwgRXhpc3RpbmdRdWV1ZUNvbmZpZyB8IEhhbmRsZXJRdWV1ZUNvbmZpZztcblxuZXhwb3J0IHR5cGUgU2VhcmNoRW5naW5lQ29uZmlnID0ge1xuICAgIHR5cGU6ICdtZWlsaScsXG4gICAgaG9zdDogc3RyaW5nLFxuICAgIG1hc3RlcktleTogc3RyaW5nXG59XG4vLyB1bmNvbW1lbnQgd2hlbiBpbXBsZW1lbnRlZFxuLy8gfSB8IHtcbi8vICAgICB0eXBlOiAnZWxhc3RpY3NlYXJjaCcsIC8vIG5vdCBpbXBsZW1lbnRlZCB5ZXRcbi8vICAgICBob3N0OiBzdHJpbmcsXG4vLyAgICAgYXBpS2V5OiBzdHJpbmdcbi8vIH0gfCB7XG4vLyAgICAgdHlwZTogJ2FsZ29saWEnLCAvLyBub3QgaW1wbGVtZW50ZWQgeWV0XG4vLyAgICAgYXBwSWQ6IHN0cmluZyxcbi8vICAgICBhcGlLZXk6IHN0cmluZ1xuLy8gfVxuXG4vKipcbiAqIENvbmZpZ3VyYXRpb24gZm9yIHNlYXJjaCBpbmRleGluZy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBTZWFyY2hJbmRleGluZ0NvbmZpZyBleHRlbmRzIElDb25zdHJ1Y3RDb25maWcge1xuICAgIC8qKlxuICAgICAqIFdoZXRoZXIgdG8gZW5hYmxlIHNlYXJjaCBpbmRleGluZy5cbiAgICAgKiBAZGVmYXVsdCBmYWxzZVxuICAgICAqL1xuICAgIGVuYWJsZWQ/OiBib29sZWFuO1xuICAgIC8qKlxuICAgICAqIExpc3Qgb2YgYWxsb3dlZCBlbnRpdHkgbmFtZXMgdG8gYmUgaW5kZXhlZC5cbiAgICAgKiBJZiBub3QgcHJvdmlkZWQsIGFsbCBlbnRpdGllcyB3aWxsIGJlIGluZGV4ZWQgZXhjZXB0IHRob3NlIGluIGV4Y2x1ZGVkRW50aXR5TmFtZXMgb3Igc3lzdGVtIGVudGl0aWVzLlxuICAgICAqIFRha2VzIHByZWNlZGVuY2Ugb3ZlciBleGNsdWRlZEVudGl0eU5hbWVzIGlmIGJvdGggYXJlIHByb3ZpZGVkLlxuICAgICAqL1xuICAgIGFsbG93ZWRFbnRpdHlOYW1lcz86IHN0cmluZ1tdO1xuICAgIC8qKlxuICAgICAqIExpc3Qgb2YgZW50aXR5IG5hbWVzIHRvIGV4Y2x1ZGUgZnJvbSBpbmRleGluZy5cbiAgICAgKiBJZiBhbGxvd2VkRW50aXR5TmFtZXMgaXMgcHJvdmlkZWQsIHRoaXMgZmllbGQgaXMgaWdub3JlZC5cbiAgICAgKiBJZiBuZWl0aGVyIGFsbG93ZWRFbnRpdHlOYW1lcyBub3IgZXhjbHVkZWRFbnRpdHlOYW1lcyBpcyBwcm92aWRlZCwgZGVmYXVsdHMgdG8gZXhjbHVkaW5nIHN5c3RlbSBlbnRpdGllcyBsaWtlICdhdWRpdExvZycuXG4gICAgICovXG4gICAgZXhjbHVkZWRFbnRpdHlOYW1lcz86IHN0cmluZ1tdO1xuICAgIC8qKlxuICAgICAqIFNlYXJjaCBlbmdpbmUgY29uZmlndXJhdGlvbiB0aGF0IGRlZmluZXMgd2hpY2ggc2VhcmNoIHByb3ZpZGVyIHRvIHVzZSBhbmQgaXRzIGNvbm5lY3Rpb24gZGV0YWlscy5cbiAgICAgKiBcbiAgICAgKiBDdXJyZW50bHkgc3VwcG9ydHMgTWVpbGlTZWFyY2ggd2l0aCBwbGFucyB0byBleHRlbmQgdG8gRWxhc3RpY3NlYXJjaCBhbmQgQWxnb2xpYS5cbiAgICAgKiBcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGBgYHR5cGVzY3JpcHRcbiAgICAgKiBlbmdpbmVDb25maWc6IHtcbiAgICAgKiAgIHR5cGU6ICdtZWlsaScsXG4gICAgICogICBob3N0OiAnaHR0cHM6Ly95b3VyLW1laWxpc2VhcmNoLWluc3RhbmNlLmNvbScsXG4gICAgICogICBtYXN0ZXJLZXk6ICd5b3VyLW1hc3Rlci1rZXknXG4gICAgICogfVxuICAgICAqIGBgYFxuICAgICAqL1xuICAgIGVuZ2luZUNvbmZpZzogU2VhcmNoRW5naW5lQ29uZmlnO1xuICAgIC8qKlxuICAgICAqIEN1c3RvbSBmdW5jdGlvbiBwcm9wZXJ0aWVzIGZvciB0aGUgc2VhcmNoIGluZGV4aW5nIExhbWJkYS5cbiAgICAgKiBBbGxvd3Mgb3ZlcnJpZGluZyBmdW5jdGlvbiBjb25maWd1cmF0aW9uIGxpa2UgVlBDLCBtZW1vcnksIHRpbWVvdXQsIGV0Yy5cbiAgICAgKiBcbiAgICAgKiAqKk5vdGU6KiogXG4gICAgICogLSBQcm9wZXJ0aWVzIHNwZWNpZmllZCBoZXJlIHdpbGwgb3ZlcnJpZGUgdGhlIHF1ZXVlJ3MgQFF1ZXVlIGRlY29yYXRvciBmdW5jdGlvblByb3BzXG4gICAgICogLSBJZ25vcmVkIHdoZW4gYGV4aXN0aW5nUXVldWVOYW1lYCBpcyBwcm92aWRlZCAoZXhpc3RpbmcgcXVldWVzIGhhdmUgdGhlaXIgb3duIGhhbmRsZXJzKVxuICAgICAqL1xuICAgIGZ1bmN0aW9uUHJvcHM/OiBOb2RlanNGdW5jdGlvblByb3BzO1xuICAgIC8qKlxuICAgICAqIEN1c3RvbSBxdWV1ZSBuYW1lIGZvciBjcmVhdGluZyBhIG5ldyBzZWFyY2ggaW5kZXhpbmcgcXVldWUuXG4gICAgICogSWYgbm90IHByb3ZpZGVkLCBkZWZhdWx0cyB0byBgJHt0YWJsZU5hbWV9LXNlYXJjaC1pbmRleGVyYFxuICAgICAqIFxuICAgICAqICoqTm90ZToqKiBDYW5ub3QgYmUgdXNlZCB3aXRoIGBleGlzdGluZ1F1ZXVlTmFtZWBcbiAgICAgKi9cbiAgICBxdWV1ZU5hbWU/OiBzdHJpbmc7XG4gICAgLyoqXG4gICAgICogTmFtZSBvZiBhbiBleGlzdGluZyBmcmFtZXdvcmstbWFuYWdlZCBxdWV1ZSB0byB1c2UgZm9yIHNlYXJjaCBpbmRleGluZyBwcm9jZXNzaW5nLlxuICAgICAqIFxuICAgICAqICoqSW1wb3J0YW50OioqIFRoZSBleGlzdGluZyBxdWV1ZSBtdXN0OlxuICAgICAqIC0gQmUgZGVmaW5lZCB3aXRoIEBRdWV1ZSgnUXVldWVOYW1lJykgZGVjb3JhdG9yIGluIHlvdXIgc3JjL3F1ZXVlcyBkaXJlY3RvcnlcbiAgICAgKiAtIEFscmVhZHkgYmUgcmVnaXN0ZXJlZCBieSB0aGUgZnJhbWV3b3JrJ3MgUXVldWVDb25zdHJ1Y3RcbiAgICAgKiAtIEJlIGNvbmZpZ3VyZWQgdG8gc3Vic2NyaWJlIHRvIHRoZSBzdHJlYW0gdG9waWMgaW4gaXRzIEBRdWV1ZSBzdWJzY3JpcHRpb25zXG4gICAgICogXG4gICAgICogKipFeGFtcGxlOioqIFxuICAgICAqIGBgYHR5cGVzY3JpcHRcbiAgICAgKiBAUXVldWUoJ01laWxpc2VhcmNoU3luYycsIHtcbiAgICAgKiAgIHN1YnNjcmlwdGlvbnM6IHtcbiAgICAgKiAgICAgdG9waWNzOiBbeyBuYW1lOiAnbXlUYWJsZS1zdHJlYW0nIH1dXG4gICAgICogICB9XG4gICAgICogfSlcbiAgICAgKiBleHBvcnQgY2xhc3MgTWVpbGlzZWFyY2hTeW5jIGV4dGVuZHMgQmFzZVNlYXJjaEluZGV4ZXIgeyAuLi4gfVxuICAgICAqIGBgYFxuICAgICAqIFRoZW4gdXNlOiBgZXhpc3RpbmdRdWV1ZU5hbWU6ICdNZWlsaXNlYXJjaFN5bmMnYFxuICAgICAqIFxuICAgICAqICoqTm90ZToqKiBDYW5ub3QgYmUgdXNlZCB3aXRoIGBxdWV1ZU5hbWVgIG9yIGBxdWV1ZVByb3BzYFxuICAgICAqL1xuICAgIGV4aXN0aW5nUXVldWVOYW1lPzogc3RyaW5nO1xuICAgIC8qKlxuICAgICAqIFBhdGggdG8gcXVldWUgaGFuZGxlciBmaWxlIGZvciBtYW51YWwgcmVnaXN0cmF0aW9uLlxuICAgICAqIFRoZSBxdWV1ZSBoYW5kbGVyIG11c3QgaGF2ZSBgbWFudWFsUmVnaXN0cmF0aW9uOiB0cnVlYCBpbiBpdHMgQFF1ZXVlIGNvbmZpZy5cbiAgICAgKiBEeW5hbW9EQiBjb25zdHJ1Y3Qgd2lsbCBjcmVhdGUgdGhlIHF1ZXVlIGFuZCBhdXRvbWF0aWNhbGx5IHN1YnNjcmliZSBpdCB0byB0aGUgc3RyZWFtIHRvcGljLlxuICAgICAqIFxuICAgICAqICoqRXhhbXBsZToqKlxuICAgICAqIGBgYHR5cGVzY3JpcHRcbiAgICAgKiAvLyBJbiBzcmMvcXVldWVzL21laWxpc2VhcmNoLXN5bmMudHM6XG4gICAgICogQFF1ZXVlKCdNZWlsaXNlYXJjaFN5bmMnLCB7XG4gICAgICogICBtYW51YWxSZWdpc3RyYXRpb246IHRydWUsXG4gICAgICogICByZXNvdXJjZUFjY2VzczogeyB0YWJsZXM6IFsncGx1c2ZhbiddIH0sXG4gICAgICogICAvLyAuLi4gb3RoZXIgcXVldWUgY29uZmlnXG4gICAgICogfSlcbiAgICAgKiBleHBvcnQgY2xhc3MgTWVpbGlzZWFyY2hTeW5jIGV4dGVuZHMgQmFzZVNlYXJjaEluZGV4ZXIgeyAuLi4gfVxuICAgICAqIFxuICAgICAqIC8vIEluIGluZGV4LnRzOlxuICAgICAqIHNlYXJjaEluZGV4aW5nOiBbe1xuICAgICAqICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgKiAgIHF1ZXVlSGFuZGxlclBhdGg6ICcuL3NyYy9xdWV1ZXMvbWVpbGlzZWFyY2gtc3luYy50cycsXG4gICAgICogICBlbmdpbmVDb25maWc6IHsgdHlwZTogJ21laWxpJywgaG9zdDogJy4uLicsIG1hc3RlcktleTogJy4uLicgfVxuICAgICAqIH1dXG4gICAgICogYGBgXG4gICAgICogXG4gICAgICogKipOb3RlOioqIENhbm5vdCBiZSB1c2VkIHdpdGggYHF1ZXVlTmFtZWAsIGBleGlzdGluZ1F1ZXVlTmFtZWAsIG9yIGBsYW1iZGFGdW5jdGlvblByb3BzYFxuICAgICAqL1xuICAgIHF1ZXVlSGFuZGxlclBhdGg/OiBzdHJpbmc7XG4gICAgLyoqXG4gICAgICogU2VhcmNoIGluZGV4aW5nIHF1ZXVlIHByb3BlcnRpZXMgKG9ubHkgdXNlZCB3aGVuIGNyZWF0aW5nIGEgbmV3IHF1ZXVlKVxuICAgICAqIFxuICAgICAqICoqTm90ZToqKiBJZ25vcmVkIHdoZW4gYGV4aXN0aW5nUXVldWVOYW1lYCBvciBgcXVldWVIYW5kbGVyUGF0aGAgaXMgcHJvdmlkZWRcbiAgICAgKi9cbiAgICBxdWV1ZVByb3BzPzogUXVldWVQcm9wcztcbiAgICAvKipcbiAgICAgKiBTUVMgZXZlbnQgc291cmNlIHByb3BlcnRpZXMgZm9yIHNlYXJjaCBpbmRleGluZ1xuICAgICAqL1xuICAgIHNxc0V2ZW50U291cmNlUHJvcHM/OiBTcXNFdmVudFNvdXJjZVByb3BzO1xufVxuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIGNvbmZpZ3VyYXRpb24gZm9yIGEgRHluYW1vREIgdGFibGUuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSUR5bmFtb0RCQ29uZmlnIGV4dGVuZHMgSUNvbnN0cnVjdENvbmZpZyB7XG4gICAgdGFibGU6IHtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIFRoZSBuYW1lIG9mIHRoZSBEeW5hbW9EQiB0YWJsZS5cbiAgICAgICAgICovXG4gICAgICAgIG5hbWU6IHN0cmluZztcbiAgICAgICAgLyoqXG4gICAgICAgICAqIFRoZSBwcm9wZXJ0aWVzIGZvciB0aGUgRHluYW1vREIgdGFibGUuXG4gICAgICAgICAqL1xuICAgICAgICBwcm9wczogVGFibGVQcm9wc1YyO1xuICAgICAgICAvKipcbiAgICAgICAgICogU3RyZWFtIHByb2Nlc3NpbmcgY29uZmlndXJhdGlvblxuICAgICAgICAgKi9cbiAgICAgICAgc3RyZWFtPzoge1xuICAgICAgICAgICAgLyoqXG4gICAgICAgICAgICAgKiBFbmFibGUgc3RyZWFtIHByb2Nlc3NpbmdcbiAgICAgICAgICAgICAqL1xuICAgICAgICAgICAgZW5hYmxlZD86IGJvb2xlYW47XG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICAqIFNOUyB0b3BpYyBjb25maWd1cmF0aW9uIGZvciBzdHJlYW0gZXZlbnRzXG4gICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIHRvcGljPzoge1xuICAgICAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICAgICAqIFRvcGljIG5hbWUuIERlZmF1bHRzIHRvIHt0YWJsZU5hbWV9LXN0cmVhbVxuICAgICAgICAgICAgICAgICAqL1xuICAgICAgICAgICAgICAgIG5hbWU/OiBzdHJpbmc7XG4gICAgICAgICAgICAgICAgLyoqXG4gICAgICAgICAgICAgICAgICogVG9waWMgcHJvcGVydGllc1xuICAgICAgICAgICAgICAgICAqL1xuICAgICAgICAgICAgICAgIHByb3BzPzogVG9waWNQcm9wcztcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICAqIFN0cmVhbSBwcm9jZXNzb3IgTGFtYmRhIGNvbmZpZ3VyYXRpb25cbiAgICAgICAgICAgICAqL1xuICAgICAgICAgICAgcHJvY2Vzc29yPzogRHluYW1vRXZlbnRTb3VyY2VQcm9wcztcbiAgICAgICAgfTtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIEF1ZGl0IGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBEeW5hbW9EQiB0YWJsZS5cbiAgICAgICAgICovXG4gICAgICAgIGF1ZGl0PzogQXVkaXRDb25maWc7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBTZWFyY2ggaW5kZXhpbmcgY29uZmlndXJhdGlvbiBmb3IgdGhlIER5bmFtb0RCIHRhYmxlLlxuICAgICAgICAgKi9cbiAgICAgICAgc2VhcmNoSW5kZXhpbmc/OiBTZWFyY2hJbmRleGluZ0NvbmZpZ1tdO1xuICAgIH07XG59XG5cbi8qKlxuICogQHBhcmFtIGR5bmFtb0RCQ29uZmlnIFRoZSBjb25maWd1cmF0aW9uIG9iamVjdCBmb3IgRHluYW1vREIuXG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqIFxuICogY29uc3QgZHluYW1vREJDb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAqICAgdGFibGU6IHtcbiAqICAgICBuYW1lOiAnbXlUYWJsZScsXG4gKiAgICAgcHJvcHM6IHtcbiAqICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiAnU1RSSU5HJyB9LFxuICogICAgICAgc29ydEtleTogeyBuYW1lOiAndGltZXN0YW1wJywgdHlwZTogJ05VTUJFUicgfSxcbiAqICAgICAgIGJpbGxpbmdNb2RlOiAnUEFZX1BFUl9SRVFVRVNUJyxcbiAqICAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1lcbiAqICAgICB9XG4gKiAgIH1cbiAqIH07XG4gKiBcbiAqIGNvbnN0IGR5bmFtb0RCID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGR5bmFtb0RCQ29uZmlnKTtcbiAqIFxuICogYXBwLnVzZShkeW5hbW9EQik7XG4gKiBcbiAqIGBgYFxuICogXG4gKiBBdWRpdCBsb2dnaW5nICh2aWEgb2JzZXJ2YWJpbGl0eSBzeXN0ZW0pOlxuICogYGBgdHNcbiAqIGF1ZGl0OiB7XG4gKiAgIGVuYWJsZWQ6IHRydWUsXG4gKiAgIGFsbG93ZWRFbnRpdHlOYW1lczogWyd1c2VyJywgJ29yZGVyJywgJ3BheW1lbnQnXSxcbiAqICAgLy8gQmFja2VuZCByb3V0aW5nIGNvbmZpZ3VyZWQgdmlhIG9ic2VydmFiaWxpdHkgREkgbGF5ZXJcbiAqIH1cbiAqIGBgYFxuICogXG4gKiBDdXN0b20gYXVkaXQgcXVldWU6XG4gKiBgYGB0c1xuICogYXVkaXQ6IHtcbiAqICAgZW5hYmxlZDogdHJ1ZSxcbiAqICAgYWxsb3dlZEVudGl0eU5hbWVzOiBbJ3VzZXInLCAnb3JkZXInXSxcbiAqICAgcXVldWVOYW1lOiAnbXktY3VzdG9tLWF1ZGl0LXF1ZXVlJ1xuICogfVxuICogYGBgXG4gKiBcbiAqIEN1c3RvbSBzZWFyY2ggaW5kZXhpbmcgcXVldWU6XG4gKiBgYGB0c1xuICogc2VhcmNoSW5kZXhpbmc6IFt7XG4gKiAgIGVuYWJsZWQ6IHRydWUsXG4gKiAgIGVuZ2luZUNvbmZpZzoge1xuICogICAgIHR5cGU6ICdtZWlsaScsXG4gKiAgICAgaG9zdDogJ2h0dHBzOi8vbWVpbGlzZWFyY2guZXhhbXBsZS5jb20nLFxuICogICAgIG1hc3RlcktleTogJ21hc3Rlci1rZXknXG4gKiAgIH0sXG4gKiAgIHF1ZXVlTmFtZTogJ215LWN1c3RvbS1zZWFyY2gtcXVldWUnXG4gKiB9XVxuICogYGBgXG4gKiBcbiAqIEV4aXN0aW5nIGZyYW1ld29yay1tYW5hZ2VkIHNlYXJjaCBpbmRleGluZyBxdWV1ZTpcbiAqIGBgYHRzXG4gKiAvLyBGaXJzdCBkZWZpbmUgdGhlIHF1ZXVlIGhhbmRsZXI6XG4gKiAvLyBAUXVldWUoJ01laWxpc2VhcmNoU3luYycsIHsgc3Vic2NyaXB0aW9uczogeyB0b3BpY3M6IFt7IG5hbWU6ICdteVRhYmxlLXN0cmVhbScgfV0gfSB9KVxuICogLy8gZXhwb3J0IGNsYXNzIE1laWxpc2VhcmNoU3luYyBleHRlbmRzIEJhc2VTZWFyY2hJbmRleGVyIHsgLi4uIH1cbiAqIFxuICogc2VhcmNoSW5kZXhpbmc6IFt7XG4gKiAgIGVuYWJsZWQ6IHRydWUsXG4gKiAgIGVuZ2luZUNvbmZpZzoge1xuICogICAgIHR5cGU6ICdtZWlsaScsXG4gKiAgICAgaG9zdDogJ2h0dHBzOi8vbWVpbGlzZWFyY2guZXhhbXBsZS5jb20nLCBcbiAqICAgICBtYXN0ZXJLZXk6ICdtYXN0ZXIta2V5J1xuICogICB9LFxuICogICBleGlzdGluZ1F1ZXVlTmFtZTogJ01laWxpc2VhcmNoU3luYycgIC8vIFJlZmVyZW5jZXMgdGhlIEBRdWV1ZSgnTWVpbGlzZWFyY2hTeW5jJylcbiAqIH1dXG4gKiBgYGBcbiAqL1xuXG5cbi8qKlxuICogQ29uZmlndXJhdGlvbiBmb3IgYXVkaXQgbG9nZ2luZyB2aWEgRHluYW1vREIgc3RyZWFtcy5cbiAqIFxuICogQXVkaXQgZXZlbnRzIGFyZSBjYXB0dXJlZCBieSB0aGUgb2JzZXJ2YWJpbGl0eSBzeXN0ZW0gLSB0aGlzIGNvbmZpZyBvbmx5IGNvbnRyb2xzOlxuICogLSBXaGljaCBlbnRpdGllcyB0byBhdWRpdCAoZW50aXR5IGZpbHRlcmluZylcbiAqIC0gU3RyZWFtIHByb2Nlc3NpbmcgcXVldWUgY29uZmlndXJhdGlvblxuICogXG4gKiBCYWNrZW5kIHJvdXRpbmcgKER5bmFtb0RCLCBDbG91ZFdhdGNoLCBPVEVMKSBpcyBjb25maWd1cmVkIHZpYSBvYnNlcnZhYmlsaXR5OlxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gSW4geW91ciBESSBsYXllcjpcbiAqIGltcG9ydCB7IGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWcgfSBmcm9tICdAdGVuMjRncm91cC9mdzI0L29ic2VydmFiaWxpdHknO1xuICogXG4gKiBESUNvbnRhaW5lci5ST09ULnJlZ2lzdGVyQ29uZmlnUHJvdmlkZXIoe1xuICogICBwcm92aWRlOiAnb2JzZXJ2YWJpbGl0eScsXG4gKiAgIHVzZUNvbmZpZzogY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZyh7XG4gKiAgICAgYmFja2VuZHM6IFtcbiAqICAgICAgIHsgdHlwZTogJ2R5bmFtb2RiJ30sXG4gKiAgICAgICB7IHR5cGU6ICdjbG91ZHdhdGNoJ31cbiAqICAgICBdXG4gKiAgIH0pLFxuICogICBwcmlvcml0eTogMTBcbiAqIH0pO1xuICogYGBgXG4gKi9cbmludGVyZmFjZSBBdWRpdENvbmZpZyBleHRlbmRzIElDb25zdHJ1Y3RDb25maWcge1xuICAgIC8qKlxuICAgICAqIFdoZXRoZXIgdG8gZW5hYmxlIGF1ZGl0IGxvZ2dpbmcgZm9yIER5bmFtb0RCIHN0cmVhbXMuXG4gICAgICogQGRlZmF1bHQgZmFsc2VcbiAgICAgKi9cbiAgICBlbmFibGVkPzogYm9vbGVhbjtcblxuICAgIC8qKlxuICAgICAqIExpc3Qgb2YgYWxsb3dlZCBlbnRpdHkgbmFtZXMgdG8gYmUgYXVkaXRlZC5cbiAgICAgKiBJZiBub3QgcHJvdmlkZWQsIGFsbCBlbnRpdGllcyB3aWxsIGJlIGF1ZGl0ZWQgZXhjZXB0IHRob3NlIGluIGV4Y2x1ZGVkRW50aXR5TmFtZXMgb3Igc3lzdGVtIGVudGl0aWVzLlxuICAgICAqIFRha2VzIHByZWNlZGVuY2Ugb3ZlciBleGNsdWRlZEVudGl0eU5hbWVzIGlmIGJvdGggYXJlIHByb3ZpZGVkLlxuICAgICAqL1xuICAgIGFsbG93ZWRFbnRpdHlOYW1lcz86IHN0cmluZ1tdO1xuXG4gICAgLyoqXG4gICAgICogTGlzdCBvZiBlbnRpdHkgbmFtZXMgdG8gZXhjbHVkZSBmcm9tIGF1ZGl0aW5nLlxuICAgICAqIElmIGFsbG93ZWRFbnRpdHlOYW1lcyBpcyBwcm92aWRlZCwgdGhpcyBmaWVsZCBpcyBpZ25vcmVkLlxuICAgICAqIElmIG5laXRoZXIgYWxsb3dlZEVudGl0eU5hbWVzIG5vciBleGNsdWRlZEVudGl0eU5hbWVzIGlzIHByb3ZpZGVkLCBcbiAgICAgKiBkZWZhdWx0cyB0byBleGNsdWRpbmcgc3lzdGVtIGVudGl0aWVzIGxpa2UgJ2F1ZGl0TG9nJyBhbmQgJ29ic2VydmFiaWxpdHlMb2cnLlxuICAgICAqL1xuICAgIGV4Y2x1ZGVkRW50aXR5TmFtZXM/OiBzdHJpbmdbXTtcblxuICAgIC8qKlxuICAgICAqIEN1c3RvbSBmdW5jdGlvbiBwcm9wZXJ0aWVzIGZvciB0aGUgYXVkaXQgTGFtYmRhLlxuICAgICAqIEFsbG93cyBvdmVycmlkaW5nIGZ1bmN0aW9uIGNvbmZpZ3VyYXRpb24gbGlrZSBWUEMsIG1lbW9yeSwgdGltZW91dCwgZXRjLlxuICAgICAqL1xuICAgIGZ1bmN0aW9uUHJvcHM/OiBOb2RlanNGdW5jdGlvblByb3BzO1xuXG4gICAgLyoqXG4gICAgICogQ3VzdG9tIHF1ZXVlIG5hbWUgZm9yIGNyZWF0aW5nIGEgbmV3IGF1ZGl0IHF1ZXVlLlxuICAgICAqIElmIG5vdCBwcm92aWRlZCwgZGVmYXVsdHMgdG8gYCR7dGFibGVOYW1lfS1lbnRpdHktYXVkaXRgXG4gICAgICovXG4gICAgcXVldWVOYW1lPzogc3RyaW5nO1xuXG4gICAgLyoqXG4gICAgICogTmFtZSBvZiBhbiBleGlzdGluZyBmcmFtZXdvcmstbWFuYWdlZCBxdWV1ZSB0byB1c2UgZm9yIGF1ZGl0IHByb2Nlc3NpbmcuXG4gICAgICogVGhlIGV4aXN0aW5nIHF1ZXVlIG11c3QgYmUgZGVmaW5lZCB3aXRoIEBRdWV1ZSBkZWNvcmF0b3IgYW5kIHN1YnNjcmliZSB0byB0aGUgc3RyZWFtIHRvcGljLlxuICAgICAqL1xuICAgIGV4aXN0aW5nUXVldWVOYW1lPzogc3RyaW5nO1xuXG4gICAgLyoqXG4gICAgICogUGF0aCB0byBxdWV1ZSBoYW5kbGVyIGZpbGUgZm9yIG1hbnVhbCByZWdpc3RyYXRpb24uXG4gICAgICogVGhlIHF1ZXVlIGhhbmRsZXIgbXVzdCBoYXZlIGBtYW51YWxSZWdpc3RyYXRpb246IHRydWVgIGluIGl0cyBAUXVldWUgY29uZmlnLlxuICAgICAqL1xuICAgIHF1ZXVlSGFuZGxlclBhdGg/OiBzdHJpbmc7XG5cbiAgICAvKipcbiAgICAgKiBBdWRpdCBxdWV1ZSBwcm9wZXJ0aWVzIChvbmx5IHVzZWQgd2hlbiBjcmVhdGluZyBhIG5ldyBxdWV1ZSlcbiAgICAgKi9cbiAgICBxdWV1ZVByb3BzPzogUXVldWVQcm9wcztcblxuICAgIC8qKlxuICAgICAqIFNRUyBldmVudCBzb3VyY2UgcHJvcGVydGllc1xuICAgICAqL1xuICAgIHNxc0V2ZW50U291cmNlUHJvcHM/OiBTcXNFdmVudFNvdXJjZVByb3BzO1xufVxuXG5leHBvcnQgY2xhc3MgRHluYW1vREJDb25zdHJ1Y3QgaW1wbGVtZW50cyBGVzI0Q29uc3RydWN0IHtcbiAgICByZWFkb25seSBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoRHluYW1vREJDb25zdHJ1Y3QubmFtZSk7XG4gICAgcmVhZG9ubHkgZncyNDogRncyNCA9IEZ3MjQuZ2V0SW5zdGFuY2UoKTtcblxuICAgIG5hbWU6IHN0cmluZyA9IER5bmFtb0RCQ29uc3RydWN0Lm5hbWU7XG4gICAgZGVwZW5kZW5jaWVzOiBzdHJpbmdbXSA9IFsgTGF5ZXJDb25zdHJ1Y3QubmFtZSBdOyAgLy8gV2FpdCBmb3IgbGF5ZXJzIHNvIGVudHJ5IHBhY2thZ2VzIGFyZSByZWdpc3RlcmVkXG4gICAgb3V0cHV0ITogRlcyNENvbnN0cnVjdE91dHB1dDtcblxuICAgIG1haW5TdGFjayE6IFN0YWNrO1xuXG4gICAgLyoqXG4gICAgICogQ29uc3RydWN0cyBhIG5ldyBpbnN0YW5jZSBvZiB0aGUgRHluYW1vREIgY2xhc3MuXG4gICAgICogQHBhcmFtIGR5bmFtb0RCQ29uZmlnIFRoZSBjb25maWd1cmF0aW9uIG9iamVjdCBmb3IgRHluYW1vREIuXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBjb25zdCBkeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgKiAgIHJlZ2lvbjogJ3VzLXdlc3QtMicsXG4gICAgICogICB0YWJsZU5hbWU6ICdteVRhYmxlJ1xuICAgICAqIH07XG4gICAgICogY29uc3QgZHluYW1vREIgPSBuZXcgRHluYW1vREIoZHluYW1vREJDb25maWcpO1xuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgZHluYW1vREJDb25maWc6IElEeW5hbW9EQkNvbmZpZykgeyB9XG5cbiAgICAvLyBjb25zdHJ1Y3QgbWV0aG9kIHRvIGNyZWF0ZSB0aGUgc3RhY2tcbiAgICBATG9nRHVyYXRpb24oKVxuICAgIHB1YmxpYyBhc3luYyBjb25zdHJ1Y3QoKSB7XG4gICAgICAgIGNvbnN0IGZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG4gICAgICAgIHRoaXMubWFpblN0YWNrID0gZncyNC5nZXRTdGFjayh0aGlzLmR5bmFtb0RCQ29uZmlnLnN0YWNrTmFtZSwgdGhpcy5keW5hbW9EQkNvbmZpZy5wYXJlbnRTdGFja05hbWUpO1xuICAgICAgICBjb25zdCBhcHBRdWFsaWZpZWRUYWJsZU5hbWUgPSBlbnN1cmVOb1NwZWNpYWxDaGFycyhlbnN1cmVTdWZmaXgodGhpcy5keW5hbW9EQkNvbmZpZy50YWJsZS5uYW1lLCBgdGFibGVgKSk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJhcHBRdWFsaWZpZWRUYWJsZU5hbWU6XCIsIGFwcFF1YWxpZmllZFRhYmxlTmFtZSk7XG5cbiAgICAgICAgLy8gU2VlIGh0dHBzOi8vZG9jcy5hd3MuYW1hem9uLmNvbS9jZGsvYXBpL3YyL2RvY3MvYXdzLWNkay1saWIuYXdzX2R5bmFtb2RiLXJlYWRtZS5odG1sXG4gICAgICAgIGNvbnN0IHRhYmxlSW5zdGFuY2UgPSBuZXcgVGFibGVWMih0aGlzLm1haW5TdGFjaywgYXBwUXVhbGlmaWVkVGFibGVOYW1lLCB0aGlzLmR5bmFtb0RCQ29uZmlnLnRhYmxlLnByb3BzKTtcblxuICAgICAgICAvLyBPdXRwdXQgdGhlIHRhYmxlIGluc3RhbmNlXG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgYXBwUXVhbGlmaWVkVGFibGVOYW1lLCB0YWJsZUluc3RhbmNlLCBPdXRwdXRUeXBlLlRBQkxFLCAndGFibGVOYW1lJyk7XG4gICAgICAgIHRoaXMuZncyNC5zZXRFbnZpcm9ubWVudFZhcmlhYmxlKGFwcFF1YWxpZmllZFRhYmxlTmFtZSwgdGFibGVJbnN0YW5jZS50YWJsZU5hbWUsICd0YWJsZScpO1xuXG4gICAgICAgIC8vIFJlZ2lzdGVyIHRoZSB0YWJsZSBpbnN0YW5jZSBhcyBhIGdsb2JhbCBjb250YWluZXJcbiAgICAgICAgZncyNC5hZGREeW5hbW9UYWJsZShhcHBRdWFsaWZpZWRUYWJsZU5hbWUsIHRhYmxlSW5zdGFuY2UpO1xuXG4gICAgICAgIGNvbnN0IGhhc0F1ZGl0RW5hYmxlZCA9IHRoaXMuZHluYW1vREJDb25maWcudGFibGUuYXVkaXQ/LmVuYWJsZWQ7XG4gICAgICAgIGNvbnN0IGhhc1NlYXJjaEluZGV4aW5nRW5hYmxlZCA9IHRoaXMuZHluYW1vREJDb25maWcudGFibGUuc2VhcmNoSW5kZXhpbmc/LnNvbWUoY29uZmlnID0+IGNvbmZpZy5lbmFibGVkKTtcbiAgICAgICAgY29uc3QgaGFzU3RyZWFtRW5hYmxlZCA9IHRoaXMuZHluYW1vREJDb25maWcudGFibGUuc3RyZWFtPy5lbmFibGVkO1xuXG4gICAgICAgIC8vIFRyYWNrIGNvbmZpZ3VyZWQgZmVhdHVyZXMgZm9yIHN1bW1hcnlcbiAgICAgICAgY29uc3QgZmVhdHVyZXM6IHN0cmluZ1tdID0gW107XG5cbiAgICAgICAgLy8gU2V0dXAgc3RyZWFtIHByb2Nlc3NpbmcgaWYgZW5hYmxlZCBvciBhdWRpdCBpcyBlbmFibGVkIG9yIHNlYXJjaCBpbmRleGluZyBpcyBlbmFibGVkIGFuZCBzdHJlYW0gQVJOIGV4aXN0c1xuICAgICAgICBpZiAoaGFzU3RyZWFtRW5hYmxlZCB8fCBoYXNBdWRpdEVuYWJsZWQgfHwgaGFzU2VhcmNoSW5kZXhpbmdFbmFibGVkKSB7XG4gICAgICAgICAgICBpZiAodGFibGVJbnN0YW5jZS50YWJsZVN0cmVhbUFybikge1xuICAgICAgICAgICAgICAgIHRoaXMuc2V0dXBTdHJlYW1Qcm9jZXNzaW5nKHRhYmxlSW5zdGFuY2UpO1xuICAgICAgICAgICAgICAgIGlmIChoYXNTdHJlYW1FbmFibGVkKSBmZWF0dXJlcy5wdXNoKCdzdHJlYW0nKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgU3RyZWFtIEFSTiBub3QgZm91bmQgZm9yIHRhYmxlICR7dGhpcy5keW5hbW9EQkNvbmZpZy50YWJsZS5uYW1lfSwgY2Fubm90IHNldCB1cCBzdHJlYW0gcHJvY2Vzc2luZ2ApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRoaXMuZHluYW1vREJDb25maWcudGFibGUuYXVkaXQ/LmVuYWJsZWQpIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuc2V0dXBBdWRpdFByb2Nlc3NpbmcodGhpcy5keW5hbW9EQkNvbmZpZy50YWJsZS5hdWRpdCwgdGFibGVJbnN0YW5jZSk7XG4gICAgICAgICAgICBmZWF0dXJlcy5wdXNoKCdhdWRpdCcpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGhhc1NlYXJjaEluZGV4aW5nRW5hYmxlZCkge1xuICAgICAgICAgICAgZm9yIChjb25zdCBjb25maWcgb2YgdGhpcy5keW5hbW9EQkNvbmZpZy50YWJsZS5zZWFyY2hJbmRleGluZyB8fCBbXSkge1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuc2V0dXBTZWFyY2hJbmRleGluZ1Byb2Nlc3NpbmcoY29uZmlnLCB0YWJsZUluc3RhbmNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGZlYXR1cmVzLnB1c2goJ3NlYXJjaC1pbmRleGluZycpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gU3VtbWFyeVxuICAgICAgICBpZiAoZmVhdHVyZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhg4pyFIFRhYmxlIFwiJHt0aGlzLmR5bmFtb0RCQ29uZmlnLnRhYmxlLm5hbWV9XCIgY29uZmlndXJlZCB3aXRoICR7ZmVhdHVyZXMubGVuZ3RofSBmZWF0dXJlKHMpOiAke2ZlYXR1cmVzLmpvaW4oJywgJyl9YCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGDinIUgVGFibGUgXCIke3RoaXMuZHluYW1vREJDb25maWcudGFibGUubmFtZX1cIiBjb25maWd1cmVkIChiYXNpYyBzZXR1cClgKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgZ2V0U3RyZWFtVG9waWNOYW1lKCk6IHN0cmluZyB7XG4gICAgICAgIHJldHVybiBgJHt0aGlzLmR5bmFtb0RCQ29uZmlnLnRhYmxlLm5hbWV9LXN0cmVhbWA7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBzZXR1cFN0cmVhbVByb2Nlc3NpbmcodGFibGVJbnN0YW5jZTogVGFibGVWMik6IHZvaWQge1xuICAgICAgICBjb25zdCBzdHJlYW1Db25maWcgPSB0aGlzLmR5bmFtb0RCQ29uZmlnLnRhYmxlLnN0cmVhbSB8fCB7fTtcblxuICAgICAgICAvLyBDcmVhdGUgU05TIHRvcGljIGZvciBzdHJlYW0gZXZlbnRzXG4gICAgICAgIGNvbnN0IHRvcGljTmFtZSA9IHN0cmVhbUNvbmZpZy50b3BpYz8ubmFtZSB8fCB0aGlzLmdldFN0cmVhbVRvcGljTmFtZSgpO1xuXG4gICAgICAgIGNvbnN0IGlzRmlmbyA9IHN0cmVhbUNvbmZpZy50b3BpYz8ucHJvcHM/LmZpZm8gPz8gZmFsc2U7XG4gICAgICAgIGNvbnN0IHN0cmVhbVRvcGljQ29uZmlnOiBJVG9waWNDb25zdHJ1Y3RDb25maWdbXSA9IFsge1xuICAgICAgICAgICAgdG9waWNOYW1lLFxuICAgICAgICAgICAgdG9waWNQcm9wczoge1xuICAgICAgICAgICAgICAgIGRpc3BsYXlOYW1lOiBgU3RyZWFtIGV2ZW50cyBmb3IgJHt0aGlzLmR5bmFtb0RCQ29uZmlnLnRhYmxlLm5hbWV9YCxcbiAgICAgICAgICAgICAgICBmaWZvOiBpc0ZpZm8sXG4gICAgICAgICAgICAgICAgLi4uc3RyZWFtQ29uZmlnLnRvcGljPy5wcm9wc1xuICAgICAgICAgICAgfVxuICAgICAgICB9IF07XG5cbiAgICAgICAgbmV3IFRvcGljQ29uc3RydWN0KHN0cmVhbVRvcGljQ29uZmlnKS5jb25zdHJ1Y3QoKTtcblxuICAgICAgICAvLyBDcmVhdGUgTGFtYmRhIHRvIHByb2Nlc3Mgc3RyZWFtIGFuZCBwdWJsaXNoIHRvIFNOU1xuICAgICAgICBjb25zdCBzdHJlYW1Qcm9jZXNzb3IgPSBuZXcgTGFtYmRhRnVuY3Rpb24odGhpcy5tYWluU3RhY2ssIGAke3RoaXMuZncyNC5hcHBOYW1lfS1zdHJlYW0tcHJvY2Vzc29yYCwge1xuICAgICAgICAgICAgZW50cnk6IGpvaW4oX19kaXJuYW1lLCAnLi4vY29yZS9ydW50aW1lL2R5bmFtb2RiLXN0cmVhbS1wcm9jZXNzb3IuanMnKSxcbiAgICAgICAgICAgIGVudmlyb25tZW50VmFyaWFibGVzOiB7XG4gICAgICAgICAgICAgICAgVE9QSUNfTkFNRTogdG9waWNOYW1lLFxuICAgICAgICAgICAgICAgIFRPUElDX1RZUEU6IGlzRmlmbyA/ICdmaWZvJyA6ICdzdGFuZGFyZCdcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICByZXNvdXJjZUFjY2Vzczoge1xuICAgICAgICAgICAgICAgIHRvcGljczogWyB7XG4gICAgICAgICAgICAgICAgICAgIG5hbWU6IHRvcGljTmFtZSxcbiAgICAgICAgICAgICAgICAgICAgYWNjZXNzOiBbICdwdWJsaXNoJyBdXG4gICAgICAgICAgICAgICAgfSBdXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pIGFzIE5vZGVqc0Z1bmN0aW9uO1xuXG4gICAgICAgIC8vIEdyYW50IHBlcm1pc3Npb25zIGFuZCBhZGQgZXZlbnQgc291cmNlXG4gICAgICAgIHRhYmxlSW5zdGFuY2UuZ3JhbnRTdHJlYW1SZWFkKHN0cmVhbVByb2Nlc3Nvcik7XG4gICAgICAgIHN0cmVhbVByb2Nlc3Nvci5hZGRFdmVudFNvdXJjZShuZXcgRHluYW1vRXZlbnRTb3VyY2UodGFibGVJbnN0YW5jZSwge1xuICAgICAgICAgICAgLi4uc3RyZWFtQ29uZmlnLnByb2Nlc3NvcixcbiAgICAgICAgICAgIHN0YXJ0aW5nUG9zaXRpb246IHN0cmVhbUNvbmZpZy5wcm9jZXNzb3I/LnN0YXJ0aW5nUG9zaXRpb24gPz8gU3RhcnRpbmdQb3NpdGlvbi5MQVRFU1QsXG4gICAgICAgICAgICBiYXRjaFNpemU6IHN0cmVhbUNvbmZpZy5wcm9jZXNzb3I/LmJhdGNoU2l6ZSA/PyA1LFxuICAgICAgICAgICAgYmlzZWN0QmF0Y2hPbkVycm9yOiBzdHJlYW1Db25maWcucHJvY2Vzc29yPy5iaXNlY3RCYXRjaE9uRXJyb3IgPz8gdHJ1ZSxcbiAgICAgICAgICAgIHJldHJ5QXR0ZW1wdHM6IHN0cmVhbUNvbmZpZy5wcm9jZXNzb3I/LnJldHJ5QXR0ZW1wdHMgPz8gM1xuICAgICAgICB9KSk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ1N0cmVhbSBwcm9jZXNzaW5nIHNldHVwIGNvbXBsZXRlZCBmb3IgdGFibGU6JywgdGhpcy5keW5hbW9EQkNvbmZpZy50YWJsZS5uYW1lKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIHNldHVwU3RyZWFtRXZlbnRDb25zdW1lcnMoXG4gICAgICAgIHRhYmxlSW5zdGFuY2U6IFRhYmxlVjIsXG4gICAgICAgIGNvbnN1bWVyTmFtZTogc3RyaW5nLFxuICAgICAgICBjb25maWc6IEF1ZGl0Q29uZmlnIHwgU2VhcmNoSW5kZXhpbmdDb25maWcsXG4gICAgICAgIGRlZmF1bHRIYW5kbGVyRW50cnk6IHN0cmluZyxcbiAgICAgICAgZW52aXJvbm1lbnRWYXJpYWJsZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sXG4gICAgICAgIHJlc291cmNlQWNjZXNzPzogYW55LFxuICAgICk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBpZiAoIXRhYmxlSW5zdGFuY2UudGFibGVTdHJlYW1Bcm4pIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYFN0cmVhbSBBUk4gbm90IGZvdW5kIGZvciB0YWJsZSAke3RoaXMuZHluYW1vREJDb25maWcudGFibGUubmFtZX0sIGNhbm5vdCBzZXQgdXAgJHtjb25zdW1lck5hbWV9YCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBxdWV1ZUNvbmZpZyA9IHRoaXMuZXh0cmFjdFF1ZXVlQ29uZmlnKGNvbmZpZyk7XG5cbiAgICAgICAgLy8gVmFsaWRhdGUgY29uZmlndXJhdGlvblxuICAgICAgICB0aGlzLnZhbGlkYXRlUXVldWVDb25maWcoY29uZmlnLCBjb25zdW1lck5hbWUpO1xuXG4gICAgICAgIGlmIChxdWV1ZUNvbmZpZy50eXBlID09PSAnaGFuZGxlcicpIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuc2V0dXBXaXRoUXVldWVIYW5kbGVyKHF1ZXVlQ29uZmlnLnF1ZXVlSGFuZGxlclBhdGgsIGNvbnN1bWVyTmFtZSwgZW52aXJvbm1lbnRWYXJpYWJsZXMsIHF1ZXVlQ29uZmlnLmZ1bmN0aW9uUHJvcHMpO1xuICAgICAgICB9IGVsc2UgaWYgKHF1ZXVlQ29uZmlnLnR5cGUgPT09ICdleGlzdGluZycpIHtcbiAgICAgICAgICAgIHRoaXMuc2V0dXBXaXRoRXhpc3RpbmdRdWV1ZShxdWV1ZUNvbmZpZy5leGlzdGluZ1F1ZXVlTmFtZSwgY29uc3VtZXJOYW1lKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnN0IGNvbW1vbkNvbmZpZyA9IHRoaXMuYnVpbGRDb21tb25MYW1iZGFDb25maWcoZGVmYXVsdEhhbmRsZXJFbnRyeSwgZW52aXJvbm1lbnRWYXJpYWJsZXMsIHJlc291cmNlQWNjZXNzLCBxdWV1ZUNvbmZpZy5mdW5jdGlvblByb3BzKTtcbiAgICAgICAgICAgIHRoaXMuc2V0dXBXaXRoTmV3UXVldWUocXVldWVDb25maWcsIGNvbnN1bWVyTmFtZSwgY29tbW9uQ29uZmlnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGAke2NvbnN1bWVyTmFtZX0gc2V0dXAgY29tcGxldGVkIGZvciB0YWJsZTpgLCB0aGlzLmR5bmFtb0RCQ29uZmlnLnRhYmxlLm5hbWUpO1xuICAgIH1cblxuICAgIHByaXZhdGUgdmFsaWRhdGVRdWV1ZUNvbmZpZyhjb25maWc6IEF1ZGl0Q29uZmlnIHwgU2VhcmNoSW5kZXhpbmdDb25maWcsIGNvbnN1bWVyTmFtZTogc3RyaW5nKTogdm9pZCB7XG4gICAgICAgIGNvbnN0IGlzU2VhcmNoQ29uZmlnID0gJ2VuZ2luZUNvbmZpZycgaW4gY29uZmlnO1xuXG4gICAgICAgIGlmIChpc1NlYXJjaENvbmZpZykge1xuICAgICAgICAgICAgY29uc3Qgc2VhcmNoQ29uZmlnID0gY29uZmlnO1xuICAgICAgICAgICAgaWYgKHNlYXJjaENvbmZpZy5leGlzdGluZ1F1ZXVlTmFtZSkge1xuICAgICAgICAgICAgICAgIGlmIChzZWFyY2hDb25maWcucXVldWVOYW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYCR7Y29uc3VtZXJOYW1lfTogQm90aCAnZXhpc3RpbmdRdWV1ZU5hbWUnIGFuZCAncXVldWVOYW1lJyBwcm92aWRlZC4gVXNpbmcgZXhpc3RpbmcgcXVldWUgJyR7c2VhcmNoQ29uZmlnLmV4aXN0aW5nUXVldWVOYW1lfScsIGlnbm9yaW5nIHF1ZXVlTmFtZS5gKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKHNlYXJjaENvbmZpZy5xdWV1ZVByb3BzKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYCR7Y29uc3VtZXJOYW1lfTogJ3F1ZXVlUHJvcHMnIHByb3ZpZGVkIHdpdGggJ2V4aXN0aW5nUXVldWVOYW1lJy4gUXVldWUgcHJvcGVydGllcyBhcmUgaWdub3JlZCB3aGVuIHVzaW5nIGV4aXN0aW5nIHF1ZXVlcy5gKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKHNlYXJjaENvbmZpZy5mdW5jdGlvblByb3BzKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYCR7Y29uc3VtZXJOYW1lfTogJ2Z1bmN0aW9uUHJvcHMnIHByb3ZpZGVkIHdpdGggJ2V4aXN0aW5nUXVldWVOYW1lJy4gRnVuY3Rpb24gcHJvcGVydGllcyBhcmUgaWdub3JlZCB3aGVuIHVzaW5nIGV4aXN0aW5nIHF1ZXVlcyAodGhleSBoYXZlIHRoZWlyIG93biBoYW5kbGVycykuYCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc3QgYXVkaXRDb25maWcgPSBjb25maWc7XG4gICAgICAgICAgICBpZiAoYXVkaXRDb25maWcuZXhpc3RpbmdRdWV1ZU5hbWUpIHtcbiAgICAgICAgICAgICAgICBpZiAoYXVkaXRDb25maWcucXVldWVOYW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYCR7Y29uc3VtZXJOYW1lfTogQm90aCAnZXhpc3RpbmdRdWV1ZU5hbWUnIGFuZCAncXVldWVOYW1lJyBwcm92aWRlZC4gVXNpbmcgZXhpc3RpbmcgcXVldWUgJyR7YXVkaXRDb25maWcuZXhpc3RpbmdRdWV1ZU5hbWV9JywgaWdub3JpbmcgcXVldWVOYW1lLmApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoYXVkaXRDb25maWcucXVldWVQcm9wcykge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGAke2NvbnN1bWVyTmFtZX06ICdxdWV1ZVByb3BzJyBwcm92aWRlZCB3aXRoICdleGlzdGluZ1F1ZXVlTmFtZScuIFF1ZXVlIHByb3BlcnRpZXMgYXJlIGlnbm9yZWQgd2hlbiB1c2luZyBleGlzdGluZyBxdWV1ZXMuYCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChhdWRpdENvbmZpZy5mdW5jdGlvblByb3BzKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYCR7Y29uc3VtZXJOYW1lfTogJ2Z1bmN0aW9uUHJvcHMnIHByb3ZpZGVkIHdpdGggJ2V4aXN0aW5nUXVldWVOYW1lJy4gRnVuY3Rpb24gcHJvcGVydGllcyBhcmUgaWdub3JlZCB3aGVuIHVzaW5nIGV4aXN0aW5nIHF1ZXVlcyAodGhleSBoYXZlIHRoZWlyIG93biBoYW5kbGVycykuYCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBleHRyYWN0UXVldWVDb25maWcoY29uZmlnOiBBdWRpdENvbmZpZyB8IFNlYXJjaEluZGV4aW5nQ29uZmlnKTogUXVldWVDb25maWcge1xuICAgICAgICAvLyBTZWFyY2hJbmRleGluZ0NvbmZpZyBpcyBkaXN0aW5ndWlzaGVkIGJ5IGhhdmluZyBlbmdpbmVDb25maWcgKHJlcXVpcmVkIGZpZWxkKVxuICAgICAgICBjb25zdCBpc1NlYXJjaENvbmZpZyA9ICdlbmdpbmVDb25maWcnIGluIGNvbmZpZztcblxuICAgICAgICBpZiAoaXNTZWFyY2hDb25maWcpIHtcbiAgICAgICAgICAgIGNvbnN0IHNlYXJjaENvbmZpZyA9IGNvbmZpZztcblxuICAgICAgICAgICAgaWYgKCdxdWV1ZUhhbmRsZXJQYXRoJyBpbiBzZWFyY2hDb25maWcgJiYgc2VhcmNoQ29uZmlnLnF1ZXVlSGFuZGxlclBhdGgpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnaGFuZGxlcicsXG4gICAgICAgICAgICAgICAgICAgIHF1ZXVlSGFuZGxlclBhdGg6IHNlYXJjaENvbmZpZy5xdWV1ZUhhbmRsZXJQYXRoLFxuICAgICAgICAgICAgICAgICAgICBmdW5jdGlvblByb3BzOiBzZWFyY2hDb25maWcuZnVuY3Rpb25Qcm9wcyxcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfSBlbHNlIGlmICgnZXhpc3RpbmdRdWV1ZU5hbWUnIGluIHNlYXJjaENvbmZpZyAmJiBzZWFyY2hDb25maWcuZXhpc3RpbmdRdWV1ZU5hbWUpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnZXhpc3RpbmcnLFxuICAgICAgICAgICAgICAgICAgICBleGlzdGluZ1F1ZXVlTmFtZTogc2VhcmNoQ29uZmlnLmV4aXN0aW5nUXVldWVOYW1lLFxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIHR5cGU6ICduZXcnLFxuICAgICAgICAgICAgICAgICAgICBmdW5jdGlvblByb3BzOiBzZWFyY2hDb25maWcuZnVuY3Rpb25Qcm9wcyxcbiAgICAgICAgICAgICAgICAgICAgcXVldWVQcm9wczogc2VhcmNoQ29uZmlnLnF1ZXVlUHJvcHMsXG4gICAgICAgICAgICAgICAgICAgIHNxc0V2ZW50U291cmNlUHJvcHM6IHNlYXJjaENvbmZpZy5zcXNFdmVudFNvdXJjZVByb3BzLFxuICAgICAgICAgICAgICAgICAgICBjdXN0b21RdWV1ZU5hbWU6IHNlYXJjaENvbmZpZy5xdWV1ZU5hbWUsXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIEF1ZGl0Q29uZmlnXG4gICAgICAgICAgICBjb25zdCBhdWRpdENvbmZpZyA9IGNvbmZpZztcblxuICAgICAgICAgICAgaWYgKGF1ZGl0Q29uZmlnLnF1ZXVlSGFuZGxlclBhdGgpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnaGFuZGxlcicsXG4gICAgICAgICAgICAgICAgICAgIHF1ZXVlSGFuZGxlclBhdGg6IGF1ZGl0Q29uZmlnLnF1ZXVlSGFuZGxlclBhdGgsXG4gICAgICAgICAgICAgICAgICAgIGZ1bmN0aW9uUHJvcHM6IGF1ZGl0Q29uZmlnLmZ1bmN0aW9uUHJvcHMsXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoYXVkaXRDb25maWcuZXhpc3RpbmdRdWV1ZU5hbWUpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnZXhpc3RpbmcnLFxuICAgICAgICAgICAgICAgICAgICBleGlzdGluZ1F1ZXVlTmFtZTogYXVkaXRDb25maWcuZXhpc3RpbmdRdWV1ZU5hbWUsXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ25ldycsXG4gICAgICAgICAgICAgICAgICAgIGZ1bmN0aW9uUHJvcHM6IGF1ZGl0Q29uZmlnLmZ1bmN0aW9uUHJvcHMsXG4gICAgICAgICAgICAgICAgICAgIHF1ZXVlUHJvcHM6IGF1ZGl0Q29uZmlnLnF1ZXVlUHJvcHMsXG4gICAgICAgICAgICAgICAgICAgIHNxc0V2ZW50U291cmNlUHJvcHM6IGF1ZGl0Q29uZmlnLnNxc0V2ZW50U291cmNlUHJvcHMsXG4gICAgICAgICAgICAgICAgICAgIGN1c3RvbVF1ZXVlTmFtZTogYXVkaXRDb25maWcucXVldWVOYW1lLFxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGJ1aWxkQ29tbW9uTGFtYmRhQ29uZmlnKFxuICAgICAgICBkZWZhdWx0SGFuZGxlckVudHJ5OiBzdHJpbmcsXG4gICAgICAgIGVudmlyb25tZW50VmFyaWFibGVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+LFxuICAgICAgICByZXNvdXJjZUFjY2VzczogYW55LFxuICAgICAgICBmdW5jdGlvblByb3BzPzogTm9kZWpzRnVuY3Rpb25Qcm9wc1xuICAgICk6IExhbWJkYUZ1bmN0aW9uUHJvcHMge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgZW50cnk6IGRlZmF1bHRIYW5kbGVyRW50cnksXG4gICAgICAgICAgICBlbnZpcm9ubWVudFZhcmlhYmxlcyxcbiAgICAgICAgICAgIHJlc291cmNlQWNjZXNzLFxuICAgICAgICAgICAgZnVuY3Rpb25Qcm9wcyxcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHNldHVwV2l0aEV4aXN0aW5nUXVldWUoXG4gICAgICAgIGV4aXN0aW5nUXVldWVOYW1lOiBzdHJpbmcsXG4gICAgICAgIGNvbnN1bWVyTmFtZTogc3RyaW5nXG4gICAgKTogdm9pZCB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFVzaW5nIGV4aXN0aW5nIGZyYW1ld29yayBxdWV1ZSAnJHtleGlzdGluZ1F1ZXVlTmFtZX0nIGZvciAke2NvbnN1bWVyTmFtZX0uIFRoZSBxdWV1ZSBtdXN0IGJlIGNvbmZpZ3VyZWQgdG8gc3Vic2NyaWJlIHRvIHRvcGljICcke3RoaXMuZ2V0U3RyZWFtVG9waWNOYW1lKCl9JyBpbiBpdHMgQFF1ZXVlIHNldHVwLmApO1xuXG4gICAgICAgIC8vIEp1c3QgdmFsaWRhdGUgdGhlIHF1ZXVlIGV4aXN0cyAtIERPTidUIG1vZGlmeSBpdCBvciBzdWJzY3JpYmUgaXQgdG8gYW55dGhpbmdcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHRoaXMuZncyNC5nZXRRdWV1ZUJ5TmFtZShcbiAgICAgICAgICAgICAgICBleGlzdGluZ1F1ZXVlTmFtZSxcbiAgICAgICAgICAgICAgICB0aGlzLm1haW5TdGFjayxcbiAgICAgICAgICAgICAgICBgJHt0aGlzLmZ3MjQuYXBwTmFtZX0tJHtjb25zdW1lck5hbWV9LWV4aXN0aW5nYFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYCR7Y29uc3VtZXJOYW1lfSB2YWxpZGF0aW9uIGNvbXBsZXRlZCAtIGV4aXN0aW5nIHF1ZXVlICR7ZXhpc3RpbmdRdWV1ZU5hbWV9IGZvdW5kIGZvciB0YWJsZTpgLCB0aGlzLmR5bmFtb0RCQ29uZmlnLnRhYmxlLm5hbWUpO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYFF1ZXVlICcke2V4aXN0aW5nUXVldWVOYW1lfScgbm90IGZvdW5kIGZvciAke2NvbnN1bWVyTmFtZX0uIEVuc3VyZSBpdCdzIGRlZmluZWQgd2l0aCBAUXVldWUoJyR7ZXhpc3RpbmdRdWV1ZU5hbWV9JykgZGVjb3JhdG9yLmApO1xuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIHNldHVwV2l0aFF1ZXVlSGFuZGxlcihcbiAgICAgICAgcXVldWVIYW5kbGVyUGF0aDogc3RyaW5nLFxuICAgICAgICBjb25zdW1lck5hbWU6IHN0cmluZyxcbiAgICAgICAgZW52aXJvbm1lbnRWYXJpYWJsZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sXG4gICAgICAgIGZ1bmN0aW9uUHJvcHM/OiBOb2RlanNGdW5jdGlvblByb3BzXG4gICAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYExvYWRpbmcgcXVldWUgaGFuZGxlciBmcm9tOiAke3F1ZXVlSGFuZGxlclBhdGh9YCk7XG5cbiAgICAgICAgLy8gRHluYW1pYyBpbXBvcnQgKHNhbWUgcGF0dGVybiBhcyBRdWV1ZUNvbnN0cnVjdCB1c2VzIHZpYSBIZWxwZXIucmVnaXN0ZXJIYW5kbGVycylcbiAgICAgICAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZShxdWV1ZUhhbmRsZXJQYXRoKTtcbiAgICAgICAgY29uc3QgcXVldWVNb2R1bGUgPSBhd2FpdCBpbXBvcnQoYWJzb2x1dGVQYXRoKTtcblxuICAgICAgICAvLyBGaW5kIHF1ZXVlIGNsYXNzIChzYW1lIGxvZ2ljIGFzIEhlbHBlci5yZWdpc3RlckhhbmRsZXJzKVxuICAgICAgICBsZXQgUXVldWVDbGFzczogKG5ldyAoLi4uYXJnczogYW55W10pID0+IGFueSkgfCB1bmRlZmluZWQ7XG4gICAgICAgIGZvciAoY29uc3QgZXhwb3J0ZWRJdGVtIG9mIE9iamVjdC52YWx1ZXMocXVldWVNb2R1bGUpKSB7XG4gICAgICAgICAgICBpZiAodHlwZW9mIGV4cG9ydGVkSXRlbSA9PT0gXCJmdW5jdGlvblwiICYmIGV4cG9ydGVkSXRlbS5uYW1lICE9PSBcImhhbmRsZXJcIikge1xuICAgICAgICAgICAgICAgIFF1ZXVlQ2xhc3MgPSBleHBvcnRlZEl0ZW0gYXMgbmV3ICguLi5hcmdzOiBhbnlbXSkgPT4gYW55O1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFRdWV1ZUNsYXNzKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHF1ZXVlIGNsYXNzIGZvdW5kIGluICR7cXVldWVIYW5kbGVyUGF0aH1gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEluc3RhbnRpYXRlIHRvIGdldCBjb25maWcgKHNhbWUgYXMgUXVldWVDb25zdHJ1Y3QgZG9lcylcbiAgICAgICAgY29uc3QgaGFuZGxlckluc3RhbmNlID0gbmV3IFF1ZXVlQ2xhc3MoKTtcbiAgICAgICAgY29uc3QgcXVldWVOYW1lID0gaGFuZGxlckluc3RhbmNlLnF1ZXVlTmFtZTtcbiAgICAgICAgY29uc3QgcXVldWVDb25maWcgPSBoYW5kbGVySW5zdGFuY2UucXVldWVDb25maWcgfHwge307XG5cbiAgICAgICAgLy8gVmFsaWRhdGUgbWFudWFsIHJlZ2lzdHJhdGlvbiBmbGFnXG4gICAgICAgIGlmICghcXVldWVDb25maWcubWFudWFsUmVnaXN0cmF0aW9uKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgICAgICAgYFF1ZXVlICcke3F1ZXVlTmFtZX0nIG11c3QgaGF2ZSBtYW51YWxSZWdpc3RyYXRpb246IHRydWUgaW4gaXRzIEBRdWV1ZSBjb25maWcgdG8gdXNlIHF1ZXVlSGFuZGxlclBhdGhgXG4gICAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgQ3JlYXRpbmcgcXVldWUgJHtxdWV1ZU5hbWV9IGZvciAke2NvbnN1bWVyTmFtZX1gKTtcblxuICAgICAgICAvLyBNZXJnZSBlbnZpcm9ubWVudCB2YXJpYWJsZXNcbiAgICAgICAgY29uc3QgbWVyZ2VkRW52VmFycyA9IHtcbiAgICAgICAgICAgIC4uLmVudmlyb25tZW50VmFyaWFibGVzLFxuICAgICAgICAgICAgLi4udGhpcy5mdzI0LnJlc29sdmVFbnZWYXJpYWJsZXMocXVldWVDb25maWcuZW52KVxuICAgICAgICB9O1xuXG4gICAgICAgIC8vIE1lcmdlIGZ1bmN0aW9uIHByb3BzIChzYW1lIHBhdHRlcm4gYXMgUXVldWVDb25zdHJ1Y3QpXG4gICAgICAgIC8vIGZ1bmN0aW9uUHJvcHMgZnJvbSBzZWFyY2hJbmRleGluZy9hdWRpdCBjb25maWcgdGFrZSBwcmVjZWRlbmNlXG4gICAgICAgIGNvbnN0IG1lcmdlZEZ1bmN0aW9uUHJvcHMgPSB7IC4uLnF1ZXVlQ29uZmlnLmZ1bmN0aW9uUHJvcHMsIC4uLmZ1bmN0aW9uUHJvcHMgfTtcblxuICAgICAgICAvLyBDcmVhdGUgcXVldWUgKyBsYW1iZGEgKHNhbWUgcGF0dGVybiBhcyBRdWV1ZUNvbnN0cnVjdCwgYnV0IHdpdGggc3Vic2NyaXB0aW9uIHRvIHN0cmVhbSB0b3BpYylcbiAgICAgICAgY29uc3QgcXVldWUgPSBuZXcgUXVldWVMYW1iZGEodGhpcy5tYWluU3RhY2ssIGAke3F1ZXVlTmFtZX0tcXVldWVgLCB7XG4gICAgICAgICAgICBxdWV1ZU5hbWU6IHF1ZXVlTmFtZSxcbiAgICAgICAgICAgIHF1ZXVlUHJvcHM6IHF1ZXVlQ29uZmlnLnF1ZXVlUHJvcHMsXG4gICAgICAgICAgICB2aXNpYmlsaXR5VGltZW91dFNlY29uZHM6IHF1ZXVlQ29uZmlnLnZpc2liaWxpdHlUaW1lb3V0U2Vjb25kcyxcbiAgICAgICAgICAgIHJlY2VpdmVNZXNzYWdlV2FpdFRpbWVTZWNvbmRzOiBxdWV1ZUNvbmZpZy5yZWNlaXZlTWVzc2FnZVdhaXRUaW1lU2Vjb25kcyxcbiAgICAgICAgICAgIHJldGVudGlvblBlcmlvZERheXM6IHF1ZXVlQ29uZmlnLnJldGVudGlvblBlcmlvZERheXMsXG4gICAgICAgICAgICBtYXhSZWNlaXZlQ291bnQ6IHF1ZXVlQ29uZmlnLm1heFJlY2VpdmVDb3VudCxcbiAgICAgICAgICAgIHNxc0V2ZW50U291cmNlUHJvcHM6IHF1ZXVlQ29uZmlnLnNxc0V2ZW50U291cmNlUHJvcHMsXG4gICAgICAgICAgICBzdWJzY3JpcHRpb25zOiB7XG4gICAgICAgICAgICAgICAgdG9waWNzOiBbIHtcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogdGhpcy5nZXRTdHJlYW1Ub3BpY05hbWUoKSxcbiAgICAgICAgICAgICAgICAgICAgZmlsdGVyczogW10sXG4gICAgICAgICAgICAgICAgfSBdLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGxhbWJkYUZ1bmN0aW9uUHJvcHM6IHtcbiAgICAgICAgICAgICAgICBlbnRyeTogYWJzb2x1dGVQYXRoLFxuICAgICAgICAgICAgICAgIGVudmlyb25tZW50VmFyaWFibGVzOiBtZXJnZWRFbnZWYXJzLFxuICAgICAgICAgICAgICAgIHJlc291cmNlQWNjZXNzOiBxdWV1ZUNvbmZpZy5yZXNvdXJjZUFjY2VzcyxcbiAgICAgICAgICAgICAgICBmdW5jdGlvblByb3BzOiBtZXJnZWRGdW5jdGlvblByb3BzLFxuICAgICAgICAgICAgICAgIGZ1bmN0aW9uVGltZW91dDogcXVldWVDb25maWcuZnVuY3Rpb25UaW1lb3V0LFxuICAgICAgICAgICAgICAgIHBvbGljaWVzOiBxdWV1ZUNvbmZpZy5wb2xpY2llcyxcbiAgICAgICAgICAgICAgICBsb2dSZW1vdmFsUG9saWN5OiBxdWV1ZUNvbmZpZy5sb2dSZW1vdmFsUG9saWN5LFxuICAgICAgICAgICAgICAgIGxvZ1JldGVudGlvbkRheXM6IHF1ZXVlQ29uZmlnLmxvZ1JldGVudGlvbkRheXMsXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pIGFzIFF1ZXVlO1xuXG4gICAgICAgIC8vIFJlZ2lzdGVyIG91dHB1dCAoc2FtZSBhcyBRdWV1ZUNvbnN0cnVjdCBkb2VzKVxuICAgICAgICB0aGlzLmZ3MjQuc2V0Q29uc3RydWN0T3V0cHV0KHRoaXMsIHF1ZXVlTmFtZSwgcXVldWUsIE91dHB1dFR5cGUuUVVFVUUsICdxdWV1ZU5hbWUnKTtcblxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGAke2NvbnN1bWVyTmFtZX0gcXVldWUgY3JlYXRlZCBzdWNjZXNzZnVsbHk6ICR7cXVldWVOYW1lfWApO1xuICAgIH1cblxuICAgIHByaXZhdGUgc2V0dXBXaXRoTmV3UXVldWUoXG4gICAgICAgIHF1ZXVlQ29uZmlnOiBOZXdRdWV1ZUNvbmZpZyxcbiAgICAgICAgY29uc3VtZXJOYW1lOiBzdHJpbmcsXG4gICAgICAgIGxhbWJkYUNvbmZpZzogTGFtYmRhRnVuY3Rpb25Qcm9wc1xuICAgICk6IHZvaWQge1xuICAgICAgICBjb25zdCBxdWV1ZU5hbWUgPSBxdWV1ZUNvbmZpZy5jdXN0b21RdWV1ZU5hbWUgfHwgYCR7dGhpcy5keW5hbW9EQkNvbmZpZy50YWJsZS5uYW1lfS0ke2NvbnN1bWVyTmFtZX1gO1xuICAgICAgICBjb25zdCBldmVudFNvdXJjZVByb3BzID0gdGhpcy5idWlsZFNxc0V2ZW50U291cmNlUHJvcHMocXVldWVDb25maWcuc3FzRXZlbnRTb3VyY2VQcm9wcyk7XG5cbiAgICAgICAgbmV3IFF1ZXVlTGFtYmRhKHRoaXMubWFpblN0YWNrLCBgJHt0aGlzLmZ3MjQuYXBwTmFtZX0tJHtjb25zdW1lck5hbWV9LXF1ZXVlYCwge1xuICAgICAgICAgICAgcXVldWVOYW1lOiBxdWV1ZU5hbWUsXG4gICAgICAgICAgICBsYW1iZGFGdW5jdGlvblByb3BzOiBsYW1iZGFDb25maWcsXG4gICAgICAgICAgICBxdWV1ZVByb3BzOiBxdWV1ZUNvbmZpZy5xdWV1ZVByb3BzIHx8IHt9LFxuICAgICAgICAgICAgc3Vic2NyaXB0aW9uczoge1xuICAgICAgICAgICAgICAgIHRvcGljczogWyB7XG4gICAgICAgICAgICAgICAgICAgIG5hbWU6IHRoaXMuZ2V0U3RyZWFtVG9waWNOYW1lKCksXG4gICAgICAgICAgICAgICAgICAgIGZpbHRlcnM6IFtdLFxuICAgICAgICAgICAgICAgIH0gXSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBzcXNFdmVudFNvdXJjZVByb3BzOiBldmVudFNvdXJjZVByb3BzLFxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGJ1aWxkU3FzRXZlbnRTb3VyY2VQcm9wcyhjdXN0b21Qcm9wcz86IFNxc0V2ZW50U291cmNlUHJvcHMpOiBTcXNFdmVudFNvdXJjZVByb3BzIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGJhdGNoU2l6ZTogY3VzdG9tUHJvcHM/LmJhdGNoU2l6ZSB8fCA1LFxuICAgICAgICAgICAgbWF4QmF0Y2hpbmdXaW5kb3c6IGN1c3RvbVByb3BzPy5tYXhCYXRjaGluZ1dpbmRvdyB8fCBEdXJhdGlvbi5zZWNvbmRzKDUpLFxuICAgICAgICAgICAgcmVwb3J0QmF0Y2hJdGVtRmFpbHVyZXM6IGN1c3RvbVByb3BzPy5yZXBvcnRCYXRjaEl0ZW1GYWlsdXJlcyB8fCB0cnVlLFxuICAgICAgICAgICAgLi4uY3VzdG9tUHJvcHMsXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBzZXR1cEF1ZGl0UHJvY2Vzc2luZyhjb25maWc6IEF1ZGl0Q29uZmlnLCB0YWJsZUluc3RhbmNlOiBUYWJsZVYyKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIC8vIE9ubHkgZW50aXR5IGZpbHRlcmluZyBlbnYgdmFycyAtIG9ic2VydmFiaWxpdHkgaGFuZGxlcyBiYWNrZW5kIHJvdXRpbmdcbiAgICAgICAgY29uc3QgZW52VmFyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9O1xuXG4gICAgICAgIGlmIChjb25maWcuYWxsb3dlZEVudGl0eU5hbWVzICYmIGNvbmZpZy5hbGxvd2VkRW50aXR5TmFtZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgZW52VmFyc1sgQVVESVRfRU5WX0tFWVMuQUxMT1dFRF9FTlRJVFlfTkFNRVMgXSA9IGNvbmZpZy5hbGxvd2VkRW50aXR5TmFtZXMuam9pbignLCcpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGNvbmZpZy5leGNsdWRlZEVudGl0eU5hbWVzICYmIGNvbmZpZy5leGNsdWRlZEVudGl0eU5hbWVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIGVudlZhcnNbIEFVRElUX0VOVl9LRVlTLkVYQ0xVREVEX0VOVElUWV9OQU1FUyBdID0gY29uZmlnLmV4Y2x1ZGVkRW50aXR5TmFtZXMuam9pbignLCcpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gTm8gcmVzb3VyY2UgYWNjZXNzIG5lZWRlZCAtIG9ic2VydmFiaWxpdHkgc3lzdGVtIGhhbmRsZXMgaXRzIG93biB0YWJsZSBhY2Nlc3MgdmlhIGdsb2JhbCByZXNvdXJjZSBhY2Nlc3NcbiAgICAgICAgYXdhaXQgdGhpcy5zZXR1cFN0cmVhbUV2ZW50Q29uc3VtZXJzKFxuICAgICAgICAgICAgdGFibGVJbnN0YW5jZSxcbiAgICAgICAgICAgICdlbnRpdHktYXVkaXQnLFxuICAgICAgICAgICAgY29uZmlnLFxuICAgICAgICAgICAgam9pbihfX2Rpcm5hbWUsICcuLi9hdWRpdC9mdW5jdGlvbi9keW5hbW9kYi1zdHJlYW0taGFuZGxlci5qcycpLFxuICAgICAgICAgICAgZW52VmFycyxcbiAgICAgICAgICAgIHt9IC8vIE5vIGFkZGl0aW9uYWwgcmVzb3VyY2UgYWNjZXNzIC0gb2JzZXJ2YWJpbGl0eSBoYW5kbGVzIGl0XG4gICAgICAgICk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbygnQXVkaXQgcHJvY2Vzc2luZyBlbmFibGVkIChvYnNlcnZhYmlsaXR5LWJhY2tlZCknLCB7XG4gICAgICAgICAgICB0YWJsZTogdGhpcy5keW5hbW9EQkNvbmZpZy50YWJsZS5uYW1lLFxuICAgICAgICAgICAgYWxsb3dlZEVudGl0aWVzOiBjb25maWcuYWxsb3dlZEVudGl0eU5hbWVzLFxuICAgICAgICAgICAgZXhjbHVkZWRFbnRpdGllczogY29uZmlnLmV4Y2x1ZGVkRW50aXR5TmFtZXNcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBzZXR1cFNlYXJjaEluZGV4aW5nUHJvY2Vzc2luZyhjb25maWc6IFNlYXJjaEluZGV4aW5nQ29uZmlnLCB0YWJsZUluc3RhbmNlOiBUYWJsZVYyKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIC8vIFNldCBzZWFyY2ggaW5kZXhpbmcgY29uZmlndXJhdGlvbiBpbiBlbnZpcm9ubWVudCB2YXJpYWJsZXMgZm9yIGxhbWJkYSBmdW5jdGlvbnNcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ1NldHRpbmcgdXAgc2VhcmNoIGluZGV4aW5nIHByb2Nlc3NpbmcgZm9yIHRhYmxlOicsIHRoaXMuZHluYW1vREJDb25maWcudGFibGUubmFtZSk7XG5cbiAgICAgICAgY29uc3QgYXBwUXVhbGlmaWVkVGFibGVOYW1lID0gZW5zdXJlTm9TcGVjaWFsQ2hhcnMoZW5zdXJlU3VmZml4KHRoaXMuZHluYW1vREJDb25maWcudGFibGUubmFtZSwgYHRhYmxlYCkpO1xuXG4gICAgICAgIGNvbnN0IHsgZW5hYmxlZCwgZW5naW5lQ29uZmlnOiB7IHR5cGU6IGVuZ2luZVR5cGUsIGhvc3Q6IGVuZ2luZUhvc3QsIG1hc3RlcktleTogZW5naW5lTWFzdGVyS2V5IH0gfSA9IGNvbmZpZztcblxuICAgICAgICBjb25zdCBlbnZWYXJzID0ge1xuICAgICAgICAgICAgLy8gcG9pbnRlciB0byB0aGUgYWN0dWFsIHRhYmxlIG5hbWUgZW52IHZhcmlhYmxlXG4gICAgICAgICAgICBbIFNFQVJDSF9JTkRFWEVSX0VOVl9LRVlTLlRBQkxFX05BTUVfRU5WX0tFWSBdOiBhcHBRdWFsaWZpZWRUYWJsZU5hbWUsXG4gICAgICAgICAgICAvLyBhY3R1YWwgdGFibGUgbmFtZVxuICAgICAgICAgICAgWyBhcHBRdWFsaWZpZWRUYWJsZU5hbWUgXTogdGhpcy5mdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUoYXBwUXVhbGlmaWVkVGFibGVOYW1lLCAndGFibGUnKSxcblxuICAgICAgICAgICAgWyBTRUFSQ0hfSU5ERVhFUl9FTlZfS0VZUy5FTkFCTEVEIF06IGVuYWJsZWQ/LnRvU3RyaW5nKCkgfHwgJ2ZhbHNlJyxcbiAgICAgICAgICAgIFsgU0VBUkNIX0lOREVYRVJfRU5WX0tFWVMuTUVJTElfSE9TVCBdOiBlbmdpbmVIb3N0IHx8IGVuZ2luZVR5cGUgPT09ICdtZWlsaScgPyB0aGlzLmZ3MjQuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZShTRUFSQ0hfSU5ERVhFUl9FTlZfS0VZUy5NRUlMSV9IT1NUKSA6IHVuZGVmaW5lZCxcbiAgICAgICAgICAgIFsgU0VBUkNIX0lOREVYRVJfRU5WX0tFWVMuTUVJTElfTUFTVEVSX0tFWSBdOiBlbmdpbmVNYXN0ZXJLZXkgfHwgZW5naW5lVHlwZSA9PT0gJ21laWxpJyA/IHRoaXMuZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKFNFQVJDSF9JTkRFWEVSX0VOVl9LRVlTLk1FSUxJX01BU1RFUl9LRVkpIDogdW5kZWZpbmVkLFxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGNvbmZpZy5hbGxvd2VkRW50aXR5TmFtZXMgJiYgY29uZmlnLmFsbG93ZWRFbnRpdHlOYW1lcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICBlbnZWYXJzWyBTRUFSQ0hfSU5ERVhFUl9FTlZfS0VZUy5BTExPV0VEX0VOVElUWV9OQU1FUyBdID0gY29uZmlnLmFsbG93ZWRFbnRpdHlOYW1lcy5qb2luKCcsJyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoY29uZmlnLmV4Y2x1ZGVkRW50aXR5TmFtZXMgJiYgY29uZmlnLmV4Y2x1ZGVkRW50aXR5TmFtZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgZW52VmFyc1sgU0VBUkNIX0lOREVYRVJfRU5WX0tFWVMuRVhDTFVERURfRU5USVRZX05BTUVTIF0gPSBjb25maWcuZXhjbHVkZWRFbnRpdHlOYW1lcy5qb2luKCcsJyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDcmVhdGUgUXVldWVMYW1iZGEgZm9yIHByb2Nlc3Npbmcgc2VhcmNoIGluZGV4aW5nIGV2ZW50cyBmcm9tIHRoZSBzdHJlYW0gdG9waWNcbiAgICAgICAgYXdhaXQgdGhpcy5zZXR1cFN0cmVhbUV2ZW50Q29uc3VtZXJzKFxuICAgICAgICAgICAgdGFibGVJbnN0YW5jZSxcbiAgICAgICAgICAgICdzZWFyY2gtaW5kZXhlcicsXG4gICAgICAgICAgICBjb25maWcsXG4gICAgICAgICAgICBqb2luKF9fZGlybmFtZSwgJy4uL3NlYXJjaC9pbmRleGVyL2Z1bmN0aW9ucy9kZWZhdWx0LWR5bmFtby1zdHJlYW0tc2VhcmNoLWluZGV4ZXItaGFuZGxlci5qcycpLFxuICAgICAgICAgICAgZW52VmFycyxcbiAgICAgICAgICAgIHt9ICAvLyBObyBiYXNlIHJlc291cmNlIGFjY2Vzc1xuICAgICAgICApO1xuXG4gICAgICAgIC8vIFRPRE86IGxvb2sgaW50byBpdCBsYXRlclxuICAgICAgICAvLyBjb25zdCBzeXN0ZW1Db250cm9sbGVyUGF0aCA9ICcvc3lzdGVtL3NlYXJjaCc7XG4gICAgICAgIC8vIGlmICghdGhpcy5mdzI0Lmhhc1N5c3RlbUNvbnRyb2xsZXIoc3lzdGVtQ29udHJvbGxlclBhdGgpKSB7XG4gICAgICAgIC8vICAgICB0aGlzLmZ3MjQucmVnaXN0ZXJTeXN0ZW1Db250cm9sbGVyKHtcbiAgICAgICAgLy8gICAgICAgICBwYXRoOiBzeXN0ZW1Db250cm9sbGVyUGF0aCxcbiAgICAgICAgLy8gICAgICAgICBmaWxlUGF0aDogam9pbihfX2Rpcm5hbWUsICcuLi9zZWFyY2gvc3lzdGVtL3NlYXJjaC1jb250cm9sbGVyLmpzJyksXG4gICAgICAgIC8vICAgICB9KTtcbiAgICAgICAgLy8gICAgIHRoaXMubG9nZ2VyLmluZm8oJ1NlYXJjaCBzeXN0ZW0gY29udHJvbGxlciByZWdpc3RlcmVkLicpO1xuICAgICAgICAvLyB9XG4gICAgfVxuXG59XG4iXX0=