"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueueLambda = void 0;
const constructs_1 = require("constructs");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_sqs_1 = require("aws-cdk-lib/aws-sqs");
const lambda_function_1 = require("./lambda-function");
const aws_lambda_event_sources_1 = require("aws-cdk-lib/aws-lambda-event-sources");
const aws_sns_1 = require("aws-cdk-lib/aws-sns");
const aws_sns_subscriptions_1 = require("aws-cdk-lib/aws-sns-subscriptions");
const fw24_1 = require("../core/fw24");
const logging_1 = require("../logging");
const core_1 = require("../core");
/**
 * Default properties for the QueueLambdaFunction.
 */
const QueueLambdaFunctionPropDefaults = {
    queueName: "",
    queueProps: {
        visibilityTimeout: aws_cdk_lib_1.Duration.seconds(30),
        receiveMessageWaitTime: aws_cdk_lib_1.Duration.seconds(20),
    },
};
/**
 * @class
 * @constructor
 * @param {Construct} scope - The scope in which the construct is defined.
 * @param {string} id - The logical ID of the construct.
 * @param {QueueLambdaFunctionProps} queueLambdaProps - The properties for the QueueLambda construct.
 * @returns {Queue} - The created Queue instance.
 *
 * @example
 * ```ts
 * // Create a new QueueLambda instance
 * const queueLambda = new QueueLambda(scope, 'MyQueueLambda', {
 *   queueName: 'MyQueue',
 *   visibilityTimeoutSeconds: 60,
 *   receiveMessageWaitTimeSeconds: 10,
 *   retentionPeriodDays: 7,
 *   queueProps: {
 *     fifo: false,
 *     encryption: QueueEncryption.KMS,
 *   },
 *   lambdaFunctionProps: {
 *     runtime: Runtime.NODEJS_22_X,
 *     entry: '/path/to/lambda_function',
 *   },
 *   sqsEventSourceProps: {
 *     batchSize: 10,
 *     maxBatchingWindow: Duration.minutes(1),
 *     reportBatchItemFailures: false,
 *   },
 *   subscriptions: {
 *     topics: ['MyTopic'],
 *   },
 * });
 * ```
 */
class QueueLambda extends constructs_1.Construct {
    logger;
    constructor(scope, id, queueLambdaProps) {
        super(scope, id);
        this.logger = (0, logging_1.createLogger)(`${QueueLambda.name}-${id}`);
        const fw24 = fw24_1.Fw24.getInstance();
        let props = { ...QueueLambdaFunctionPropDefaults, ...queueLambdaProps };
        // dlq props
        let dlqProps = {};
        //check if dlq already exists
        const existingDLQ = fw24.getEnvironmentVariable(props.queueName, 'dlq') || fw24.getEnvironmentVariable(props.queueName + '_dlq', 'queue');
        //if it does, assign it to the queue
        if (existingDLQ) {
            dlqProps = {
                deadLetterQueue: {
                    maxReceiveCount: props.maxReceiveCount ?? 3,
                    queue: existingDLQ,
                }
            };
        }
        else if (!props.queueName.endsWith("dlq")) { //if queue itself is a dlq don't assign default dlq
            //set default dlq
            const isFifoQueue = props.queueProps?.fifo || props.queueName.endsWith('.fifo') || props.queueProps?.contentBasedDeduplication;
            let defaultDLQ = isFifoQueue ? fw24.getEnvironmentVariable('dlq_default_fifo') : fw24.getEnvironmentVariable('dlq_default');
            if (!defaultDLQ) {
                const dlqName = isFifoQueue ? 'default-dlq-fifo' : 'default-dlq';
                //create default dlq
                defaultDLQ = new aws_sqs_1.Queue(this, dlqName, {
                    fifo: isFifoQueue
                });
                fw24.getEnvironmentVariable(dlqName.replace('default-', '_'), defaultDLQ);
            }
            //assign default dlq
            dlqProps = {
                deadLetterQueue: {
                    maxReceiveCount: props.maxReceiveCount ?? 3,
                    queue: defaultDLQ,
                }
            };
        }
        // set the timeouts
        let timeoutProps = {};
        if (props.visibilityTimeoutSeconds)
            Object.assign(timeoutProps, { visibilityTimeout: aws_cdk_lib_1.Duration.seconds(props.visibilityTimeoutSeconds) });
        if (props.receiveMessageWaitTimeSeconds)
            Object.assign(timeoutProps, { receiveMessageWaitTime: aws_cdk_lib_1.Duration.seconds(props.receiveMessageWaitTimeSeconds) });
        if (props.retentionPeriodDays)
            Object.assign(timeoutProps, { messageRetentionPeriod: aws_cdk_lib_1.Duration.days(props.retentionPeriodDays) });
        // set the default dlq with option to override
        props.queueProps = {
            ...dlqProps,
            ...props.queueProps,
            ...timeoutProps,
        };
        const queue = new aws_sqs_1.Queue(this, id, {
            ...props.queueProps,
        });
        if (props.lambdaFunctionProps) {
            const queueFunction = new lambda_function_1.LambdaFunction(scope, `${id}-lambda`, { ...props.lambdaFunctionProps });
            const isFifoQueue = core_1.Helper.isFifoQueueProps({
                ...(props.queueProps || {}),
                queueName: props.queueName
            });
            const eventSourceProps = isFifoQueue ? {} : {
                batchSize: props.sqsEventSourceProps?.batchSize ?? 1,
                maxBatchingWindow: props.sqsEventSourceProps?.maxBatchingWindow ?? aws_cdk_lib_1.Duration.seconds(5),
                reportBatchItemFailures: props.sqsEventSourceProps?.reportBatchItemFailures ?? true,
            };
            // add event source to lambda function
            queueFunction.addEventSource(new aws_lambda_event_sources_1.SqsEventSource(queue, eventSourceProps));
        }
        // subscribe the queue to SNS topic
        props?.subscriptions?.topics?.forEach((topic) => {
            const topicName = typeof topic === 'string' ? topic : topic.name;
            const filters = typeof topic === 'string' ? [] : topic.filters;
            const topicArn = fw24.getArn('sns', fw24.getEnvironmentVariable(topicName, 'topicName'));
            const topicInstance = aws_sns_1.Topic.fromTopicArn(this, topicName + id + '-topic', topicArn);
            // TODO: add ability to filter messages
            topicInstance.addSubscription(new aws_sns_subscriptions_1.SqsSubscription(queue));
        });
        return queue;
    }
}
exports.QueueLambda = QueueLambda;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVldWUtbGFtYmRhLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvbnN0cnVjdHMvcXVldWUtbGFtYmRhLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDJDQUF1QztBQUN2Qyw2Q0FBdUM7QUFFdkMsaURBQTRDO0FBRTVDLHVEQUF3RTtBQUN4RSxtRkFBMkY7QUFDM0YsaURBQTRDO0FBQzVDLDZFQUFvRTtBQUNwRSx1Q0FBb0M7QUFDcEMsd0NBQW1EO0FBQ25ELGtDQUFpQztBQWlGakM7O0dBRUc7QUFDSCxNQUFNLCtCQUErQixHQUE4QjtJQUNqRSxTQUFTLEVBQUUsRUFBRTtJQUNiLFVBQVUsRUFBRTtRQUNWLGlCQUFpQixFQUFFLHNCQUFRLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztRQUN2QyxzQkFBc0IsRUFBRSxzQkFBUSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7S0FDN0M7Q0FDRixDQUFBO0FBRUQ7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FrQ0c7QUFDSCxNQUFhLFdBQVksU0FBUSxzQkFBUztJQUMvQixNQUFNLENBQVk7SUFFM0IsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxnQkFBMEM7UUFDbEYsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQUNqQixJQUFJLENBQUMsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxHQUFHLFdBQVcsQ0FBQyxJQUFJLElBQUksRUFBRSxFQUFFLENBQUMsQ0FBQztRQUV4RCxNQUFNLElBQUksR0FBRyxXQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7UUFFaEMsSUFBSSxLQUFLLEdBQUcsRUFBRSxHQUFHLCtCQUErQixFQUFFLEdBQUcsZ0JBQWdCLEVBQUUsQ0FBQztRQUV4RSxZQUFZO1FBQ1osSUFBSSxRQUFRLEdBQUcsRUFBRSxDQUFDO1FBQ2xCLDZCQUE2QjtRQUM3QixNQUFNLFdBQVcsR0FBVyxJQUFJLENBQUMsc0JB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QUMsc0JBQXNCLENBQUMsU0FBUyxFQUFFLFdBQVcsQ0FBQyxDQUFDLENBQUM7WUFDekYsTUFBTSxhQUFhLEdBQUcsZUFBSyxDQUFDLFlBQVksQ0FBQyxJQUFJLEVBQUUsU0FBUyxHQUFDLEVBQUUsR0FBQyxRQUFRLEVBQUUsUUFBUSxDQUFDLENBQUM7WUFDaEYsdUNBQXVDO1lBQ3ZDLGFBQWEsQ0FBQyxlQUFlLENBQUMsSUFBSSx1Q0FBZSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7UUFDNUQsQ0FBQyxDQUFDLENBQUM7UUFFSCxPQUFPLEtBQUssQ0FBQztJQUNmLENBQUM7Q0FFRjtBQTlGRCxrQ0E4RkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tIFwiY29uc3RydWN0c1wiO1xuaW1wb3J0IHsgRHVyYXRpb24gfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCB7IE5vZGVqc0Z1bmN0aW9uIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1sYW1iZGEtbm9kZWpzXCI7XG5pbXBvcnQgeyBRdWV1ZSB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc3FzXCI7XG5pbXBvcnQgeyBRdWV1ZVByb3BzIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1zcXNcIjtcbmltcG9ydCB7IExhbWJkYUZ1bmN0aW9uLCBMYW1iZGFGdW5jdGlvblByb3BzIH0gZnJvbSBcIi4vbGFtYmRhLWZ1bmN0aW9uXCI7XG5pbXBvcnQgeyBTcXNFdmVudFNvdXJjZSwgU3FzRXZlbnRTb3VyY2VQcm9wcyB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLWV2ZW50LXNvdXJjZXNcIjtcbmltcG9ydCB7IFRvcGljIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1zbnNcIjtcbmltcG9ydCB7IFNxc1N1YnNjcmlwdGlvbiB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc25zLXN1YnNjcmlwdGlvbnNcIjtcbmltcG9ydCB7IEZ3MjQgfSBmcm9tIFwiLi4vY29yZS9mdzI0XCI7XG5pbXBvcnQgeyBJTG9nZ2VyLCBjcmVhdGVMb2dnZXIgfSBmcm9tIFwiLi4vbG9nZ2luZ1wiO1xuaW1wb3J0IHsgSGVscGVyIH0gZnJvbSBcIi4uL2NvcmVcIjtcblxuLyoqXG4gKiBSZXByZXNlbnRzIHRoZSBwcm9wZXJ0aWVzIGZvciBhIFF1ZXVlTGFtYmRhRnVuY3Rpb24uXG4gKi9cbmludGVyZmFjZSBRdWV1ZUxhbWJkYUZ1bmN0aW9uUHJvcHMge1xuICAvKipcbiAgICogVGhlIG5hbWUgb2YgdGhlIHF1ZXVlLlxuICAgKi9cbiAgcXVldWVOYW1lOiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIFRoZSBwcm9wZXJ0aWVzIGZvciB0aGUgcXVldWUuXG4gICAqL1xuICBxdWV1ZVByb3BzPzogUXVldWVQcm9wcztcblxuICAvKipcbiAgICogVGhlIHZpc2liaWxpdHkgdGltZW91dCBmb3IgdGhlIHF1ZXVlIGluIHNlY29uZHMuXG4gICAqL1xuICB2aXNpYmlsaXR5VGltZW91dFNlY29uZHM/OiBudW1iZXI7XG5cbiAgLyoqXG4gICAqIFRoZSB3YWl0IHRpbWUgZm9yIHJlY2VpdmluZyBtZXNzYWdlcyBmcm9tIHRoZSBxdWV1ZSBpbiBzZWNvbmRzLlxuICAgKi9cbiAgcmVjZWl2ZU1lc3NhZ2VXYWl0VGltZVNlY29uZHM/OiBudW1iZXI7XG5cbiAgLyoqXG4gICAqIFRoZSByZXRlbnRpb24gcGVyaW9kIGZvciB0aGUgcXVldWUgaW4gZGF5cy5cbiAgICovXG4gIHJldGVudGlvblBlcmlvZERheXM/OiBudW1iZXI7XG5cbiAgLyoqXG4gICAqIFRoZSBudW1iZXIgb2YgdGltZXMgYSBtZXNzYWdlIGNhbiBiZSB1bnN1Y2Nlc3NmdWxseSBkZXF1ZXVlZCBiZWZvcmUgYmVpbmcgbW92ZWQgdG8gdGhlIGRlYWQtbGV0dGVyIHF1ZXVlLlxuICAgKi9cbiAgbWF4UmVjZWl2ZUNvdW50PzogbnVtYmVyO1xuXG4gIC8qKlxuICAgKiBUaGUgcHJvcGVydGllcyBmb3IgdGhlIFNRUyBldmVudCBzb3VyY2UuXG4gICAqL1xuICBzcXNFdmVudFNvdXJjZVByb3BzPzoge1xuICAgIC8qKlxuICAgICAqIFRoZSBudW1iZXIgb2YgbWVzc2FnZXMgdG8gcmV0cmlldmUgZnJvbSB0aGUgcXVldWUgaW4gYSBzaW5nbGUgYmF0Y2guXG4gICAgICovXG4gICAgYmF0Y2hTaXplPzogbnVtYmVyO1xuXG4gICAgLyoqXG4gICAgICogVGhlIG1heGltdW0gYW1vdW50IG9mIHRpbWUgdG8gd2FpdCBiZWZvcmUgdHJpZ2dlcmluZyBhIGJhdGNoIG9mIG1lc3NhZ2VzLlxuICAgICAqL1xuICAgIG1heEJhdGNoaW5nV2luZG93PzogRHVyYXRpb247XG5cbiAgICAvKipcbiAgICAgKiBXaGV0aGVyIHRvIHJlcG9ydCBmYWlsdXJlcyBmb3IgaW5kaXZpZHVhbCBiYXRjaCBpdGVtcy5cbiAgICAgKi9cbiAgICByZXBvcnRCYXRjaEl0ZW1GYWlsdXJlcz86IGJvb2xlYW47XG4gIH07XG5cbiAgLyoqXG4gICAqIFRoZSBwcm9wZXJ0aWVzIGZvciB0aGUgbGFtYmRhIGZ1bmN0aW9uLlxuICAgKi9cbiAgbGFtYmRhRnVuY3Rpb25Qcm9wcz86IExhbWJkYUZ1bmN0aW9uUHJvcHM7XG5cbiAgLyoqXG4gICAqIFRoZSBzdWJzY3JpcHRpb25zIGZvciB0aGUgcXVldWUuXG4gICAqL1xuICBzdWJzY3JpcHRpb25zPzogSVF1ZXVlU3Vic2NyaXB0aW9ucztcbn1cblxuLyoqXG4gKiBSZXByZXNlbnRzIHRoZSBzdWJzY3JpcHRpb25zIGZvciBhIHF1ZXVlLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIElRdWV1ZVN1YnNjcmlwdGlvbnMge1xuICAvKipcbiAgICogQW4gYXJyYXkgb2YgdG9waWNzIHdpdGggdGhlaXIgY29ycmVzcG9uZGluZyBmaWx0ZXJzLlxuICAgKiBFYWNoIHRvcGljIGhhcyBhIG5hbWUgYW5kIGFuIGFycmF5IG9mIGZpbHRlcnMuXG4gICAqL1xuICB0b3BpY3M6IEFycmF5PHtcbiAgICBuYW1lOiBzdHJpbmc7XG4gICAgZmlsdGVyczogc3RyaW5nW107IFxuICB9PiB8IHN0cmluZ1tdO1xufVxuXG4vKipcbiAqIERlZmF1bHQgcHJvcGVydGllcyBmb3IgdGhlIFF1ZXVlTGFtYmRhRnVuY3Rpb24uXG4gKi9cbmNvbnN0IFF1ZXVlTGFtYmRhRnVuY3Rpb25Qcm9wRGVmYXVsdHMgOiBRdWV1ZUxhbWJkYUZ1bmN0aW9uUHJvcHMgPSB7XG4gIHF1ZXVlTmFtZTogXCJcIixcbiAgcXVldWVQcm9wczoge1xuICAgIHZpc2liaWxpdHlUaW1lb3V0OiBEdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICByZWNlaXZlTWVzc2FnZVdhaXRUaW1lOiBEdXJhdGlvbi5zZWNvbmRzKDIwKSxcbiAgfSxcbn1cblxuLyoqXG4gKiBAY2xhc3NcbiAqIEBjb25zdHJ1Y3RvclxuICogQHBhcmFtIHtDb25zdHJ1Y3R9IHNjb3BlIC0gVGhlIHNjb3BlIGluIHdoaWNoIHRoZSBjb25zdHJ1Y3QgaXMgZGVmaW5lZC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBpZCAtIFRoZSBsb2dpY2FsIElEIG9mIHRoZSBjb25zdHJ1Y3QuXG4gKiBAcGFyYW0ge1F1ZXVlTGFtYmRhRnVuY3Rpb25Qcm9wc30gcXVldWVMYW1iZGFQcm9wcyAtIFRoZSBwcm9wZXJ0aWVzIGZvciB0aGUgUXVldWVMYW1iZGEgY29uc3RydWN0LlxuICogQHJldHVybnMge1F1ZXVlfSAtIFRoZSBjcmVhdGVkIFF1ZXVlIGluc3RhbmNlLlxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqIC8vIENyZWF0ZSBhIG5ldyBRdWV1ZUxhbWJkYSBpbnN0YW5jZVxuICogY29uc3QgcXVldWVMYW1iZGEgPSBuZXcgUXVldWVMYW1iZGEoc2NvcGUsICdNeVF1ZXVlTGFtYmRhJywge1xuICogICBxdWV1ZU5hbWU6ICdNeVF1ZXVlJyxcbiAqICAgdmlzaWJpbGl0eVRpbWVvdXRTZWNvbmRzOiA2MCxcbiAqICAgcmVjZWl2ZU1lc3NhZ2VXYWl0VGltZVNlY29uZHM6IDEwLFxuICogICByZXRlbnRpb25QZXJpb2REYXlzOiA3LFxuICogICBxdWV1ZVByb3BzOiB7XG4gKiAgICAgZmlmbzogZmFsc2UsXG4gKiAgICAgZW5jcnlwdGlvbjogUXVldWVFbmNyeXB0aW9uLktNUyxcbiAqICAgfSxcbiAqICAgbGFtYmRhRnVuY3Rpb25Qcm9wczoge1xuICogICAgIHJ1bnRpbWU6IFJ1bnRpbWUuTk9ERUpTXzIyX1gsXG4gKiAgICAgZW50cnk6ICcvcGF0aC90by9sYW1iZGFfZnVuY3Rpb24nLFxuICogICB9LFxuICogICBzcXNFdmVudFNvdXJjZVByb3BzOiB7XG4gKiAgICAgYmF0Y2hTaXplOiAxMCxcbiAqICAgICBtYXhCYXRjaGluZ1dpbmRvdzogRHVyYXRpb24ubWludXRlcygxKSxcbiAqICAgICByZXBvcnRCYXRjaEl0ZW1GYWlsdXJlczogZmFsc2UsXG4gKiAgIH0sXG4gKiAgIHN1YnNjcmlwdGlvbnM6IHtcbiAqICAgICB0b3BpY3M6IFsnTXlUb3BpYyddLFxuICogICB9LFxuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNsYXNzIFF1ZXVlTGFtYmRhIGV4dGVuZHMgQ29uc3RydWN0IHtcbiAgcmVhZG9ubHkgbG9nZ2VyID86IElMb2dnZXI7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcXVldWVMYW1iZGFQcm9wczogUXVldWVMYW1iZGFGdW5jdGlvblByb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkKTtcbiAgICB0aGlzLmxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihgJHtRdWV1ZUxhbWJkYS5uYW1lfS0ke2lkfWApO1xuXG4gICAgY29uc3QgZncyNCA9IEZ3MjQuZ2V0SW5zdGFuY2UoKTtcbiAgICBcbiAgICBsZXQgcHJvcHMgPSB7IC4uLlF1ZXVlTGFtYmRhRnVuY3Rpb25Qcm9wRGVmYXVsdHMsIC4uLnF1ZXVlTGFtYmRhUHJvcHMgfTtcbiAgICBcbiAgICAvLyBkbHEgcHJvcHNcbiAgICBsZXQgZGxxUHJvcHMgPSB7fTtcbiAgICAvL2NoZWNrIGlmIGRscSBhbHJlYWR5IGV4aXN0c1xuICAgIGNvbnN0IGV4aXN0aW5nRExRIDogUXVldWUgPSBmdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUocHJvcHMucXVldWVOYW1lLCAnZGxxJykgfHwgZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKHByb3BzLnF1ZXVlTmFtZSsnX2RscScsICdxdWV1ZScpXG4gICAgLy9pZiBpdCBkb2VzLCBhc3NpZ24gaXQgdG8gdGhlIHF1ZXVlXG4gICAgaWYoIGV4aXN0aW5nRExRICkge1xuICAgICAgZGxxUHJvcHMgPSB7XG4gICAgICAgIGRlYWRMZXR0ZXJRdWV1ZToge1xuICAgICAgICAgIG1heFJlY2VpdmVDb3VudDogcHJvcHMubWF4UmVjZWl2ZUNvdW50ID8/IDMsXG4gICAgICAgICAgcXVldWU6IGV4aXN0aW5nRExRLFxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBlbHNlIGlmKCAhcHJvcHMucXVldWVOYW1lLmVuZHNXaXRoKFwiZGxxXCIpICkgeyAvL2lmIHF1ZXVlIGl0c2VsZiBpcyBhIGRscSBkb24ndCBhc3NpZ24gZGVmYXVsdCBkbHFcbiAgICAgIC8vc2V0IGRlZmF1bHQgZGxxXG4gICAgICBjb25zdCBpc0ZpZm9RdWV1ZSA9IHByb3BzLnF1ZXVlUHJvcHM/LmZpZm8gfHwgcHJvcHMucXVldWVOYW1lLmVuZHNXaXRoKCcuZmlmbycpIHx8IHByb3BzLnF1ZXVlUHJvcHM/LmNvbnRlbnRCYXNlZERlZHVwbGljYXRpb247XG4gICAgICBsZXQgZGVmYXVsdERMUSA9IGlzRmlmb1F1ZXVlID8gZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKCdkbHFfZGVmYXVsdF9maWZvJykgOiBmdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUoJ2RscV9kZWZhdWx0Jyk7XG5cbiAgICAgIGlmKCFkZWZhdWx0RExRICl7XG4gICAgICAgIGNvbnN0IGRscU5hbWUgPSBpc0ZpZm9RdWV1ZSA/ICdkZWZhdWx0LWRscS1maWZvJyA6ICdkZWZhdWx0LWRscSc7XG4gICAgICAgIC8vY3JlYXRlIGRlZmF1bHQgZGxxXG4gICAgICAgIGRlZmF1bHRETFEgPSBuZXcgUXVldWUodGhpcywgZGxxTmFtZSwge1xuICAgICAgICAgIGZpZm86IGlzRmlmb1F1ZXVlXG4gICAgICAgIH0pO1xuICAgICAgICBmdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUoZGxxTmFtZS5yZXBsYWNlKCdkZWZhdWx0LScsICdfJyksIGRlZmF1bHRETFEpO1xuICAgICAgfVxuICAgICAgLy9hc3NpZ24gZGVmYXVsdCBkbHFcbiAgICAgIGRscVByb3BzID0ge1xuICAgICAgICBkZWFkTGV0dGVyUXVldWU6IHtcbiAgICAgICAgICBtYXhSZWNlaXZlQ291bnQ6IHByb3BzLm1heFJlY2VpdmVDb3VudCA/PyAzLFxuICAgICAgICAgIHF1ZXVlOiBkZWZhdWx0RExRLFxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gc2V0IHRoZSB0aW1lb3V0c1xuICAgIGxldCB0aW1lb3V0UHJvcHM6IGFueSA9IHt9O1xuICAgIGlmKHByb3BzLnZpc2liaWxpdHlUaW1lb3V0U2Vjb25kcykgT2JqZWN0LmFzc2lnbih0aW1lb3V0UHJvcHMsIHsgdmlzaWJpbGl0eVRpbWVvdXQgOiBEdXJhdGlvbi5zZWNvbmRzKHByb3BzLnZpc2liaWxpdHlUaW1lb3V0U2Vjb25kcyl9KTtcbiAgICBpZihwcm9wcy5yZWNlaXZlTWVzc2FnZVdhaXRUaW1lU2Vjb25kcykgT2JqZWN0LmFzc2lnbih0aW1lb3V0UHJvcHMsIHsgcmVjZWl2ZU1lc3NhZ2VXYWl0VGltZSA6IER1cmF0aW9uLnNlY29uZHMocHJvcHMucmVjZWl2ZU1lc3NhZ2VXYWl0VGltZVNlY29uZHMpfSk7XG4gICAgaWYocHJvcHMucmV0ZW50aW9uUGVyaW9kRGF5cykgT2JqZWN0LmFzc2lnbih0aW1lb3V0UHJvcHMsIHsgbWVzc2FnZVJldGVudGlvblBlcmlvZCA6IER1cmF0aW9uLmRheXMocHJvcHMucmV0ZW50aW9uUGVyaW9kRGF5cyl9KTsgICBcblxuICAgIC8vIHNldCB0aGUgZGVmYXVsdCBkbHEgd2l0aCBvcHRpb24gdG8gb3ZlcnJpZGVcbiAgICBwcm9wcy5xdWV1ZVByb3BzID0ge1xuICAgICAgLi4uZGxxUHJvcHMsXG4gICAgICAuLi5wcm9wcy5xdWV1ZVByb3BzLFxuICAgICAgLi4udGltZW91dFByb3BzLFxuICAgIH1cblxuICAgIGNvbnN0IHF1ZXVlID0gbmV3IFF1ZXVlKHRoaXMsIGlkLCB7XG4gICAgICAuLi5wcm9wcy5xdWV1ZVByb3BzLFxuICAgIH0pIGFzIFF1ZXVlO1xuXG4gICAgaWYocHJvcHMubGFtYmRhRnVuY3Rpb25Qcm9wcyl7XG4gICAgICBjb25zdCBxdWV1ZUZ1bmN0aW9uID0gbmV3IExhbWJkYUZ1bmN0aW9uKHNjb3BlLCBgJHtpZH0tbGFtYmRhYCwgeyAuLi5wcm9wcy5sYW1iZGFGdW5jdGlvblByb3BzIH0pIGFzIE5vZGVqc0Z1bmN0aW9uO1xuICAgICAgXG4gICAgICBjb25zdCBpc0ZpZm9RdWV1ZSA9IEhlbHBlci5pc0ZpZm9RdWV1ZVByb3BzKHsgXG4gICAgICAgIC4uLihwcm9wcy5xdWV1ZVByb3BzIHx8IHt9KSwgXG4gICAgICAgIHF1ZXVlTmFtZTogcHJvcHMucXVldWVOYW1lIFxuICAgICAgfSk7XG4gICAgICBcbiAgICAgIGNvbnN0IGV2ZW50U291cmNlUHJvcHM6IFNxc0V2ZW50U291cmNlUHJvcHMgPSAgaXNGaWZvUXVldWUgPyB7fSA6IHtcbiAgICAgICAgYmF0Y2hTaXplOiBwcm9wcy5zcXNFdmVudFNvdXJjZVByb3BzPy5iYXRjaFNpemUgPz8gMSxcbiAgICAgICAgbWF4QmF0Y2hpbmdXaW5kb3c6IHByb3BzLnNxc0V2ZW50U291cmNlUHJvcHM/Lm1heEJhdGNoaW5nV2luZG93ID8/IER1cmF0aW9uLnNlY29uZHMoNSksXG4gICAgICAgIHJlcG9ydEJhdGNoSXRlbUZhaWx1cmVzOiBwcm9wcy5zcXNFdmVudFNvdXJjZVByb3BzPy5yZXBvcnRCYXRjaEl0ZW1GYWlsdXJlcyA/PyB0cnVlLFxuICAgICAgfTtcbiAgICAgIFxuICAgICAgLy8gYWRkIGV2ZW50IHNvdXJjZSB0byBsYW1iZGEgZnVuY3Rpb25cbiAgICAgIHF1ZXVlRnVuY3Rpb24uYWRkRXZlbnRTb3VyY2UobmV3IFNxc0V2ZW50U291cmNlKHF1ZXVlLCBldmVudFNvdXJjZVByb3BzKSk7XG4gICAgfVxuXG4gICAgLy8gc3Vic2NyaWJlIHRoZSBxdWV1ZSB0byBTTlMgdG9waWNcbiAgICBwcm9wcz8uc3Vic2NyaXB0aW9ucz8udG9waWNzPy5mb3JFYWNoKCAoIHRvcGljOiBhbnkpID0+IHtcbiAgICAgIGNvbnN0IHRvcGljTmFtZSA9IHR5cGVvZiB0b3BpYyA9PT0gJ3N0cmluZycgPyB0b3BpYyA6IHRvcGljLm5hbWU7XG4gICAgICBjb25zdCBmaWx0ZXJzID0gdHlwZW9mIHRvcGljID09PSAnc3RyaW5nJyA/IFtdIDogdG9waWMuZmlsdGVycztcblxuICAgICAgY29uc3QgdG9waWNBcm4gPSBmdzI0LmdldEFybignc25zJywgZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKHRvcGljTmFtZSwgJ3RvcGljTmFtZScpKTtcbiAgICAgIGNvbnN0IHRvcGljSW5zdGFuY2UgPSBUb3BpYy5mcm9tVG9waWNBcm4odGhpcywgdG9waWNOYW1lK2lkKyctdG9waWMnLCB0b3BpY0Fybik7XG4gICAgICAvLyBUT0RPOiBhZGQgYWJpbGl0eSB0byBmaWx0ZXIgbWVzc2FnZXNcbiAgICAgIHRvcGljSW5zdGFuY2UuYWRkU3Vic2NyaXB0aW9uKG5ldyBTcXNTdWJzY3JpcHRpb24ocXVldWUpKTtcbiAgICB9KTtcbiAgICBcbiAgICByZXR1cm4gcXVldWU7XG4gIH1cbiAgXG59XG4iXX0=