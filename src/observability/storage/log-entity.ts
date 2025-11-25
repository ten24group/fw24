import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { EntityConfiguration } from 'electrodb';
import { DefaultEntityOperations, createElectroDBEntity, createEntitySchema } from '../../entity';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: {
    convertClassInstanceToMap: true,
    removeUndefinedValues: true,
    convertEmptyValues: true,
  },
});

const TABLE_ENV = process.env.AUDIT_TABLE_NAME ?? 'AuditLogs';
export const ObservabilityLogEntityConfig: EntityConfiguration = {
  table: process.env[`${TABLE_ENV.toUpperCase()}_TABLE`] ?? TABLE_ENV,
  client: docClient,
};

export const ObservabilityLogEntitySchema = createEntitySchema({
  model: {
    version: '1',
    entity: 'log',
    entityNamePlural: 'logs',
    service: 'observability',
    entityOperations: DefaultEntityOperations,
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
      default: () => randomUUID(),
    },
    parentLogId: {
      type: 'string',
      required: false,
    },
    correlationId: {
      type: 'string',
      required: true,
      default: () => randomUUID(),
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
} as const);

export const ObservabilityLogEntity = () =>
  createElectroDBEntity({
    schema: ObservabilityLogEntitySchema,
    entityConfigurations: ObservabilityLogEntityConfig,
  }).entity;

