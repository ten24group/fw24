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
    },
});
const ObservabilityLogEntity = () => (0, entity_1.createElectroDBEntity)({
    schema: exports.ObservabilityLogEntitySchema,
    entityConfigurations: exports.ObservabilityLogEntityConfig,
}).entity;
exports.ObservabilityLogEntity = ObservabilityLogEntity;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9nLWVudGl0eS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L3N0b3JhZ2UvbG9nLWVudGl0eS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSw4REFBMEQ7QUFDMUQsd0RBQStEO0FBQy9ELG1DQUFvQztBQUVwQyx5Q0FBa0c7QUFFbEcsTUFBTSxTQUFTLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0FBQ3pDLE1BQU0sU0FBUyxHQUFHLHFDQUFzQixDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUU7SUFDdkQsZUFBZSxFQUFFO1FBQ2YseUJBQXlCLEVBQUUsSUFBSTtRQUMvQixxQkFBcUIsRUFBRSxJQUFJO1FBQzNCLGtCQUFrQixFQUFFLElBQUk7S0FDekI7Q0FDRixDQUFDLENBQUM7QUFFSCxNQUFNLFNBQVMsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGdCQUFnQixJQUFJLFdBQVcsQ0FBQztBQUNqRCxRQUFBLDRCQUE0QixHQUF3QjtJQUMvRCxLQUFLLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxHQUFHLFNBQVMsQ0FBQyxXQUFXLEVBQUUsUUFBUSxDQUFDLElBQUksU0FBUztJQUNuRSxNQUFNLEVBQUUsU0FBUztDQUNsQixDQUFDO0FBRVcsUUFBQSw0QkFBNEIsR0FBRyxJQUFBLDJCQUFrQixFQUFDO0lBQzdELEtBQUssRUFBRTtRQUNMLE9BQU8sRUFBRSxHQUFHO1FBQ1osTUFBTSxFQUFFLEtBQUs7UUFDYixnQkFBZ0IsRUFBRSxNQUFNO1FBQ3hCLE9BQU8sRUFBRSxlQUFlO1FBQ3hCLGdCQUFnQixFQUFFLGdDQUF1QjtRQUN6QyxvQkFBb0IsRUFBRSxJQUFJO1FBQzFCLHNCQUFzQixFQUFFLElBQUk7UUFDNUIsc0JBQXNCLEVBQUUsSUFBSTtRQUM1QixzQkFBc0IsRUFBRSxJQUFJO0tBQzdCO0lBQ0QsVUFBVSxFQUFFO1FBQ1YsS0FBSyxFQUFFO1lBQ0ws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LEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxDQUFDLGFBQWEsQ0FBQyxFQUFFO1NBQ3BEO1FBQ0QsTUFBTSxFQUFFO1lBQ04sS0FBSyxFQUFFLE1BQU07WUFDYixFQUFFLEVBQUUsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxDQUFDLE1BQU0sQ0FBQyxFQUFFO1lBQzVDLEVBQUUsRUFBRSxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsU0FBUyxFQUFFLENBQUMsYUFBYSxDQUFDLEVBQUU7U0FDcEQ7S0FDRjtDQUNPLENBQUMsQ0FBQztBQUVMLE1BQU0sc0JBQXNCLEdBQUcsR0FBRyxFQUFFLENBQ3pDLElBQUEsOEJBQXFCLEVBQUM7SUFDcEIsTUFBTSxFQUFFLG9DQUE0QjtJQUNwQyxvQkFBb0IsRUFBRSxvQ0FBNEI7Q0FDbkQsQ0FBQyxDQUFDLE1BQU0sQ0FBQztBQUpDLFFBQUEsc0JBQXNCLDBCQUl2QiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IER5bmFtb0RCQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJztcbmltcG9ydCB7IER5bmFtb0RCRG9jdW1lbnRDbGllbnQgfSBmcm9tICdAYXdzLXNkay9saWItZHluYW1vZGInO1xuaW1wb3J0IHsgcmFuZG9tVVVJRCB9IGZyb20gJ2NyeXB0byc7XG5pbXBvcnQgeyBFbnRpdHlDb25maWd1cmF0aW9uIH0gZnJvbSAnZWxlY3Ryb2RiJztcbmltcG9ydCB7IERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLCBjcmVhdGVFbGVjdHJvREJFbnRpdHksIGNyZWF0ZUVudGl0eVNjaGVtYSB9IGZyb20gJy4uLy4uL2VudGl0eSc7XG5cbmNvbnN0IGRkYkNsaWVudCA9IG5ldyBEeW5hbW9EQkNsaWVudCh7fSk7XG5jb25zdCBkb2NDbGllbnQgPSBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LmZyb20oZGRiQ2xpZW50LCB7XG4gIG1hcnNoYWxsT3B0aW9uczoge1xuICAgIGNvbnZlcnRDbGFzc0luc3RhbmNlVG9NYXA6IHRydWUsXG4gICAgcmVtb3ZlVW5kZWZpbmVkVmFsdWVzOiB0cnVlLFxuICAgIGNvbnZlcnRFbXB0eVZhbHVlczogdHJ1ZSxcbiAgfSxcbn0pO1xuXG5jb25zdCBUQUJMRV9FTlYgPSBwcm9jZXNzLmVudi5BVURJVF9UQUJMRV9OQU1FID8/ICdBdWRpdExvZ3MnO1xuZXhwb3J0IGNvbnN0IE9ic2VydmFiaWxpdHlMb2dFbnRpdHlDb25maWc6IEVudGl0eUNvbmZpZ3VyYXRpb24gPSB7XG4gIHRhYmxlOiBwcm9jZXNzLmVudltgJHtUQUJMRV9FTlYudG9VcHBlckNhc2UoKX1fVEFCTEVgXSA/PyBUQUJMRV9FTlYsXG4gIGNsaWVudDogZG9jQ2xpZW50LFxufTtcblxuZXhwb3J0IGNvbnN0IE9ic2VydmFiaWxpdHlMb2dFbnRpdHlTY2hlbWEgPSBjcmVhdGVFbnRpdHlTY2hlbWEoe1xuICBtb2RlbDoge1xuICAgIHZlcnNpb246ICcxJyxcbiAgICBlbnRpdHk6ICdsb2cnLFxuICAgIGVudGl0eU5hbWVQbHVyYWw6ICdsb2dzJyxcbiAgICBzZXJ2aWNlOiAnb2JzZXJ2YWJpbGl0eScsXG4gICAgZW50aXR5T3BlcmF0aW9uczogRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgZXhjbHVkZUZyb21BZG1pbk1lbnU6IHRydWUsXG4gICAgZXhjbHVkZUZyb21BZG1pbkNyZWF0ZTogdHJ1ZSxcbiAgICBleGNsdWRlRnJvbUFkbWluVXBkYXRlOiB0cnVlLFxuICAgIGV4Y2x1ZGVGcm9tQWRtaW5EZWxldGU6IHRydWUsXG4gIH0sXG4gIGF0dHJpYnV0ZXM6IHtcbiAgICBsb2dJZDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgIGlzSWRlbnRpZmllcjogdHJ1ZSxcbiAgICAgIGRlZmF1bHQ6ICgpID0+IHJhbmRvbVVVSUQoKSxcbiAgICB9LFxuICAgIHBhcmVudExvZ0lkOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICB9LFxuICAgIGNvcnJlbGF0aW9uSWQ6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICBkZWZhdWx0OiAoKSA9PiByYW5kb21VVUlEKCksXG4gICAgfSxcbiAgICB0eXBlOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgIH0sXG4gICAgc3ViVHlwZToge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgfSxcbiAgICBsZXZlbDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgIGRlZmF1bHQ6ICgpID0+ICdpbmZvJyxcbiAgICB9LFxuICAgIHRpbWVzdGFtcE1zOiB7XG4gICAgICB0eXBlOiAnbnVtYmVyJyxcbiAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgZGVmYXVsdDogKCkgPT4gRGF0ZS5ub3coKSxcbiAgICB9LFxuICAgIGR1cmF0aW9uTXM6IHtcbiAgICAgIHR5cGU6ICdudW1iZXInLFxuICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgIH0sXG4gICAgc3VjY2Vzczoge1xuICAgICAgdHlwZTogJ2Jvb2xlYW4nLFxuICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgIH0sXG4gICAgc3RhdHVzOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICB9LFxuICAgIGVudGl0eU5hbWU6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgIH0sXG4gICAgZW50aXR5SWQ6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgIH0sXG4gICAgb3BlcmF0aW9uOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICB9LFxuICAgIG1ldHJpY3M6IHtcbiAgICAgIHR5cGU6ICdtYXAnLFxuICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgcHJvcGVydGllczoge30sXG4gICAgfSxcbiAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICB0eXBlOiAnbWFwJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgIHByb3BlcnRpZXM6IHt9LFxuICAgIH0sXG4gICAgZGF0YToge1xuICAgICAgdHlwZTogJ21hcCcsXG4gICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICBwcm9wZXJ0aWVzOiB7fSxcbiAgICB9LFxuICAgIG1ldGFkYXRhOiB7XG4gICAgICB0eXBlOiAnbWFwJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgIHByb3BlcnRpZXM6IHt9LFxuICAgIH0sXG4gICAgZXJyb3I6IHtcbiAgICAgIHR5cGU6ICdtYXAnLFxuICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgcHJvcGVydGllczoge1xuICAgICAgICB0eXBlOiB7IHR5cGU6ICdzdHJpbmcnIH0sXG4gICAgICAgIG1lc3NhZ2U6IHsgdHlwZTogJ3N0cmluZycgfSxcbiAgICAgICAgc3RhY2s6IHsgdHlwZTogJ3N0cmluZycgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgICBhY3Rvcjoge1xuICAgICAgdHlwZTogJ21hcCcsXG4gICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICBwcm9wZXJ0aWVzOiB7fSxcbiAgICB9LFxuICAgIGNvbnRleHQ6IHtcbiAgICAgIHR5cGU6ICdtYXAnLFxuICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgcHJvcGVydGllczoge30sXG4gICAgfSxcbiAgICB0dGw6IHtcbiAgICAgIHR5cGU6ICdudW1iZXInLFxuICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgZGVmYXVsdDogKCkgPT4gTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCkgKyA5MCAqIDI0ICogNjAgKiA2MCxcbiAgICB9LFxuICB9LFxuICBpbmRleGVzOiB7XG4gICAgcHJpbWFyeToge1xuICAgICAgcGs6IHsgZmllbGQ6ICdwaycsIGNvbXBvc2l0ZTogWydsb2dJZCddIH0sXG4gICAgICBzazogeyBmaWVsZDogJ3NrJywgY29tcG9zaXRlOiBbXSB9LFxuICAgIH0sXG4gICAgYnlUcmFjZToge1xuICAgICAgaW5kZXg6ICdnc2kxJyxcbiAgICAgIHBrOiB7IGZpZWxkOiAnZ3NpMXBrJywgY29tcG9zaXRlOiBbJ2NvcnJlbGF0aW9uSWQnXSB9LFxuICAgICAgc2s6IHsgZmllbGQ6ICdnc2kxc2snLCBjb21wb3NpdGU6IFsndGltZXN0YW1wTXMnXSB9LFxuICAgIH0sXG4gICAgYnlQYXJlbnQ6IHtcbiAgICAgIGluZGV4OiAnZ3NpMicsXG4gICAgICBwazogeyBmaWVsZDogJ2dzaTJwaycsIGNvbXBvc2l0ZTogWydwYXJlbnRMb2dJZCddIH0sXG4gICAgICBzazogeyBmaWVsZDogJ2dzaTJzaycsIGNvbXBvc2l0ZTogWyd0aW1lc3RhbXBNcyddIH0sXG4gICAgfSxcbiAgICBieUVudGl0eToge1xuICAgICAgaW5kZXg6ICdnc2kzJyxcbiAgICAgIHBrOiB7IGZpZWxkOiAnZ3NpM3BrJywgY29tcG9zaXRlOiBbJ2VudGl0eU5hbWUnLCAnZW50aXR5SWQnXSB9LFxuICAgICAgc2s6IHsgZmllbGQ6ICdnc2kzc2snLCBjb21wb3NpdGU6IFsndGltZXN0YW1wTXMnXSB9LFxuICAgIH0sXG4gICAgYnlMZXZlbDoge1xuICAgICAgaW5kZXg6ICdnc2k0JyxcbiAgICAgIHBrOiB7IGZpZWxkOiAnZ3NpNHBrJywgY29tcG9zaXRlOiBbJ2xldmVsJ10gfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnZ3NpNHNrJywgY29tcG9zaXRlOiBbJ3RpbWVzdGFtcE1zJ10gfSxcbiAgICB9LFxuICAgIGJ5VHlwZToge1xuICAgICAgaW5kZXg6ICdnc2k1JyxcbiAgICAgIHBrOiB7IGZpZWxkOiAnZ3NpNXBrJywgY29tcG9zaXRlOiBbJ3R5cGUnXSB9LFxuICAgICAgc2s6IHsgZmllbGQ6ICdnc2k1c2snLCBjb21wb3NpdGU6IFsndGltZXN0YW1wTXMnXSB9LFxuICAgIH0sXG4gIH0sXG59IGFzIGNvbnN0KTtcblxuZXhwb3J0IGNvbnN0IE9ic2VydmFiaWxpdHlMb2dFbnRpdHkgPSAoKSA9PlxuICBjcmVhdGVFbGVjdHJvREJFbnRpdHkoe1xuICAgIHNjaGVtYTogT2JzZXJ2YWJpbGl0eUxvZ0VudGl0eVNjaGVtYSxcbiAgICBlbnRpdHlDb25maWd1cmF0aW9uczogT2JzZXJ2YWJpbGl0eUxvZ0VudGl0eUNvbmZpZyxcbiAgfSkuZW50aXR5O1xuXG4iXX0=