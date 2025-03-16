import { randomUUID } from 'crypto';
import {
    DefaultEntityOperations,
    createEntitySchema,
} from '../entity';

export const createAuditSchema = () => createEntitySchema({
    model: {
        version: '1',
        entity: 'audit',
        entityNamePlural: 'audits',
        entityOperations: DefaultEntityOperations,
        service: 'audit'
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
            default: () => randomUUID()
        },
        entityName: {
            type: 'string',
            required: true,
            isEditable: false,
        },
        crudType: {
            type: 'string',
            required: true,
            isEditable: false,
        },
        timestamp: {
            type: 'string',
            required: true,
            isEditable: false,
            default: () => new Date().toISOString()
        },
        data: {
            type: 'map',
            required: false,
            isEditable: false,
            properties: {
                '*': { type: 'any' }
            }
        },
        entity: {
            type: 'map',
            required: false,
            isEditable: false,
            properties: {
                '*': { type: 'any' }
            }
        },
        actor: {
            type: 'map',
            required: false,
            isEditable: false,
            properties: {
                '*': { type: 'any' }
            }
        },
        tenant: {
            type: 'map',
            required: false,
            isEditable: false,
            properties: {
                '*': { type: 'any' }
            }
        },
        identifiers: {
            type: 'map',
            required: false,
            isEditable: false,
            properties: {
                '*': { type: 'any' }
            }
        }
    },
    indexes: {
        primary: {
            pk: {
                field: 'auditId',
                composite: []
            },
            sk: {
                field: 'timestamp',
                composite: []
            }
        }
    }
}); 