/**
 * Tests for change detection utilities.
 * 
 * These pure utility functions are tested independently without complex dependencies.
 */
import { getChangedProperties, DEFAULT_IGNORED_FIELDS } from './change-detection';

describe('Change Detection Utilities', () => {
    describe('getChangedProperties', () => {
        it('should detect simple property changes', () => {
            const oldImage = { name: 'John', age: 30 };
            const newImage = { name: 'Jane', age: 30 };

            const changes = getChangedProperties(oldImage, newImage);

            expect(changes).toEqual({
                name: { old: 'John', new: 'Jane' }
            });
        });

        it('should detect property additions', () => {
            const oldImage = { name: 'John' };
            const newImage = { name: 'John', email: 'john@example.com' };

            const changes = getChangedProperties(oldImage, newImage);

            expect(changes).toEqual({
                email: { new: 'john@example.com' }
            });
        });

        it('should detect property deletions', () => {
            const oldImage = { name: 'John', email: 'john@example.com' };
            const newImage = { name: 'John' };

            const changes = getChangedProperties(oldImage, newImage);

            expect(changes).toEqual({
                email: { old: 'john@example.com' }
            });
        });

        it('should ignore specified fields', () => {
            const oldImage = { name: 'John', updatedAt: '2024-01-01' };
            const newImage = { name: 'Jane', updatedAt: '2024-01-02' };

            const changes = getChangedProperties(oldImage, newImage);

            // updatedAt is in default ignored fields
            expect(changes).toEqual({
                name: { old: 'John', new: 'Jane' }
            });
        });

        it('should handle nested object changes', () => {
            const oldImage = {
                user: { name: 'John', address: { city: 'NYC' } }
            };
            const newImage = {
                user: { name: 'John', address: { city: 'LA' } }
            };

            const changes = getChangedProperties(oldImage, newImage);

            expect(changes.user).toBeDefined();
            expect(changes.user.old).toEqual({ address: { city: 'NYC' } });
            expect(changes.user.new).toEqual({ address: { city: 'LA' } });
        });

        it('should handle array changes', () => {
            const oldImage = { tags: ['a', 'b'] };
            const newImage = { tags: ['a', 'c'] };

            const changes = getChangedProperties(oldImage, newImage);

            expect(changes.tags).toBeDefined();
        });

        it('should return empty object when no changes', () => {
            const oldImage = { name: 'John', age: 30 };
            const newImage = { name: 'John', age: 30 };

            const changes = getChangedProperties(oldImage, newImage);

            expect(changes).toEqual({});
        });

        it('should handle creation (no old image)', () => {
            const newImage = { name: 'John', email: 'john@example.com' };

            const changes = getChangedProperties(undefined, newImage);

            expect(changes).toEqual({
                name: { new: 'John' },
                email: { new: 'john@example.com' }
            });
        });

        it('should handle deletion (no new image)', () => {
            const oldImage = { name: 'John', email: 'john@example.com' };

            const changes = getChangedProperties(oldImage, undefined);

            expect(changes).toEqual({
                name: { old: 'John' },
                email: { old: 'john@example.com' }
            });
        });

        it('should ignore GSI keys', () => {
            const oldImage = { 
                name: 'John', 
                gsi1pk: 'USER#123',
                gsi1sk: 'PROFILE'
            };
            const newImage = { 
                name: 'Jane', 
                gsi1pk: 'USER#456',
                gsi1sk: 'PROFILE'
            };

            const changes = getChangedProperties(oldImage, newImage);

            expect(changes).toEqual({
                name: { old: 'John', new: 'Jane' }
            });
            expect(changes.gsi1pk).toBeUndefined();
            expect(changes.gsi1sk).toBeUndefined();
        });

        it('should ignore _actor field', () => {
            const oldImage = { 
                name: 'John', 
                _actor: { actorId: 'user-1', actorType: 'user' }
            };
            const newImage = { 
                name: 'Jane', 
                _actor: { actorId: 'user-2', actorType: 'user' }
            };

            const changes = getChangedProperties(oldImage, newImage);

            expect(changes).toEqual({
                name: { old: 'John', new: 'Jane' }
            });
            expect(changes._actor).toBeUndefined();
        });

        it('should handle type changes', () => {
            const oldImage = { value: '123' };
            const newImage = { value: 123 };

            const changes = getChangedProperties(oldImage, newImage);

            expect(changes).toEqual({
                value: { old: '123', new: 123 }
            });
        });

        it('should handle null values', () => {
            const oldImage = { name: 'John', nickname: null };
            const newImage = { name: 'John', nickname: 'Johnny' };

            const changes = getChangedProperties(oldImage, newImage);

            expect(changes).toEqual({
                nickname: { old: null, new: 'Johnny' }
            });
        });
        
        it('should ignore pk and sk fields', () => {
            const oldImage = { 
                name: 'John', 
                pk: 'USER#123',
                sk: 'PROFILE#456'
            };
            const newImage = { 
                name: 'Jane', 
                pk: 'USER#123',
                sk: 'PROFILE#456'
            };

            const changes = getChangedProperties(oldImage, newImage);

            expect(changes).toEqual({
                name: { old: 'John', new: 'Jane' }
            });
            expect(changes.pk).toBeUndefined();
            expect(changes.sk).toBeUndefined();
        });

        it('should handle deeply nested changes', () => {
            const oldImage = {
                config: {
                    settings: {
                        theme: {
                            primary: 'blue'
                        }
                    }
                }
            };
            const newImage = {
                config: {
                    settings: {
                        theme: {
                            primary: 'red'
                        }
                    }
                }
            };

            const changes = getChangedProperties(oldImage, newImage);

            expect(changes.config).toBeDefined();
        });

        it('should handle both images being undefined', () => {
            const changes = getChangedProperties(undefined, undefined);
            expect(changes).toEqual({});
        });

        it('should allow custom ignored fields', () => {
            const oldImage = { name: 'John', customField: 'old' };
            const newImage = { name: 'Jane', customField: 'new' };

            const changes = getChangedProperties(oldImage, newImage, ['customField']);

            expect(changes).toEqual({
                name: { old: 'John', new: 'Jane' }
            });
            expect(changes.customField).toBeUndefined();
        });

        it('should handle array element additions', () => {
            const oldImage = { items: ['a'] };
            const newImage = { items: ['a', 'b'] };

            const changes = getChangedProperties(oldImage, newImage);

            expect(changes.items).toBeDefined();
            expect(changes.items.new).toContain('b');
        });

        it('should handle array element removals', () => {
            const oldImage = { items: ['a', 'b'] };
            const newImage = { items: ['a'] };

            const changes = getChangedProperties(oldImage, newImage);

            expect(changes.items).toBeDefined();
            expect(changes.items.old).toContain('b');
        });
    });

    describe('DEFAULT_IGNORED_FIELDS', () => {
        it('should contain expected default fields', () => {
            expect(DEFAULT_IGNORED_FIELDS).toContain('updatedAt');
            expect(DEFAULT_IGNORED_FIELDS).toContain('pk');
            expect(DEFAULT_IGNORED_FIELDS).toContain('sk');
            expect(DEFAULT_IGNORED_FIELDS).toContain('_actor');
            expect(DEFAULT_IGNORED_FIELDS).toContain('__edb_e__');
            expect(DEFAULT_IGNORED_FIELDS).toContain('__edb_v__');
        });

        it('should contain all GSI key fields', () => {
            expect(DEFAULT_IGNORED_FIELDS).toContain('gsi1pk');
            expect(DEFAULT_IGNORED_FIELDS).toContain('gsi1sk');
            expect(DEFAULT_IGNORED_FIELDS).toContain('gsi2pk');
            expect(DEFAULT_IGNORED_FIELDS).toContain('gsi2sk');
            expect(DEFAULT_IGNORED_FIELDS).toContain('gsi3pk');
            expect(DEFAULT_IGNORED_FIELDS).toContain('gsi3sk');
            expect(DEFAULT_IGNORED_FIELDS).toContain('gsi4pk');
            expect(DEFAULT_IGNORED_FIELDS).toContain('gsi4sk');
        });
    });
});

