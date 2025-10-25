"use strict";
/**
 * @fileoverview Type Safety Verification Test
 *
 * This file contains comprehensive type-level tests for all entity type helpers.
 * These tests validate type safety at compile time using TypeScript's type system.
 *
 * Tests cover:
 * - Entity Relations (direct, circular dependencies, lazy loading)
 * - Entity Queries (filters, hydration, pagination)
 * - Field Options (static, API-loaded, templates)
 * - Entity Operations (subsets, supersets, custom operations)
 * - Utility Types (attribute filtering, value types, etc.)
 * - Type Guards (runtime type checking)
 */
Object.defineProperty(exports, "__esModule", { value: true });
const base_entity_1 = require("./base-entity");
// Mock custom operations for testing
const ArticleOps = {
    ...base_entity_1.DefaultEntityOperations,
    publish: 'publish',
    unpublish: 'unpublish',
    archive: 'archive'
};
const ReadOnlyOps = (0, base_entity_1.createOperationsSubset)(['get', 'list', 'query']);
// ============================================================================
// SECTION 1: ENTITY RELATIONS
// ============================================================================
// TEST 1.1: Direct Relation - Type Safety on target field
const test1 = (0, base_entity_1.createEntityRelation)({
    entityName: 'team',
    type: 'many-to-one',
    // ✅ This should work - 'teamId' is valid
    identifiers: { source: 'teamId', target: 'teamId' }
});
const test1_error = (0, base_entity_1.createEntityRelation)({
    entityName: 'team',
    type: 'many-to-one',
    //@ts-expect-error - 'invalidField' is not in TeamSchema
    identifiers: { source: 'teamId', target: 'invalidField' }
});
// TEST 2: Multiple Identifiers - Type Safety
const test2 = (0, base_entity_1.createEntityRelation)({
    entityName: 'team',
    type: 'many-to-one',
    identifiers: [
        { source: 'teamId', target: 'teamId' },
        // ✅ Valid fields
        { source: 'city', target: 'city' }
    ]
});
// TEST 3: Circular Dependency - Lazy Identifiers
const test3 = (0, base_entity_1.createEntityRelation)({
    entityName: 'post',
    type: 'one-to-many',
    // ✅ Lazy function for circular deps
    identifiers: () => ({ source: 'userId', target: 'userId' })
});
// TEST 4: Lazy Identifiers with Type Safety
const test4 = (0, base_entity_1.createEntityRelation)({
    entityName: 'post',
    type: 'one-to-many',
    // @ts-expect-error - 'invalidField' is not in PostSchema
    identifiers: () => ({ source: 'userId', target: 'invalidField' })
});
// TEST 5: Relation with Lazy Attributes (for circular deps in hydration)
const test5 = (0, base_entity_1.createEntityRelation)({
    entityName: 'user',
    type: 'many-to-one',
    identifiers: () => ({ source: 'userId', target: 'userId' }),
    // ✅ Lazy attributes for complex circular deps
    attributes: () => ({ userId: true, name: true, email: true })
});
// TEST 6: Entity Query Type Safety
const test6 = (0, base_entity_1.createEntityQuery)({
    filters: {
        // ✅ Valid field
        age: { gte: 18 }
    },
    attributes: { userId: true, name: true }
});
const test6_error = (0, base_entity_1.createEntityQuery)({
    filters: {
        // @ts-expect-error - 'invalidField' is not in UserSchema
        invalidField: { eq: 'test' }
    }
});
// TEST 7: Hydrate Options Type Safety
const test7 = (0, base_entity_1.createHydrateOptions)({
    userId: true,
    name: true,
    // ✅ Valid fields
    email: true
});
// TEST 8: Hydrate Options with Nested Relations
const test8 = (0, base_entity_1.createHydrateOptions)({
    postId: true,
    title: true
    // NOTE: Nested relation hydration with attributes object requires
    // using HydrateOptionsMapForEntity type directly, not via the wrapper function
});
// TEST 9: Field Options with AttributesTemplate Type Safety
const test9 = (0, base_entity_1.createFieldOptions)({
    apiMethod: 'GET',
    apiUrl: '/api/teams',
    responseKey: 'data',
    optionMapping: {
        // ✅ Valid attribute
        label: 'teamName',
        value: 'teamId'
    }
});
const test9_error = (0, base_entity_1.createFieldOptions)({
    apiMethod: 'GET',
    apiUrl: '/api/teams',
    responseKey: 'data',
    optionMapping: {
        // @ts-expect-error - 'invalidField' is not in TeamSchema
        label: 'invalidField',
        value: 'teamId'
    }
});
// TEST 10: Field Options with Composed Label (AttributesTemplate)
const test10 = (0, base_entity_1.createFieldOptions)({
    apiMethod: 'GET',
    apiUrl: '/api/teams',
    responseKey: 'data',
    optionMapping: {
        label: {
            // ✅ Valid attributes in composite
            composite: ['teamName', 'city'],
            template: '{teamName} ({city})'
        },
        value: 'teamId'
    }
});
const test10_error = (0, base_entity_1.createFieldOptions)({
    apiMethod: 'GET',
    apiUrl: '/api/teams',
    responseKey: 'data',
    optionMapping: {
        label: {
            // @ts-expect-error - 'invalidField' not in TeamSchema composite
            composite: ['teamName', 'invalidField'],
            template: '{teamName} ({invalidField})'
        },
        value: 'teamId'
    }
});
// TEST 11: AttributesTemplate Direct Usage (without wrapper)
const test11 = {
    // ✅ Type-safe without wrapper function
    composite: ['teamName', 'city'],
    template: '{teamName} - {city}'
};
const test11_error = {
    // @ts-expect-error - 'invalidField' not valid
    composite: ['teamName', 'invalidField'],
    template: '{teamName} - {invalidField}'
};
// TEST 12: Verify Relation type directly (without wrapper)
const test12 = {
    entityName: 'team',
    type: 'many-to-one',
    // ✅ Type-safe target field
    identifiers: { source: 'teamId', target: 'teamId' }
};
const test12_error = {
    entityName: 'team',
    type: 'many-to-one',
    //@ts-expect-error - 'invalidField' not valid
    identifiers: { source: 'teamId', target: 'invalidField' }
};
const test2_1 = base_entity_1.DefaultEntityOperations;
const test2_2 = (0, base_entity_1.createOperationsSubset)(['get', 'list', 'query']);
// TEST 2.3: Operations Subset - No Delete
const test2_3 = (0, base_entity_1.createOperationsSubset)(['get', 'list', 'query', 'create', 'update']);
// TEST 2.4: Operations Superset - Custom Operations
const test2_4 = {
    ...base_entity_1.DefaultEntityOperations,
    approve: 'approve',
    reject: 'reject'
};
// Compile-time assertions
const test2_5_1 = true;
const test2_5_2 = false;
const test2_5_3 = true;
// All should be assignable to TEntityOperations
const test2_8_1 = base_entity_1.DefaultEntityOperations;
const test2_8_2 = { get: 'get', list: 'list' };
const test2_8_3 = { ...base_entity_1.DefaultEntityOperations, custom: 'custom' };
const test2_8_4 = { myOp: 'myOp' };
// TEST 2.12: Operation Type Guards in Practice
function handleOperation(_schema, operation, input) {
    // Type-safe operation handling based on the schema's operations
    if (operation === 'get' || operation === 'delete' || operation === 'duplicate') {
        // input is EntityIdentifiers or EntityIdentifiers[]
        const ids = input;
        return ids;
    }
    else if (operation === 'create' || operation === 'upsert') {
        // input is CreateEntityItem or UpsertEntityItem
        const data = input;
        return data;
    }
    else if (operation === 'update') {
        // input is UpdateEntityItem
        const data = input;
        return data;
    }
    // For custom operations or list/query operations
    return input;
}
// TEST 2.13: Operations Configuration Validation
// Valid configurations
const validConfig1 = base_entity_1.DefaultEntityOperations; // ✅ All operations
const validConfig2 = (0, base_entity_1.createOperationsSubset)(['get', 'list']); // ✅ Subset
const validConfig3 = { ...base_entity_1.DefaultEntityOperations, approve: 'approve' }; // ✅ Superset
const validConfig4 = { customOp: 'customOp' }; // ✅ Custom
// All are TEntityOperations
const test2_13_1 = validConfig1;
const test2_13_2 = validConfig2;
const test2_13_3 = validConfig3;
const test2_13_4 = validConfig4;
// TEST 2.14: createOperationsSubset Type Safety
const subset1 = (0, base_entity_1.createOperationsSubset)(['get', 'list', 'query']);
// @ts-expect-error - 'invalidOperation' is not a key of TDefaultEntityOperations
const subset_error = (0, base_entity_1.createOperationsSubset)(['get', 'list', 'invalidOperation']);
const defaultKeys = ['get', 'list', 'query', 'create', 'upsert', 'update', 'delete', 'duplicate'];
const test2_16_1 = true;
const test2_16_2 = true;
const test2_16_3 = false;
// Should be a record of all attributes with their value types
// TEST 3.5: AttributesTemplate Type Safety
const test3_5 = {
    composite: ['teamName', 'city'],
    template: '{teamName} - {city}'
};
const test3_5_error = {
    //@ts-expect-error - 'invalidField' not valid
    composite: ['teamName', 'invalidField'],
    template: '{teamName} - {invalidField}'
};
// ============================================================================
// SECTION 4: FIELD OPTIONS & TEMPLATES
// ============================================================================
// TEST 4.1: Simple Field Options
const test4_1 = (0, base_entity_1.createFieldOptions)({
    apiMethod: 'GET',
    apiUrl: '/api/teams',
    responseKey: 'data',
    optionMapping: {
        label: 'teamName',
        value: 'teamId'
    }
});
// TEST 4.2: Field Options with Template
const test4_2 = (0, base_entity_1.createFieldOptions)({
    apiMethod: 'GET',
    apiUrl: '/api/teams',
    responseKey: 'data',
    optionMapping: {
        label: {
            composite: ['teamName', 'city'],
            template: '{teamName} ({city})'
        },
        value: 'teamId'
    }
});
// TEST 4.3: Field Options with Query
const test4_3 = (0, base_entity_1.createFieldOptions)({
    apiMethod: 'GET',
    apiUrl: '/api/teams',
    responseKey: 'data',
    query: {
        filters: {
            isActive: { eq: true }
        }
    },
    optionMapping: {
        label: 'teamName',
        value: 'teamId'
    }
});
// TEST 4.4: Invalid Field in Options
const test4_4_error = (0, base_entity_1.createFieldOptions)({
    apiMethod: 'GET',
    apiUrl: '/api/teams',
    responseKey: 'data',
    optionMapping: {
        //@ts-expect-error - 'invalidField' not in TeamSchema
        label: 'invalidField',
        value: 'teamId'
    }
});
// ============================================================================
// SECTION 5: ENTITY QUERIES
// ============================================================================
// TEST 5.1: Simple Query with Filters
const test5_1 = (0, base_entity_1.createEntityQuery)({
    filters: {
        age: { gte: 18 },
        isActive: { eq: true }
    }
});
// TEST 5.2: Query with Attributes Selection
const test5_2 = (0, base_entity_1.createEntityQuery)({
    filters: {
        age: { gte: 18 }
    },
    attributes: ['userId', 'name', 'email']
});
// TEST 5.3: Query with Hydration
const test5_3 = (0, base_entity_1.createEntityQuery)({
    filters: {
        isActive: { eq: true }
    },
    attributes: (0, base_entity_1.createHydrateOptions)({
        userId: true,
        name: true,
        email: true,
        avatar: true
    })
});
// TEST 5.4: Query with Pagination
const test5_4 = (0, base_entity_1.createEntityQuery)({
    filters: {
        isActive: { eq: true }
    },
    pagination: {
        count: 20,
        order: 'asc'
    }
});
// TEST 5.5: Query with Search
const test5_5 = (0, base_entity_1.createEntityQuery)({
    search: 'john',
    searchAttributes: ['name', 'email'],
    pagination: {
        count: 10
    }
});
// TEST 5.6: Invalid Filter Field
const test5_6_error = (0, base_entity_1.createEntityQuery)({
    filters: {
        //@ts-expect-error - 'invalidField' not in UserSchema
        invalidField: { eq: 'test' }
    }
});
// ============================================================================
// SECTION 6: HYDRATE OPTIONS
// ============================================================================
// TEST 6.1: Simple Hydrate Options
const test6_1 = (0, base_entity_1.createHydrateOptions)({
    userId: true,
    name: true,
    email: true
});
// TEST 6.2: Hydrate Options with Array Paths
const test6_2 = (0, base_entity_1.createHydrateOptions)([
    'userId',
    'name',
    'email'
]);
// TEST 6.3: Nested Relation Hydration
const test6_3 = (0, base_entity_1.createHydrateOptions)({
    postId: true,
    title: true,
    content: true
});
// TEST 6.4: Lazy Hydration for Circular Dependencies
const test6_4 = (0, base_entity_1.createEntityRelation)({
    entityName: 'user',
    type: 'many-to-one',
    identifiers: () => ({ source: 'userId', target: 'userId' }),
    attributes: () => ({ userId: true, name: true, email: true })
});
// ============================================================================
// SECTION 7: TYPE GUARDS (Runtime Type Checking)
// ============================================================================
// TEST 7.1: Select Field Metadata
const test7_1_valid = {
    fieldType: 'select',
    options: [{ value: 'a', label: 'A' }]
};
if ((0, base_entity_1.isSelectFieldMetadata)(test7_1_valid)) {
    // Should narrow type to SelectFieldMetadata
    const options = test7_1_valid.options;
}
// TEST 7.2: Image Field Metadata
const test7_2_valid = {
    fieldType: 'image',
    accept: 'image/*'
};
if ((0, base_entity_1.isImageFieldMetadata)(test7_2_valid)) {
    const accept = test7_2_valid.accept;
}
// TEST 7.3: File Field Metadata
const test7_3_valid = {
    fieldType: 'file',
    maxFileSize: 1000000
};
if ((0, base_entity_1.isFileFieldMetadata)(test7_3_valid)) {
    const size = test7_3_valid.maxFileSize;
}
// TEST 7.4: Date Field Metadata
const test7_4_valid = {
    fieldType: 'date',
    minDate: new Date()
};
if ((0, base_entity_1.isDateFieldMetadata)(test7_4_valid)) {
    const min = test7_4_valid.minDate;
}
// TEST 7.5: DateTime Field Metadata
const test7_5_valid = {
    fieldType: 'datetime',
    minDateTime: new Date()
};
if ((0, base_entity_1.isDateTimeFieldMetadata)(test7_5_valid)) {
    const min = test7_5_valid.minDateTime;
}
// TEST 7.6: Number Field Metadata
const test7_6_valid = {
    fieldType: 'number',
    min: 0,
    max: 100
};
if ((0, base_entity_1.isNumberFieldMetadata)(test7_6_valid)) {
    const min = test7_6_valid.min;
}
// TEST 7.7: Boolean Field Metadata
const test7_7_valid = {
    fieldType: 'boolean',
    trueLabel: 'Yes',
    falseLabel: 'No'
};
if ((0, base_entity_1.isBooleanFieldMetadata)(test7_7_valid)) {
    const trueLabel = test7_7_valid.trueLabel;
}
// TEST 7.8: Editor Field Metadata
const test7_8_valid = {
    fieldType: 'rich-text'
};
if ((0, base_entity_1.isEditorFieldMetadata)(test7_8_valid)) {
    const type = test7_8_valid.fieldType;
}
// TEST 7.9: Code Editor Field Metadata
const test7_9_valid = {
    fieldType: 'code'
};
if ((0, base_entity_1.isCodeEditorFieldMetadata)(test7_9_valid)) {
    const type = test7_9_valid.fieldType;
}
// ============================================================================
// SECTION 8: COMPLEX SCENARIOS
// ============================================================================
// TEST 8.1: Circular Dependency Between Entities
const test8_1_user = (0, base_entity_1.createEntityRelation)({
    entityName: 'post',
    type: 'one-to-many',
    identifiers: () => ({ source: 'userId', target: 'userId' })
});
const test8_1_post = (0, base_entity_1.createEntityRelation)({
    entityName: 'user',
    type: 'many-to-one',
    identifiers: () => ({ source: 'userId', target: 'userId' }),
    attributes: () => ({ userId: true, name: true })
});
// TEST 8.2: Complex Query with Multiple Features
const test8_2 = (0, base_entity_1.createEntityQuery)({
    filters: {
        age: { gte: 18, lte: 65 },
        isActive: { eq: true }
    },
    search: 'john',
    searchAttributes: ['name', 'email'],
    attributes: (0, base_entity_1.createHydrateOptions)({
        userId: true,
        name: true,
        email: true,
        age: true
    }),
    pagination: {
        count: 25,
        order: 'desc'
    }
});
// TEST 8.3: Entity with Custom Operations and Queries
const test8_3_schema = (0, base_entity_1.createEntityQuery)({
    filters: {
        status: { eq: 'published' }
    },
    attributes: {
        articleId: true,
        title: true,
        status: true
    }
});
// TEST 8.4: Multiple Identifier Mappings
const test8_4 = (0, base_entity_1.createEntityRelation)({
    entityName: 'team',
    type: 'many-to-one',
    identifiers: [
        { source: 'teamId', target: 'teamId' },
        { source: 'city', target: 'city' }
    ]
});
// TEST 8.5: Lazy Identifiers with Type Safety
const test8_5 = (0, base_entity_1.createEntityRelation)({
    entityName: 'post',
    type: 'one-to-many',
    identifiers: () => [
        { source: 'userId', target: 'userId' },
        { source: 'postId', target: 'postId' }
    ]
});
// TEST 8.6: Field Options with Complex Template
const test8_6 = (0, base_entity_1.createFieldOptions)({
    apiMethod: 'GET',
    apiUrl: '/api/teams',
    responseKey: 'teams',
    query: {
        filters: {
            isActive: { eq: true }
        },
        pagination: {
            count: 100
        }
    },
    optionMapping: {
        label: {
            composite: ['teamName', 'city'],
            template: '{teamName} - {city}'
        },
        value: 'teamId'
    }
});
// ============================================================================
// VALIDATION & SUMMARY
// ============================================================================
console.log('✅ All type safety tests passed!');
console.log('');
console.log('Test Coverage:');
console.log('- Entity Relations: Direct, Circular Dependencies, Lazy Loading');
console.log('- Entity Operations: Subsets, Supersets, Custom Operations');
console.log('- Utility Types: Attribute Filtering, Value Type Extraction');
console.log('- Field Options: Static, API-loaded, Templates');
console.log('- Entity Queries: Filters, Hydration, Pagination, Search');
console.log('- Type Guards: Runtime Type Checking for All Field Types');
console.log('- Complex Scenarios: Multi-feature Queries, Circular Refs');
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1lbnRpdHkudHlwZXMudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9lbnRpdHkvYmFzZS1lbnRpdHkudHlwZXMudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7Ozs7Ozs7R0FhRzs7QUFFSCwrQ0FnQ3VCO0FBK0J2QixxQ0FBcUM7QUFDckMsTUFBTSxVQUFVLEdBQUc7SUFDakIsR0FBRyxxQ0FBdUI7SUFDMUIsT0FBTyxFQUFFLFNBQVM7SUFDbEIsU0FBUyxFQUFFLFdBQVc7SUFDdEIsT0FBTyxFQUFFLFNBQVM7Q0FDVixDQUFDO0FBRVgsTUFBTSxXQUFXLEdBQUcsSUFBQSxvQ0FBc0IsRUFBQyxDQUFDLEtBQUssRUFBRSxNQUFNLEVBQUUsT0FBTyxDQUFDLENBQUMsQ0FBQztBQUVyRSwrRUFBK0U7QUFDL0UsOEJBQThCO0FBQzlCLCtFQUErRTtBQUUvRSwwREFBMEQ7QUFDMUQsTUFBTSxLQUFLLEdBQUcsSUFBQSxrQ0FBb0IsRUFBYTtJQUM3QyxVQUFVLEVBQUUsTUFBTTtJQUNsQixJQUFJLEVBQUUsYUFBYTtJQUNuQix5Q0FBeUM7SUFDekMsV0FBVyxFQUFFLEVBQUUsTUFBTSxFQUFFLFFBQVEsRUFBRSxNQUFNLEVBQUUsUUFBUSxFQUFFO0NBQ3BELENBQUMsQ0FBQztBQUVILE1BQU0sV0FBVyxHQUFHLElBQUEsa0NBQW9CLEVBQWE7SUFDbkQsVUFBVSxFQUFFLE1BQU07SUFDbEIsSUFBSSxFQUFFLGFBQWE7SUFDbkIsd0RBQXdEO0lBQ3hELFdBQVcsRUFBRSxFQUFFLE1BQU0sRUFBRSxRQUFRLEVBQUUsTUFBTSxFQUFFLGNBQWMsRUFBRTtDQUMxRCxDQUFDLENBQUM7QUFFSCw2Q0FBNkM7QUFDN0MsTUFBTSxLQUFLLEdBQUcsSUFBQSxrQ0FBb0IsRUFBYTtJQUM3QyxVQUFVLEVBQUUsTUFBTTtJQUNsQixJQUFJLEVBQUUsYUFBYTtJQUNuQixXQUFXLEVBQUU7UUFDWCxFQUFF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QUNELEtBQUssRUFBRSxRQUFRO0tBQ2hCO0NBQ0YsQ0FBQyxDQUFDO0FBRUgsK0VBQStFO0FBQy9FLHVCQUF1QjtBQUN2QiwrRUFBK0U7QUFFL0UsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFDO0FBQy9DLE9BQU8sQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLENBQUM7QUFDaEIsT0FBTyxDQUFDLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDO0FBQzlCLE9BQU8sQ0FBQyxHQUFHLENBQUMsaUVBQWlFLENBQUMsQ0FBQztBQUMvRSxPQUFPLENBQUMsR0FBRyxDQUFDLDREQUE0RCxDQUFDLENBQUM7QUFDMUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyw2REFBNkQsQ0FBQyxDQUFDO0FBQzNFLE9BQU8sQ0FBQyxHQUFHLENBQUMsZ0RBQWdELENBQUMsQ0FBQztBQUM5RCxPQUFPLENBQUMsR0FBRyxDQUFDLDBEQUEwRCxDQUFDLENBQUM7QUFDeEUsT0FBTyxDQUFDLEdBQUcsQ0FBQywwREFBMEQsQ0FBQyxDQUFDO0FBQ3hFLE9BQU8sQ0FBQyxHQUFHLENBQUMsMkRBQTJELENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQGZpbGVvdmVydmlldyBUeXBlIFNhZmV0eSBWZXJpZmljYXRpb24gVGVzdFxuICogXG4gKiBUaGlzIGZpbGUgY29udGFpbnMgY29tcHJlaGVuc2l2ZSB0eXBlLWxldmVsIHRlc3RzIGZvciBhbGwgZW50aXR5IHR5cGUgaGVscGVycy5cbiAqIFRoZXNlIHRlc3RzIHZhbGlkYXRlIHR5cGUgc2FmZXR5IGF0IGNvbXBpbGUgdGltZSB1c2luZyBUeXBlU2NyaXB0J3MgdHlwZSBzeXN0ZW0uXG4gKiBcbiAqIFRlc3RzIGNvdmVyOlxuICogLSBFbnRpdHkgUmVsYXRpb25zIChkaXJlY3QsIGNpcmN1bGFyIGRlcGVuZGVuY2llcywgbGF6eSBsb2FkaW5nKVxuICogLSBFbnRpdHkgUXVlcmllcyAoZmlsdGVycywgaHlkcmF0aW9uLCBwYWdpbmF0aW9uKVxuICogLSBGaWVsZCBPcHRpb25zIChzdGF0aWMsIEFQSS1sb2FkZWQsIHRlbXBsYXRlcylcbiAqIC0gRW50aXR5IE9wZXJhdGlvbnMgKHN1YnNldHMsIHN1cGVyc2V0cywgY3VzdG9tIG9wZXJhdGlvbnMpXG4gKiAtIFV0aWxpdHkgVHlwZXMgKGF0dHJpYnV0ZSBmaWx0ZXJpbmcsIHZhbHVlIHR5cGVzLCBldGMuKVxuICogLSBUeXBlIEd1YXJkcyAocnVudGltZSB0eXBlIGNoZWNraW5nKVxuICovXG5cbmltcG9ydCB7IFxuICBFbnRpdHlTY2hlbWEsIFxuICBjcmVhdGVFbnRpdHlSZWxhdGlvbiwgXG4gIGNyZWF0ZUVudGl0eVF1ZXJ5LFxuICBjcmVhdGVIeWRyYXRlT3B0aW9ucyxcbiAgY3JlYXRlRmllbGRPcHRpb25zLFxuICBjcmVhdGVPcGVyYXRpb25zU3Vic2V0LFxuICBBdHRyaWJ1dGVzVGVtcGxhdGUsXG4gIFJlbGF0aW9uLFxuICBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucyxcbiAgVERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLFxuICBURW50aXR5T3BlcmF0aW9ucyxcbiAgT3BlcmF0aW9uc1N1YnNldCxcbiAgT3BlcmF0aW9uc1N1cGVyc2V0LFxuICBJc09wZXJhdGlvbkVuYWJsZWQsXG4gIFRFbnRpdHlPcHNJbnB1dFNjaGVtYXMsXG4gIEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWEsXG4gIENyZWF0ZUVudGl0eUl0ZW1UeXBlRnJvbVNjaGVtYSxcbiAgVXBkYXRlRW50aXR5SXRlbVR5cGVGcm9tU2NoZW1hLFxuICBWaXNpYmxlQXR0cmlidXRlS2V5cyxcbiAgV3JpdGFibGVBdHRyaWJ1dGVLZXlzLFxuICBBdHRyaWJ1dGVWYWx1ZVR5cGUsXG4gIEVudGl0eUF0dHJpYnV0ZVZhbHVlTWFwLFxuICBpc1NlbGVjdEZpZWxkTWV0YWRhdGEsXG4gIGlzSW1hZ2VGaWVsZE1ldGFkYXRhLFxuICBpc0ZpbGVGaWVsZE1ldGFkYXRhLFxuICBpc0RhdGVGaWVsZE1ldGFkYXRhLFxuICBpc0RhdGVUaW1lRmllbGRNZXRhZGF0YSxcbiAgaXNOdW1iZXJGaWVsZE1ldGFkYXRhLFxuICBpc0Jvb2xlYW5GaWVsZE1ldGFkYXRhLFxuICBpc0VkaXRvckZpZWxkTWV0YWRhdGEsXG4gIGlzQ29kZUVkaXRvckZpZWxkTWV0YWRhdGEsXG59IGZyb20gJy4vYmFzZS1lbnRpdHknO1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBNT0NLIFNDSEVNQVMgRk9SIFRFU1RJTkdcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxudHlwZSBVc2VyU2NoZW1hID0gRW50aXR5U2NoZW1hPFxuICAndXNlcklkJyB8ICduYW1lJyB8ICdlbWFpbCcgfCAnYWdlJyB8ICdpc0FjdGl2ZScgfCAnYXZhdGFyJyB8ICdjcmVhdGVkQXQnLFxuICBhbnksXG4gIGFueVxuPjtcblxudHlwZSBQb3N0U2NoZW1hID0gRW50aXR5U2NoZW1hPFxuICAncG9zdElkJyB8ICd0aXRsZScgfCAnY29udGVudCcgfCAndXNlcklkJyB8ICdzdGF0dXMnIHwgJ3B1Ymxpc2hlZEF0JyxcbiAgYW55LFxuICBhbnlcbj47XG5cbnR5cGUgVGVhbVNjaGVtYSA9IEVudGl0eVNjaGVtYTxcbiAgJ3RlYW1JZCcgfCAndGVhbU5hbWUnIHwgJ2NpdHknIHwgJ2xvZ28nIHwgJ2lzQWN0aXZlJyxcbiAgYW55LFxuICBhbnlcbj47XG5cbnR5cGUgQXJ0aWNsZVNjaGVtYSA9IEVudGl0eVNjaGVtYTxcbiAgJ2FydGljbGVJZCcgfCAndGl0bGUnIHwgJ2NvbnRlbnQnIHwgJ3N0YXR1cycsXG4gIGFueSxcbiAgYW55LFxuICB0eXBlb2YgQXJ0aWNsZU9wc1xuPjtcblxuLy8gTW9jayBjdXN0b20gb3BlcmF0aW9ucyBmb3IgdGVzdGluZ1xuY29uc3QgQXJ0aWNsZU9wcyA9IHtcbiAgLi4uRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gIHB1Ymxpc2g6ICdwdWJsaXNoJyxcbiAgdW5wdWJsaXNoOiAndW5wdWJsaXNoJyxcbiAgYXJjaGl2ZTogJ2FyY2hpdmUnXG59IGFzIGNvbnN0O1xuXG5jb25zdCBSZWFkT25seU9wcyA9IGNyZWF0ZU9wZXJhdGlvbnNTdWJzZXQoWydnZXQnLCAnbGlzdCcsICdxdWVyeSddKTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU0VDVElPTiAxOiBFTlRJVFkgUkVMQVRJT05TXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8vIFRFU1QgMS4xOiBEaXJlY3QgUmVsYXRpb24gLSBUeXBlIFNhZmV0eSBvbiB0YXJnZXQgZmllbGRcbmNvbnN0IHRlc3QxID0gY3JlYXRlRW50aXR5UmVsYXRpb248VGVhbVNjaGVtYT4oe1xuICBlbnRpdHlOYW1lOiAndGVhbScsXG4gIHR5cGU6ICdtYW55LXRvLW9uZScsXG4gIC8vIOKchSBUaGlzIHNob3VsZCB3b3JrIC0gJ3RlYW1JZCcgaXMgdmFsaWRcbiAgaWRlbnRpZmllcnM6IHsgc291cmNlOiAndGVhbUlkJywgdGFyZ2V0OiAndGVhbUlkJyB9XG59KTtcblxuY29uc3QgdGVzdDFfZXJyb3IgPSBjcmVhdGVFbnRpdHlSZWxhdGlvbjxUZWFtU2NoZW1hPih7XG4gIGVudGl0eU5hbWU6ICd0ZWFtJyxcbiAgdHlwZTogJ21hbnktdG8tb25lJyxcbiAgLy9AdHMtZXhwZWN0LWVycm9yIC0gJ2ludmFsaWRGaWVsZCcgaXMgbm90IGluIFRlYW1TY2hlbWFcbiAgaWRlbnRpZmllcnM6IHsgc291cmNlOiAndGVhbUlkJywgdGFyZ2V0OiAnaW52YWxpZEZpZWxkJyB9XG59KTtcblxuLy8gVEVTVCAyOiBNdWx0aXBsZSBJZGVudGlmaWVycyAtIFR5cGUgU2FmZXR5XG5jb25zdCB0ZXN0MiA9IGNyZWF0ZUVudGl0eVJlbGF0aW9uPFRlYW1TY2hlbWE+KHtcbiAgZW50aXR5TmFtZTogJ3RlYW0nLFxuICB0eXBlOiAnbWFueS10by1vbmUnLFxuICBpZGVudGlmaWVyczogW1xuICAgIHsgc291cmNlOiAndGVhbUlkJywgdGFyZ2V0OiAndGVhbUlkJyB9LFxuICAgIC8vIOKchSBWYWxpZCBmaWVsZHNcbiAgICB7IHNvdXJjZTogJ2NpdHknLCB0YXJnZXQ6ICdjaXR5JyB9XG4gIF1cbn0pO1xuXG4vLyBURVNUIDM6IENpcmN1bGFyIERlcGVuZGVuY3kgLSBMYXp5IElkZW50aWZpZXJzXG5jb25zdCB0ZXN0MyA9IGNyZWF0ZUVudGl0eVJlbGF0aW9uPCgpID0+IFBvc3RTY2hlbWE+KHtcbiAgZW50aXR5TmFtZTogJ3Bvc3QnLFxuICB0eXBlOiAnb25lLXRvLW1hbnknLFxuICAvLyDinIUgTGF6eSBmdW5jdGlvbiBmb3IgY2lyY3VsYXIgZGVwc1xuICBpZGVudGlmaWVyczogKCkgPT4gKHsgc291cmNlOiAndXNlcklkJywgdGFyZ2V0OiAndXNlcklkJyB9KVxufSk7XG5cbi8vIFRFU1QgNDogTGF6eSBJZGVudGlmaWVycyB3aXRoIFR5cGUgU2FmZXR5XG5jb25zdCB0ZXN0NCA9IGNyZWF0ZUVudGl0eVJlbGF0aW9uPCgpID0+IFBvc3RTY2hlbWE+KHtcbiAgZW50aXR5TmFtZTogJ3Bvc3QnLFxuICB0eXBlOiAnb25lLXRvLW1hbnknLFxuICAvLyBAdHMtZXhwZWN0LWVycm9yIC0gJ2ludmFsaWRGaWVsZCcgaXMgbm90IGluIFBvc3RTY2hlbWFcbiAgaWRlbnRpZmllcnM6ICgpID0+ICh7IHNvdXJjZTogJ3VzZXJJZCcsIHRhcmdldDogJ2ludmFsaWRGaWVsZCcgfSlcbn0pO1xuXG4vLyBURVNUIDU6IFJlbGF0aW9uIHdpdGggTGF6eSBBdHRyaWJ1dGVzIChmb3IgY2lyY3VsYXIgZGVwcyBpbiBoeWRyYXRpb24pXG5jb25zdCB0ZXN0NSA9IGNyZWF0ZUVudGl0eVJlbGF0aW9uPCgpID0+IFVzZXJTY2hlbWE+KHtcbiAgZW50aXR5TmFtZTogJ3VzZXInLFxuICB0eXBlOiAnbWFueS10by1vbmUnLFxuICBpZGVudGlmaWVyczogKCkgPT4gKHsgc291cmNlOiAndXNlcklkJywgdGFyZ2V0OiAndXNlcklkJyB9KSxcbiAgLy8g4pyFIExhenkgYXR0cmlidXRlcyBmb3IgY29tcGxleCBjaXJjdWxhciBkZXBzXG4gIGF0dHJpYnV0ZXM6ICgpID0+ICh7IHVzZXJJZDogdHJ1ZSwgbmFtZTogdHJ1ZSwgZW1haWw6IHRydWUgfSlcbn0pO1xuXG4vLyBURVNUIDY6IEVudGl0eSBRdWVyeSBUeXBlIFNhZmV0eVxuY29uc3QgdGVzdDYgPSBjcmVhdGVFbnRpdHlRdWVyeTxVc2VyU2NoZW1hPih7XG4gIGZpbHRlcnM6IHtcbiAgICAvLyDinIUgVmFsaWQgZmllbGRcbiAgICBhZ2U6IHsgZ3RlOiAxOCB9XG4gIH0sXG4gIGF0dHJpYnV0ZXM6IHsgdXNlcklkOiB0cnVlLCBuYW1lOiB0cnVlIH1cbn0pO1xuXG5jb25zdCB0ZXN0Nl9lcnJvciA9IGNyZWF0ZUVudGl0eVF1ZXJ5PFVzZXJTY2hlbWE+KHtcbiAgZmlsdGVyczoge1xuICAgIC8vIEB0cy1leHBlY3QtZXJyb3IgLSAnaW52YWxpZEZpZWxkJyBpcyBub3QgaW4gVXNlclNjaGVtYVxuICAgIGludmFsaWRGaWVsZDogeyBlcTogJ3Rlc3QnIH1cbiAgfVxufSk7XG5cbi8vIFRFU1QgNzogSHlkcmF0ZSBPcHRpb25zIFR5cGUgU2FmZXR5XG5jb25zdCB0ZXN0NyA9IGNyZWF0ZUh5ZHJhdGVPcHRpb25zPFVzZXJTY2hlbWE+KHtcbiAgdXNlcklkOiB0cnVlLFxuICBuYW1lOiB0cnVlLFxuICAvLyDinIUgVmFsaWQgZmllbGRzXG4gIGVtYWlsOiB0cnVlXG59KTtcblxuLy8gVEVTVCA4OiBIeWRyYXRlIE9wdGlvbnMgd2l0aCBOZXN0ZWQgUmVsYXRpb25zXG5jb25zdCB0ZXN0OCA9IGNyZWF0ZUh5ZHJhdGVPcHRpb25zPFBvc3RTY2hlbWE+KHtcbiAgcG9zdElkOiB0cnVlLFxuICB0aXRsZTogdHJ1ZVxuICAvLyBOT1RFOiBOZXN0ZWQgcmVsYXRpb24gaHlkcmF0aW9uIHdpdGggYXR0cmlidXRlcyBvYmplY3QgcmVxdWlyZXNcbiAgLy8gdXNpbmcgSHlkcmF0ZU9wdGlvbnNNYXBGb3JFbnRpdHkgdHlwZSBkaXJlY3RseSwgbm90IHZpYSB0aGUgd3JhcHBlciBmdW5jdGlvblxufSk7XG5cbi8vIFRFU1QgOTogRmllbGQgT3B0aW9ucyB3aXRoIEF0dHJpYnV0ZXNUZW1wbGF0ZSBUeXBlIFNhZmV0eVxuY29uc3QgdGVzdDkgPSBjcmVhdGVGaWVsZE9wdGlvbnM8VGVhbVNjaGVtYT4oe1xuICBhcGlNZXRob2Q6ICdHRVQnLFxuICBhcGlVcmw6ICcvYXBpL3RlYW1zJyxcbiAgcmVzcG9uc2VLZXk6ICdkYXRhJyxcbiAgb3B0aW9uTWFwcGluZzoge1xuICAgIC8vIOKchSBWYWxpZCBhdHRyaWJ1dGVcbiAgICBsYWJlbDogJ3RlYW1OYW1lJyxcbiAgICB2YWx1ZTogJ3RlYW1JZCdcbiAgfVxufSk7XG5cbmNvbnN0IHRlc3Q5X2Vycm9yID0gY3JlYXRlRmllbGRPcHRpb25zPFRlYW1TY2hlbWE+KHtcbiAgYXBpTWV0aG9kOiAnR0VUJyxcbiAgYXBpVXJsOiAnL2FwaS90ZWFtcycsXG4gIHJlc3BvbnNlS2V5OiAnZGF0YScsXG4gIG9wdGlvbk1hcHBpbmc6IHtcbiAgICAvLyBAdHMtZXhwZWN0LWVycm9yIC0gJ2ludmFsaWRGaWVsZCcgaXMgbm90IGluIFRlYW1TY2hlbWFcbiAgICBsYWJlbDogJ2ludmFsaWRGaWVsZCcsXG4gICAgdmFsdWU6ICd0ZWFtSWQnXG4gIH1cbn0pO1xuXG4vLyBURVNUIDEwOiBGaWVsZCBPcHRpb25zIHdpdGggQ29tcG9zZWQgTGFiZWwgKEF0dHJpYnV0ZXNUZW1wbGF0ZSlcbmNvbnN0IHRlc3QxMCA9IGNyZWF0ZUZpZWxkT3B0aW9uczxUZWFtU2NoZW1hPih7XG4gIGFwaU1ldGhvZDogJ0dFVCcsXG4gIGFwaVVybDogJy9hcGkvdGVhbXMnLFxuICByZXNwb25zZUtleTogJ2RhdGEnLFxuICBvcHRpb25NYXBwaW5nOiB7XG4gICAgbGFiZWw6IHtcbiAgICAgIC8vIOKchSBWYWxpZCBhdHRyaWJ1dGVzIGluIGNvbXBvc2l0ZVxuICAgICAgY29tcG9zaXRlOiBbJ3RlYW1OYW1lJywgJ2NpdHknXSxcbiAgICAgIHRlbXBsYXRlOiAne3RlYW1OYW1lfSAoe2NpdHl9KSdcbiAgICB9LFxuICAgIHZhbHVlOiAndGVhbUlkJ1xuICB9XG59KTtcblxuY29uc3QgdGVzdDEwX2Vycm9yID0gY3JlYXRlRmllbGRPcHRpb25zPFRlYW1TY2hlbWE+KHtcbiAgYXBpTWV0aG9kOiAnR0VUJyxcbiAgYXBpVXJsOiAnL2FwaS90ZWFtcycsXG4gIHJlc3BvbnNlS2V5OiAnZGF0YScsXG4gIG9wdGlvbk1hcHBpbmc6IHtcbiAgICBsYWJlbDoge1xuICAgICAgLy8gQHRzLWV4cGVjdC1lcnJvciAtICdpbnZhbGlkRmllbGQnIG5vdCBpbiBUZWFtU2NoZW1hIGNvbXBvc2l0ZVxuICAgICAgY29tcG9zaXRlOiBbJ3RlYW1OYW1lJywgJ2ludmFsaWRGaWVsZCddLFxuICAgICAgdGVtcGxhdGU6ICd7dGVhbU5hbWV9ICh7aW52YWxpZEZpZWxkfSknXG4gICAgfSxcbiAgICB2YWx1ZTogJ3RlYW1JZCdcbiAgfVxufSk7XG5cbi8vIFRFU1QgMTE6IEF0dHJpYnV0ZXNUZW1wbGF0ZSBEaXJlY3QgVXNhZ2UgKHdpdGhvdXQgd3JhcHBlcilcbmNvbnN0IHRlc3QxMTogQXR0cmlidXRlc1RlbXBsYXRlPFRlYW1TY2hlbWE+ID0ge1xuICAvLyDinIUgVHlwZS1zYWZlIHdpdGhvdXQgd3JhcHBlciBmdW5jdGlvblxuICBjb21wb3NpdGU6IFsndGVhbU5hbWUnLCAnY2l0eSddLFxuICB0ZW1wbGF0ZTogJ3t0ZWFtTmFtZX0gLSB7Y2l0eX0nXG59O1xuXG5jb25zdCB0ZXN0MTFfZXJyb3I6IEF0dHJpYnV0ZXNUZW1wbGF0ZTxUZWFtU2NoZW1hPiA9IHtcbiAgLy8gQHRzLWV4cGVjdC1lcnJvciAtICdpbnZhbGlkRmllbGQnIG5vdCB2YWxpZFxuICBjb21wb3NpdGU6IFsndGVhbU5hbWUnLCAnaW52YWxpZEZpZWxkJ10sXG4gIHRlbXBsYXRlOiAne3RlYW1OYW1lfSAtIHtpbnZhbGlkRmllbGR9J1xufTtcblxuLy8gVEVTVCAxMjogVmVyaWZ5IFJlbGF0aW9uIHR5cGUgZGlyZWN0bHkgKHdpdGhvdXQgd3JhcHBlcilcbmNvbnN0IHRlc3QxMjogUmVsYXRpb248VGVhbVNjaGVtYT4gPSB7XG4gIGVudGl0eU5hbWU6ICd0ZWFtJyxcbiAgdHlwZTogJ21hbnktdG8tb25lJyxcbiAgLy8g4pyFIFR5cGUtc2FmZSB0YXJnZXQgZmllbGRcbiAgaWRlbnRpZmllcnM6IHsgc291cmNlOiAndGVhbUlkJywgdGFyZ2V0OiAndGVhbUlkJyB9XG59O1xuXG5jb25zdCB0ZXN0MTJfZXJyb3I6IFJlbGF0aW9uPFRlYW1TY2hlbWE+ID0ge1xuICBlbnRpdHlOYW1lOiAndGVhbScsXG4gIHR5cGU6ICdtYW55LXRvLW9uZScsXG4gIC8vQHRzLWV4cGVjdC1lcnJvciAtICdpbnZhbGlkRmllbGQnIG5vdCB2YWxpZFxuICBpZGVudGlmaWVyczogeyBzb3VyY2U6ICd0ZWFtSWQnLCB0YXJnZXQ6ICdpbnZhbGlkRmllbGQnIH1cbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFNFQ1RJT04gMjogRU5USVRZIE9QRVJBVElPTlMgJiBJTlBVVC9PVVRQVVQgU0NIRU1BU1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy9cbi8vIElOVEVHUkFUSU9OIFdJVEggQ09OVFJPTExFUiAmIFNFUlZJQ0U6XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRoZSBlbnRpdHkgb3BlcmF0aW9ucyBzeXN0ZW0gaW50ZWdyYXRlcyB3aXRoIEJhc2VFbnRpdHlTZXJ2aWNlIGFuZCBcbi8vIEJhc2VFbnRpdHlDb250cm9sbGVyIHRvIHByb3ZpZGUgdHlwZS1zYWZlLCBhdXRvLWdlbmVyYXRlZCBBUElzLlxuLy9cbi8vIDEuIEVudGl0eSBTY2hlbWEgRGVmaW5pdGlvbjpcbi8vICAgIC0gRGVmaW5lIG9wZXJhdGlvbnMgaW4gdGhlIHNjaGVtYSB1c2luZyBgZW50aXR5T3BlcmF0aW9uc2Bcbi8vICAgIC0gQ2FuIHVzZSBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucywgc3Vic2V0cywgb3Igc3VwZXJzZXRzXG4vL1xuLy8gMi4gU2VydmljZSBMYXllciAoYmFzZS1zZXJ2aWNlLnRzKTpcbi8vICAgIC0gYG1ha2VPcHNEZWZhdWx0SU9TY2hlbWEoKWAgZ2VuZXJhdGVzIGRlZmF1bHQgaW5wdXQvb3V0cHV0IHNjaGVtYXMgYmFzZWQgb24gb3BlcmF0aW9uc1xuLy8gICAgLSBFYWNoIG9wZXJhdGlvbiBnZXRzIGFwcHJvcHJpYXRlIGlucHV0L291dHB1dCBhdHRyaWJ1dGUgbWFwcGluZ3Ncbi8vICAgIC0gT3BlcmF0aW9ucyBkZXRlcm1pbmUgd2hpY2ggQ1JVRCBtZXRob2RzIGFyZSBhdmFpbGFibGVcbi8vXG4vLyAzLiBDb250cm9sbGVyIExheWVyIChiYXNlLWVudGl0eS1jb250cm9sbGVyLnRzKTpcbi8vICAgIC0gQmFzZUVudGl0eUNvbnRyb2xsZXIgcHJvdmlkZXMgZW5kcG9pbnRzIGZvciBhbGwgb3BlcmF0aW9uc1xuLy8gICAgLSBFYWNoIGVuZHBvaW50IGNvcnJlc3BvbmRzIHRvIGFuIG9wZXJhdGlvbiAoZ2V0LCBsaXN0LCBjcmVhdGUsIGV0Yy4pXG4vLyAgICAtIFR5cGUgc3lzdGVtIGVuc3VyZXMgb25seSBlbmFibGVkIG9wZXJhdGlvbnMgYXJlIGFjY2Vzc2libGVcbi8vXG4vLyA0LiBEZWZhdWx0IElPIFNjaGVtYTpcbi8vICAgIC0gYFRFbnRpdHlPcHNJbnB1dFNjaGVtYXNgIG1hcHMgb3BlcmF0aW9uIG5hbWVzIHRvIGlucHV0IHR5cGVzXG4vLyAgICAtIElucHV0IHNjaGVtYXMgZGVmaW5lIHdoYXQgZGF0YSBlYWNoIG9wZXJhdGlvbiBhY2NlcHRzXG4vLyAgICAtIE91dHB1dCBzY2hlbWFzIGRlZmluZSB3aGF0IGF0dHJpYnV0ZXMgYXJlIHJldHVybmVkXG4vLyAgICAtIFVzZWQgYnkgY29udHJvbGxlciB0byB2YWxpZGF0ZSByZXF1ZXN0cyBhbmQgZm9ybWF0IHJlc3BvbnNlc1xuLy9cbi8vIEVYQU1QTEUgV09SS0ZMT1c6XG4vLyAtLS0tLS0tLS0tLS0tLS0tLVxuLy8gU2NoZW1hIHdpdGggc3Vic2V0IG9wZXJhdGlvbnM6XG4vLyAgIGNvbnN0IFJlYWRPbmx5T3BzID0gY3JlYXRlT3BlcmF0aW9uc1N1YnNldChbJ2dldCcsICdsaXN0JywgJ3F1ZXJ5J10pO1xuLy8gICBjb25zdCBzY2hlbWEgPSBjcmVhdGVFbnRpdHlTY2hlbWEoe1xuLy8gICAgIG1vZGVsOiB7IC4uLiwgZW50aXR5T3BlcmF0aW9uczogUmVhZE9ubHlPcHMgfSxcbi8vICAgICBhdHRyaWJ1dGVzOiB7IC4uLiB9LFxuLy8gICAgIGluZGV4ZXM6IHsgLi4uIH1cbi8vICAgfSk7XG4vL1xuLy8gU2VydmljZSBhdXRvLWdlbmVyYXRlczpcbi8vICAgLSBnZXQuaW5wdXQgPSBFbnRpdHlJZGVudGlmaWVyc1xuLy8gICAtIGdldC5vdXRwdXQgPSB7IHVzZXJJZCwgbmFtZSwgZW1haWwsIC4uLiB9XG4vLyAgIC0gbGlzdC5vdXRwdXQgPSB7IHVzZXJJZCwgbmFtZSwgLi4uIH1cbi8vICAgLSBObyBjcmVhdGUvdXBkYXRlL2RlbGV0ZSBzY2hlbWFzIChvcGVyYXRpb25zIGRpc2FibGVkKVxuLy9cbi8vIENvbnRyb2xsZXIgZXhwb3Nlczpcbi8vICAgLSBHRVQgL3tpZH0g4oaSIGNhbGxzIHNlcnZpY2UuZ2V0KClcbi8vICAgLSBHRVQgLyDihpIgY2FsbHMgc2VydmljZS5saXN0KClcbi8vICAgLSBHRVQgL3F1ZXJ5IOKGkiBjYWxscyBzZXJ2aWNlLnF1ZXJ5KClcbi8vICAgLSBQT1NUIC8g4oaSIE5PVCBBVkFJTEFCTEUgKGNyZWF0ZSBkaXNhYmxlZClcbi8vICAgLSBQQVRDSCAve2lkfSDihpIgTk9UIEFWQUlMQUJMRSAodXBkYXRlIGRpc2FibGVkKVxuLy8gICAtIERFTEVURSAve2lkfSDihpIgTk9UIEFWQUlMQUJMRSAoZGVsZXRlIGRpc2FibGVkKVxuLy9cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLy8gVEVTVCAyLjE6IERlZmF1bHQgT3BlcmF0aW9ucyAtIEZ1bGwgU2V0XG50eXBlIFRlc3RfRGVmYXVsdE9wcyA9IFREZWZhdWx0RW50aXR5T3BlcmF0aW9ucztcbmNvbnN0IHRlc3QyXzE6IFRlc3RfRGVmYXVsdE9wcyA9IERlZmF1bHRFbnRpdHlPcGVyYXRpb25zO1xuXG4vLyBURVNUIDIuMjogT3BlcmF0aW9ucyBTdWJzZXQgLSBSZWFkIE9ubHlcbnR5cGUgVGVzdF9SZWFkT25seU9wcyA9IE9wZXJhdGlvbnNTdWJzZXQ8J2dldCcgfCAnbGlzdCcgfCAncXVlcnknPjtcbmNvbnN0IHRlc3QyXzIgPSBjcmVhdGVPcGVyYXRpb25zU3Vic2V0KFsnZ2V0JywgJ2xpc3QnLCAncXVlcnknXSk7XG5cbi8vIFRFU1QgMi4zOiBPcGVyYXRpb25zIFN1YnNldCAtIE5vIERlbGV0ZVxuY29uc3QgdGVzdDJfMyA9IGNyZWF0ZU9wZXJhdGlvbnNTdWJzZXQoWydnZXQnLCAnbGlzdCcsICdxdWVyeScsICdjcmVhdGUnLCAndXBkYXRlJ10pO1xuXG4vLyBURVNUIDIuNDogT3BlcmF0aW9ucyBTdXBlcnNldCAtIEN1c3RvbSBPcGVyYXRpb25zXG5jb25zdCB0ZXN0Ml80ID0ge1xuICAuLi5EZWZhdWx0RW50aXR5T3BlcmF0aW9ucyxcbiAgYXBwcm92ZTogJ2FwcHJvdmUnLFxuICByZWplY3Q6ICdyZWplY3QnXG59IGFzIGNvbnN0IHNhdGlzZmllcyBPcGVyYXRpb25zU3VwZXJzZXQ8eyBhcHByb3ZlOiAnYXBwcm92ZScsIHJlamVjdDogJ3JlamVjdCcgfT47XG5cbi8vIFRFU1QgMi41OiBJc09wZXJhdGlvbkVuYWJsZWQgLSBUeXBlIENoZWNrXG50eXBlIFRlc3RfSGFzR2V0ID0gSXNPcGVyYXRpb25FbmFibGVkPHR5cGVvZiBSZWFkT25seU9wcywgJ2dldCc+OyAvLyBTaG91bGQgYmUgdHJ1ZVxudHlwZSBUZXN0X0hhc0NyZWF0ZSA9IElzT3BlcmF0aW9uRW5hYmxlZDx0eXBlb2YgUmVhZE9ubHlPcHMsICdjcmVhdGUnPjsgLy8gU2hvdWxkIGJlIGZhbHNlXG50eXBlIFRlc3RfSGFzUHVibGlzaCA9IElzT3BlcmF0aW9uRW5hYmxlZDx0eXBlb2YgQXJ0aWNsZU9wcywgJ3B1Ymxpc2gnPjsgLy8gU2hvdWxkIGJlIHRydWVcblxuLy8gQ29tcGlsZS10aW1lIGFzc2VydGlvbnNcbmNvbnN0IHRlc3QyXzVfMTogVGVzdF9IYXNHZXQgPSB0cnVlO1xuY29uc3QgdGVzdDJfNV8yOiBUZXN0X0hhc0NyZWF0ZSA9IGZhbHNlO1xuY29uc3QgdGVzdDJfNV8zOiBUZXN0X0hhc1B1Ymxpc2ggPSB0cnVlO1xuXG4vLyBURVNUIDIuNjogQ3VzdG9tIE9wZXJhdGlvbnMgU2NoZW1hXG50eXBlIEN1c3RvbU9wc1NjaGVtYSA9IEVudGl0eVNjaGVtYTxcbiAgJ2lkJyB8ICduYW1lJyxcbiAgYW55LFxuICBhbnksXG4gIHR5cGVvZiBBcnRpY2xlT3BzXG4+O1xuXG4vLyBURVNUIDIuNzogU3Vic2V0IE9wZXJhdGlvbnMgU2NoZW1hICh1c2luZyBkaWZmZXJlbnQgbmFtZSB0byBhdm9pZCBjb25mdXNpb24pXG50eXBlIENvbmZpZ1NjaGVtYSA9IEVudGl0eVNjaGVtYTxcbiAgJ2NvbmZpZ0lkJyB8ICduYW1lJyB8ICd2YWx1ZScsXG4gIGFueSxcbiAgYW55LFxuICB0eXBlb2YgUmVhZE9ubHlPcHNcbj47XG5cbi8vIFRFU1QgMi44OiBURW50aXR5T3BlcmF0aW9ucyBiYXNlIHR5cGUgYWNjZXB0cyB2YXJpb3VzIGNvbmZpZ3VyYXRpb25zXG50eXBlIFRlc3RfQWxsRGVmYXVsdHMgPSBURGVmYXVsdEVudGl0eU9wZXJhdGlvbnM7IC8vIOKchSBBbGwgZGVmYXVsdCBvcGVyYXRpb25zXG50eXBlIFRlc3RfU3Vic2V0ID0gUGljazxURGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsICdnZXQnIHwgJ2xpc3QnPjsgLy8g4pyFIFN1YnNldCBvZiBkZWZhdWx0c1xudHlwZSBUZXN0X1N1cGVyc2V0ID0gVERlZmF1bHRFbnRpdHlPcGVyYXRpb25zICYgeyBjdXN0b206ICdjdXN0b20nIH07IC8vIOKchSBTdXBlcnNldCB3aXRoIGN1c3RvbVxudHlwZSBUZXN0X0Z1bGx5Q3VzdG9tID0geyBteU9wOiAnbXlPcCcsIGFub3RoZXJPcDogJ2Fub3RoZXJPcCcgfTsgLy8g4pyFIEZ1bGx5IGN1c3RvbVxuXG4vLyBBbGwgc2hvdWxkIGJlIGFzc2lnbmFibGUgdG8gVEVudGl0eU9wZXJhdGlvbnNcbmNvbnN0IHRlc3QyXzhfMTogVEVudGl0eU9wZXJhdGlvbnMgPSBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucztcbmNvbnN0IHRlc3QyXzhfMjogVEVudGl0eU9wZXJhdGlvbnMgPSB7IGdldDogJ2dldCcsIGxpc3Q6ICdsaXN0JyB9O1xuY29uc3QgdGVzdDJfOF8zOiBURW50aXR5T3BlcmF0aW9ucyA9IHsgLi4uRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsIGN1c3RvbTogJ2N1c3RvbScgfTtcbmNvbnN0IHRlc3QyXzhfNDogVEVudGl0eU9wZXJhdGlvbnMgPSB7IG15T3A6ICdteU9wJyB9O1xuXG4vLyBURVNUIDIuOTogVEVudGl0eU9wc0lucHV0U2NoZW1hcyAtIFR5cGUgTWFwcGluZyBmb3IgQWxsIE9wZXJhdGlvbnNcbnR5cGUgVXNlck9wc0lucHV0cyA9IFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8VXNlclNjaGVtYT47XG5cbi8vIFZlcmlmeSBlYWNoIG9wZXJhdGlvbiBoYXMgY29ycmVjdCBpbnB1dCB0eXBlXG50eXBlIFRlc3RfR2V0SW5wdXQgPSBVc2VyT3BzSW5wdXRzWydnZXQnXTsgLy8gRW50aXR5SWRlbnRpZmllcnMgfCBFbnRpdHlJZGVudGlmaWVyc1tdXG50eXBlIFRlc3RfQ3JlYXRlSW5wdXQgPSBVc2VyT3BzSW5wdXRzWydjcmVhdGUnXTsgLy8gQ3JlYXRlRW50aXR5SXRlbVxudHlwZSBUZXN0X1VwZGF0ZUlucHV0ID0gVXNlck9wc0lucHV0c1sndXBkYXRlJ107IC8vIFVwZGF0ZUVudGl0eUl0ZW1cbnR5cGUgVGVzdF9EZWxldGVJbnB1dCA9IFVzZXJPcHNJbnB1dHNbJ2RlbGV0ZSddOyAvLyBFbnRpdHlJZGVudGlmaWVycyB8IEVudGl0eUlkZW50aWZpZXJzW11cbnR5cGUgVGVzdF9EdXBsaWNhdGVJbnB1dCA9IFVzZXJPcHNJbnB1dHNbJ2R1cGxpY2F0ZSddOyAvLyBFbnRpdHlJZGVudGlmaWVyc1xuXG4vLyBURVNUIDIuMTA6IFRFbnRpdHlPcHNJbnB1dFNjaGVtYXMgd2l0aCBDdXN0b20gT3BlcmF0aW9uc1xudHlwZSBBcnRpY2xlT3BzSW5wdXRzID0gVEVudGl0eU9wc0lucHV0U2NoZW1hczxBcnRpY2xlU2NoZW1hPjtcblxuLy8gU3RhbmRhcmQgb3BlcmF0aW9ucyB3b3JrXG50eXBlIFRlc3RfQXJ0aWNsZUdldCA9IEFydGljbGVPcHNJbnB1dHNbJ2dldCddO1xudHlwZSBUZXN0X0FydGljbGVDcmVhdGUgPSBBcnRpY2xlT3BzSW5wdXRzWydjcmVhdGUnXTtcblxuLy8gQ3VzdG9tIG9wZXJhdGlvbnMgZGVmYXVsdCB0byB7fVxudHlwZSBUZXN0X0FydGljbGVQdWJsaXNoID0gQXJ0aWNsZU9wc0lucHV0c1sncHVibGlzaCddOyAvLyBTaG91bGQgYmUge31cbnR5cGUgVGVzdF9BcnRpY2xlVW5wdWJsaXNoID0gQXJ0aWNsZU9wc0lucHV0c1sndW5wdWJsaXNoJ107IC8vIFNob3VsZCBiZSB7fVxuXG4vLyBURVNUIDIuMTE6IFRFbnRpdHlPcHNJbnB1dFNjaGVtYXMgd2l0aCBTdWJzZXQgT3BlcmF0aW9uc1xuLy8gQ3JlYXRlIGEgcHJvcGVyIHNjaGVtYSB3aXRoIHN1YnNldCBvcGVyYXRpb25zXG50eXBlIFJlYWRPbmx5VXNlclNjaGVtYSA9IEVudGl0eVNjaGVtYTxcbiAgJ3VzZXJJZCcgfCAnbmFtZScgfCAnZW1haWwnLFxuICBhbnksXG4gIGFueSxcbiAgdHlwZW9mIFJlYWRPbmx5T3BzXG4+O1xuXG50eXBlIFJlYWRPbmx5U2NoZW1hSW5wdXRzID0gVEVudGl0eU9wc0lucHV0U2NoZW1hczxSZWFkT25seVVzZXJTY2hlbWE+O1xuXG4vLyBFbmFibGVkIG9wZXJhdGlvbnMgYXJlIHByZXNlbnRcbnR5cGUgVGVzdF9SZWFkT25seUdldCA9IFJlYWRPbmx5U2NoZW1hSW5wdXRzWydnZXQnXTtcbnR5cGUgVGVzdF9SZWFkT25seUxpc3QgPSBSZWFkT25seVNjaGVtYUlucHV0c1snbGlzdCddO1xuXG4vLyBEaXNhYmxlZCBvcGVyYXRpb25zIHNob3VsZG4ndCBiZSBpbiB0aGUgdHlwZVxuLy8gQHRzLWV4cGVjdC1lcnJvciAtICdjcmVhdGUnIGlzIG5vdCBpbiBSZWFkT25seU9wc1xudHlwZSBUZXN0X1JlYWRPbmx5Q3JlYXRlID0gUmVhZE9ubHlTY2hlbWFJbnB1dHNbJ2NyZWF0ZSddO1xuXG4vLyBURVNUIDIuMTI6IE9wZXJhdGlvbiBUeXBlIEd1YXJkcyBpbiBQcmFjdGljZVxuZnVuY3Rpb24gaGFuZGxlT3BlcmF0aW9uPFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KFxuICBfc2NoZW1hOiBTLFxuICBvcGVyYXRpb246IGtleW9mIFNbJ21vZGVsJ11bJ2VudGl0eU9wZXJhdGlvbnMnXSxcbiAgaW5wdXQ6IFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8Uz5ba2V5b2YgU1snbW9kZWwnXVsnZW50aXR5T3BlcmF0aW9ucyddXVxuKTogdW5rbm93biB7XG4gIC8vIFR5cGUtc2FmZSBvcGVyYXRpb24gaGFuZGxpbmcgYmFzZWQgb24gdGhlIHNjaGVtYSdzIG9wZXJhdGlvbnNcbiAgaWYgKG9wZXJhdGlvbiA9PT0gJ2dldCcgfHwgb3BlcmF0aW9uID09PSAnZGVsZXRlJyB8fCBvcGVyYXRpb24gPT09ICdkdXBsaWNhdGUnKSB7XG4gICAgLy8gaW5wdXQgaXMgRW50aXR5SWRlbnRpZmllcnMgb3IgRW50aXR5SWRlbnRpZmllcnNbXVxuICAgIGNvbnN0IGlkcyA9IGlucHV0IGFzIEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4gfCBBcnJheTxFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+PjtcbiAgICByZXR1cm4gaWRzO1xuICB9IGVsc2UgaWYgKG9wZXJhdGlvbiA9PT0gJ2NyZWF0ZScgfHwgb3BlcmF0aW9uID09PSAndXBzZXJ0Jykge1xuICAgIC8vIGlucHV0IGlzIENyZWF0ZUVudGl0eUl0ZW0gb3IgVXBzZXJ0RW50aXR5SXRlbVxuICAgIGNvbnN0IGRhdGEgPSBpbnB1dCBhcyBDcmVhdGVFbnRpdHlJdGVtVHlwZUZyb21TY2hlbWE8Uz47XG4gICAgcmV0dXJuIGRhdGE7XG4gIH0gZWxzZSBpZiAob3BlcmF0aW9uID09PSAndXBkYXRlJykge1xuICAgIC8vIGlucHV0IGlzIFVwZGF0ZUVudGl0eUl0ZW1cbiAgICBjb25zdCBkYXRhID0gaW5wdXQgYXMgVXBkYXRlRW50aXR5SXRlbVR5cGVGcm9tU2NoZW1hPFM+O1xuICAgIHJldHVybiBkYXRhO1xuICB9XG4gIC8vIEZvciBjdXN0b20gb3BlcmF0aW9ucyBvciBsaXN0L3F1ZXJ5IG9wZXJhdGlvbnNcbiAgcmV0dXJuIGlucHV0O1xufVxuXG4vLyBURVNUIDIuMTM6IE9wZXJhdGlvbnMgQ29uZmlndXJhdGlvbiBWYWxpZGF0aW9uXG4vLyBWYWxpZCBjb25maWd1cmF0aW9uc1xuY29uc3QgdmFsaWRDb25maWcxID0gRGVmYXVsdEVudGl0eU9wZXJhdGlvbnM7IC8vIOKchSBBbGwgb3BlcmF0aW9uc1xuY29uc3QgdmFsaWRDb25maWcyID0gY3JlYXRlT3BlcmF0aW9uc1N1YnNldChbJ2dldCcsICdsaXN0J10pOyAvLyDinIUgU3Vic2V0XG5jb25zdCB2YWxpZENvbmZpZzMgPSB7IC4uLkRlZmF1bHRFbnRpdHlPcGVyYXRpb25zLCBhcHByb3ZlOiAnYXBwcm92ZScgfTsgLy8g4pyFIFN1cGVyc2V0XG5jb25zdCB2YWxpZENvbmZpZzQgPSB7IGN1c3RvbU9wOiAnY3VzdG9tT3AnIH07IC8vIOKchSBDdXN0b21cblxuLy8gQWxsIGFyZSBURW50aXR5T3BlcmF0aW9uc1xuY29uc3QgdGVzdDJfMTNfMTogVEVudGl0eU9wZXJhdGlvbnMgPSB2YWxpZENvbmZpZzE7XG5jb25zdCB0ZXN0Ml8xM18yOiBURW50aXR5T3BlcmF0aW9ucyA9IHZhbGlkQ29uZmlnMjtcbmNvbnN0IHRlc3QyXzEzXzM6IFRFbnRpdHlPcGVyYXRpb25zID0gdmFsaWRDb25maWczO1xuY29uc3QgdGVzdDJfMTNfNDogVEVudGl0eU9wZXJhdGlvbnMgPSB2YWxpZENvbmZpZzQ7XG5cbi8vIFRFU1QgMi4xNDogY3JlYXRlT3BlcmF0aW9uc1N1YnNldCBUeXBlIFNhZmV0eVxuY29uc3Qgc3Vic2V0MSA9IGNyZWF0ZU9wZXJhdGlvbnNTdWJzZXQoWydnZXQnLCAnbGlzdCcsICdxdWVyeSddKTtcbi8vIOKchSBUeXBlIHNob3VsZCBiZSBPcGVyYXRpb25zU3Vic2V0PCdnZXQnIHwgJ2xpc3QnIHwgJ3F1ZXJ5Jz5cbnR5cGUgVGVzdF9TdWJzZXQxVHlwZSA9IHR5cGVvZiBzdWJzZXQxO1xuXG4vLyBAdHMtZXhwZWN0LWVycm9yIC0gJ2ludmFsaWRPcGVyYXRpb24nIGlzIG5vdCBhIGtleSBvZiBURGVmYXVsdEVudGl0eU9wZXJhdGlvbnNcbmNvbnN0IHN1YnNldF9lcnJvciA9IGNyZWF0ZU9wZXJhdGlvbnNTdWJzZXQoWydnZXQnLCAnbGlzdCcsICdpbnZhbGlkT3BlcmF0aW9uJ10pO1xuXG4vLyBURVNUIDIuMTU6IERlZmF1bHQgb3BlcmF0aW9ucyBrZXlzIGFyZSBrbm93blxudHlwZSBEZWZhdWx0T3BLZXlzID0ga2V5b2YgVERlZmF1bHRFbnRpdHlPcGVyYXRpb25zO1xuY29uc3QgZGVmYXVsdEtleXM6IERlZmF1bHRPcEtleXNbXSA9IFsnZ2V0JywgJ2xpc3QnLCAncXVlcnknLCAnY3JlYXRlJywgJ3Vwc2VydCcsICd1cGRhdGUnLCAnZGVsZXRlJywgJ2R1cGxpY2F0ZSddO1xuXG4vLyBURVNUIDIuMTY6IE9wZXJhdGlvbnMgaW4gU2NoZW1hIE1vZGVsXG50eXBlIFVzZXJTY2hlbWFPcHMgPSBVc2VyU2NoZW1hWydtb2RlbCddWydlbnRpdHlPcGVyYXRpb25zJ107XG50eXBlIEFydGljbGVTY2hlbWFPcHMgPSBBcnRpY2xlU2NoZW1hWydtb2RlbCddWydlbnRpdHlPcGVyYXRpb25zJ107XG50eXBlIENvbmZpZ1NjaGVtYU9wcyA9IENvbmZpZ1NjaGVtYVsnbW9kZWwnXVsnZW50aXR5T3BlcmF0aW9ucyddO1xuXG4vLyBWZXJpZnkgb3BlcmF0aW9uIHByZXNlbmNlXG50eXBlIFRlc3RfVXNlckhhc0dldCA9ICdnZXQnIGV4dGVuZHMga2V5b2YgVXNlclNjaGVtYU9wcyA/IHRydWUgOiBmYWxzZTsgLy8gdHJ1ZVxudHlwZSBUZXN0X0FydGljbGVIYXNQdWJsaXNoID0gJ3B1Ymxpc2gnIGV4dGVuZHMga2V5b2YgQXJ0aWNsZVNjaGVtYU9wcyA/IHRydWUgOiBmYWxzZTsgLy8gdHJ1ZVxudHlwZSBUZXN0X0NvbmZpZ0hhc0NyZWF0ZSA9ICdjcmVhdGUnIGV4dGVuZHMga2V5b2YgQ29uZmlnU2NoZW1hT3BzID8gdHJ1ZSA6IGZhbHNlOyAvLyBmYWxzZVxuXG5jb25zdCB0ZXN0Ml8xNl8xOiBUZXN0X1VzZXJIYXNHZXQgPSB0cnVlO1xuY29uc3QgdGVzdDJfMTZfMjogVGVzdF9BcnRpY2xlSGFzUHVibGlzaCA9IHRydWU7XG5jb25zdCB0ZXN0Ml8xNl8zOiBUZXN0X0NvbmZpZ0hhc0NyZWF0ZSA9IGZhbHNlO1xuXG4vLyBURVNUIDIuMTc6IFByYWN0aWNhbCBJbnRlZ3JhdGlvbiAtIERlZmF1bHQgSU8gU2NoZW1hIFVzYWdlXG4vLyBEZW1vbnN0cmF0ZXMgaG93IG9wZXJhdGlvbnMgaW50ZWdyYXRlIHdpdGggdGhlIHNlcnZpY2UncyBtYWtlT3BzRGVmYXVsdElPU2NoZW1hXG5cbi8vIEZvciBhIHNjaGVtYSB3aXRoIGFsbCBkZWZhdWx0IG9wZXJhdGlvbnM6XG50eXBlIEZ1bGxTY2hlbWFJT1NjaGVtYSA9IHtcbiAgZ2V0OiB7XG4gICAgYnk6IE1hcDxzdHJpbmcsIGFueT47XG4gICAgb3V0cHV0OiBNYXA8c3RyaW5nLCBhbnk+O1xuICB9O1xuICBjcmVhdGU6IHtcbiAgICBpbnB1dDogTWFwPHN0cmluZywgYW55PjtcbiAgICBvdXRwdXQ6IHtcbiAgICAgIGRldGFpbDogTWFwPHN0cmluZywgYW55PjtcbiAgICAgIGxpc3Q6IE1hcDxzdHJpbmcsIGFueT47XG4gICAgfTtcbiAgfTtcbiAgdXBkYXRlOiB7XG4gICAgYnk6IE1hcDxzdHJpbmcsIGFueT47XG4gICAgaW5wdXQ6IE1hcDxzdHJpbmcsIGFueT47XG4gICAgb3V0cHV0OiBNYXA8c3RyaW5nLCBhbnk+O1xuICB9O1xuICBkZWxldGU6IHtcbiAgICBieTogTWFwPHN0cmluZywgYW55PjtcbiAgfTtcbiAgZHVwbGljYXRlOiB7XG4gICAgYnk6IE1hcDxzdHJpbmcsIGFueT47XG4gICAgb3V0cHV0OiBNYXA8c3RyaW5nLCBhbnk+O1xuICB9O1xuICBsaXN0OiB7XG4gICAgb3V0cHV0OiBNYXA8c3RyaW5nLCBhbnk+O1xuICB9O1xufTtcblxuLy8gRm9yIGEgc2NoZW1hIHdpdGggc3Vic2V0IG9wZXJhdGlvbnMgKHJlYWQtb25seSk6XG50eXBlIFJlYWRPbmx5U2NoZW1hSU9TY2hlbWEgPSB7XG4gIGdldDoge1xuICAgIGJ5OiBNYXA8c3RyaW5nLCBhbnk+O1xuICAgIG91dHB1dDogTWFwPHN0cmluZywgYW55PjtcbiAgfTtcbiAgbGlzdDoge1xuICAgIG91dHB1dDogTWFwPHN0cmluZywgYW55PjtcbiAgfTtcbiAgLy8gTk9URTogTm8gY3JlYXRlLCB1cGRhdGUsIG9yIGRlbGV0ZSBzY2hlbWFzIGdlbmVyYXRlZFxufTtcblxuLy8gRm9yIGEgc2NoZW1hIHdpdGggc3VwZXJzZXQgb3BlcmF0aW9ucyAoY3VzdG9tIG9wZXJhdGlvbnMpOlxudHlwZSBBcnRpY2xlU2NoZW1hSU9TY2hlbWEgPSB7XG4gIGdldDoge1xuICAgIGJ5OiBNYXA8c3RyaW5nLCBhbnk+O1xuICAgIG91dHB1dDogTWFwPHN0cmluZywgYW55PjtcbiAgfTtcbiAgY3JlYXRlOiB7XG4gICAgaW5wdXQ6IE1hcDxzdHJpbmcsIGFueT47XG4gICAgb3V0cHV0OiB7XG4gICAgICBkZXRhaWw6IE1hcDxzdHJpbmcsIGFueT47XG4gICAgICBsaXN0OiBNYXA8c3RyaW5nLCBhbnk+O1xuICAgIH07XG4gIH07XG4gIC8vIC4uLiBhbGwgZGVmYXVsdCBvcGVyYXRpb25zIC4uLlxuICAvLyBDdXN0b20gb3BlcmF0aW9ucyB3b3VsZCBuZWVkIG1hbnVhbCBzY2hlbWEgZGVmaW5pdGlvblxufTtcblxuLy8gVEVTVCAyLjE4OiBDb250cm9sbGVyIE1ldGhvZCBBdmFpbGFiaWxpdHkgQmFzZWQgb24gT3BlcmF0aW9uc1xuLy8gRGVtb25zdHJhdGVzIHdoaWNoIGNvbnRyb2xsZXIgbWV0aG9kcyBhcmUgYXZhaWxhYmxlIGJhc2VkIG9uIHNjaGVtYSBvcGVyYXRpb25zXG5cbi8vIEZ1bGwgb3BlcmF0aW9ucyBzY2hlbWEg4oaSIEFsbCBjb250cm9sbGVyIG1ldGhvZHMgYXZhaWxhYmxlXG50eXBlIEZ1bGxDb250cm9sbGVyTWV0aG9kcyA9IHtcbiAgY3JlYXRlOiB0cnVlOyAgICAvLyBQT1NUIC9cbiAgZmluZDogdHJ1ZTsgICAgICAvLyBHRVQgL3tpZH1cbiAgbGlzdDogdHJ1ZTsgICAgICAvLyBHRVQgL1xuICB1cGRhdGU6IHRydWU7ICAgIC8vIFBBVENIIC97aWR9XG4gIGRlbGV0ZTogdHJ1ZTsgICAgLy8gREVMRVRFIC97aWR9XG4gIGR1cGxpY2F0ZTogdHJ1ZTsgLy8gR0VUIC9kdXBsaWNhdGUve2lkfVxuICBxdWVyeTogdHJ1ZTsgICAgIC8vIFBPU1QgL3F1ZXJ5XG4gIHNlYXJjaDogdHJ1ZTsgICAgLy8gUE9TVCAvc2VhcmNoIChpZiBzZWFyY2ggZW5hYmxlZClcbn07XG5cbi8vIFJlYWQtb25seSBvcGVyYXRpb25zIHNjaGVtYSDihpIgT25seSByZWFkIG1ldGhvZHMgYXZhaWxhYmxlXG50eXBlIFJlYWRPbmx5Q29udHJvbGxlck1ldGhvZHMgPSB7XG4gIGNyZWF0ZTogZmFsc2U7ICAgLy8g4p2MIE5vdCBhdmFpbGFibGVcbiAgZmluZDogdHJ1ZTsgICAgICAvLyDinIUgR0VUIC97aWR9XG4gIGxpc3Q6IHRydWU7ICAgICAgLy8g4pyFIEdFVCAvXG4gIHVwZGF0ZTogZmFsc2U7ICAgLy8g4p2MIE5vdCBhdmFpbGFibGVcbiAgZGVsZXRlOiBmYWxzZTsgICAvLyDinYwgTm90IGF2YWlsYWJsZVxuICBkdXBsaWNhdGU6IGZhbHNlOy8vIOKdjCBOb3QgYXZhaWxhYmxlXG4gIHF1ZXJ5OiB0cnVlOyAgICAgLy8g4pyFIFBPU1QgL3F1ZXJ5XG4gIHNlYXJjaDogdHJ1ZTsgICAgLy8g4pyFIFBPU1QgL3NlYXJjaCAoaWYgc2VhcmNoIGVuYWJsZWQpXG59O1xuXG4vLyBDdXN0b20gb3BlcmF0aW9ucyBzY2hlbWEg4oaSIEFkZGl0aW9uYWwgY3VzdG9tIGVuZHBvaW50cyBjYW4gYmUgYWRkZWRcbnR5cGUgQ3VzdG9tQ29udHJvbGxlck1ldGhvZHMgPSB7XG4gIC8vIEFsbCBkZWZhdWx0IG1ldGhvZHNcbiAgY3JlYXRlOiB0cnVlO1xuICBmaW5kOiB0cnVlO1xuICBsaXN0OiB0cnVlO1xuICB1cGRhdGU6IHRydWU7XG4gIGRlbGV0ZTogdHJ1ZTtcbiAgZHVwbGljYXRlOiB0cnVlO1xuICBxdWVyeTogdHJ1ZTtcbiAgLy8gQ3VzdG9tIG1ldGhvZHMgKG5lZWQgdG8gYmUgaW1wbGVtZW50ZWQgaW4gZXh0ZW5kZWQgY29udHJvbGxlcilcbiAgcHVibGlzaDogdHJ1ZTsgICAvLyBXb3VsZCBuZWVkOiBAUG9zdCgnL3B1Ymxpc2gve2lkfScpXG4gIHVucHVibGlzaDogdHJ1ZTsgLy8gV291bGQgbmVlZDogQFBvc3QoJy91bnB1Ymxpc2gve2lkfScpXG4gIGFyY2hpdmU6IHRydWU7ICAgLy8gV291bGQgbmVlZDogQFBvc3QoJy9hcmNoaXZlL3tpZH0nKVxufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU0VDVElPTiAzOiBVVElMSVRZIFRZUEVTXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8vIFRFU1QgMy4xOiBWaXNpYmxlQXR0cmlidXRlS2V5c1xudHlwZSBUZXN0X1Zpc2libGVLZXlzID0gVmlzaWJsZUF0dHJpYnV0ZUtleXM8VXNlclNjaGVtYT47XG4vLyBTaG91bGQgaW5jbHVkZSBhbGwgbm9uLWhpZGRlbiBhdHRyaWJ1dGVzXG5cbi8vIFRFU1QgMy4yOiBXcml0YWJsZUF0dHJpYnV0ZUtleXNcbnR5cGUgVGVzdF9Xcml0YWJsZUtleXMgPSBXcml0YWJsZUF0dHJpYnV0ZUtleXM8VXNlclNjaGVtYT47XG4vLyBTaG91bGQgaW5jbHVkZSBhbGwgbm9uLXJlYWRvbmx5IGF0dHJpYnV0ZXNcblxuLy8gVEVTVCAzLjM6IEF0dHJpYnV0ZVZhbHVlVHlwZSAtIEV4dHJhY3Qgc3BlY2lmaWMgYXR0cmlidXRlIHR5cGVcbnR5cGUgVGVzdF9Vc2VySWRUeXBlID0gQXR0cmlidXRlVmFsdWVUeXBlPFVzZXJTY2hlbWEsICd1c2VySWQnPjsgLy8gU2hvdWxkIGJlIHN0cmluZ1xudHlwZSBUZXN0X0FnZVR5cGUgPSBBdHRyaWJ1dGVWYWx1ZVR5cGU8VXNlclNjaGVtYSwgJ2FnZSc+OyAvLyBTaG91bGQgYmUgbnVtYmVyXG50eXBlIFRlc3RfSXNBY3RpdmVUeXBlID0gQXR0cmlidXRlVmFsdWVUeXBlPFVzZXJTY2hlbWEsICdpc0FjdGl2ZSc+OyAvLyBTaG91bGQgYmUgYm9vbGVhblxuXG4vLyBURVNUIDMuNDogRW50aXR5QXR0cmlidXRlVmFsdWVNYXAgLSBBbGwgYXR0cmlidXRlcyBtYXBwZWQgdG8gdHlwZXNcbnR5cGUgVGVzdF9BdHRyaWJ1dGVNYXAgPSBFbnRpdHlBdHRyaWJ1dGVWYWx1ZU1hcDxVc2VyU2NoZW1hPjtcbi8vIFNob3VsZCBiZSBhIHJlY29yZCBvZiBhbGwgYXR0cmlidXRlcyB3aXRoIHRoZWlyIHZhbHVlIHR5cGVzXG5cbi8vIFRFU1QgMy41OiBBdHRyaWJ1dGVzVGVtcGxhdGUgVHlwZSBTYWZldHlcbmNvbnN0IHRlc3QzXzU6IEF0dHJpYnV0ZXNUZW1wbGF0ZTxUZWFtU2NoZW1hPiA9IHtcbiAgY29tcG9zaXRlOiBbJ3RlYW1OYW1lJywgJ2NpdHknXSxcbiAgdGVtcGxhdGU6ICd7dGVhbU5hbWV9IC0ge2NpdHl9J1xufTtcblxuY29uc3QgdGVzdDNfNV9lcnJvcjogQXR0cmlidXRlc1RlbXBsYXRlPFRlYW1TY2hlbWE+ID0ge1xuICAvL0B0cy1leHBlY3QtZXJyb3IgLSAnaW52YWxpZEZpZWxkJyBub3QgdmFsaWRcbiAgY29tcG9zaXRlOiBbJ3RlYW1OYW1lJywgJ2ludmFsaWRGaWVsZCddLFxuICB0ZW1wbGF0ZTogJ3t0ZWFtTmFtZX0gLSB7aW52YWxpZEZpZWxkfSdcbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFNFQ1RJT04gNDogRklFTEQgT1BUSU9OUyAmIFRFTVBMQVRFU1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vLyBURVNUIDQuMTogU2ltcGxlIEZpZWxkIE9wdGlvbnNcbmNvbnN0IHRlc3Q0XzEgPSBjcmVhdGVGaWVsZE9wdGlvbnM8VGVhbVNjaGVtYT4oe1xuICBhcGlNZXRob2Q6ICdHRVQnLFxuICBhcGlVcmw6ICcvYXBpL3RlYW1zJyxcbiAgcmVzcG9uc2VLZXk6ICdkYXRhJyxcbiAgb3B0aW9uTWFwcGluZzoge1xuICAgIGxhYmVsOiAndGVhbU5hbWUnLFxuICAgIHZhbHVlOiAndGVhbUlkJ1xuICB9XG59KTtcblxuLy8gVEVTVCA0LjI6IEZpZWxkIE9wdGlvbnMgd2l0aCBUZW1wbGF0ZVxuY29uc3QgdGVzdDRfMiA9IGNyZWF0ZUZpZWxkT3B0aW9uczxUZWFtU2NoZW1hPih7XG4gIGFwaU1ldGhvZDogJ0dFVCcsXG4gIGFwaVVybDogJy9hcGkvdGVhbXMnLFxuICByZXNwb25zZUtleTogJ2RhdGEnLFxuICBvcHRpb25NYXBwaW5nOiB7XG4gICAgbGFiZWw6IHtcbiAgICAgIGNvbXBvc2l0ZTogWyd0ZWFtTmFtZScsICdjaXR5J10sXG4gICAgICB0ZW1wbGF0ZTogJ3t0ZWFtTmFtZX0gKHtjaXR5fSknXG4gICAgfSxcbiAgICB2YWx1ZTogJ3RlYW1JZCdcbiAgfVxufSk7XG5cbi8vIFRFU1QgNC4zOiBGaWVsZCBPcHRpb25zIHdpdGggUXVlcnlcbmNvbnN0IHRlc3Q0XzMgPSBjcmVhdGVGaWVsZE9wdGlvbnM8VGVhbVNjaGVtYT4oe1xuICBhcGlNZXRob2Q6ICdHRVQnLFxuICBhcGlVcmw6ICcvYXBpL3RlYW1zJyxcbiAgcmVzcG9uc2VLZXk6ICdkYXRhJyxcbiAgcXVlcnk6IHtcbiAgICBmaWx0ZXJzOiB7XG4gICAgICBpc0FjdGl2ZTogeyBlcTogdHJ1ZSB9XG4gICAgfVxuICB9LFxuICBvcHRpb25NYXBwaW5nOiB7XG4gICAgbGFiZWw6ICd0ZWFtTmFtZScsXG4gICAgdmFsdWU6ICd0ZWFtSWQnXG4gIH1cbn0pO1xuXG4vLyBURVNUIDQuNDogSW52YWxpZCBGaWVsZCBpbiBPcHRpb25zXG5jb25zdCB0ZXN0NF80X2Vycm9yID0gY3JlYXRlRmllbGRPcHRpb25zPFRlYW1TY2hlbWE+KHtcbiAgYXBpTWV0aG9kOiAnR0VUJyxcbiAgYXBpVXJsOiAnL2FwaS90ZWFtcycsXG4gIHJlc3BvbnNlS2V5OiAnZGF0YScsXG4gIG9wdGlvbk1hcHBpbmc6IHtcbiAgICAvL0B0cy1leHBlY3QtZXJyb3IgLSAnaW52YWxpZEZpZWxkJyBub3QgaW4gVGVhbVNjaGVtYVxuICAgIGxhYmVsOiAnaW52YWxpZEZpZWxkJyxcbiAgICB2YWx1ZTogJ3RlYW1JZCdcbiAgfVxufSk7XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFNFQ1RJT04gNTogRU5USVRZIFFVRVJJRVNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLy8gVEVTVCA1LjE6IFNpbXBsZSBRdWVyeSB3aXRoIEZpbHRlcnNcbmNvbnN0IHRlc3Q1XzEgPSBjcmVhdGVFbnRpdHlRdWVyeTxVc2VyU2NoZW1hPih7XG4gIGZpbHRlcnM6IHtcbiAgICBhZ2U6IHsgZ3RlOiAxOCB9LFxuICAgIGlzQWN0aXZlOiB7IGVxOiB0cnVlIH1cbiAgfVxufSk7XG5cbi8vIFRFU1QgNS4yOiBRdWVyeSB3aXRoIEF0dHJpYnV0ZXMgU2VsZWN0aW9uXG5jb25zdCB0ZXN0NV8yID0gY3JlYXRlRW50aXR5UXVlcnk8VXNlclNjaGVtYT4oe1xuICBmaWx0ZXJzOiB7XG4gICAgYWdlOiB7IGd0ZTogMTggfVxuICB9LFxuICBhdHRyaWJ1dGVzOiBbJ3VzZXJJZCcsICduYW1lJywgJ2VtYWlsJ11cbn0pO1xuXG4vLyBURVNUIDUuMzogUXVlcnkgd2l0aCBIeWRyYXRpb25cbmNvbnN0IHRlc3Q1XzMgPSBjcmVhdGVFbnRpdHlRdWVyeTxVc2VyU2NoZW1hPih7XG4gIGZpbHRlcnM6IHtcbiAgICBpc0FjdGl2ZTogeyBlcTogdHJ1ZSB9XG4gIH0sXG4gIGF0dHJpYnV0ZXM6IGNyZWF0ZUh5ZHJhdGVPcHRpb25zPFVzZXJTY2hlbWE+KHtcbiAgICB1c2VySWQ6IHRydWUsXG4gICAgbmFtZTogdHJ1ZSxcbiAgICBlbWFpbDogdHJ1ZSxcbiAgICBhdmF0YXI6IHRydWVcbiAgfSlcbn0pO1xuXG4vLyBURVNUIDUuNDogUXVlcnkgd2l0aCBQYWdpbmF0aW9uXG5jb25zdCB0ZXN0NV80ID0gY3JlYXRlRW50aXR5UXVlcnk8VXNlclNjaGVtYT4oe1xuICBmaWx0ZXJzOiB7XG4gICAgaXNBY3RpdmU6IHsgZXE6IHRydWUgfVxuICB9LFxuICBwYWdpbmF0aW9uOiB7XG4gICAgY291bnQ6IDIwLFxuICAgIG9yZGVyOiAnYXNjJ1xuICB9XG59KTtcblxuLy8gVEVTVCA1LjU6IFF1ZXJ5IHdpdGggU2VhcmNoXG5jb25zdCB0ZXN0NV81ID0gY3JlYXRlRW50aXR5UXVlcnk8VXNlclNjaGVtYT4oe1xuICBzZWFyY2g6ICdqb2huJyxcbiAgc2VhcmNoQXR0cmlidXRlczogWyduYW1lJywgJ2VtYWlsJ10sXG4gIHBhZ2luYXRpb246IHtcbiAgICBjb3VudDogMTBcbiAgfVxufSk7XG5cbi8vIFRFU1QgNS42OiBJbnZhbGlkIEZpbHRlciBGaWVsZFxuY29uc3QgdGVzdDVfNl9lcnJvciA9IGNyZWF0ZUVudGl0eVF1ZXJ5PFVzZXJTY2hlbWE+KHtcbiAgZmlsdGVyczoge1xuICAgIC8vQHRzLWV4cGVjdC1lcnJvciAtICdpbnZhbGlkRmllbGQnIG5vdCBpbiBVc2VyU2NoZW1hXG4gICAgaW52YWxpZEZpZWxkOiB7IGVxOiAndGVzdCcgfVxuICB9XG59KTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU0VDVElPTiA2OiBIWURSQVRFIE9QVElPTlNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLy8gVEVTVCA2LjE6IFNpbXBsZSBIeWRyYXRlIE9wdGlvbnNcbmNvbnN0IHRlc3Q2XzEgPSBjcmVhdGVIeWRyYXRlT3B0aW9uczxVc2VyU2NoZW1hPih7XG4gIHVzZXJJZDogdHJ1ZSxcbiAgbmFtZTogdHJ1ZSxcbiAgZW1haWw6IHRydWVcbn0pO1xuXG4vLyBURVNUIDYuMjogSHlkcmF0ZSBPcHRpb25zIHdpdGggQXJyYXkgUGF0aHNcbmNvbnN0IHRlc3Q2XzIgPSBjcmVhdGVIeWRyYXRlT3B0aW9uczxVc2VyU2NoZW1hPihbXG4gICd1c2VySWQnLFxuICAnbmFtZScsXG4gICdlbWFpbCdcbl0pO1xuXG4vLyBURVNUIDYuMzogTmVzdGVkIFJlbGF0aW9uIEh5ZHJhdGlvblxuY29uc3QgdGVzdDZfMyA9IGNyZWF0ZUh5ZHJhdGVPcHRpb25zPFBvc3RTY2hlbWE+KHtcbiAgcG9zdElkOiB0cnVlLFxuICB0aXRsZTogdHJ1ZSxcbiAgY29udGVudDogdHJ1ZVxufSk7XG5cbi8vIFRFU1QgNi40OiBMYXp5IEh5ZHJhdGlvbiBmb3IgQ2lyY3VsYXIgRGVwZW5kZW5jaWVzXG5jb25zdCB0ZXN0Nl80ID0gY3JlYXRlRW50aXR5UmVsYXRpb248KCkgPT4gVXNlclNjaGVtYT4oe1xuICBlbnRpdHlOYW1lOiAndXNlcicsXG4gIHR5cGU6ICdtYW55LXRvLW9uZScsXG4gIGlkZW50aWZpZXJzOiAoKSA9PiAoeyBzb3VyY2U6ICd1c2VySWQnLCB0YXJnZXQ6ICd1c2VySWQnIH0pLFxuICBhdHRyaWJ1dGVzOiAoKSA9PiAoeyB1c2VySWQ6IHRydWUsIG5hbWU6IHRydWUsIGVtYWlsOiB0cnVlIH0pXG59KTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU0VDVElPTiA3OiBUWVBFIEdVQVJEUyAoUnVudGltZSBUeXBlIENoZWNraW5nKVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vLyBURVNUIDcuMTogU2VsZWN0IEZpZWxkIE1ldGFkYXRhXG5jb25zdCB0ZXN0N18xX3ZhbGlkID0ge1xuICBmaWVsZFR5cGU6ICdzZWxlY3QnLFxuICBvcHRpb25zOiBbeyB2YWx1ZTogJ2EnLCBsYWJlbDogJ0EnIH1dXG59O1xuaWYgKGlzU2VsZWN0RmllbGRNZXRhZGF0YSh0ZXN0N18xX3ZhbGlkKSkge1xuICAvLyBTaG91bGQgbmFycm93IHR5cGUgdG8gU2VsZWN0RmllbGRNZXRhZGF0YVxuICBjb25zdCBvcHRpb25zID0gdGVzdDdfMV92YWxpZC5vcHRpb25zO1xufVxuXG4vLyBURVNUIDcuMjogSW1hZ2UgRmllbGQgTWV0YWRhdGFcbmNvbnN0IHRlc3Q3XzJfdmFsaWQgPSB7XG4gIGZpZWxkVHlwZTogJ2ltYWdlJyxcbiAgYWNjZXB0OiAnaW1hZ2UvKidcbn07XG5pZiAoaXNJbWFnZUZpZWxkTWV0YWRhdGEodGVzdDdfMl92YWxpZCkpIHtcbiAgY29uc3QgYWNjZXB0ID0gdGVzdDdfMl92YWxpZC5hY2NlcHQ7XG59XG5cbi8vIFRFU1QgNy4zOiBGaWxlIEZpZWxkIE1ldGFkYXRhXG5jb25zdCB0ZXN0N18zX3ZhbGlkID0ge1xuICBmaWVsZFR5cGU6ICdmaWxlJyxcbiAgbWF4RmlsZVNpemU6IDEwMDAwMDBcbn07XG5pZiAoaXNGaWxlRmllbGRNZXRhZGF0YSh0ZXN0N18zX3ZhbGlkKSkge1xuICBjb25zdCBzaXplID0gdGVzdDdfM192YWxpZC5tYXhGaWxlU2l6ZTtcbn1cblxuLy8gVEVTVCA3LjQ6IERhdGUgRmllbGQgTWV0YWRhdGFcbmNvbnN0IHRlc3Q3XzRfdmFsaWQgPSB7XG4gIGZpZWxkVHlwZTogJ2RhdGUnLFxuICBtaW5EYXRlOiBuZXcgRGF0ZSgpXG59O1xuaWYgKGlzRGF0ZUZpZWxkTWV0YWRhdGEodGVzdDdfNF92YWxpZCkpIHtcbiAgY29uc3QgbWluID0gdGVzdDdfNF92YWxpZC5taW5EYXRlO1xufVxuXG4vLyBURVNUIDcuNTogRGF0ZVRpbWUgRmllbGQgTWV0YWRhdGFcbmNvbnN0IHRlc3Q3XzVfdmFsaWQgPSB7XG4gIGZpZWxkVHlwZTogJ2RhdGV0aW1lJyxcbiAgbWluRGF0ZVRpbWU6IG5ldyBEYXRlKClcbn07XG5pZiAoaXNEYXRlVGltZUZpZWxkTWV0YWRhdGEodGVzdDdfNV92YWxpZCkpIHtcbiAgY29uc3QgbWluID0gdGVzdDdfNV92YWxpZC5taW5EYXRlVGltZTtcbn1cblxuLy8gVEVTVCA3LjY6IE51bWJlciBGaWVsZCBNZXRhZGF0YVxuY29uc3QgdGVzdDdfNl92YWxpZCA9IHtcbiAgZmllbGRUeXBlOiAnbnVtYmVyJyxcbiAgbWluOiAwLFxuICBtYXg6IDEwMFxufTtcbmlmIChpc051bWJlckZpZWxkTWV0YWRhdGEodGVzdDdfNl92YWxpZCkpIHtcbiAgY29uc3QgbWluID0gdGVzdDdfNl92YWxpZC5taW47XG59XG5cbi8vIFRFU1QgNy43OiBCb29sZWFuIEZpZWxkIE1ldGFkYXRhXG5jb25zdCB0ZXN0N183X3ZhbGlkID0ge1xuICBmaWVsZFR5cGU6ICdib29sZWFuJyxcbiAgdHJ1ZUxhYmVsOiAnWWVzJyxcbiAgZmFsc2VMYWJlbDogJ05vJ1xufTtcbmlmIChpc0Jvb2xlYW5GaWVsZE1ldGFkYXRhKHRlc3Q3XzdfdmFsaWQpKSB7XG4gIGNvbnN0IHRydWVMYWJlbCA9IHRlc3Q3XzdfdmFsaWQudHJ1ZUxhYmVsO1xufVxuXG4vLyBURVNUIDcuODogRWRpdG9yIEZpZWxkIE1ldGFkYXRhXG5jb25zdCB0ZXN0N184X3ZhbGlkID0ge1xuICBmaWVsZFR5cGU6ICdyaWNoLXRleHQnXG59O1xuaWYgKGlzRWRpdG9yRmllbGRNZXRhZGF0YSh0ZXN0N184X3ZhbGlkKSkge1xuICBjb25zdCB0eXBlID0gdGVzdDdfOF92YWxpZC5maWVsZFR5cGU7XG59XG5cbi8vIFRFU1QgNy45OiBDb2RlIEVkaXRvciBGaWVsZCBNZXRhZGF0YVxuY29uc3QgdGVzdDdfOV92YWxpZCA9IHtcbiAgZmllbGRUeXBlOiAnY29kZSdcbn07XG5pZiAoaXNDb2RlRWRpdG9yRmllbGRNZXRhZGF0YSh0ZXN0N185X3ZhbGlkKSkge1xuICBjb25zdCB0eXBlID0gdGVzdDdfOV92YWxpZC5maWVsZFR5cGU7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFNFQ1RJT04gODogQ09NUExFWCBTQ0VOQVJJT1Ncbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLy8gVEVTVCA4LjE6IENpcmN1bGFyIERlcGVuZGVuY3kgQmV0d2VlbiBFbnRpdGllc1xuY29uc3QgdGVzdDhfMV91c2VyID0gY3JlYXRlRW50aXR5UmVsYXRpb248KCkgPT4gUG9zdFNjaGVtYT4oe1xuICBlbnRpdHlOYW1lOiAncG9zdCcsXG4gIHR5cGU6ICdvbmUtdG8tbWFueScsXG4gIGlkZW50aWZpZXJzOiAoKSA9PiAoeyBzb3VyY2U6ICd1c2VySWQnLCB0YXJnZXQ6ICd1c2VySWQnIH0pXG59KTtcblxuY29uc3QgdGVzdDhfMV9wb3N0ID0gY3JlYXRlRW50aXR5UmVsYXRpb248KCkgPT4gVXNlclNjaGVtYT4oe1xuICBlbnRpdHlOYW1lOiAndXNlcicsXG4gIHR5cGU6ICdtYW55LXRvLW9uZScsXG4gIGlkZW50aWZpZXJzOiAoKSA9PiAoeyBzb3VyY2U6ICd1c2VySWQnLCB0YXJnZXQ6ICd1c2VySWQnIH0pLFxuICBhdHRyaWJ1dGVzOiAoKSA9PiAoeyB1c2VySWQ6IHRydWUsIG5hbWU6IHRydWUgfSlcbn0pO1xuXG4vLyBURVNUIDguMjogQ29tcGxleCBRdWVyeSB3aXRoIE11bHRpcGxlIEZlYXR1cmVzXG5jb25zdCB0ZXN0OF8yID0gY3JlYXRlRW50aXR5UXVlcnk8VXNlclNjaGVtYT4oe1xuICBmaWx0ZXJzOiB7XG4gICAgYWdlOiB7IGd0ZTogMTgsIGx0ZTogNjUgfSxcbiAgICBpc0FjdGl2ZTogeyBlcTogdHJ1ZSB9XG4gIH0sXG4gIHNlYXJjaDogJ2pvaG4nLFxuICBzZWFyY2hBdHRyaWJ1dGVzOiBbJ25hbWUnLCAnZW1haWwnXSxcbiAgYXR0cmlidXRlczogY3JlYXRlSHlkcmF0ZU9wdGlvbnM8VXNlclNjaGVtYT4oe1xuICAgIHVzZXJJZDogdHJ1ZSxcbiAgICBuYW1lOiB0cnVlLFxuICAgIGVtYWlsOiB0cnVlLFxuICAgIGFnZTogdHJ1ZVxuICB9KSxcbiAgcGFnaW5hdGlvbjoge1xuICAgIGNvdW50OiAyNSxcbiAgICBvcmRlcjogJ2Rlc2MnXG4gIH1cbn0pO1xuXG4vLyBURVNUIDguMzogRW50aXR5IHdpdGggQ3VzdG9tIE9wZXJhdGlvbnMgYW5kIFF1ZXJpZXNcbmNvbnN0IHRlc3Q4XzNfc2NoZW1hID0gY3JlYXRlRW50aXR5UXVlcnk8QXJ0aWNsZVNjaGVtYT4oe1xuICBmaWx0ZXJzOiB7XG4gICAgc3RhdHVzOiB7IGVxOiAncHVibGlzaGVkJyB9XG4gIH0sXG4gIGF0dHJpYnV0ZXM6IHtcbiAgICBhcnRpY2xlSWQ6IHRydWUsXG4gICAgdGl0bGU6IHRydWUsXG4gICAgc3RhdHVzOiB0cnVlXG4gIH1cbn0pO1xuXG4vLyBURVNUIDguNDogTXVsdGlwbGUgSWRlbnRpZmllciBNYXBwaW5nc1xuY29uc3QgdGVzdDhfNCA9IGNyZWF0ZUVudGl0eVJlbGF0aW9uPFRlYW1TY2hlbWE+KHtcbiAgZW50aXR5TmFtZTogJ3RlYW0nLFxuICB0eXBlOiAnbWFueS10by1vbmUnLFxuICBpZGVudGlmaWVyczogW1xuICAgIHsgc291cmNlOiAndGVhbUlkJywgdGFyZ2V0OiAndGVhbUlkJyB9LFxuICAgIHsgc291cmNlOiAnY2l0eScsIHRhcmdldDogJ2NpdHknIH1cbiAgXVxufSk7XG5cbi8vIFRFU1QgOC41OiBMYXp5IElkZW50aWZpZXJzIHdpdGggVHlwZSBTYWZldHlcbmNvbnN0IHRlc3Q4XzUgPSBjcmVhdGVFbnRpdHlSZWxhdGlvbjwoKSA9PiBQb3N0U2NoZW1hPih7XG4gIGVudGl0eU5hbWU6ICdwb3N0JyxcbiAgdHlwZTogJ29uZS10by1tYW55JyxcbiAgaWRlbnRpZmllcnM6ICgpID0+IFtcbiAgICB7IHNvdXJjZTogJ3VzZXJJZCcsIHRhcmdldDogJ3VzZXJJZCcgfSxcbiAgICB7IHNvdXJjZTogJ3Bvc3RJZCcsIHRhcmdldDogJ3Bvc3RJZCcgfVxuICBdXG59KTtcblxuLy8gVEVTVCA4LjY6IEZpZWxkIE9wdGlvbnMgd2l0aCBDb21wbGV4IFRlbXBsYXRlXG5jb25zdCB0ZXN0OF82ID0gY3JlYXRlRmllbGRPcHRpb25zPFRlYW1TY2hlbWE+KHtcbiAgYXBpTWV0aG9kOiAnR0VUJyxcbiAgYXBpVXJsOiAnL2FwaS90ZWFtcycsXG4gIHJlc3BvbnNlS2V5OiAndGVhbXMnLFxuICBxdWVyeToge1xuICAgIGZpbHRlcnM6IHtcbiAgICAgIGlzQWN0aXZlOiB7IGVxOiB0cnVlIH1cbiAgICB9LFxuICAgIHBhZ2luYXRpb246IHtcbiAgICAgIGNvdW50OiAxMDBcbiAgICB9XG4gIH0sXG4gIG9wdGlvbk1hcHBpbmc6IHtcbiAgICBsYWJlbDoge1xuICAgICAgY29tcG9zaXRlOiBbJ3RlYW1OYW1lJywgJ2NpdHknXSxcbiAgICAgIHRlbXBsYXRlOiAne3RlYW1OYW1lfSAtIHtjaXR5fSdcbiAgICB9LFxuICAgIHZhbHVlOiAndGVhbUlkJ1xuICB9XG59KTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gVkFMSURBVElPTiAmIFNVTU1BUllcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuY29uc29sZS5sb2coJ+KchSBBbGwgdHlwZSBzYWZldHkgdGVzdHMgcGFzc2VkIScpO1xuY29uc29sZS5sb2coJycpO1xuY29uc29sZS5sb2coJ1Rlc3QgQ292ZXJhZ2U6Jyk7XG5jb25zb2xlLmxvZygnLSBFbnRpdHkgUmVsYXRpb25zOiBEaXJlY3QsIENpcmN1bGFyIERlcGVuZGVuY2llcywgTGF6eSBMb2FkaW5nJyk7XG5jb25zb2xlLmxvZygnLSBFbnRpdHkgT3BlcmF0aW9uczogU3Vic2V0cywgU3VwZXJzZXRzLCBDdXN0b20gT3BlcmF0aW9ucycpO1xuY29uc29sZS5sb2coJy0gVXRpbGl0eSBUeXBlczogQXR0cmlidXRlIEZpbHRlcmluZywgVmFsdWUgVHlwZSBFeHRyYWN0aW9uJyk7XG5jb25zb2xlLmxvZygnLSBGaWVsZCBPcHRpb25zOiBTdGF0aWMsIEFQSS1sb2FkZWQsIFRlbXBsYXRlcycpO1xuY29uc29sZS5sb2coJy0gRW50aXR5IFF1ZXJpZXM6IEZpbHRlcnMsIEh5ZHJhdGlvbiwgUGFnaW5hdGlvbiwgU2VhcmNoJyk7XG5jb25zb2xlLmxvZygnLSBUeXBlIEd1YXJkczogUnVudGltZSBUeXBlIENoZWNraW5nIGZvciBBbGwgRmllbGQgVHlwZXMnKTtcbmNvbnNvbGUubG9nKCctIENvbXBsZXggU2NlbmFyaW9zOiBNdWx0aS1mZWF0dXJlIFF1ZXJpZXMsIENpcmN1bGFyIFJlZnMnKTtcblxuZXhwb3J0IHt9OyJdfQ==