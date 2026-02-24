import { createEntitySchema } from './base-entity';
import { DefaultEntityOperations } from './constants';

describe('createEntitySchema extra properties', () => {
    it('should preserve extra properties on attributes', () => {
        const schema = createEntitySchema({
            model: {
                entity: 'test',
                service: 'test',
                version: '1',
                entityOperations: DefaultEntityOperations
            },
            attributes: {
                id: { type: 'string', isIdentifier: true },
                name: { type: 'string', validations: [{ required: true }] as any }
            },
            indexes: { primary: { pk: { field: 'pk', composite: ['id'] }, sk: { field: 'sk', composite: [] } } }
        } as const);

        expect(schema.attributes.name.validations).toBeDefined();
        expect(schema.attributes.name.validations[0].required).toBe(true);
    });
});
