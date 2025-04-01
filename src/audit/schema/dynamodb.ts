import { randomUUID } from 'crypto';
import { DefaultEntityOperations, createEntitySchema } from '../../entity';

export const auditSchema = createEntitySchema({
  model: {
    version: '1',
    entity: 'auditLog',
    entityNamePlural: 'auditLogs',
    entityOperations: DefaultEntityOperations,
    service: 'auditLog',
  },
  attributes: {
    auditId: {
      type: 'string',
      required: true,
      readOnly: true,
      isVisible: false,
      isEditable: false,
      isCreatable: false,
      isIdentifier: true,
      default: () => randomUUID(),
    },
    entityName: {
      type: 'string',
      required: true,
      isEditable: false,
    },
    eventType: {
      type: 'string',
      required: true,
      isEditable: false,
    },
    timestamp: {
      type: 'string',
      required: true,
      isEditable: false,
      default: () => new Date().toISOString(),
    },
    data: {
      type: 'any',
      required: false,
      isEditable: false,
    },
    entity: {
      type: 'map',
      required: false,
      isEditable: false,
      properties: {
        '*': { type: 'any' },
      },
    },
    actor: {
      type: 'map',
      required: false,
      isEditable: false,
      properties: {
        '*': { type: 'any' },
      },
    },
    tenant: {
      type: 'map',
      required: false,
      isEditable: false,
      properties: {
        '*': { type: 'any' },
      },
    },
    identifiers: {
      type: 'map',
      required: false,
      isEditable: false,
      properties: {
        id: { type: 'string' },
      },
    },
  },
  indexes: {
    primary: {
      pk: {
        field: 'pk',
        composite: ['auditId'],
      },
      sk: {
        field: 'sk',
        composite: [],
      },
    },
  },
});

export type AuditSchemaType = typeof auditSchema;
