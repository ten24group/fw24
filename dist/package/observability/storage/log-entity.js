"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ObservabilityLogEntity = exports.ObservabilityLogEntitySchema = exports.ObservabilityLogEntityConfig = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const crypto_1 = require("crypto");
const entity_1 = require("../../entity");
const ddbClient = new client_dynamodb_1.DynamoDBClient({});
const docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(ddbClient, {
    marshallOptions: {
        convertClassInstanceToMap: true,
        removeUndefinedValues: true,
        convertEmptyValues: true,
    },
});
const TABLE_ENV = process.env.AUDIT_TABLE_NAME ?? 'AuditLogs';
exports.ObservabilityLogEntityConfig = {
    table: process.env[`${TABLE_ENV.toUpperCase()}_TABLE`] ?? TABLE_ENV,
    client: docClient,
};
exports.ObservabilityLogEntitySchema = (0, entity_1.createEntitySchema)({
    model: {
        version: '1',
        entity: 'log',
        entityNamePlural: 'logs',
        service: 'observability',
        entityOperations: entity_1.DefaultEntityOperations,
        excludeFromAdminMenu: true,
        excludeFromAdminCreate: true,
        excludeFromAdminUpdate: true,
        excludeFromAdminDelete: true,
    },
    attributes: {
        logId: {
            type: 'string',
            required: true,
            isIdentifier: true,
            default: () => (0, crypto_1.randomUUID)(),
        },
        parentLogId: {
            type: 'string',
            required: false,
        },
        correlationId: {
            type: 'string',
            required: true,
            default: () => (0, crypto_1.randomUUID)(),
        },
        type: {
            type: 'string',
            required: true,
        },
        subType: {
            type: 'string',
            required: false,
        },
        level: {
            type: 'string',
            required: true,
            default: () => 'info',
        },
        timestampMs: {
            type: 'number',
            required: true,
            default: () => Date.now(),
        },
        durationMs: {
            type: 'number',
            required: false,
        },
        success: {
            type: 'boolean',
            required: false,
        },
        status: {
            type: 'string',
            required: false,
        },
        entityName: {
            type: 'string',
            required: false,
        },
        entityId: {
            type: 'string',
            required: false,
        },
        operation: {
            type: 'string',
            required: false,
        },
        source: {
            type: 'string',
            required: false,
        },
        tags: {
            type: 'map',
            required: false,
            properties: {},
        },
        metrics: {
            type: 'map',
            required: false,
            properties: {},
        },
        attributes: {
            type: 'map',
            required: false,
            properties: {},
        },
        data: {
            type: 'map',
            required: false,
            properties: {},
        },
        metadata: {
            type: 'map',
            required: false,
            properties: {},
        },
        error: {
            type: 'map',
            required: false,
            properties: {
                type: { type: 'string' },
                message: { type: 'string' },
                stack: { type: 'string' },
            },
        },
        actor: {
            type: 'map',
            required: false,
            properties: {},
        },
        context: {
            type: 'map',
            required: false,
            properties: {},
        },
        ttl: {
            type: 'number',
            required: false,
            default: () => Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60,
        },
    },
    indexes: {
        primary: {
            pk: { field: 'pk', composite: ['logId'] },
            sk: { field: 'sk', composite: [] },
        },
        byTrace: {
            index: 'gsi1',
            pk: { field: 'gsi1pk', composite: ['correlationId'] },
            sk: { field: 'gsi1sk', composite: ['timestampMs'] },
        },
        byParent: {
            index: 'gsi2',
            pk: { field: 'gsi2pk', composite: ['parentLogId'] },
            sk: { field: 'gsi2sk', composite: ['timestampMs'] },
        },
        byEntity: {
            index: 'gsi3',
            pk: { field: 'gsi3pk', composite: ['entityName', 'entityId'] },
            sk: { field: 'gsi3sk', composite: ['timestampMs'] },
        },
        byLevel: {
            index: 'gsi4',
            pk: { field: 'gsi4pk', composite: ['level'] },
            sk: { field: 'gsi4sk', composite: ['timestampMs'] },
        },
        byType: {
            index: 'gsi5',
            pk: { field: 'gsi5pk', composite: ['type'] },
            sk: { field: 'gsi5sk', composite: ['timestampMs'] },
        },
        bySource: {
            index: 'gsi6',
            pk: { field: 'gsi6pk', composite: ['source'] },
            sk: { field: 'gsi6sk', composite: ['timestampMs'] },
        },
    },
});
const ObservabilityLogEntity = () => (0, entity_1.createElectroDBEntity)({
    schema: exports.ObservabilityLogEntitySchema,
    entityConfigurations: exports.ObservabilityLogEntityConfig,
}).entity;
exports.ObservabilityLogEntity = ObservabilityLogEntity;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9nLWVudGl0eS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L3N0b3JhZ2UvbG9nLWVudGl0eS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSw4REFBMEQ7QUFDMUQsd0RBQStEO0FBQy9ELG1DQUFvQztBQUVwQyx5Q0FBa0c7QUFFbEcsTUFBTSxTQUFTLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0FBQ3pDLE1BQU0sU0FBUyxHQUFHLHFDQUFzQixDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUU7SUFDdkQsZUFBZSxFQUFFO1FBQ2YseUJBQXlCLEVBQUUsSUFBSTtRQUMvQixxQkFBcUIsRUFBRSxJQUFJO1FBQzNCLGtCQUFrQixFQUFFLElBQUk7S0FDekI7Q0FDRixDQUFDLENBQUM7QUFFSCxNQUFNLFNBQVMsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGdCQUFnQixJQUFJLFdBQVcsQ0FBQztBQUNqRCxRQUFBLDRCQUE0QixHQUF3QjtJQUMvRCxLQUFLLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxHQUFHLFNBQVMsQ0FBQyxXQUFXLEVBQUUsUUFBUSxDQUFDLElBQUksU0FBUztJQUNuRSxNQUFNLEVBQUUsU0FBUztDQUNsQixDQUFDO0FBRVcsUUFBQSw0QkFBNEIsR0FBRyxJQUFBLDJCQUFrQixFQUFDO0lBQzdELEtBQUssRUFBRTtRQUNMLE9BQU8sRUFBRSxHQUFHO1FBQ1osTUFBTSxFQUFFLEtBQUs7UUFDYixnQkFBZ0IsRUFBRSxNQUFNO1FBQ3hCLE9BQU8sRUFBRSxlQUFlO1FBQ3hCLGdCQUFnQixFQUFFLGdDQUF1QjtRQUN6QyxvQkFBb0IsRUFBRSxJQUFJO1FBQzFCLHNCQUFzQixFQUFFLElBQUk7UUFDNUIsc0JBQXNCLEVBQUUsSUFBSTtRQUM1QixzQkFBc0IsRUFBRSxJQUFJO0tBQzdCO0lBQ0QsVUFBVSxFQUFFO1FBQ1YsS0FBSyxFQUFFO1lBQ0ws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RUFBRTtTQUNwRDtRQUNELE9BQU8sRUFBRTtZQUNQLEtBQUssRUFBRSxNQUFNO1lBQ2IsRUFBRSxFQUFFLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsQ0FBQyxPQUFPLENBQUMsRUFBRTtZQUM3QyxFQUFFLEVBQUUsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxDQUFDLGFBQWEsQ0FBQyxFQUFFO1NBQ3BEO1FBQ0QsTUFBTSxFQUFFO1lBQ04sS0FBSyxFQUFFLE1BQU07WUFDYixFQUFFLEVBQUUsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxDQUFDLE1BQU0sQ0FBQyxFQUFFO1lBQzVDLEVBQUUsRUFBRSxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsU0FBUyxFQUFFLENBQUMsYUFBYSxDQUFDLEVBQUU7U0FDcEQ7UUFDRCxRQUFRLEVBQUU7WUFDUixLQUFLLEVBQUUsTUFBTTtZQUNiLEVBQUUsRUFBRSxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsU0FBUyxFQUFFLENBQUMsUUFBUSxDQUFDLEVBQUU7WUFDOUMsRUFBRSxFQUFFLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsQ0FBQyxhQUFhLENBQUMsRUFBRTtTQUNwRDtLQUNGO0NBQ08sQ0FBQyxDQUFDO0FBRUwsTUFBTSxzQkFBc0IsR0FBRyxHQUFHLEVBQUUsQ0FDekMsSUFBQSw4QkFBcUIsRUFBQztJQUNwQixNQUFNLEVBQUUsb0NBQTRCO0lBQ3BDLG9CQUFvQixFQUFFLG9DQUE0QjtDQUNuRCxDQUFDLENBQUMsTUFBTSxDQUFDO0FBSkMsUUFBQSxzQkFBc0IsMEJBSXZCIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xuaW1wb3J0IHsgRHluYW1vREJEb2N1bWVudENsaWVudCB9IGZyb20gJ0Bhd3Mtc2RrL2xpYi1keW5hbW9kYic7XG5pbXBvcnQgeyByYW5kb21VVUlEIH0gZnJvbSAnY3J5cHRvJztcbmltcG9ydCB7IEVudGl0eUNvbmZpZ3VyYXRpb24gfSBmcm9tICdlbGVjdHJvZGInO1xuaW1wb3J0IHsgRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsIGNyZWF0ZUVsZWN0cm9EQkVudGl0eSwgY3JlYXRlRW50aXR5U2NoZW1hIH0gZnJvbSAnLi4vLi4vZW50aXR5JztcblxuY29uc3QgZGRiQ2xpZW50ID0gbmV3IER5bmFtb0RCQ2xpZW50KHt9KTtcbmNvbnN0IGRvY0NsaWVudCA9IER5bmFtb0RCRG9jdW1lbnRDbGllbnQuZnJvbShkZGJDbGllbnQsIHtcbiAgbWFyc2hhbGxPcHRpb25zOiB7XG4gICAgY29udmVydENsYXNzSW5zdGFuY2VUb01hcDogdHJ1ZSxcbiAgICByZW1vdmVVbmRlZmluZWRWYWx1ZXM6IHRydWUsXG4gICAgY29udmVydEVtcHR5VmFsdWVzOiB0cnVlLFxuICB9LFxufSk7XG5cbmNvbnN0IFRBQkxFX0VOViA9IHByb2Nlc3MuZW52LkFVRElUX1RBQkxFX05BTUUgPz8gJ0F1ZGl0TG9ncyc7XG5leHBvcnQgY29uc3QgT2JzZXJ2YWJpbGl0eUxvZ0VudGl0eUNvbmZpZzogRW50aXR5Q29uZmlndXJhdGlvbiA9IHtcbiAgdGFibGU6IHByb2Nlc3MuZW52W2Ake1RBQkxFX0VOVi50b1VwcGVyQ2FzZSgpfV9UQUJMRWBdID8/IFRBQkxFX0VOVixcbiAgY2xpZW50OiBkb2NDbGllbnQsXG59O1xuXG5leHBvcnQgY29uc3QgT2JzZXJ2YWJpbGl0eUxvZ0VudGl0eVNjaGVtYSA9IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gIG1vZGVsOiB7XG4gICAgdmVyc2lvbjogJzEnLFxuICAgIGVudGl0eTogJ2xvZycsXG4gICAgZW50aXR5TmFtZVBsdXJhbDogJ2xvZ3MnLFxuICAgIHNlcnZpY2U6ICdvYnNlcnZhYmlsaXR5JyxcbiAgICBlbnRpdHlPcGVyYXRpb25zOiBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucyxcbiAgICBleGNsdWRlRnJvbUFkbWluTWVudTogdHJ1ZSxcbiAgICBleGNsdWRlRnJvbUFkbWluQ3JlYXRlOiB0cnVlLFxuICAgIGV4Y2x1ZGVGcm9tQWRtaW5VcGRhdGU6IHRydWUsXG4gICAgZXhjbHVkZUZyb21BZG1pbkRlbGV0ZTogdHJ1ZSxcbiAgfSxcbiAgYXR0cmlidXRlczoge1xuICAgIGxvZ0lkOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgaXNJZGVudGlmaWVyOiB0cnVlLFxuICAgICAgZGVmYXVsdDogKCkgPT4gcmFuZG9tVVVJRCgpLFxuICAgIH0sXG4gICAgcGFyZW50TG9nSWQ6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgIH0sXG4gICAgY29ycmVsYXRpb25JZDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgIGRlZmF1bHQ6ICgpID0+IHJhbmRvbVVVSUQoKSxcbiAgICB9LFxuICAgIHR5cGU6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgfSxcbiAgICBzdWJUeXBlOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICB9LFxuICAgIGxldmVsOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgZGVmYXVsdDogKCkgPT4gJ2luZm8nLFxuICAgIH0sXG4gICAgdGltZXN0YW1wTXM6IHtcbiAgICAgIHR5cGU6ICdudW1iZXInLFxuICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICBkZWZhdWx0OiAoKSA9PiBEYXRlLm5vdygpLFxuICAgIH0sXG4gICAgZHVyYXRpb25Nczoge1xuICAgICAgdHlwZTogJ251bWJlcicsXG4gICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgfSxcbiAgICBzdWNjZXNzOiB7XG4gICAgICB0eXBlOiAnYm9vbGVhbicsXG4gICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgfSxcbiAgICBzdGF0dXM6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgIH0sXG4gICAgZW50aXR5TmFtZToge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgfSxcbiAgICBlbnRpdHlJZDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgfSxcbiAgICBvcGVyYXRpb246IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgIH0sXG4gICAgc291cmNlOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICB9LFxuICAgIHRhZ3M6IHtcbiAgICAgIHR5cGU6ICdtYXAnLFxuICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgcHJvcGVydGllczoge30sXG4gICAgfSxcbiAgICBtZXRyaWNzOiB7XG4gICAgICB0eXBlOiAnbWFwJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgIHByb3BlcnRpZXM6IHt9LFxuICAgIH0sXG4gICAgYXR0cmlidXRlczoge1xuICAgICAgdHlwZTogJ21hcCcsXG4gICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICBwcm9wZXJ0aWVzOiB7fSxcbiAgICB9LFxuICAgIGRhdGE6IHtcbiAgICAgIHR5cGU6ICdtYXAnLFxuICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgcHJvcGVydGllczoge30sXG4gICAgfSxcbiAgICBtZXRhZGF0YToge1xuICAgICAgdHlwZTogJ21hcCcsXG4gICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICBwcm9wZXJ0aWVzOiB7fSxcbiAgICB9LFxuICAgIGVycm9yOiB7XG4gICAgICB0eXBlOiAnbWFwJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgdHlwZTogeyB0eXBlOiAnc3RyaW5nJyB9LFxuICAgICAgICBtZXNzYWdlOiB7IHR5cGU6ICdzdHJpbmcnIH0sXG4gICAgICAgIHN0YWNrOiB7IHR5cGU6ICdzdHJpbmcnIH0sXG4gICAgICB9LFxuICAgIH0sXG4gICAgYWN0b3I6IHtcbiAgICAgIHR5cGU6ICdtYXAnLFxuICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgcHJvcGVydGllczoge30sXG4gICAgfSxcbiAgICBjb250ZXh0OiB7XG4gICAgICB0eXBlOiAnbWFwJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgIHByb3BlcnRpZXM6IHt9LFxuICAgIH0sXG4gICAgdHRsOiB7XG4gICAgICB0eXBlOiAnbnVtYmVyJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgIGRlZmF1bHQ6ICgpID0+IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApICsgOTAgKiAyNCAqIDYwICogNjAsXG4gICAgfSxcbiAgfSxcbiAgaW5kZXhlczoge1xuICAgIHByaW1hcnk6IHtcbiAgICAgIHBrOiB7IGZpZWxkOiAncGsnLCBjb21wb3NpdGU6IFsnbG9nSWQnXSB9LFxuICAgICAgc2s6IHsgZmllbGQ6ICdzaycsIGNvbXBvc2l0ZTogW10gfSxcbiAgICB9LFxuICAgIGJ5VHJhY2U6IHtcbiAgICAgIGluZGV4OiAnZ3NpMScsXG4gICAgICBwazogeyBmaWVsZDogJ2dzaTFwaycsIGNvbXBvc2l0ZTogWydjb3JyZWxhdGlvbklkJ10gfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnZ3NpMXNrJywgY29tcG9zaXRlOiBbJ3RpbWVzdGFtcE1zJ10gfSxcbiAgICB9LFxuICAgIGJ5UGFyZW50OiB7XG4gICAgICBpbmRleDogJ2dzaTInLFxuICAgICAgcGs6IHsgZmllbGQ6ICdnc2kycGsnLCBjb21wb3NpdGU6IFsncGFyZW50TG9nSWQnXSB9LFxuICAgICAgc2s6IHsgZmllbGQ6ICdnc2kyc2snLCBjb21wb3NpdGU6IFsndGltZXN0YW1wTXMnXSB9LFxuICAgIH0sXG4gICAgYnlFbnRpdHk6IHtcbiAgICAgIGluZGV4OiAnZ3NpMycsXG4gICAgICBwazogeyBmaWVsZDogJ2dzaTNwaycsIGNvbXBvc2l0ZTogWydlbnRpdHlOYW1lJywgJ2VudGl0eUlkJ10gfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnZ3NpM3NrJywgY29tcG9zaXRlOiBbJ3RpbWVzdGFtcE1zJ10gfSxcbiAgICB9LFxuICAgIGJ5TGV2ZWw6IHtcbiAgICAgIGluZGV4OiAnZ3NpNCcsXG4gICAgICBwazogeyBmaWVsZDogJ2dzaTRwaycsIGNvbXBvc2l0ZTogWydsZXZlbCddIH0sXG4gICAgICBzazogeyBmaWVsZDogJ2dzaTRzaycsIGNvbXBvc2l0ZTogWyd0aW1lc3RhbXBNcyddIH0sXG4gICAgfSxcbiAgICBieVR5cGU6IHtcbiAgICAgIGluZGV4OiAnZ3NpNScsXG4gICAgICBwazogeyBmaWVsZDogJ2dzaTVwaycsIGNvbXBvc2l0ZTogWyd0eXBlJ10gfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnZ3NpNXNrJywgY29tcG9zaXRlOiBbJ3RpbWVzdGFtcE1zJ10gfSxcbiAgICB9LFxuICAgIGJ5U291cmNlOiB7XG4gICAgICBpbmRleDogJ2dzaTYnLFxuICAgICAgcGs6IHsgZmllbGQ6ICdnc2k2cGsnLCBjb21wb3NpdGU6IFsnc291cmNlJ10gfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnZ3NpNnNrJywgY29tcG9zaXRlOiBbJ3RpbWVzdGFtcE1zJ10gfSxcbiAgICB9LFxuICB9LFxufSBhcyBjb25zdCk7XG5cbmV4cG9ydCBjb25zdCBPYnNlcnZhYmlsaXR5TG9nRW50aXR5ID0gKCkgPT5cbiAgY3JlYXRlRWxlY3Ryb0RCRW50aXR5KHtcbiAgICBzY2hlbWE6IE9ic2VydmFiaWxpdHlMb2dFbnRpdHlTY2hlbWEsXG4gICAgZW50aXR5Q29uZmlndXJhdGlvbnM6IE9ic2VydmFiaWxpdHlMb2dFbnRpdHlDb25maWcsXG4gIH0pLmVudGl0eTtcblxuIl19