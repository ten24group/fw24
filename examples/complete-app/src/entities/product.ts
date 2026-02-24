import { createEntitySchema, DefaultEntityOperations } from '@ten24group/fw24';

export const ProductEntity = createEntitySchema({
  model: {
    entity: 'product',
    version: '1',
    service: 'store',
    entityNamePlural: 'Products',
    entityOperations: DefaultEntityOperations
  },
  attributes: {
    id: {
      type: 'string',
      required: true
    },
    name: {
      type: 'string',
      required: true
    },
    price: {
      type: 'number',
      required: true
    }
  },
  indexes: {
    primary: {
      pk: {
        field: 'pk',
        composite: ['id']
      },
      sk: {
        field: 'sk',
        composite: []
      }
    }
  }
} as const);
