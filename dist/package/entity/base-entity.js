"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DefaultEntityOperations = exports.SpecialAttributeTypes = void 0;
exports.createHydrateOptions = createHydrateOptions;
exports.createEntityQuery = createEntityQuery;
exports.createEntityRelation = createEntityRelation;
exports.isSelectFieldMetadata = isSelectFieldMetadata;
exports.isImageFieldMetadata = isImageFieldMetadata;
exports.isFileFieldMetadata = isFileFieldMetadata;
exports.isDateFieldMetadata = isDateFieldMetadata;
exports.isDateTimeFieldMetadata = isDateTimeFieldMetadata;
exports.isNumberFieldMetadata = isNumberFieldMetadata;
exports.isBooleanFieldMetadata = isBooleanFieldMetadata;
exports.isEditorFieldMetadata = isEditorFieldMetadata;
exports.isCodeEditorFieldMetadata = isCodeEditorFieldMetadata;
exports.createFieldOptions = createFieldOptions;
exports.createEntitySchema = createEntitySchema;
exports.createElectroDBEntity = createElectroDBEntity;
const electrodb_1 = require("electrodb");
/**
 * Creates type-safe hydrate options for entity queries.
 * Use this to specify which attributes (including relations) to load when querying entities.
 *
 * @template E - The entity schema type
 * @param options - The hydrate options (map or array of attribute paths)
 * @returns The typed hydrate options
 *
 * @example
 * // Using attribute map
 * createHydrateOptions<UserSchema>({
 *   userId: true,
 *   name: true,
 *   email: true,
 *   posts: true // hydrate relation
 * })
 *
 * @example
 * // Using array of paths
 * createHydrateOptions<UserSchema>([
 *   'userId',
 *   'name',
 *   'email',
 *   'posts.title',
 *   'posts.content'
 * ])
 *
 * @example
 * // With nested relation hydration
 * createHydrateOptions<UserSchema>({
 *   userId: true,
 *   name: true,
 *   posts: {
 *     attributes: {
 *       postId: true,
 *       title: true,
 *       comments: true
 *     }
 *   }
 * })
 */
function createHydrateOptions(options) {
    return options;
}
/**
 * Creates a type-safe entity query with proper type inference for all query parameters.
 * Ensures that filters, attributes, and search parameters are valid for the given entity schema.
 *
 * @template E - The entity schema type
 * @param query - The entity query configuration
 * @returns The typed entity query
 *
 * @example
 * // Simple query with filters
 * createEntityQuery<UserSchema>({
 *   filters: {
 *     status: { eq: 'active' },
 *     age: { gte: 18 }
 *   },
 *   attributes: ['userId', 'name', 'email']
 * })
 *
 * @example
 * // Query with pagination and search
 * createEntityQuery<UserSchema>({
 *   search: 'john',
 *   searchAttributes: ['name', 'email'],
 *   attributes: createHydrateOptions<UserSchema>({
 *     userId: true,
 *     name: true,
 *     email: true
 *   }),
 *   pagination: {
 *     count: 20,
 *     order: 'asc',
 *     cursor: null
 *   }
 * })
 *
 * @example
 * // Query with relation hydration
 * createEntityQuery<GameSchema>({
 *   filters: {
 *     status: { eq: 'upcoming' }
 *   },
 *   attributes: createHydrateOptions<GameSchema>({
 *     gameId: true,
 *     gameDate: true,
 *     homeTeam: {
 *       attributes: {
 *         teamId: true,
 *         teamName: true,
 *         logo: true
 *       }
 *     },
 *     awayTeam: {
 *       attributes: {
 *         teamId: true,
 *         teamName: true,
 *         logo: true
 *       }
 *     }
 *   }),
 *   pagination: { count: 10 }
 * })
 */
function createEntityQuery(query) {
    return query;
}
/**
 * Creates an entity relation with full type safety and circular dependency support.
 * This is the primary helper for defining entity relations.
 *
 * @template T - The entity schema type (direct or lazy-loaded via function)
 * @param relation - The relation configuration
 * @returns The typed relation
 *
 * @example
 * // Simple relation (no circular dependency)
 * createEntityRelation<TeamSchema>({
 *   entityName: 'team',
 *   type: 'many-to-one',
 *   identifiers: { source: 'teamId', target: 'teamId' }
 * })
 *
 * @example
 * // Multiple identifiers
 * createEntityRelation<TeamSchema>({
 *   entityName: 'team',
 *   type: 'many-to-one',
 *   identifiers: [
 *     { source: 'teamId', target: 'teamId' },
 *     { source: 'tenantId', target: 'tenantId' }
 *   ]
 * })
 *
 * @example
 * // Circular dependency - use lazy loading with arrow function
 * createEntityRelation<() => PostSchema>({
 *   entityName: 'post',
 *   type: 'one-to-many',
 *   identifiers: () => ({ source: 'userId', target: 'userId' })
 * })
 *
 * @example
 * // With hydration options
 * createEntityRelation<TeamSchema>({
 *   entityName: 'team',
 *   type: 'many-to-one',
 *   identifiers: { source: 'teamId', target: 'teamId' },
 *   hydrate: true,
 *   attributes: { teamId: true, teamName: true, logo: true }
 * })
 */
function createEntityRelation(relation) {
    return relation;
}
// Type guard for SelectFieldMetadata
function isSelectFieldMetadata(obj) {
    return (typeof obj === 'object'
        && !!obj
        && 'options' in obj
        && ['select', 'multi-select', 'autocomplete'].includes(obj.fieldType));
}
// Type guard for ImageFieldMetadata
function isImageFieldMetadata(obj) {
    return (typeof obj === 'object'
        && !!obj
        && obj.fieldType === 'image');
}
// Type guard for FileFieldMetadata
function isFileFieldMetadata(obj) {
    return (typeof obj === 'object'
        && !!obj
        && obj.fieldType === 'file');
}
// Type guard for DateFieldMetadata
function isDateFieldMetadata(obj) {
    return (typeof obj === 'object'
        && !!obj
        && obj.fieldType === 'date');
}
// Type guard for DateTimeFieldMetadata
function isDateTimeFieldMetadata(obj) {
    return (typeof obj === 'object'
        && !!obj
        && obj.fieldType === 'datetime');
}
// Type guard for NumberFieldMetadata
function isNumberFieldMetadata(obj) {
    return (typeof obj === 'object'
        && !!obj
        && obj.fieldType === 'number');
}
// Type guard for BooleanFieldMetadata
function isBooleanFieldMetadata(obj) {
    return (typeof obj === 'object'
        && !!obj
        && ['boolean', 'switch', 'toggle'].includes(obj.fieldType));
}
// Type guard for EditorFieldMetadata
function isEditorFieldMetadata(obj) {
    return (typeof obj === 'object'
        && !!obj
        && ['rich-text', 'wysiwyg'].includes(obj.fieldType));
}
// Type guard for CodeEditorFieldMetadata
function isCodeEditorFieldMetadata(obj) {
    return (typeof obj === 'object'
        && !!obj
        && ['code', 'markdown', 'json'].includes(obj.fieldType));
}
/**
 * Creates type-safe field options configuration for API-loaded select/radio/checkbox options.
 * Provides full type safety for attribute references in option mappings and query filters.
 *
 * @template E - The entity schema type for the options source
 * @param config - The field options API configuration
 * @returns The typed field options API config
 *
 * @example
 * // Simple attribute mapping
 * createFieldOptions<UserSchema>({
 *   apiMethod: 'GET',
 *   apiUrl: '/api/users',
 *   responseKey: 'data',
 *   optionMapping: {
 *     label: 'name',
 *     value: 'userId'
 *   }
 * })
 *
 * @example
 * // With query filters
 * createFieldOptions<TeamSchema>({
 *   apiMethod: 'GET',
 *   apiUrl: '/api/teams',
 *   responseKey: 'teams',
 *   query: { filters: { status: { eq: 'active' } } },
 *   optionMapping: {
 *     label: 'teamName',
 *     value: 'teamId'
 *   }
 * })
 *
 * @example
 * // With attribute template for composed labels
 * createFieldOptions<TeamSchema>({
 *   apiMethod: 'GET',
 *   apiUrl: '/api/teams',
 *   responseKey: 'teams',
 *   optionMapping: {
 *     label: {
 *       composite: ['teamName', 'city'],
 *       template: '{teamName} ({city})'
 *     },
 *     value: 'teamId'
 *   }
 * })
 */
function createFieldOptions(config) {
    return config;
}
exports.SpecialAttributeTypes = {
    name: 'name',
    slug: 'slug',
    color: 'color',
    image: 'image',
    description: 'description',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    deletedAt: 'deletedAt'
};
/**
 * Default entity operations that are commonly used.
 * Use this as a base or define your own subset/superset.
 */
exports.DefaultEntityOperations = {
    get: "get",
    list: "list",
    query: "query",
    create: "create",
    upsert: "upsert",
    update: "update",
    delete: "delete",
    duplicate: "duplicate",
};
/**
 * This function is used to define an entity schema for DynamoDB based entity, and it used ElectroDB under the hood.
 * It takes an object as an argument that describes the model, attributes, and indexes of the entity.
 * the generic params are only for the type inference, and they are not used in the function.
 *
 * @param schema - The entity schema configuration.
 *
 * @example
 * import { createEntitySchema } from '@ten24Group/fw24'
 *
 * const entitySchema = createEntitySchema({
 *   // entity schema configuration
 *
 *  // metadata about the entity
 *  model: {
 *      version: '1',
 *      entity: 'user',             // the name of the entity
 *      entityNamePlural: 'Users', // used by auto generated UI
 *      entityOperations: DefaultEntityOperations, // the operations that can be performed on the entity
 *      service: 'users', // ElectroDB service name [logical group of entities]
 *  },
 * // the attributes for the entity
 *  attributes: {
 *     userId: {
 *      type: 'string',
 *      required: true,
 *      readOnly: true,
 *      default: () => randomUUID()
 *    },
 *   // ... other attributes
 *  },
 * // the access patterns for the entity
 *  indexes: {
 *      primary: {
 *          pk: {
 *              field: 'primary_pk',
 *              composite: ['userId'],
 *          },
 *          sk: {
 *              field: 'primary_sk',
 *              composite: [],
 *          }
 *      },
 *      // ... other indexes
 *  },
 * } as const );
 *
 *
 */
function createEntitySchema(schema) {
    // Automatically inject _actor field into every schema for audit tracking
    const enhancedSchema = {
        ...schema,
        attributes: {
            ...schema.attributes,
            _actor: {
                type: 'any',
                required: false,
                hidden: true, // Hidden from ElectroDB operations
                readOnly: false,
                // UI metadata - mark as not visible in any UI
                isVisible: false,
                isListable: false,
                isCreatable: false,
                isEditable: false,
                isFilterable: false,
                isSearchable: false,
                isSortable: false,
                name: "Actor Context",
                description: "Internal field storing complete actor context for audit purposes"
            }
        }
    };
    return (0, electrodb_1.createSchema)(enhancedSchema);
}
function createElectroDBEntity(options) {
    const { schema, entityConfigurations } = options;
    const newElectroDbEntity = new electrodb_1.Entity(schema, entityConfigurations);
    return {
        name: schema.model.entity,
        entity: newElectroDbEntity,
        schema: schema,
        symbol: Symbol.for(schema.model.entity),
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1lbnRpdHkuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZW50aXR5L2Jhc2UtZW50aXR5LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQStNQSxvREFJQztBQWdFRCw4Q0FJQztBQWlGRCxvREFJQztBQTJVRCxzREFPQztBQUdELG9EQU1DO0FBR0Qsa0RBTUM7QUFHRCxrREFNQztBQUdELDBEQU1DO0FBR0Qsc0RBTUM7QUFHRCx3REFNQztBQUdELHNEQU1DO0FBR0QsOERBTUM7QUFpS0QsZ0RBSUM7QUFnTUQsZ0RBZ0NDO0FBRUQsc0RBY0M7QUExcENELHlDQUFpRDtBQXFLakQ7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0F3Q0c7QUFDSCxTQUFnQixvQkFBb0IsQ0FDbEMsT0FBa0M7SUFFbEMsT0FBTyxPQUFPLENBQUM7QUFDakIsQ0FBQztBQUVEOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBNkRHO0FBQ0gsU0FBZ0IsaUJBQWlCLENBQy9CLEtBQXFCO0lBRXJCLE9BQU8sS0FBSyxDQUFDO0FBQ2YsQ0FBQztBQW9DRDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0E0Q0c7QUFDSCxTQUFnQixvQkFBb0IsQ0FDbEMsUUFBMEM7SUFFMUMsT0FBTyxRQUFRLENBQUM7QUFDbEIsQ0FBQztBQTBVRCxxQ0FBcUM7QUFDckMsU0FBZ0IscUJBQXFCLENBQUMsR0FBUTtJQUM1QyxPQUFPLENBQ0wsT0FBTyxHQUFHLEtBQUssUUFBUTtXQUNwQixDQUFDLENBQUMsR0FBRztXQUNMLFNBQVMsSUFBSSxHQUFHO1dBQ2hCLENBQUUsUUFBUSxFQUFFLGNBQWMsRUFBRSxjQUFjLENBQUUsQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUN4RSxDQUFDO0FBQ0osQ0FBQztBQUVELG9D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QUMsS0FBSyxDQUFDLE1BQU0sQ0FBQztLQUN4QyxDQUFBO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgRW50aXR5Q29uZmlndXJhdGlvbiwgU2NoZW1hLCBFbnRpdHlJZGVudGlmaWVycywgQ3JlYXRlRW50aXR5SXRlbSwgVXBkYXRlRW50aXR5SXRlbSwgRW50aXR5SXRlbSwgQXR0cmlidXRlLCBSZXNwb25zZUl0ZW0sIFVwc2VydEl0ZW0gfSBmcm9tIFwiZWxlY3Ryb2RiXCI7XG5pbXBvcnQgeyBjcmVhdGVTY2hlbWEsIEVudGl0eSB9IGZyb20gXCJlbGVjdHJvZGJcIjtcblxuaW1wb3J0IHR5cGUgeyBFbnRpdHlRdWVyeSwgRmlsdGVyT3BlcmF0b3JzRXh0ZW5kZWQgfSBmcm9tICcuL3F1ZXJ5LXR5cGVzJztcbmltcG9ydCB0eXBlIHsgQmFzZUVudGl0eVNlcnZpY2UgfSBmcm9tIFwiLi9iYXNlLXNlcnZpY2VcIjtcbmltcG9ydCB0eXBlIHsgT21pdE5ldmVyLCBQYXRocywgV3JpdGFibGUgfSBmcm9tIFwiLi4vdXRpbHMvdHlwZXNcIjtcbmltcG9ydCB7IFNlYXJjaEluZGV4Q29uZmlnIH0gZnJvbSAnLi4vc2VhcmNoL3R5cGVzJztcbmltcG9ydCB7IEVudGl0eVNlYXJjaFNlcnZpY2UgfSBmcm9tICcuLi9zZWFyY2gvc2VydmljZXMnO1xuaW1wb3J0IHsgRGVwSWRlbnRpZmllciB9IGZyb20gXCIuLi9pbnRlcmZhY2VzXCI7XG5pbXBvcnQgdHlwZSB7IEZvcm1QYWdlQ29uZmlnU3RydWN0dXJlLCBMaXN0UGFnZUNvbmZpZ1N0cnVjdHVyZSwgRGV0YWlsc1BhZ2VDb25maWdTdHJ1Y3R1cmUgfSBmcm9tICcuLi91aS1jb25maWctZ2VuL3RlbXBsYXRlcy9jdXN0b20tcGFnZSc7XG5cbi8qKlxuICogQGZpbGVvdmVydmlldyBFbnRpdHkgU2NoZW1hIGFuZCBUeXBlLVNhZmUgSGVscGVyIEZ1bmN0aW9uc1xuICogXG4gKiBUaGlzIG1vZHVsZSBwcm92aWRlcyBlc3NlbnRpYWwgdHlwZS1zYWZlIGhlbHBlcnMgZm9yIGRlZmluaW5nIGVudGl0eSBzY2hlbWFzLFxuICogcmVsYXRpb25zLCBxdWVyaWVzLCBhbmQgY29uZmlndXJhdGlvbnMgd2l0aCBmdWxsIFR5cGVTY3JpcHQgc3VwcG9ydC5cbiAqIFxuICogIyMgQ29yZSBUeXBlLVNhZmUgSGVscGVyIEZ1bmN0aW9uc1xuICogXG4gKiAjIyMgRXNzZW50aWFsIEhlbHBlcnMgKDQgZnVuY3Rpb25zKVxuICogXG4gKiAxLiAqKmBjcmVhdGVFbnRpdHlSZWxhdGlvbjxFPigpYCoqIC0gRGVmaW5lIGVudGl0eSByZWxhdGlvbnMgd2l0aCBjaXJjdWxhciBkZXBlbmRlbmN5IHN1cHBvcnRcbiAqICAgIC0gRGlyZWN0OiBgY3JlYXRlRW50aXR5UmVsYXRpb248VGVhbVNjaGVtYT4oeyAuLi4gfSlgXG4gKiAgICAtIExhenk6IGBjcmVhdGVFbnRpdHlSZWxhdGlvbjwoKSA9PiBQb3N0U2NoZW1hPih7IC4uLiB9KWBcbiAqIFxuICogMi4gKipgY3JlYXRlRW50aXR5UXVlcnk8RT4oKWAqKiAtIEJ1aWxkIHR5cGUtc2FmZSBxdWVyaWVzIHdpdGggZmlsdGVycywgcGFnaW5hdGlvbiwgYW5kIGh5ZHJhdGlvblxuICogXG4gKiAzLiAqKmBjcmVhdGVIeWRyYXRlT3B0aW9uczxFPigpYCoqIC0gU3BlY2lmeSB3aGljaCBhdHRyaWJ1dGVzIGFuZCByZWxhdGlvbnMgdG8gbG9hZFxuICogXG4gKiA0LiAqKmBjcmVhdGVGaWVsZE9wdGlvbnM8RT4oKWAqKiAtIENvbmZpZ3VyZSBBUEktbG9hZGVkIG9wdGlvbnMgZm9yIHNlbGVjdC9yYWRpby9jaGVja2JveCBmaWVsZHNcbiAqIFxuICogIyMjIENvcmUgU2NoZW1hIEZ1bmN0aW9uc1xuICogLSBgY3JlYXRlRW50aXR5U2NoZW1hPC4uLj4oKWAgLSBEZWZpbmUgZW50aXR5IHNjaGVtYXMgd2l0aCBFbGVjdHJvREJcbiAqIC0gYGNyZWF0ZUVsZWN0cm9EQkVudGl0eTxTPigpYCAtIENyZWF0ZSBFbGVjdHJvREIgZW50aXR5IGluc3RhbmNlc1xuICogXG4gKiAjIyBVc2FnZSBFeGFtcGxlc1xuICogXG4gKiAjIyMgU2ltcGxlIFJlbGF0aW9uXG4gKiBgYGB0c1xuICogdGVhbUlkOiB7XG4gKiAgIHR5cGU6ICdzdHJpbmcnLFxuICogICByZWxhdGlvbjogY3JlYXRlRW50aXR5UmVsYXRpb248VGVhbVNjaGVtYT4oe1xuICogICAgIGVudGl0eU5hbWU6ICd0ZWFtJyxcbiAqICAgICB0eXBlOiAnbWFueS10by1vbmUnLFxuICogICAgIGlkZW50aWZpZXJzOiB7IHNvdXJjZTogJ3RlYW1JZCcsIHRhcmdldDogJ3RlYW1JZCcgfVxuICogICB9KVxuICogfVxuICogYGBgXG4gKiBcbiAqICMjIyBDaXJjdWxhciBEZXBlbmRlbmN5IFJlbGF0aW9uXG4gKiBgYGB0c1xuICogdXNlcklkOiB7XG4gKiAgIHR5cGU6ICdzdHJpbmcnLFxuICogICByZWxhdGlvbjogY3JlYXRlRW50aXR5UmVsYXRpb248KCkgPT4gVXNlclNjaGVtYT4oe1xuICogICAgIGVudGl0eU5hbWU6ICd1c2VyJyxcbiAqICAgICB0eXBlOiAnbWFueS10by1vbmUnLFxuICogICAgIGlkZW50aWZpZXJzOiAoKSA9PiAoeyBzb3VyY2U6ICd1c2VySWQnLCB0YXJnZXQ6ICd1c2VySWQnIH0pXG4gKiAgIH0pXG4gKiB9XG4gKiBgYGBcbiAqIFxuICogIyMjIFF1ZXJ5IHdpdGggSHlkcmF0aW9uXG4gKiBgYGB0c1xuICogY29uc3QgcXVlcnkgPSBjcmVhdGVFbnRpdHlRdWVyeTxHYW1lU2NoZW1hPih7XG4gKiAgIGZpbHRlcnM6IHsgc3RhdHVzOiB7IGVxOiAndXBjb21pbmcnIH0gfSxcbiAqICAgYXR0cmlidXRlczogY3JlYXRlSHlkcmF0ZU9wdGlvbnM8R2FtZVNjaGVtYT4oe1xuICogICAgIGdhbWVJZDogdHJ1ZSxcbiAqICAgICBob21lVGVhbTogeyBhdHRyaWJ1dGVzOiB7IHRlYW1JZDogdHJ1ZSwgdGVhbU5hbWU6IHRydWUgfSB9XG4gKiAgIH0pXG4gKiB9KVxuICogYGBgXG4gKiBcbiAqICMjIyBGaWVsZCBPcHRpb25zXG4gKiBgYGB0c1xuICogLy8gU3RhdGljIG9wdGlvbnMgLSB1c2UgYXJyYXkgZGlyZWN0bHlcbiAqIG9wdGlvbnM6IFtcbiAqICAgeyB2YWx1ZTogJ2FjdGl2ZScsIGxhYmVsOiAnQWN0aXZlJyB9LFxuICogICB7IHZhbHVlOiAnaW5hY3RpdmUnLCBsYWJlbDogJ0luYWN0aXZlJyB9XG4gKiBdXG4gKiBcbiAqIC8vIEFQSS1sb2FkZWQgb3B0aW9ucyAtIHVzZSBoZWxwZXJcbiAqIG9wdGlvbnM6IGNyZWF0ZUZpZWxkT3B0aW9uczxUZWFtU2NoZW1hPih7XG4gKiAgIGFwaU1ldGhvZDogJ0dFVCcsXG4gKiAgIGFwaVVybDogJy9hcGkvdGVhbXMnLFxuICogICByZXNwb25zZUtleTogJ2RhdGEnLFxuICogICBvcHRpb25NYXBwaW5nOiB7IGxhYmVsOiAndGVhbU5hbWUnLCB2YWx1ZTogJ3RlYW1JZCcgfVxuICogfSlcbiAqIGBgYFxuICogXG4gKiAjIyMgRW50aXR5IE9wZXJhdGlvbnNcbiAqICBcbiAqIGBgYHRzXG4gKiAvLyBGdWxsIHNldCAoZGVmYXVsdCkgLSBBbGwgQ1JVRCBvcGVyYXRpb25zXG4gKiBlbnRpdHlPcGVyYXRpb25zOiBEZWZhdWx0RW50aXR5T3BlcmF0aW9uc1xuICpcbiAqIC8vIFN1cGVyc2V0IC0gQWRkIGN1c3RvbSBvcGVyYXRpb25zIChlLmcuLCBwdWJsaXNoL2FwcHJvdmUgd29ya2Zsb3dzKVxuICogY29uc3QgQXJ0aWNsZU9wcyA9IHtcbiAqICAgLi4uRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gKiAgIHB1Ymxpc2g6ICdwdWJsaXNoJyxcbiAqICAgdW5wdWJsaXNoOiAndW5wdWJsaXNoJyxcbiAqICAgYXJjaGl2ZTogJ2FyY2hpdmUnXG4gKiB9IGFzIGNvbnN0O1xuICogZW50aXR5T3BlcmF0aW9uczogQXJ0aWNsZU9wc1xuICogYGBgXG4gKiBcbiAqICMjIFR5cGUgVXRpbGl0aWVzXG4gKiBcbiAqIEFkZGl0aW9uYWwgdHlwZSB1dGlsaXRpZXMgZm9yIGFkdmFuY2VkIHVzZSBjYXNlczpcbiAqIC0gYEF0dHJpYnV0ZXNUZW1wbGF0ZTxFPmAgLSBUeXBlLXNhZmUgYXR0cmlidXRlIGNvbXBvc2l0aW9uXG4gKiAtIGBWaXNpYmxlQXR0cmlidXRlS2V5czxFPmAgLSBFeHRyYWN0IHZpc2libGUgYXR0cmlidXRlIG5hbWVzXG4gKiAtIGBXcml0YWJsZUF0dHJpYnV0ZUtleXM8RT5gIC0gRXh0cmFjdCB3cml0YWJsZSBhdHRyaWJ1dGUgbmFtZXNcbiAqIC0gYEF0dHJpYnV0ZVZhbHVlVHlwZTxFLCBLPmAgLSBHZXQgdmFsdWUgdHlwZSBmb3IgYW4gYXR0cmlidXRlXG4gKiAtIGBFbnRpdHlBdHRyaWJ1dGVWYWx1ZU1hcDxFPmAgLSBNYXAgb2YgYWxsIGF0dHJpYnV0ZXMgdG8gdmFsdWUgdHlwZXNcbiAqIFxuICogIyMgUmVzb3VyY2VzXG4gKiBcbiAqIC0gaHR0cHM6Ly9naXRodWIuY29tL25sam1zL3NzaWEvYmxvYi9tYWluL3BhY2thZ2VzL2RhdGFiYXNlL3N0b3JhZ2VzL1BsYXllclN0b3JhZ2UudHNcbiAqIC0gaHR0cHM6Ly9naXRodWIuY29tL3R5d2FsY2gvZWxlY3Ryby1kZW1vL2Jsb2IvbWFpbi9uZXRsaWZ5L2Z1bmN0aW9ucy9zaGFyZS9yYXRlbGltaXQudHNcbiAqIC0gaHR0cHM6Ly9naXN0LmdpdGh1Yi5jb20vdHl3YWxjaC84MDQwMDg3ZTBmYzg4NmNhNWY3NDJhYTk5YjYyM2UxYlxuICogLSBodHRwczovL21lZGl1bS5jb20vZGV2ZWxvcGluZy1rb2FuL21vZGVsaW5nLWdyYXBoLXJlbGF0aW9uc2hpcHMtaW4tZHluYW1vZGItYzA2MTQxNjEyYTcwXG4gKiAtIGh0dHBzOi8vZ2lzdC5naXRodWIuY29tL3NldmVyaS81ZDE4MWEzZTc3OWY0MWE1ZTVmY2UxYjdkY2QxN2E4OVxuICogLSBodHRwczovL2dpdGh1Yi5jb20vaWt1c2hsaWFuc2tpL2ZhbWlseS1jYXItYm9va2luZy1iYWNrZW5kL2Jsb2IvbWFpbi9zZXJ2aWNlcy9jb3JlL2Jvb2tpbmcvYm9va2luZy5yZXBvc2l0b3J5LnRzXG4gKi9cblxuLyoqXG4gKiBSZXByZXNlbnRzIHRoZSBvcHRpb25zIGZvciBoeWRyYXRpbmcgYW4gZW50aXR5LlxuICogSXQgY2FuIGJlIGEgc3RyaW5nIHJlcHJlc2VudGluZyB0aGUgZW50aXR5IG5hbWUsXG4gKiBvciBhbiBvYmplY3Qgd2l0aCBhZGRpdGlvbmFsIGF0dHJpYnV0ZXMgYW5kIGh5ZHJhdGUgb3B0aW9ucy5cbiovXG5leHBvcnQgdHlwZSBSZWxhdGlvbmFsQXR0cmlidXRlczxUIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnksIGFueT4+ID0gT21pdE5ldmVyPHtcbiAgWyBLIGluIGtleW9mIFRbICdhdHRyaWJ1dGVzJyBdIF06IFRbICdhdHRyaWJ1dGVzJyBdWyBLIF1bICdoaWRkZW4nIF0gZXh0ZW5kcyB0cnVlID8gbmV2ZXJcbiAgOiBQaWNrUmVsYXRpb248VCwgSz4gZXh0ZW5kcyBuZXZlciA/IG5ldmVyXG4gIDogUGlja1JlbGF0aW9uPFQsIEs+O1xufT5cblxuZXhwb3J0IHR5cGUgTm9uUmVsYXRpb25hbEF0dHJpYnV0ZXM8VCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55LCBhbnk+PiA9IE9taXROZXZlcjx7XG4gIFsgSyBpbiBrZXlvZiBUWyAnYXR0cmlidXRlcycgXSBdOiBUWyAnYXR0cmlidXRlcycgXVsgSyBdWyAnaGlkZGVuJyBdIGV4dGVuZHMgdHJ1ZSA/IG5ldmVyXG4gIDogUGlja1JlbGF0aW9uPFQsIEs+IGV4dGVuZHMgbmV2ZXIgPyBUWyAnYXR0cmlidXRlcycgXVsgSyBdIDogbmV2ZXJcbn0+XG5cbmV4cG9ydCB0eXBlIFBpY2tSZWxhdGlvbjxFIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnksIGFueT4sIEEgZXh0ZW5kcyBrZXlvZiBFWyAnYXR0cmlidXRlcycgXT4gPVxuICBFWyAnYXR0cmlidXRlcycgXVsgQSBdWyAncmVsYXRpb24nIF0gZXh0ZW5kcyBSZWxhdGlvbjxpbmZlciBSPiA/IFJlbGF0aW9uPFI+IDogbmV2ZXI7XG5cbi8vIHV0aWxpdHkgdHlwZSBmb3IgcHJlcGFyZSBhbGwgdGhlIHBhdGhzIGZvciBlbnRpdHkgYW5kIGl0J3MgcmVsYXRpb25zXG50eXBlIF9FbnRpdHlBdHRyaWJ1dGVQYXRoczxFIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnksIGFueT4+ID1cbiAgeyBbIEsgaW4ga2V5b2YgTm9uUmVsYXRpb25hbEF0dHJpYnV0ZXM8RT4gXT86IEsgfVxuICAmXG4gIHsgWyBLIGluIGtleW9mIFJlbGF0aW9uYWxBdHRyaWJ1dGVzPEU+IF0/OiBfRW50aXR5QXR0cmlidXRlUGF0aHM8UmVsVG9SZWxhdGVkRW50aXR5PFJlbGF0aW9uYWxBdHRyaWJ1dGVzPEU+WyBLIF0+PiB9XG4vLyB1dGlsaXR5IHR5cGUgZm9yIHByZXBhcmUgYWxsIHRoZSBwYXRocyBmb3IgZW50aXR5IGFuZCBpdCdzIHJlbGF0aW9uc1xuZXhwb3J0IHR5cGUgRW50aXR5QXR0cmlidXRlUGF0aHM8RSBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55LCBhbnk+PiA9IFBhdGhzPF9FbnRpdHlBdHRyaWJ1dGVQYXRoczxFPj47XG5cblxuZXhwb3J0IHR5cGUgSHlkcmF0ZU9wdGlvbnNNYXBGb3JFbnRpdHk8VCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55LCBhbnk+PiA9XG4gIHsgWyBLIGluIGtleW9mIE5vblJlbGF0aW9uYWxBdHRyaWJ1dGVzPFQ+IF0/OiBib29sZWFuOyB9XG4gICZcbiAgeyBbIEsgaW4ga2V5b2YgUmVsYXRpb25hbEF0dHJpYnV0ZXM8VD4gXT86IGJvb2xlYW4gfCBIeWRyYXRlT3B0aW9uRm9yUmVsYXRpb248UmVsYXRpb25hbEF0dHJpYnV0ZXM8VD5bIEsgXT4gfTtcblxuZXhwb3J0IHR5cGUgSHlkcmF0ZU9wdGlvbkZvckVudGl0eTxFIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnksIGFueT4+ID0gSHlkcmF0ZU9wdGlvbnNNYXBGb3JFbnRpdHk8RT4gfCBBcnJheTxFbnRpdHlBdHRyaWJ1dGVQYXRoczxFPj47XG5cbmV4cG9ydCB0eXBlIEh5ZHJhdGVPcHRpb25Gb3JSZWxhdGlvbjxSZWwgZXh0ZW5kcyBSZWxhdGlvbjxhbnk+ID0gYW55PiA9IHtcbiAgZW50aXR5TmFtZT86IFJlbFsgJ2VudGl0eU5hbWUnIF0sXG4gIHJlbGF0aW9uVHlwZT86IFJlbFsgJ3R5cGUnIF0sXG4gIGlkZW50aWZpZXJzPzogUmVsYXRpb25JZGVudGlmaWVyczxSZWxUb1JlbGF0ZWRFbnRpdHk8UmVsPj4sXG4gIGF0dHJpYnV0ZXM6IEh5ZHJhdGVPcHRpb25Gb3JFbnRpdHk8UmVsVG9SZWxhdGVkRW50aXR5PFJlbD4+XG59XG5cbi8qKlxuICogQ3JlYXRlcyB0eXBlLXNhZmUgaHlkcmF0ZSBvcHRpb25zIGZvciBlbnRpdHkgcXVlcmllcy5cbiAqIFVzZSB0aGlzIHRvIHNwZWNpZnkgd2hpY2ggYXR0cmlidXRlcyAoaW5jbHVkaW5nIHJlbGF0aW9ucykgdG8gbG9hZCB3aGVuIHF1ZXJ5aW5nIGVudGl0aWVzLlxuICogXG4gKiBAdGVtcGxhdGUgRSAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGVcbiAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIGh5ZHJhdGUgb3B0aW9ucyAobWFwIG9yIGFycmF5IG9mIGF0dHJpYnV0ZSBwYXRocylcbiAqIEByZXR1cm5zIFRoZSB0eXBlZCBoeWRyYXRlIG9wdGlvbnNcbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIFVzaW5nIGF0dHJpYnV0ZSBtYXBcbiAqIGNyZWF0ZUh5ZHJhdGVPcHRpb25zPFVzZXJTY2hlbWE+KHtcbiAqICAgdXNlcklkOiB0cnVlLFxuICogICBuYW1lOiB0cnVlLFxuICogICBlbWFpbDogdHJ1ZSxcbiAqICAgcG9zdHM6IHRydWUgLy8gaHlkcmF0ZSByZWxhdGlvblxuICogfSlcbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIFVzaW5nIGFycmF5IG9mIHBhdGhzXG4gKiBjcmVhdGVIeWRyYXRlT3B0aW9uczxVc2VyU2NoZW1hPihbXG4gKiAgICd1c2VySWQnLFxuICogICAnbmFtZScsXG4gKiAgICdlbWFpbCcsXG4gKiAgICdwb3N0cy50aXRsZScsXG4gKiAgICdwb3N0cy5jb250ZW50J1xuICogXSlcbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIFdpdGggbmVzdGVkIHJlbGF0aW9uIGh5ZHJhdGlvblxuICogY3JlYXRlSHlkcmF0ZU9wdGlvbnM8VXNlclNjaGVtYT4oe1xuICogICB1c2VySWQ6IHRydWUsXG4gKiAgIG5hbWU6IHRydWUsXG4gKiAgIHBvc3RzOiB7XG4gKiAgICAgYXR0cmlidXRlczoge1xuICogICAgICAgcG9zdElkOiB0cnVlLFxuICogICAgICAgdGl0bGU6IHRydWUsXG4gKiAgICAgICBjb21tZW50czogdHJ1ZVxuICogICAgIH1cbiAqICAgfVxuICogfSlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUh5ZHJhdGVPcHRpb25zPEUgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueSwgYW55Pj4oXG4gIG9wdGlvbnM6IEh5ZHJhdGVPcHRpb25Gb3JFbnRpdHk8RT5cbik6IEh5ZHJhdGVPcHRpb25Gb3JFbnRpdHk8RT4ge1xuICByZXR1cm4gb3B0aW9ucztcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGEgdHlwZS1zYWZlIGVudGl0eSBxdWVyeSB3aXRoIHByb3BlciB0eXBlIGluZmVyZW5jZSBmb3IgYWxsIHF1ZXJ5IHBhcmFtZXRlcnMuXG4gKiBFbnN1cmVzIHRoYXQgZmlsdGVycywgYXR0cmlidXRlcywgYW5kIHNlYXJjaCBwYXJhbWV0ZXJzIGFyZSB2YWxpZCBmb3IgdGhlIGdpdmVuIGVudGl0eSBzY2hlbWEuXG4gKiBcbiAqIEB0ZW1wbGF0ZSBFIC0gVGhlIGVudGl0eSBzY2hlbWEgdHlwZVxuICogQHBhcmFtIHF1ZXJ5IC0gVGhlIGVudGl0eSBxdWVyeSBjb25maWd1cmF0aW9uXG4gKiBAcmV0dXJucyBUaGUgdHlwZWQgZW50aXR5IHF1ZXJ5XG4gKiBcbiAqIEBleGFtcGxlXG4gKiAvLyBTaW1wbGUgcXVlcnkgd2l0aCBmaWx0ZXJzXG4gKiBjcmVhdGVFbnRpdHlRdWVyeTxVc2VyU2NoZW1hPih7XG4gKiAgIGZpbHRlcnM6IHtcbiAqICAgICBzdGF0dXM6IHsgZXE6ICdhY3RpdmUnIH0sXG4gKiAgICAgYWdlOiB7IGd0ZTogMTggfVxuICogICB9LFxuICogICBhdHRyaWJ1dGVzOiBbJ3VzZXJJZCcsICduYW1lJywgJ2VtYWlsJ11cbiAqIH0pXG4gKiBcbiAqIEBleGFtcGxlXG4gKiAvLyBRdWVyeSB3aXRoIHBhZ2luYXRpb24gYW5kIHNlYXJjaFxuICogY3JlYXRlRW50aXR5UXVlcnk8VXNlclNjaGVtYT4oe1xuICogICBzZWFyY2g6ICdqb2huJyxcbiAqICAgc2VhcmNoQXR0cmlidXRlczogWyduYW1lJywgJ2VtYWlsJ10sXG4gKiAgIGF0dHJpYnV0ZXM6IGNyZWF0ZUh5ZHJhdGVPcHRpb25zPFVzZXJTY2hlbWE+KHtcbiAqICAgICB1c2VySWQ6IHRydWUsXG4gKiAgICAgbmFtZTogdHJ1ZSxcbiAqICAgICBlbWFpbDogdHJ1ZVxuICogICB9KSxcbiAqICAgcGFnaW5hdGlvbjoge1xuICogICAgIGNvdW50OiAyMCxcbiAqICAgICBvcmRlcjogJ2FzYycsXG4gKiAgICAgY3Vyc29yOiBudWxsXG4gKiAgIH1cbiAqIH0pXG4gKiBcbiAqIEBleGFtcGxlXG4gKiAvLyBRdWVyeSB3aXRoIHJlbGF0aW9uIGh5ZHJhdGlvblxuICogY3JlYXRlRW50aXR5UXVlcnk8R2FtZVNjaGVtYT4oe1xuICogICBmaWx0ZXJzOiB7XG4gKiAgICAgc3RhdHVzOiB7IGVxOiAndXBjb21pbmcnIH1cbiAqICAgfSxcbiAqICAgYXR0cmlidXRlczogY3JlYXRlSHlkcmF0ZU9wdGlvbnM8R2FtZVNjaGVtYT4oe1xuICogICAgIGdhbWVJZDogdHJ1ZSxcbiAqICAgICBnYW1lRGF0ZTogdHJ1ZSxcbiAqICAgICBob21lVGVhbToge1xuICogICAgICAgYXR0cmlidXRlczoge1xuICogICAgICAgICB0ZWFtSWQ6IHRydWUsXG4gKiAgICAgICAgIHRlYW1OYW1lOiB0cnVlLFxuICogICAgICAgICBsb2dvOiB0cnVlXG4gKiAgICAgICB9XG4gKiAgICAgfSxcbiAqICAgICBhd2F5VGVhbToge1xuICogICAgICAgYXR0cmlidXRlczoge1xuICogICAgICAgICB0ZWFtSWQ6IHRydWUsXG4gKiAgICAgICAgIHRlYW1OYW1lOiB0cnVlLFxuICogICAgICAgICBsb2dvOiB0cnVlXG4gKiAgICAgICB9XG4gKiAgICAgfVxuICogICB9KSxcbiAqICAgcGFnaW5hdGlvbjogeyBjb3VudDogMTAgfVxuICogfSlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUVudGl0eVF1ZXJ5PEUgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KFxuICBxdWVyeTogRW50aXR5UXVlcnk8RT5cbik6IEVudGl0eVF1ZXJ5PEU+IHtcbiAgcmV0dXJuIHF1ZXJ5O1xufVxuXG5cblxuLyoqXG4gKiBVdGlsaXR5IHR5cGUgdG8gZXh0cmFjdCBvbmx5IHZpc2libGUgKG5vbi1oaWRkZW4pIGF0dHJpYnV0ZSBrZXlzIGZyb20gYW4gZW50aXR5IHNjaGVtYVxuICovXG5leHBvcnQgdHlwZSBWaXNpYmxlQXR0cmlidXRlS2V5czxFIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnksIGFueT4+ID0ge1xuICBbSyBpbiBrZXlvZiBFWydhdHRyaWJ1dGVzJ11dOiBFWydhdHRyaWJ1dGVzJ11bS11bJ2hpZGRlbiddIGV4dGVuZHMgdHJ1ZSA/IG5ldmVyIDogS1xufVtrZXlvZiBFWydhdHRyaWJ1dGVzJ11dO1xuXG4vKipcbiAqIFV0aWxpdHkgdHlwZSB0byBleHRyYWN0IG9ubHkgd3JpdGFibGUgKG5vbi1yZWFkb25seSkgYXR0cmlidXRlIGtleXMgZnJvbSBhbiBlbnRpdHkgc2NoZW1hXG4gKi9cbmV4cG9ydCB0eXBlIFdyaXRhYmxlQXR0cmlidXRlS2V5czxFIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnksIGFueT4+ID0ge1xuICBbSyBpbiBrZXlvZiBFWydhdHRyaWJ1dGVzJ11dOiBFWydhdHRyaWJ1dGVzJ11bS11bJ3JlYWRPbmx5J10gZXh0ZW5kcyB0cnVlID8gbmV2ZXIgOiBLXG59W2tleW9mIEVbJ2F0dHJpYnV0ZXMnXV07XG5cbi8qKlxuICogUmVwcmVzZW50cyBhbiBpZGVudGlmaWVyIG1hcHBpbmcgYmV0d2VlbiBzb3VyY2UgYW5kIHRhcmdldCBlbnRpdHkgYXR0cmlidXRlcy5cbiAqIFRoZSB0YXJnZXQgaXMgY29uc3RyYWluZWQgdG8gdmFsaWQgYXR0cmlidXRlIGtleXMgb2YgdGhlIHRhcmdldCBlbnRpdHkuXG4gKi9cbmV4cG9ydCB0eXBlIFJlbGF0aW9uSWRlbnRpZmllcjxFIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnksIGFueT4gPSBhbnk+ID0geyBcbiAgc291cmNlOiBzdHJpbmcsIFxuICB0YXJnZXQ6IGtleW9mIEVbICdhdHRyaWJ1dGVzJyBdIFxufTtcblxuZXhwb3J0IHR5cGUgUmVsYXRpb25JZGVudGlmaWVyczxFIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnksIGFueT4gPSBhbnk+ID0gUmVsYXRpb25JZGVudGlmaWVyPEU+IHwgQXJyYXk8UmVsYXRpb25JZGVudGlmaWVyPEU+PlxuXG4vKipcbiAqIEhlbHBlciB0eXBlIHRvIHJlc29sdmUgZW50aXR5IHNjaGVtYSBmcm9tIGVpdGhlciBkaXJlY3QgdHlwZSBvciBsYXp5IGZ1bmN0aW9uXG4gKi9cbmV4cG9ydCB0eXBlIFJlc29sdmVFbnRpdHlTY2hlbWE8VD4gPSBUIGV4dGVuZHMgKCkgPT4gaW5mZXIgRSBcbiAgPyBFIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnksIGFueT4gPyBFIDogbmV2ZXJcbiAgOiBUIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnksIGFueT4gPyBUIDogbmV2ZXI7XG5cbi8qKlxuICogQ3JlYXRlcyBhbiBlbnRpdHkgcmVsYXRpb24gd2l0aCBmdWxsIHR5cGUgc2FmZXR5IGFuZCBjaXJjdWxhciBkZXBlbmRlbmN5IHN1cHBvcnQuXG4gKiBUaGlzIGlzIHRoZSBwcmltYXJ5IGhlbHBlciBmb3IgZGVmaW5pbmcgZW50aXR5IHJlbGF0aW9ucy5cbiAqIFxuICogQHRlbXBsYXRlIFQgLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlIChkaXJlY3Qgb3IgbGF6eS1sb2FkZWQgdmlhIGZ1bmN0aW9uKVxuICogQHBhcmFtIHJlbGF0aW9uIC0gVGhlIHJlbGF0aW9uIGNvbmZpZ3VyYXRpb25cbiAqIEByZXR1cm5zIFRoZSB0eXBlZCByZWxhdGlvblxuICogXG4gKiBAZXhhbXBsZVxuICogLy8gU2ltcGxlIHJlbGF0aW9uIChubyBjaXJjdWxhciBkZXBlbmRlbmN5KVxuICogY3JlYXRlRW50aXR5UmVsYXRpb248VGVhbVNjaGVtYT4oe1xuICogICBlbnRpdHlOYW1lOiAndGVhbScsXG4gKiAgIHR5cGU6ICdtYW55LXRvLW9uZScsXG4gKiAgIGlkZW50aWZpZXJzOiB7IHNvdXJjZTogJ3RlYW1JZCcsIHRhcmdldDogJ3RlYW1JZCcgfVxuICogfSlcbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIE11bHRpcGxlIGlkZW50aWZpZXJzXG4gKiBjcmVhdGVFbnRpdHlSZWxhdGlvbjxUZWFtU2NoZW1hPih7XG4gKiAgIGVudGl0eU5hbWU6ICd0ZWFtJyxcbiAqICAgdHlwZTogJ21hbnktdG8tb25lJyxcbiAqICAgaWRlbnRpZmllcnM6IFtcbiAqICAgICB7IHNvdXJjZTogJ3RlYW1JZCcsIHRhcmdldDogJ3RlYW1JZCcgfSxcbiAqICAgICB7IHNvdXJjZTogJ3RlbmFudElkJywgdGFyZ2V0OiAndGVuYW50SWQnIH1cbiAqICAgXVxuICogfSlcbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIENpcmN1bGFyIGRlcGVuZGVuY3kgLSB1c2UgbGF6eSBsb2FkaW5nIHdpdGggYXJyb3cgZnVuY3Rpb25cbiAqIGNyZWF0ZUVudGl0eVJlbGF0aW9uPCgpID0+IFBvc3RTY2hlbWE+KHtcbiAqICAgZW50aXR5TmFtZTogJ3Bvc3QnLFxuICogICB0eXBlOiAnb25lLXRvLW1hbnknLFxuICogICBpZGVudGlmaWVyczogKCkgPT4gKHsgc291cmNlOiAndXNlcklkJywgdGFyZ2V0OiAndXNlcklkJyB9KVxuICogfSlcbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIFdpdGggaHlkcmF0aW9uIG9wdGlvbnNcbiAqIGNyZWF0ZUVudGl0eVJlbGF0aW9uPFRlYW1TY2hlbWE+KHtcbiAqICAgZW50aXR5TmFtZTogJ3RlYW0nLFxuICogICB0eXBlOiAnbWFueS10by1vbmUnLFxuICogICBpZGVudGlmaWVyczogeyBzb3VyY2U6ICd0ZWFtSWQnLCB0YXJnZXQ6ICd0ZWFtSWQnIH0sXG4gKiAgIGh5ZHJhdGU6IHRydWUsXG4gKiAgIGF0dHJpYnV0ZXM6IHsgdGVhbUlkOiB0cnVlLCB0ZWFtTmFtZTogdHJ1ZSwgbG9nbzogdHJ1ZSB9XG4gKiB9KVxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRW50aXR5UmVsYXRpb248VCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55LCBhbnk+IHwgKCgpID0+IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55LCBhbnk+KT4oXG4gIHJlbGF0aW9uOiBSZWxhdGlvbjxSZXNvbHZlRW50aXR5U2NoZW1hPFQ+PlxuKTogUmVsYXRpb248UmVzb2x2ZUVudGl0eVNjaGVtYTxUPj4ge1xuICByZXR1cm4gcmVsYXRpb247XG59XG5cbmV4cG9ydCB0eXBlIFJlbFRvUmVsYXRlZEVudGl0eTxSZWw+ID0gUmVsIGV4dGVuZHMgUmVsYXRpb248aW5mZXIgRT4gPyBFIDogbmV2ZXI7XG4vKipcbiAqIFJlcHJlc2VudHMgYSByZWxhdGlvbiBiZXR3ZWVuIGVudGl0aWVzLlxuICogU3VwcG9ydHMgbGF6eS1sb2FkZWQgZW50aXR5IHNjaGVtYXMgdG8gYXZvaWQgY2lyY3VsYXIgZGVwZW5kZW5jeSBpc3N1ZXMuXG4gKlxuICogQHRlbXBsYXRlIEUgLSBUaGUgdHlwZSBvZiB0aGUgcmVsYXRlZCBlbnRpdHkgc2NoZW1hLlxuICovXG5leHBvcnQgdHlwZSBSZWxhdGlvbjxFIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnksIGFueT4gPSBhbnk+ID0ge1xuICAvKipcbiAgICogUmVwcmVzZW50cyBhIHJlbGF0aW9uIGJldHdlZW4gZW50aXRpZXMuXG4gICAqL1xuICBlbnRpdHlOYW1lOiBFWyAnbW9kZWwnIF1bICdlbnRpdHknIF07XG5cbiAgLyoqXG4gICAqIFRoZSB0eXBlIG9mIHRoZSByZWxhdGlvbi5cbiAgICogUG9zc2libGUgdmFsdWVzOiAnb25lLXRvLW9uZScsICdvbmUtdG8tbWFueScsICdtYW55LXRvLW9uZScsICdtYW55LXRvLW1hbnknLlxuICAgKi9cbiAgdHlwZTogJ29uZS10by1tYW55JyB8ICdtYW55LXRvLW9uZSc7IC8vICdvbmUtdG8tb25lJyB8ICdtYW55LXRvLW1hbnknO1xuXG4gIC8qKlxuICAgKiBJZGVudGlmaWVycyB0byBsb2FkIHRoZSByZWxhdGVkIGVudGl0eS5cbiAgICogVGhlc2UgYXJlIG1hcHBpbmdzIGJldHdlZW4gc291cmNlIGVudGl0eSBhdHRyaWJ1dGVzIGFuZCByZWxhdGVkIGVudGl0eSBhdHRyaWJ1dGVzLlxuICAgKiBUaGUga2V5cyBmb3Igc291cmNlIGVudGl0aWVzIGNhbiBzdXBwb3J0IHBhdGhzIGxpa2UgJ2F0dDEubmVzdGVkS2V5MScuXG4gICAqIFRoZSB2YWx1ZXMgY2FuIGJlIGEgc3RyaW5nIHJlcHJlc2VudGluZyB0aGUgcmVsYXRlZCBlbnRpdHkgYXR0cmlidXRlIG9yIGFuIGFycmF5IG9mIHN0cmluZ3MuXG4gICAqIENhbiBiZSBwcm92aWRlZCBkaXJlY3RseSBvciB2aWEgYSBmdW5jdGlvbiB0byBoYW5kbGUgY2lyY3VsYXIgZGVwZW5kZW5jaWVzLlxuICAgKi9cbiAgaWRlbnRpZmllcnM6IFJlbGF0aW9uSWRlbnRpZmllcnM8RT4gfCAoKCkgPT4gUmVsYXRpb25JZGVudGlmaWVyczxFPik7XG5cbiAgLy8gc2V0IHRoaXMgdG8gdHJ1ZSBpbiBlbnRpdHktZGVmaW5pdGlvbiB0byBhdXRvLWh5ZHJhdGUgdGhpcyByZWxhdGlvblxuICBoeWRyYXRlPzogYm9vbGVhbjtcblxuICAvKipcbiAgICogQXR0cmlidXRlcyB0byBsb2FkIHdoZW4gaHlkcmF0aW5nIHRoaXMgcmVsYXRpb24gYW5kIE9wdGlvbnMgZm9yIGh5ZHJhdGluZyB0aGUgcmVsYXRpb25hbCBhdHRyaWJ1dGVzIG9mIHRoaXMgcmVsYXRpb24uXG4gICAqIENhbiBiZSBwcm92aWRlZCBkaXJlY3RseSBvciB2aWEgYSBmdW5jdGlvbiB0byBoYW5kbGUgY2lyY3VsYXIgZGVwZW5kZW5jaWVzIGluIGNvbXBsZXggcmVsYXRpb24gY2hhaW5zLlxuICAgKi9cbiAgYXR0cmlidXRlcz86IEh5ZHJhdGVPcHRpb25Gb3JFbnRpdHk8RT4gfCAoKCkgPT4gSHlkcmF0ZU9wdGlvbkZvckVudGl0eTxFPik7XG59O1xuXG5cbi8qKlxuICogUmVwcmVzZW50cyBhbiBlbnRpdHkgYXR0cmlidXRlLlxuICovXG5leHBvcnQgdHlwZSBFbnRpdHlBdHRyaWJ1dGUgPSBBdHRyaWJ1dGUgJiB7XG4gIC8qKlxuICAgKiBUaGUgaHVtYW4gcmVhZGFibGUgbmFtZSBvZiB0aGUgYXR0cmlidXRlLlxuICAgKi9cbiAgbmFtZT86IHN0cmluZztcblxuICAvKipcbiAgICogSW5kaWNhdGVzIHdoZXRoZXIgdGhlIGF0dHJpYnV0ZSBpcyBhbiBpZGVudGlmaWVyLlxuICAgKi9cbiAgaXNJZGVudGlmaWVyPzogYm9vbGVhbjtcblxuICAvKipcbiAgICogSW5kaWNhdGVzIHdoZXRoZXIgdGhlIGF0dHJpYnV0ZSBpcyB1bmlxdWUgKGZvciB1bmlxdWUgY29uc3RyYWludHMpLlxuICAgKi9cbiAgaXNVbmlxdWU/OiBib29sZWFuO1xuXG4gIC8qKlxuICAgKiBEZWZpbmVzIGEgcmVsYXRpb24gd2l0aCBhbm90aGVyIGVudGl0eS5cbiAgICogVXNlIHRoZSB0eXBlLWhlbHBlciBgY3JlYXRlRW50aXR5UmVsYXRpb248RW50aXR5U2NoZW1hPigpYCBmdW5jdGlvbiBmb3IgdHlwZS1zYWZlIHJlbGF0aW9uIGNyZWF0aW9uLlxuICAgKiBGb3IgY2lyY3VsYXIgZGVwZW5kZW5jaWVzLCB1c2UgYGNyZWF0ZUVudGl0eVJlbGF0aW9uPCgpID0+IEVudGl0eVNjaGVtYT4oKWAgd2l0aCBsYXp5IGxvYWRpbmcuXG4gICAqL1xuICByZWxhdGlvbj86IFJlbGF0aW9uPGFueT47XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRpb25zIGZvciB0aGUgYXR0cmlidXRlLlxuICAgKi9cbiAgdmFsaWRhdGlvbnM/OiBhbnlbXTtcblxufVxuICAmIEZpZWxkTWV0YWRhdGE7XG5cblxuZXhwb3J0IHR5cGUgRmllbGRNZXRhZGF0YSA9IFRleHRGaWVsZE1ldGFkYXRhIHwgTnVtYmVyRmllbGRNZXRhZGF0YSB8IERhdGVGaWVsZE1ldGFkYXRhXG4gIHwgVGltZUZpZWxkTWV0YWRhdGEgfCBEYXRlVGltZUZpZWxkTWV0YWRhdGEgfCBCb29sZWFuRmllbGRNZXRhZGF0YVxuICB8IFNlbGVjdEZpZWxkTWV0YWRhdGEgfCBSYWRpb0ZpZWxkTWV0YWRhdGEgfCBDaGVja2JveEZpZWxkTWV0YWRhdGFcbiAgfCBGaWxlRmllbGRNZXRhZGF0YSB8IFJhbmdlRmllbGRNZXRhZGF0YSB8IENvbG9yRmllbGRNZXRhZGF0YVxuICB8IEltYWdlRmllbGRNZXRhZGF0YSB8IEhpZGRlbkZpZWxkTWV0YWRhdGEgfCBDdXN0b21GaWVsZE1ldGFkYXRhXG4gIHwgUmF0aW5nRmllbGRNZXRhZGF0YSB8IEVkaXRvckZpZWxkTWV0YWRhdGEgfCBDb2RlRWRpdG9yRmllbGRNZXRhZGF0YTtcblxuLy8gTWV0YWRhdGEgZm9yIFVJXG5leHBvcnQgaW50ZXJmYWNlIEJhc2VGaWVsZE1ldGFkYXRhIHtcbiAgaXNWaXNpYmxlPzogYm9vbGVhbjsgLy8gaWYgdGhlIGZpZWxkIGlzIHZpc2libGUgb3IgaGlkZGVuIG9uIGFsbCBkZXRhaWwtcGFnZXNcbiAgaXNMaXN0YWJsZT86IGJvb2xlYW47IC8vIGlmIHRoZSBmaWVsZCBpcyB2aXNpYmxlIGluIHRoZSBsaXN0IHZpZXdcbiAgaXNDcmVhdGFibGU/OiBib29sZWFuOyAvLyBpZiB0aGUgZmllbGQgaXMgY3JlYXRhYmxlXG4gIGlzRWRpdGFibGU/OiBib29sZWFuOyAvLyBpZiB0aGUgZmllbGQgaXMgZWRpdGFibGVcbiAgaXNGaWx0ZXJhYmxlPzogYm9vbGVhbjsgLy8gaWYgdGhlIGZpZWxkIGlzIGZpbHRlcmFibGVcbiAgaXNTZWFyY2hhYmxlPzogYm9vbGVhbjsgLy8gaWYgdGhlIGZpZWxkIGlzIHNlYXJjaGFibGVcbiAgaXNTb3J0YWJsZT86IGJvb2xlYW47IC8vIGlmIHRoZSBmaWVsZCBpcyBzb3J0YWJsZVxuICBwbGFjZWhvbGRlcj86IHN0cmluZztcbiAgaGVscFRleHQ/OiBzdHJpbmc7XG4gIHRvb2x0aXA/OiBzdHJpbmc7IC8vIG1heWJlIHRoaXMgY2FuIGJlIGluZmVycmVkIGZyb20gdGhlIGhlbHBUZXh0XG4gIC8vIEZpbHRlciBjb25maWd1cmF0aW9uIG9wdGlvbnNcbiAgZmlsdGVyQ29uZmlnPzoge1xuICAgIGZpbHRlclR5cGU/OiAndGV4dCcgfCAnc2VsZWN0JyB8ICdkYXRldGltZScgfCAnbnVtYmVyJyB8ICdib29sZWFuJzsgLy8gRmlsdGVyIGlucHV0IHR5cGVcbiAgICBkZWZhdWx0T3BlcmF0b3I/OiBGaWx0ZXJPcGVyYXRvcnNFeHRlbmRlZDxhbnk+OyAvLyBEZWZhdWx0IGZpbHRlciBvcGVyYXRvciAoZS5nLiwgJ2NvbnRhaW5zJywgJ2VxJywgJ2luJylcbiAgICBhdmFpbGFibGVPcGVyYXRvcnM/OiBGaWx0ZXJPcGVyYXRvcnNFeHRlbmRlZDxhbnk+W107IC8vIFJlc3RyaWN0IGF2YWlsYWJsZSBvcGVyYXRvcnMgZm9yIHRoaXMgY29sdW1uXG4gICAgcHJlZGVmaW5lZE9wdGlvbnM/OiBBcnJheTx7IGxhYmVsOiBzdHJpbmc7IHZhbHVlOiBzdHJpbmcgfT47IC8vIEZvciBkcm9wZG93bi9zZWxlY3QgZmlsdGVyc1xuICB9O1xuICAvLyBMaW5rIGNvbmZpZ3VyYXRpb24gZm9yIHJlbmRlcmluZyBmaWVsZCBhcyBpbnRlcm5hbCBsaW5rXG4gIGlzTGluaz86IGJvb2xlYW47XG4gIGxpbmtDb25maWc/OiB7XG4gICAgcm91dGVQYXR0ZXJuOiBzdHJpbmc7XG4gICAgZGlzcGxheVRleHQ/OiBzdHJpbmc7XG4gIH07XG59XG5cbi8qKlxuICogTW9kYWwgdHlwZSBmb3IgYWN0aW9uc1xuICovXG5leHBvcnQgdHlwZSBNb2RhbFR5cGUgPSBcImNvbmZpcm1cIiB8IFwibGlzdFwiIHwgXCJmb3JtXCIgfCBcImFjY29yZGlvblwiIHwgXCJjdXN0b21cIiB8IFwiZGV0YWlsc1wiIHwgXCJkYXNoYm9hcmRcIjtcblxuLyoqXG4gKiBBUEkgbWV0aG9kIHR5cGUgLSBtdXN0IG1hdGNoIGZyb250ZW5kIElBcGlDb25maWdcbiAqL1xuZXhwb3J0IHR5cGUgQXBpTWV0aG9kID0gJ0dFVCcgfCAnUE9TVCcgfCAnUFVUJyB8ICdERUxFVEUnIHwgJ1BBVENIJztcblxuLyoqXG4gKiBDb25maXJtIG1vZGFsIGNvbmZpZ3VyYXRpb25cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJQ29uZmlybU1vZGFsIHtcbiAgdGl0bGU6IHN0cmluZztcbiAgY29udGVudD86IHN0cmluZztcbn1cblxuLyoqXG4gKiBBUEkgY29uZmlndXJhdGlvbiBmb3IgbW9kYWwgYWN0aW9uc1xuICovXG5leHBvcnQgaW50ZXJmYWNlIElNb2RhbEFwaUNvbmZpZyB7XG4gIGFwaU1ldGhvZDogQXBpTWV0aG9kO1xuICByZXNwb25zZUtleT86IHN0cmluZztcbiAgYXBpVXJsOiBzdHJpbmc7XG59XG5cbi8qKlxuICogTW9kYWwgY29uZmlndXJhdGlvbiBmb3IgZW50aXR5IHBhZ2UgYWN0aW9uc1xuICogTm90ZTogVGhpcyBpcyBhIHN1YnNldCBvZiB0aGUgZnJvbnRlbmQgSU1vZGFsQ29uZmlnLCBleGNsdWRpbmcgcnVudGltZSBwcm9wc1xuICovXG4vKipcbiAqIE5hdmlnYXRpb24gY29uZmlndXJhdGlvbiBmb3IgbW9kYWwgZm9ybSBzdWJtaXNzaW9uc1xuICogQWxsb3dzIGNvbGxlY3RpbmcgdXNlciBpbnB1dCBhbmQgbmF2aWdhdGluZyB0byBhIHJvdXRlIHdpdGhvdXQgQVBJIGNhbGxzXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSU5hdmlnYXRlVG9Db25maWcge1xuICAvKiogVGFyZ2V0IHJvdXRlIHBhdHRlcm4sIGUuZy4sIFwiL2xpc3QtZ2FtZVwiIG9yIFwiL3ZpZXctdXNlci86dXNlcklkXCIgKi9cbiAgcm91dGVQYXR0ZXJuOiBzdHJpbmc7XG4gIFxuICAvKiogV2hldGhlciB0byB1c2UgZm9ybSB2YWx1ZXMgZm9yIHJvdXRlL3F1ZXJ5IHBhcmFtcy4gRGVmYXVsdDogdHJ1ZSAqL1xuICB1c2VGb3JtVmFsdWVzPzogYm9vbGVhbjtcbiAgXG4gIC8qKiBNYXBzIGZvcm0gZmllbGQgcGF0aHMgdG8gcXVlcnkgcGFyYW1ldGVycy4gXG4gICAqIEV4YW1wbGU6IHsgXCJzdGF0dXMuZXFcIjogXCJzdGF0dXNGaWx0ZXJcIiwgXCJ0ZWFtSWRzLmluXCI6IFwic2VsZWN0ZWRUZWFtc1wiIH1cbiAgICovXG4gIHF1ZXJ5UGFyYW1NYXBwaW5nPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgXG4gIC8qKiBNYXBzIGZvcm0gZmllbGQgcGF0aHMgdG8gcm91dGUgcGFyYW1ldGVycy5cbiAgICogRXhhbXBsZTogeyB1c2VySWQ6IFwic2VsZWN0ZWRVc2VyLmlkXCIgfVxuICAgKi9cbiAgcm91dGVQYXJhbU1hcHBpbmc/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICBcbiAgLyoqIFVzZSBzZXNzaW9uU3RvcmFnZSBmb3IgbGFyZ2UgcGFyYW1ldGVyIHNldHMgKD4xNTAwIGNoYXJzKS4gRGVmYXVsdDogZmFsc2UgKi9cbiAgdXNlTGFyZ2VQYXJhbVN0b3JhZ2U/OiBib29sZWFuO1xuICBcbiAgLyoqIERhdGUgZm9ybWF0IGZvciBkYXRlIGZpZWxkcy4gRGVmYXVsdDogJ0lTTycgKi9cbiAgZGF0ZUZvcm1hdD86ICdJU08nIHwgJ3VuaXgnIHwgJ1lZWVktTU0tREQnO1xuICBcbiAgLyoqIEFycmF5IGZpZWxkIHRvIGV4dHJhY3QgKGUuZy4sICdpZCcgZXh0cmFjdHMgSURzIGZyb20gb2JqZWN0IGFycmF5cykuIERlZmF1bHQ6IGF1dG8tZGV0ZWN0ICovXG4gIGFycmF5VmFsdWVQYXRoPzogc3RyaW5nO1xuICBcbiAgLyoqIFVzZSByZXBsYWNlIGluc3RlYWQgb2YgcHVzaCBpbiBuYXZpZ2F0aW9uIGhpc3RvcnkuIERlZmF1bHQ6IGZhbHNlICovXG4gIHJlcGxhY2U/OiBib29sZWFuO1xuICBcbiAgLyoqIFByZS1wb3B1bGF0ZSBmb3JtIGZyb20gcXVlcnkgcGFyYW1zIG9uIG1vZGFsIG9wZW4uIERlZmF1bHQ6IGZhbHNlICovXG4gIGludmVyc2VNYXBwaW5nPzogYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBDb25maWd1cmF0aW9uIGZvciBkaXNwbGF5aW5nIEFQSSByZXNwb25zZSBpbiBhIG1vZGFsXG4gKiBSZXVzZXMgdGhlIGV4aXN0aW5nIHBhZ2UgcmVuZGVyaW5nIHN5c3RlbSAoZGV0YWlscywgbGlzdCwgZGFzaGJvYXJkLCBldGMuKVxuICogXG4gKiBVc2UgQ2FzZXM6XG4gKiAtIEJ1bGsgb3BlcmF0aW9uczogU2hvdyByZXN1bHRzIGJyZWFrZG93biAoY3JlYXRlZC91cGRhdGVkL2ZhaWxlZCBjb3VudHMpXG4gKiAtIFJlcG9ydCBnZW5lcmF0aW9uOiBTaG93IHN1bW1hcnkgd2l0aCBkb3dubG9hZCBsaW5rc1xuICogLSBUZXN0L3ZhbGlkYXRpb246IFNob3cgb3BlcmF0aW9uIHJlc3VsdHMsIHdhcm5pbmdzLCBBUEkgcmVzcG9uc2VzXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSVJlc3BvbnNlRGlzcGxheUNvbmZpZyB7XG4gIC8qKiBXaGV0aGVyIHRvIHNob3cgcmVzcG9uc2UgaW4gYSBtb2RhbC4gSWYgZmFsc2UsIG9ubHkgdG9hc3Qgbm90aWZpY2F0aW9uIHNob3dzLiBEZWZhdWx0OiBmYWxzZSAqL1xuICBzaG93TW9kYWw/OiBib29sZWFuO1xuICBcbiAgLyoqIFRpdGxlIGZvciByZXNwb25zZSBtb2RhbC4gSWYgbm90IHByb3ZpZGVkLCBhcHBlbmRzIFwiIC0gUmVzdWx0c1wiIHRvIGFjdGlvbiBtb2RhbCB0aXRsZSAqL1xuICBtb2RhbFRpdGxlPzogc3RyaW5nO1xuICBcbiAgLyoqIFdpZHRoIG9mIHJlc3BvbnNlIG1vZGFsIGluIHBpeGVscy4gRGVmYXVsdDogODAwICovXG4gIG1vZGFsV2lkdGg/OiBudW1iZXI7XG4gIFxuICAvKiogT1BUSU9OIDE6IFJlbmRlciByZXNwb25zZSB1c2luZyBleGlzdGluZyBwYWdlIHR5cGUgc3lzdGVtIChyZWNvbW1lbmRlZCkgKi9cbiAgcGFnZVR5cGU/OiAnZGV0YWlscycgfCAnbGlzdCcgfCAnZGFzaGJvYXJkJyB8ICdhY2NvcmRpb24nO1xuICBwYWdlQ29uZmlnPzogRGV0YWlsc1BhZ2VDb25maWdTdHJ1Y3R1cmUgfCBMaXN0UGFnZUNvbmZpZ1N0cnVjdHVyZSB8IFJlY29yZDxzdHJpbmcsIGFueT47XG4gIFxuICAvKiogT1BUSU9OIDI6IFNob3cgcmF3IEpTT04gcmVzcG9uc2UgKHVzZWZ1bCBmb3IgZGVidWdnaW5nL3Rlc3RpbmcpICovXG4gIHNob3dSYXdKc29uPzogYm9vbGVhbjtcbiAgXG4gIC8qKiBQYXRoIHRvIGV4dHJhY3QgZGF0YSBmcm9tIHJlc3BvbnNlLiBEZWZhdWx0OiB1c2VzIHJlc3BvbnNlIHJvb3RcbiAgICogRXhhbXBsZTogXCJkYXRhLnJlc3VsdHNcIiB3aWxsIHVzZSByZXNwb25zZS5kYXRhLnJlc3VsdHMgYXMgdGhlIGRhdGEgc291cmNlXG4gICAqL1xuICBkYXRhUGF0aD86IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBJRW50aXR5UGFnZUFjdGlvbk1vZGFsQ29uZmlnIHtcbiAgbW9kYWxUeXBlOiBNb2RhbFR5cGU7XG4gIG1vZGFsUGFnZUNvbmZpZz86IElDb25maXJtTW9kYWwgfCBGb3JtUGFnZUNvbmZpZ1N0cnVjdHVyZSB8IExpc3RQYWdlQ29uZmlnU3RydWN0dXJlIHwgRGV0YWlsc1BhZ2VDb25maWdTdHJ1Y3R1cmU7XG4gIFxuICAvKiogRUlUSEVSOiBNYWtlIEFQSSBjYWxsIChleGlzdGluZyBwYXR0ZXJuKSAqL1xuICBhcGlDb25maWc/OiBJTW9kYWxBcGlDb25maWc7XG4gIHN1Ym1pdFN1Y2Nlc3NSZWRpcmVjdD86IHN0cmluZztcbiAgXG4gIC8qKiBPUjogTmF2aWdhdGUgd2l0aG91dCBBUEkgY2FsbCAobmV3IHBhdHRlcm4pICovXG4gIG5hdmlnYXRlVG8/OiBJTmF2aWdhdGVUb0NvbmZpZyB8IHN0cmluZzsgIC8vIFN0cmluZyBzaG9ydGhhbmQ6IFwiL2xpc3QtZ2FtZT9zdGF0dXM9e3N0YXR1c31cIlxuICBcbiAgLyoqIE9QVElPTkFMOiBEaXNwbGF5IEFQSSByZXNwb25zZSBpbiBhIG1vZGFsIChpbnN0ZWFkIG9mIGp1c3QgdG9hc3Qgbm90aWZpY2F0aW9uKVxuICAgKiBOb3RlOiBPbmx5IGFwcGxpZXMgd2hlbiBhcGlDb25maWcgaXMgcHJlc2VudC4gSWdub3JlZCBmb3IgbmF2aWdhdGVUby5cbiAgICovXG4gIHJlc3BvbnNlQ29uZmlnPzogSVJlc3BvbnNlRGlzcGxheUNvbmZpZztcbn1cblxuLyoqXG4gKiBFbnRpdHkgcGFnZSBhY3Rpb25cbiAqIFN1cHBvcnRzIGJ1dHRvbnMsIGRyb3Bkb3ducyB3aXRoIG1vZGFscy9uYXZpZ2F0aW9uXG4gKiBcbiAqIFBhdHRlcm5zOlxuICogMS4gTmF2aWdhdGlvbjogeyB1cmw6IFwiL3ZpZXctdXNlci86aWRcIiB9XG4gKiAyLiBNb2RhbCB3aXRoIGlubGluZSBjb25maWc6IHsgb3BlbkluTW9kYWw6IHRydWUsIG1vZGFsQ29uZmlnOiB7Li4ufSB9XG4gKiAzLiBNb2RhbCB3aXRoIHJvdXRlIHJlc29sdXRpb246IHsgb3BlbkluTW9kYWw6IHRydWUsIHVybDogXCIvdmlldy11c2VyLzppZFwiIH1cbiAqIFxuICogTm90ZTogaXRlbXMgY2Fubm90IGhhdmUgbmVzdGVkIGl0ZW1zIChtYXggMSBsZXZlbCBvZiBuZXN0aW5nKVxuICovXG5leHBvcnQgaW50ZXJmYWNlIElFbnRpdHlQYWdlQWN0aW9uIHtcbiAgbGFiZWw6IHN0cmluZztcbiAgdXJsPzogc3RyaW5nO1xuICBpY29uPzogc3RyaW5nO1xuICB0eXBlPzogJ2J1dHRvbicgfCAnZHJvcGRvd24nO1xuICBpdGVtcz86IEFycmF5PE9taXQ8SUVudGl0eVBhZ2VBY3Rpb24sICdpdGVtcyc+PjsgIC8vIEl0ZW1zIGNhbm5vdCBoYXZlIHN1Yi1pdGVtc1xuICBcbiAgLyoqIE9wZW4gYWN0aW9uIGluIG1vZGFsIGluc3RlYWQgb2YgbmF2aWdhdGluZyAqL1xuICBvcGVuSW5Nb2RhbD86IGJvb2xlYW47XG4gIFxuICAvKiogTW9kYWwgY29uZmlndXJhdGlvbiAoaW5saW5lIGNvbmZpZyBvciByZXNvbHZlZCBmcm9tIHVybCkgKi9cbiAgbW9kYWxDb25maWc/OiBJRW50aXR5UGFnZUFjdGlvbk1vZGFsQ29uZmlnO1xuICBcbiAgLyoqIEN1c3RvbSBtb2RhbCB3aWR0aC4gRGVmYXVsdDogYXV0by1kZXRlY3QgZnJvbSBwYWdlIHR5cGUgKi9cbiAgbW9kYWxXaWR0aD86IG51bWJlciB8IHN0cmluZztcbiAgXG4gIC8qKiBPdmVycmlkZSByZXNvbHZlZCBwYWdlIHRpdGxlIHdoZW4gb3BlbmVkIGluIG1vZGFsICovXG4gIG1vZGFsVGl0bGU/OiBzdHJpbmc7XG4gIFxuICAvKiogSGlkZSB0aGlzIGFjdGlvbiB3aGVuIHJlbmRlcmVkIGluc2lkZSBhIG1vZGFsLiBEZWZhdWx0OiBmYWxzZSAqL1xuICBoaWRlSW5Nb2RhbD86IGJvb2xlYW47XG4gIFxuICAvKiogT25seSBvcGVuIGluIG1vZGFsIG9uIHNwZWNpZmllZCBzY3JlZW4gc2l6ZS4gRGVmYXVsdDogYWx3YXlzICovXG4gIG9wZW5Jbk1vZGFsQ29uZGl0aW9uPzogJ3NtJyB8ICdtZCcgfCAnbGcnIHwgJ3hsJztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBJRW50aXR5UGFnZUNvbHVtbiB7XG4gIHNvcnRPcmRlcjogbnVtYmVyO1xuICBmaWVsZHM6IHN0cmluZ1tdO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIElFbnRpdHlQYWdlQ29sdW1uQ29uZmlnIHtcbiAgbnVtQ29sdW1ucz86IG51bWJlcjtcbiAgY29sdW1uczogSUVudGl0eVBhZ2VDb2x1bW5bXTtcbn1cblxuaW50ZXJmYWNlIFRleHRGaWVsZE1ldGFkYXRhIGV4dGVuZHMgQmFzZUZpZWxkTWV0YWRhdGEge1xuICBmaWVsZFR5cGU/OiAndGV4dCcgfCAndGV4dGFyZWEnIHwgJ3Bhc3N3b3JkJyB8ICdlbWFpbCc7XG4gIG1heExlbmd0aD86IG51bWJlcjtcbiAgbWFzaz86IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIE51bWJlckZpZWxkTWV0YWRhdGEgZXh0ZW5kcyBCYXNlRmllbGRNZXRhZGF0YSB7XG4gIGZpZWxkVHlwZT86ICdudW1iZXInO1xuICBtaW4/OiBudW1iZXI7XG4gIG1heD86IG51bWJlcjtcbiAgc3RlcD86IG51bWJlcjtcbn1cblxuaW50ZXJmYWNlIERhdGVGaWVsZE1ldGFkYXRhIGV4dGVuZHMgQmFzZUZpZWxkTWV0YWRhdGEge1xuICBmaWVsZFR5cGU/OiAnZGF0ZSc7XG4gIG1pbkRhdGU/OiBEYXRlO1xuICBtYXhEYXRlPzogRGF0ZTtcbiAgZGF0ZUZvcm1hdD86IHN0cmluZzsgLy8gZm9ybWF0IHRvIGRpc3BsYXkgdGhlIGRhdGVcbn1cblxuXG5pbnRlcmZhY2UgVGltZUZpZWxkTWV0YWRhdGEgZXh0ZW5kcyBCYXNlRmllbGRNZXRhZGF0YSB7XG4gIGZpZWxkVHlwZT86ICd0aW1lJztcbiAgbWluVGltZT86IHN0cmluZzsgLy8gaW4gSEg6bW0gZm9ybWF0XG4gIG1heFRpbWU/OiBzdHJpbmc7IC8vIGluIEhIOm1tIGZvcm1hdFxuICB0aW1lRm9ybWF0Pzogc3RyaW5nOyAvLyBmb3JtYXQgdG8gZGlzcGxheSB0aGUgdGltZVxufVxuXG5pbnRlcmZhY2UgRGF0ZVRpbWVGaWVsZE1ldGFkYXRhIGV4dGVuZHMgQmFzZUZpZWxkTWV0YWRhdGEge1xuICBmaWVsZFR5cGU/OiAnZGF0ZXRpbWUnO1xuICBtaW5EYXRlVGltZT86IERhdGU7XG4gIG1heERhdGVUaW1lPzogRGF0ZTtcbiAgZGF0ZVRpbWVGb3JtYXQ/OiBzdHJpbmc7IC8vIGZvcm1hdCB0byBkaXNwbGF5IHRoZSBkYXRlIGFuZCB0aW1lXG59XG5cbmludGVyZmFjZSBDb2xvckZpZWxkTWV0YWRhdGEgZXh0ZW5kcyBCYXNlRmllbGRNZXRhZGF0YSB7XG4gIGZpZWxkVHlwZT86ICdjb2xvcic7XG4gIGRlZmF1bHRDb2xvcj86IHN0cmluZzsgLy8gZGVmYXVsdCBjb2xvciB2YWx1ZVxufVxuXG5pbnRlcmZhY2UgQm9vbGVhbkZpZWxkTWV0YWRhdGEgZXh0ZW5kcyBCYXNlRmllbGRNZXRhZGF0YSB7XG4gIGZpZWxkVHlwZT86ICdib29sZWFuJyB8ICdzd2l0Y2gnIHwgJ3RvZ2dsZSc7XG4gIHRydWVMYWJlbD86IHN0cmluZzsgLy8gbGFiZWwgZm9yIHRoZSB0cnVlIHZhbHVlXG4gIGZhbHNlTGFiZWw/OiBzdHJpbmc7IC8vIGxhYmVsIGZvciB0aGUgZmFsc2UgdmFsdWVcbn1cblxuZXhwb3J0IGludGVyZmFjZSBTZWxlY3RGaWVsZE1ldGFkYXRhPEUgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4gPSBhbnk+IGV4dGVuZHMgQmFzZUZpZWxkTWV0YWRhdGEge1xuICBmaWVsZFR5cGU/OiAnc2VsZWN0JyB8ICdtdWx0aS1zZWxlY3QnIHwgJ2F1dG9jb21wbGV0ZSc7XG4gIG9wdGlvbnM6IEZpZWxkT3B0aW9uczxFPjtcbiAgbWF4U2VsZWN0aW9ucz86IG51bWJlcjsgLy8gbWF4aW11bSBudW1iZXIgb2Ygc2VsZWN0aW9uc1xuICAvLyB3aGV0aGVyIHRvIGFsbG93IGFkZGluZyBuZXcgb3B0aW9uc1xuICBhZGROZXdPcHRpb24/OiB7XG4gICAgZW50aXR5TmFtZTogc3RyaW5nOyAvLyBlbnRpdHkgbmFtZSB0byBjcmVhdGUgbmV3IG9wdGlvblxuICB9O1xufVxuXG4vLyBUeXBlIGd1YXJkIGZvciBTZWxlY3RGaWVsZE1ldGFkYXRhXG5leHBvcnQgZnVuY3Rpb24gaXNTZWxlY3RGaWVsZE1ldGFkYXRhKG9iajogYW55KTogb2JqIGlzIFNlbGVjdEZpZWxkTWV0YWRhdGEge1xuICByZXR1cm4gKFxuICAgIHR5cGVvZiBvYmogPT09ICdvYmplY3QnXG4gICAgJiYgISFvYmpcbiAgICAmJiAnb3B0aW9ucycgaW4gb2JqXG4gICAgJiYgWyAnc2VsZWN0JywgJ211bHRpLXNlbGVjdCcsICdhdXRvY29tcGxldGUnIF0uaW5jbHVkZXMob2JqLmZpZWxkVHlwZSlcbiAgKTtcbn1cblxuLy8gVHlwZSBndWFyZCBmb3IgSW1hZ2VGaWVsZE1ldGFkYXRhXG5leHBvcnQgZnVuY3Rpb24gaXNJbWFnZUZpZWxkTWV0YWRhdGEob2JqOiBhbnkpOiBvYmogaXMgSW1hZ2VGaWVsZE1ldGFkYXRhIHtcbiAgcmV0dXJuIChcbiAgICB0eXBlb2Ygb2JqID09PSAnb2JqZWN0J1xuICAgICYmICEhb2JqXG4gICAgJiYgb2JqLmZpZWxkVHlwZSA9PT0gJ2ltYWdlJ1xuICApO1xufVxuXG4vLyBUeXBlIGd1YXJkIGZvciBGaWxlRmllbGRNZXRhZGF0YVxuZXhwb3J0IGZ1bmN0aW9uIGlzRmlsZUZpZWxkTWV0YWRhdGEob2JqOiBhbnkpOiBvYmogaXMgRmlsZUZpZWxkTWV0YWRhdGEge1xuICByZXR1cm4gKFxuICAgIHR5cGVvZiBvYmogPT09ICdvYmplY3QnXG4gICAgJiYgISFvYmpcbiAgICAmJiBvYmouZmllbGRUeXBlID09PSAnZmlsZSdcbiAgKTtcbn1cblxuLy8gVHlwZSBndWFyZCBmb3IgRGF0ZUZpZWxkTWV0YWRhdGFcbmV4cG9ydCBmdW5jdGlvbiBpc0RhdGVGaWVsZE1ldGFkYXRhKG9iajogYW55KTogb2JqIGlzIERhdGVGaWVsZE1ldGFkYXRhIHtcbiAgcmV0dXJuIChcbiAgICB0eXBlb2Ygb2JqID09PSAnb2JqZWN0J1xuICAgICYmICEhb2JqXG4gICAgJiYgb2JqLmZpZWxkVHlwZSA9PT0gJ2RhdGUnXG4gICk7XG59XG5cbi8vIFR5cGUgZ3VhcmQgZm9yIERhdGVUaW1lRmllbGRNZXRhZGF0YVxuZXhwb3J0IGZ1bmN0aW9uIGlzRGF0ZVRpbWVGaWVsZE1ldGFkYXRhKG9iajogYW55KTogb2JqIGlzIERhdGVUaW1lRmllbGRNZXRhZGF0YSB7XG4gIHJldHVybiAoXG4gICAgdHlwZW9mIG9iaiA9PT0gJ29iamVjdCdcbiAgICAmJiAhIW9ialxuICAgICYmIG9iai5maWVsZFR5cGUgPT09ICdkYXRldGltZSdcbiAgKTtcbn1cblxuLy8gVHlwZSBndWFyZCBmb3IgTnVtYmVyRmllbGRNZXRhZGF0YVxuZXhwb3J0IGZ1bmN0aW9uIGlzTnVtYmVyRmllbGRNZXRhZGF0YShvYmo6IGFueSk6IG9iaiBpcyBOdW1iZXJGaWVsZE1ldGFkYXRhIHtcbiAgcmV0dXJuIChcbiAgICB0eXBlb2Ygb2JqID09PSAnb2JqZWN0J1xuICAgICYmICEhb2JqXG4gICAgJiYgb2JqLmZpZWxkVHlwZSA9PT0gJ251bWJlcidcbiAgKTtcbn1cblxuLy8gVHlwZSBndWFyZCBmb3IgQm9vbGVhbkZpZWxkTWV0YWRhdGFcbmV4cG9ydCBmdW5jdGlvbiBpc0Jvb2xlYW5GaWVsZE1ldGFkYXRhKG9iajogYW55KTogb2JqIGlzIEJvb2xlYW5GaWVsZE1ldGFkYXRhIHtcbiAgcmV0dXJuIChcbiAgICB0eXBlb2Ygb2JqID09PSAnb2JqZWN0J1xuICAgICYmICEhb2JqXG4gICAgJiYgWyAnYm9vbGVhbicsICdzd2l0Y2gnLCAndG9nZ2xlJyBdLmluY2x1ZGVzKG9iai5maWVsZFR5cGUpXG4gICk7XG59XG5cbi8vIFR5cGUgZ3VhcmQgZm9yIEVkaXRvckZpZWxkTWV0YWRhdGFcbmV4cG9ydCBmdW5jdGlvbiBpc0VkaXRvckZpZWxkTWV0YWRhdGEob2JqOiBhbnkpOiBvYmogaXMgRWRpdG9yRmllbGRNZXRhZGF0YSB7XG4gIHJldHVybiAoXG4gICAgdHlwZW9mIG9iaiA9PT0gJ29iamVjdCdcbiAgICAmJiAhIW9ialxuICAgICYmIFsgJ3JpY2gtdGV4dCcsICd3eXNpd3lnJyBdLmluY2x1ZGVzKG9iai5maWVsZFR5cGUpXG4gICk7XG59XG5cbi8vIFR5cGUgZ3VhcmQgZm9yIENvZGVFZGl0b3JGaWVsZE1ldGFkYXRhXG5leHBvcnQgZnVuY3Rpb24gaXNDb2RlRWRpdG9yRmllbGRNZXRhZGF0YShvYmo6IGFueSk6IG9iaiBpcyBDb2RlRWRpdG9yRmllbGRNZXRhZGF0YSB7XG4gIHJldHVybiAoXG4gICAgdHlwZW9mIG9iaiA9PT0gJ29iamVjdCdcbiAgICAmJiAhIW9ialxuICAgICYmIFsgJ2NvZGUnLCAnbWFya2Rvd24nLCAnanNvbicgXS5pbmNsdWRlcyhvYmouZmllbGRUeXBlKVxuICApO1xufVxuXG5cblxuaW50ZXJmYWNlIFJhZGlvRmllbGRNZXRhZGF0YTxFIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+ID0gYW55PiBleHRlbmRzIEJhc2VGaWVsZE1ldGFkYXRhIHtcbiAgZmllbGRUeXBlPzogJ3JhZGlvJztcbiAgb3B0aW9uczogRmllbGRPcHRpb25zPEU+O1xuICBsYXlvdXQ/OiAnaG9yaXpvbnRhbCcgfCAndmVydGljYWwnOyAvLyBsYXlvdXQgb2YgdGhlIHJhZGlvIGJ1dHRvbnNcbn1cblxuaW50ZXJmYWNlIENoZWNrYm94RmllbGRNZXRhZGF0YTxFIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+ID0gYW55PiBleHRlbmRzIEJhc2VGaWVsZE1ldGFkYXRhIHtcbiAgZmllbGRUeXBlPzogJ2NoZWNrYm94JztcbiAgb3B0aW9uczogRmllbGRPcHRpb25zPEU+O1xuICBsYXlvdXQ/OiAnaG9yaXpvbnRhbCcgfCAndmVydGljYWwnOyAvLyBsYXlvdXQgb2YgdGhlIHJhZGlvIGJ1dHRvbnNcbn1cblxuaW50ZXJmYWNlIENvbW1vbkZpbGVGaWVsZE1ldGFkYXRhIHtcbiAgYWNjZXB0Pzogc3RyaW5nOyAvLyBmaWxlIHR5cGVzIHRvIGFjY2VwdCBlLmcuIFwiaW1hZ2UvKlwiIHwgXCJpbWFnZS9wbmdcIiB8IFwiaW1hZ2UvanBlZ1wiIHwgXCJpbWFnZS9naWZcIiB8IFwiaW1hZ2UvYm1wXCIgfCBcImltYWdlL3dlYnBcIiB8IFwiYXBwbGljYXRpb24vcGRmXCIgfCBcImFwcGxpY2F0aW9uL21zd29yZFwiXG4gIG1heEZpbGVTaXplPzogbnVtYmVyOyAvLyBtYXhpbXVtIGZpbGUgc2l6ZSBpbiBieXRlc1xuICBmaWxlTmFtZVByZWZpeD86IHN0cmluZzsgLy8gcHJlZml4IGZvciB0aGUgZmlsZSBuYW1lIGUuZy4gJ3Byb2ZpbGUtcGljLScgfCAnZG9jdW1lbnRzLycgfCAnbmVzdGVkL3BhdGgvdG8vaW1hZ2VzLydcbiAgZ2V0U2lnbmVkVXBsb2FkVXJsQVBJQ29uZmlnPzogR2V0U2lnbmVkVXBsb2FkVXJsQVBJQ29uZmlnLCAvLyBBUEkgY29uZmlnIHRvIGdldCBzaWduZWQgdXBsb2FkIFVSTFxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEZpbGVGaWVsZE1ldGFkYXRhIGV4dGVuZHMgQmFzZUZpZWxkTWV0YWRhdGEsIENvbW1vbkZpbGVGaWVsZE1ldGFkYXRhIHtcbiAgZmllbGRUeXBlPzogJ2ZpbGUnO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEltYWdlRmllbGRNZXRhZGF0YSBleHRlbmRzIEJhc2VGaWVsZE1ldGFkYXRhLCBDb21tb25GaWxlRmllbGRNZXRhZGF0YSB7XG4gIGZpZWxkVHlwZT86ICdpbWFnZSc7XG4gIGFzcGVjdFJhdGlvPzogc3RyaW5nOyAvLyBkZXNpcmVkIGFzcGVjdCByYXRpbyBmb3IgdGhlIGltYWdlXG4gIHdpdGhJbWFnZUNyb3A/OiBib29sZWFuOyAvLyB3aGV0aGVyIHRvIGFsbG93IGltYWdlIGNyb3BwaW5nIGF0IHRoZSB0aW1lIG9mIHVwbG9hZGluZ1xuICBhY2NlcHQ/OiBcImltYWdlLypcIiB8IFwiaW1hZ2UvcG5nXCIgfCBcImltYWdlL2pwZWdcIiB8IFwiaW1hZ2UvZ2lmXCIgfCBcImltYWdlL2JtcFwiIHwgXCJpbWFnZS93ZWJwXCI7XG59XG5cbmludGVyZmFjZSBSYW5nZUZpZWxkTWV0YWRhdGEgZXh0ZW5kcyBCYXNlRmllbGRNZXRhZGF0YSB7XG4gIGZpZWxkVHlwZT86ICdyYW5nZSc7XG4gIG1pbj86IG51bWJlcjtcbiAgbWF4PzogbnVtYmVyO1xuICBzdGVwPzogbnVtYmVyO1xuICBzaG93VmFsdWU/OiBib29sZWFuOyAvLyB3aGV0aGVyIHRvIHNob3cgdGhlIGN1cnJlbnQgdmFsdWVcbn1cblxuZXhwb3J0IHR5cGUgR2V0U2lnbmVkVXBsb2FkVXJsQVBJQ29uZmlnID0ge1xuICBhcGlVcmw6IHN0cmluZztcbiAgYXBpTWV0aG9kOiAnR0VUJyB8ICdQT1NUJztcbn07XG5cbmludGVyZmFjZSBIaWRkZW5GaWVsZE1ldGFkYXRhIGV4dGVuZHMgQmFzZUZpZWxkTWV0YWRhdGEge1xuICBmaWVsZFR5cGU/OiAnaGlkZGVuJztcbn1cblxuaW50ZXJmYWNlIEN1c3RvbUZpZWxkTWV0YWRhdGEgZXh0ZW5kcyBCYXNlRmllbGRNZXRhZGF0YSB7XG4gIGZpZWxkVHlwZT86ICdjdXN0b20nO1xufVxuXG5pbnRlcmZhY2UgUmF0aW5nRmllbGRNZXRhZGF0YSBleHRlbmRzIEJhc2VGaWVsZE1ldGFkYXRhIHtcbiAgZmllbGRUeXBlPzogJ3JhdGluZyc7XG4gIG1heFJhdGluZz86IG51bWJlcjsgLy8gbWF4aW11bSByYXRpbmcgdmFsdWVcbn1cblxuaW50ZXJmYWNlIEVkaXRvckZpZWxkTWV0YWRhdGEgZXh0ZW5kcyBCYXNlRmllbGRNZXRhZGF0YSwgQ29tbW9uRmlsZUZpZWxkTWV0YWRhdGEge1xuICBmaWVsZFR5cGU/OiAncmljaC10ZXh0JyB8ICd3eXNpd3lnJztcbn1cblxuaW50ZXJmYWNlIENvZGVFZGl0b3JGaWVsZE1ldGFkYXRhIGV4dGVuZHMgQmFzZUZpZWxkTWV0YWRhdGEge1xuICBmaWVsZFR5cGU/OiAnY29kZScgfCAnbWFya2Rvd24nIHwgJ2pzb24nO1xufVxuXG5leHBvcnQgdHlwZSBGaWVsZE9wdGlvbnM8RSBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PiA9IGFueT4gPSBBcnJheTxGaWVsZE9wdGlvbj4gfCBGaWVsZE9wdGlvbnNBUElDb25maWc8RT47XG5cbmV4cG9ydCB0eXBlIEZpZWxkT3B0aW9uID0ge1xuICB2YWx1ZTogc3RyaW5nLFxuICBsYWJlbDogc3RyaW5nLFxufVxuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIHRlbXBsYXRlIGZvciBhdHRyaWJ1dGVzLlxuICogQWxsb3dzIGNvbXBvc2luZyBtdWx0aXBsZSBhdHRyaWJ1dGVzIGludG8gYSBmb3JtYXR0ZWQgc3RyaW5nLlxuICogUHJvdmlkZXMgdHlwZS1zYWZlIGF0dHJpYnV0ZSBuYW1lIHZhbGlkYXRpb24gdmlhIGdlbmVyaWNzLlxuICogXG4gKiBAdGVtcGxhdGUgRSAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGVcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHRzXG4gKiAvLyBEZWZpbmUgZGlyZWN0bHkgaW4gZmllbGQgb3B0aW9ucyBjb25maWdcbiAqIGNvbnN0IHRlbXBsYXRlOiBBdHRyaWJ1dGVzVGVtcGxhdGU8VXNlclNjaGVtYT4gPSB7XG4gKiAgIGNvbXBvc2l0ZTogWydmaXJzdE5hbWUnLCAnbGFzdE5hbWUnXSxcbiAqICAgdGVtcGxhdGU6ICd7Zmlyc3ROYW1lfS1BTkQte2xhc3ROYW1lfSdcbiAqIH1cbiAqIGBgYFxuICovXG5leHBvcnQgdHlwZSBBdHRyaWJ1dGVzVGVtcGxhdGU8RSBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PiA9IGFueT4gPSB7XG4gIGNvbXBvc2l0ZTogQXJyYXk8a2V5b2YgRVsnYXR0cmlidXRlcyddICYgc3RyaW5nPixcbiAgdGVtcGxhdGU6IHN0cmluZyxcbn1cblxuLyoqXG4gKiBDb25maWd1cmF0aW9uIGZvciBsb2FkaW5nIGZpZWxkIG9wdGlvbnMgZnJvbSBhbiBBUEkgZW5kcG9pbnQuXG4gKiBQcm92aWRlcyB0eXBlLXNhZmUgYXR0cmlidXRlIHJlZmVyZW5jZXMgZm9yIHRoZSBnaXZlbiBlbnRpdHkgc2NoZW1hLlxuICogXG4gKiBAdGVtcGxhdGUgRSAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUgZm9yIHR5cGUtc2FmZSBhdHRyaWJ1dGUgcmVmZXJlbmNlc1xuICovXG5leHBvcnQgdHlwZSBGaWVsZE9wdGlvbnNBUElDb25maWc8RSBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4gPSB7XG4gIGFwaU1ldGhvZDogJ0dFVCcgfCAnUE9TVCcsXG4gIGFwaVVybDogc3RyaW5nLFxuICByZXNwb25zZUtleTogc3RyaW5nLFxuICBxdWVyeT86IEVudGl0eVF1ZXJ5PEU+LFxuICBvcHRpb25NYXBwaW5nPzoge1xuICAgIGxhYmVsOiAoa2V5b2YgRVsnYXR0cmlidXRlcyddICYgc3RyaW5nKSB8IEF0dHJpYnV0ZXNUZW1wbGF0ZTxFPixcbiAgICB2YWx1ZTogKGtleW9mIEVbJ2F0dHJpYnV0ZXMnXSAmIHN0cmluZykgfCBBdHRyaWJ1dGVzVGVtcGxhdGU8RT4sXG4gIH0sXG59XG5cbi8qKlxuICogQ3JlYXRlcyB0eXBlLXNhZmUgZmllbGQgb3B0aW9ucyBjb25maWd1cmF0aW9uIGZvciBBUEktbG9hZGVkIHNlbGVjdC9yYWRpby9jaGVja2JveCBvcHRpb25zLlxuICogUHJvdmlkZXMgZnVsbCB0eXBlIHNhZmV0eSBmb3IgYXR0cmlidXRlIHJlZmVyZW5jZXMgaW4gb3B0aW9uIG1hcHBpbmdzIGFuZCBxdWVyeSBmaWx0ZXJzLlxuICogXG4gKiBAdGVtcGxhdGUgRSAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUgZm9yIHRoZSBvcHRpb25zIHNvdXJjZVxuICogQHBhcmFtIGNvbmZpZyAtIFRoZSBmaWVsZCBvcHRpb25zIEFQSSBjb25maWd1cmF0aW9uXG4gKiBAcmV0dXJucyBUaGUgdHlwZWQgZmllbGQgb3B0aW9ucyBBUEkgY29uZmlnXG4gKiBcbiAqIEBleGFtcGxlXG4gKiAvLyBTaW1wbGUgYXR0cmlidXRlIG1hcHBpbmdcbiAqIGNyZWF0ZUZpZWxkT3B0aW9uczxVc2VyU2NoZW1hPih7XG4gKiAgIGFwaU1ldGhvZDogJ0dFVCcsXG4gKiAgIGFwaVVybDogJy9hcGkvdXNlcnMnLFxuICogICByZXNwb25zZUtleTogJ2RhdGEnLFxuICogICBvcHRpb25NYXBwaW5nOiB7XG4gKiAgICAgbGFiZWw6ICduYW1lJyxcbiAqICAgICB2YWx1ZTogJ3VzZXJJZCdcbiAqICAgfVxuICogfSlcbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIFdpdGggcXVlcnkgZmlsdGVyc1xuICogY3JlYXRlRmllbGRPcHRpb25zPFRlYW1TY2hlbWE+KHtcbiAqICAgYXBpTWV0aG9kOiAnR0VUJyxcbiAqICAgYXBpVXJsOiAnL2FwaS90ZWFtcycsXG4gKiAgIHJlc3BvbnNlS2V5OiAndGVhbXMnLFxuICogICBxdWVyeTogeyBmaWx0ZXJzOiB7IHN0YXR1czogeyBlcTogJ2FjdGl2ZScgfSB9IH0sXG4gKiAgIG9wdGlvbk1hcHBpbmc6IHtcbiAqICAgICBsYWJlbDogJ3RlYW1OYW1lJyxcbiAqICAgICB2YWx1ZTogJ3RlYW1JZCdcbiAqICAgfVxuICogfSlcbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIFdpdGggYXR0cmlidXRlIHRlbXBsYXRlIGZvciBjb21wb3NlZCBsYWJlbHNcbiAqIGNyZWF0ZUZpZWxkT3B0aW9uczxUZWFtU2NoZW1hPih7XG4gKiAgIGFwaU1ldGhvZDogJ0dFVCcsXG4gKiAgIGFwaVVybDogJy9hcGkvdGVhbXMnLFxuICogICByZXNwb25zZUtleTogJ3RlYW1zJyxcbiAqICAgb3B0aW9uTWFwcGluZzoge1xuICogICAgIGxhYmVsOiB7XG4gKiAgICAgICBjb21wb3NpdGU6IFsndGVhbU5hbWUnLCAnY2l0eSddLFxuICogICAgICAgdGVtcGxhdGU6ICd7dGVhbU5hbWV9ICh7Y2l0eX0pJ1xuICogICAgIH0sXG4gKiAgICAgdmFsdWU6ICd0ZWFtSWQnXG4gKiAgIH1cbiAqIH0pXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVGaWVsZE9wdGlvbnM8RSBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4oXG4gIGNvbmZpZzogRmllbGRPcHRpb25zQVBJQ29uZmlnPEU+XG4pOiBGaWVsZE9wdGlvbnNBUElDb25maWc8RT4ge1xuICByZXR1cm4gY29uZmlnO1xufVxuXG5leHBvcnQgY29uc3QgU3BlY2lhbEF0dHJpYnV0ZVR5cGVzID0ge1xuICBuYW1lOiAnbmFtZScsXG4gIHNsdWc6ICdzbHVnJyxcbiAgY29sb3I6ICdjb2xvcicsXG4gIGltYWdlOiAnaW1hZ2UnLFxuICBkZXNjcmlwdGlvbjogJ2Rlc2NyaXB0aW9uJyxcblxuICBjcmVhdGVkQXQ6ICdjcmVhdGVkQXQnLFxuICB1cGRhdGVkQXQ6ICd1cGRhdGVkQXQnLFxuICBkZWxldGVkQXQ6ICdkZWxldGVkQXQnXG59O1xuXG5leHBvcnQgdHlwZSBTcGVjaWFsQXR0cmlidXRlVHlwZSA9IGtleW9mIHR5cGVvZiBTcGVjaWFsQXR0cmlidXRlVHlwZXM7XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgc2NoZW1hIGZvciBhbiBlbnRpdHkuXG4gKlxuICogQHRlbXBsYXRlIEEgLSBBdHRyaWJ1dGUgbmFtZXNcbiAqIEB0ZW1wbGF0ZSBGIC0gRmFjZXQgbmFtZXNcbiAqIEB0ZW1wbGF0ZSBDIC0gQ29sbGVjdGlvbiBuYW1lc1xuICogQHRlbXBsYXRlIE9wcCAtIFRoZSB0eXBlIG9mIGVudGl0eSBvcGVyYXRpb25zLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEVudGl0eVNjaGVtYTxcbiAgQSBleHRlbmRzIHN0cmluZyxcbiAgRiBleHRlbmRzIHN0cmluZyxcbiAgQyBleHRlbmRzIHN0cmluZyxcbiAgT3BwIGV4dGVuZHMgVERlZmF1bHRFbnRpdHlPcGVyYXRpb25zID0gVERlZmF1bHRFbnRpdHlPcGVyYXRpb25zXG4+IGV4dGVuZHMgU2NoZW1hPEEsIEYsIEM+IHtcbiAgcmVhZG9ubHkgbW9kZWw6IFNjaGVtYTxBLCBGLCBDPlsgJ21vZGVsJyBdICYge1xuICAgIHJlYWRvbmx5IGVudGl0eU5hbWVQbHVyYWw6IHN0cmluZztcbiAgICByZWFkb25seSBlbnRpdHlPcGVyYXRpb25zOiBPcHA7XG4gICAgcmVhZG9ubHkgZW50aXR5TWVudUljb24/OiBzdHJpbmcsIC8vIGRlZmF1bHQgaXMgJ2FwcFN0b3JlJ1xuICAgIHJlYWRvbmx5IGVudGl0eU5hbWVBdHRyaWJ1dGU/OiBzdHJpbmcsIC8vIGRlZmF1bHQgaXMgJ25hbWUnXG4gICAgcmVhZG9ubHkgZW50aXR5U2x1Z0F0dHJpYnV0ZT86IHN0cmluZywgLy8gZGVmYXVsdCBpcyAnc2x1ZydcbiAgICByZWFkb25seSBlbnRpdHlJbWFnZUF0dHJpYnV0ZT86IHN0cmluZywgLy8gZGVmYXVsdCBpcyAnaW1hZ2UnXG4gICAgcmVhZG9ubHkgZW50aXR5RGVzY3JpcHRpb25BdHRyaWJ1dGU/OiBzdHJpbmcsIC8vIGRlZmF1bHQgaXMgJ2Rlc2NyaXB0aW9uJ1xuXG4gICAgcmVhZG9ubHkgZXhjbHVkZUZyb21BZG1pbk1lbnU/OiBib29sZWFuLCAvLyBkZWZhdWx0IGlzIGZhbHNlXG4gICAgcmVhZG9ubHkgZXhjbHVkZUZyb21BZG1pbkxpc3Q/OiBib29sZWFuLCAvLyBkZWZhdWx0IGlzIGZhbHNlXG4gICAgcmVhZG9ubHkgZXhjbHVkZUZyb21BZG1pbkRldGFpbD86IGJvb2xlYW4sIC8vIGRlZmF1bHQgaXMgZmFsc2VcbiAgICByZWFkb25seSBleGNsdWRlRnJvbUFkbWluQ3JlYXRlPzogYm9vbGVhbiwgLy8gZGVmYXVsdCBpcyBmYWxzZVxuICAgIHJlYWRvbmx5IGV4Y2x1ZGVGcm9tQWRtaW5VcGRhdGU/OiBib29sZWFuLCAvLyBkZWZhdWx0IGlzIGZhbHNlXG4gICAgcmVhZG9ubHkgZXhjbHVkZUZyb21BZG1pbkRlbGV0ZT86IGJvb2xlYW4sIC8vIGRlZmF1bHQgaXMgZmFsc2VcbiAgICByZWFkb25seSBleGNsdWRlRnJvbUFkbWluRHVwbGljYXRlPzogYm9vbGVhbiwgLy8gZGVmYXVsdCBpcyBmYWxzZVxuXG4gICAgcmVhZG9ubHkgQ1JVREFwaVBhdGg/OiBzdHJpbmcsIC8vIGRlZmF1bHQgaXMgJydcblxuICAgIC8vIE1lbnUgY29uZmlndXJhdGlvblxuICAgIHJlYWRvbmx5IG1lbnVHcm91cD86IHN0cmluZzsgLy8gR3JvdXAgdGhpcyBlbnRpdHkgYmVsb25ncyB0byBpbiB0aGUgbWVudVxuICAgIHJlYWRvbmx5IG1lbnVPcmRlcj86IG51bWJlcjsgLy8gT3JkZXIgd2l0aGluIHRoZSBncm91cCAoZGVmYXVsdDogMClcblxuICAgIC8vIENyZWF0ZSBwYWdlIGNvbmZpZ3VyYXRpb25cbiAgICByZWFkb25seSBjcmVhdGVQYWdlQnJlYWRjcnVtYnM/OiBBcnJheTx7IGxhYmVsOiBzdHJpbmc7IHVybD86IHN0cmluZyB9PixcbiAgICByZWFkb25seSBjcmVhdGVQYWdlQ29sdW1uc0NvbmZpZz86IElFbnRpdHlQYWdlQ29sdW1uQ29uZmlnLFxuICAgIC8vIExpc3QgcGFnZSBjb25maWd1cmF0aW9uXG4gICAgcmVhZG9ubHkgbGlzdFBhZ2VBY3Rpb25zPzogSUVudGl0eVBhZ2VBY3Rpb25bXSxcbiAgICByZWFkb25seSBsaXN0UGFnZUJyZWFkY3J1bWJzPzogQXJyYXk8eyBsYWJlbDogc3RyaW5nOyB1cmw/OiBzdHJpbmcgfT4sXG4gICAgcmVhZG9ubHkgbGlzdFBhZ2VEZWZhdWx0U29ydD86IHsgZmllbGQ6IHN0cmluZzsgb3JkZXI6ICdhc2MnIHwgJ2Rlc2MnIH0gfCBBcnJheTx7IGZpZWxkOiBzdHJpbmc7IG9yZGVyOiAnYXNjJyB8ICdkZXNjJyB9PiB8IHN0cmluZyxcbiAgICAvLyBWaWV3IHBhZ2UgY29uZmlndXJhdGlvblxuICAgIHJlYWRvbmx5IHZpZXdQYWdlQWN0aW9ucz86IElFbnRpdHlQYWdlQWN0aW9uW10sXG4gICAgcmVhZG9ubHkgdmlld1BhZ2VCcmVhZGNydW1icz86IEFycmF5PHsgbGFiZWw6IHN0cmluZzsgdXJsPzogc3RyaW5nIH0+LFxuICAgIHJlYWRvbmx5IHZpZXdQYWdlQ29sdW1uc0NvbmZpZz86IElFbnRpdHlQYWdlQ29sdW1uQ29uZmlnLFxuICAgIC8vIEVkaXQgcGFnZSBjb25maWd1cmF0aW9uXG4gICAgcmVhZG9ubHkgZWRpdFBhZ2VBY3Rpb25zPzogSUVudGl0eVBhZ2VBY3Rpb25bXSxcbiAgICByZWFkb25seSBlZGl0UGFnZUJyZWFkY3J1bWJzPzogQXJyYXk8eyBsYWJlbDogc3RyaW5nOyB1cmw/OiBzdHJpbmcgfT4sXG4gICAgcmVhZG9ubHkgZWRpdFBhZ2VDb2x1bW5zQ29uZmlnPzogSUVudGl0eVBhZ2VDb2x1bW5Db25maWcsXG4gICAgXG5cbiAgICByZWFkb25seSBzZWFyY2g/OiB7XG4gICAgICBlbmFibGVkOiBib29sZWFuO1xuICAgICAgaW5kZXhDb25maWc/OiBTZWFyY2hJbmRleENvbmZpZztcbiAgICAgIHNlcnZpY2VDbGFzcz86IERlcElkZW50aWZpZXI8RW50aXR5U2VhcmNoU2VydmljZTxhbnk+PiB8IHR5cGVvZiBFbnRpdHlTZWFyY2hTZXJ2aWNlIHwgRW50aXR5U2VhcmNoU2VydmljZTxhbnk+O1xuICAgICAgLy8gRG9jdW1lbnQgdHJhbnNmb3JtYXRpb24gZm9yIGluZGV4aW5nXG4gICAgICBkb2N1bWVudFRyYW5zZm9ybWVyPzogKGVudGl0eTogRW50aXR5UmVjb3JkVHlwZUZyb21TY2hlbWE8RW50aXR5U2NoZW1hPEEsIEYsIEM+PikgPT4gUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBhbnk+PjtcbiAgICB9O1xuICB9O1xuICByZWFkb25seSBhdHRyaWJ1dGVzOiB7XG4gICAgcmVhZG9ubHkgWyBhIGluIEEgXTogRW50aXR5QXR0cmlidXRlO1xuICB9O1xufVxuXG4vKipcbiAqIERlZmF1bHQgZW50aXR5IG9wZXJhdGlvbnMgdGhhdCBhcmUgY29tbW9ubHkgdXNlZC5cbiAqIFVzZSB0aGlzIGFzIGEgYmFzZSBvciBkZWZpbmUgeW91ciBvd24gc3Vic2V0L3N1cGVyc2V0LlxuICovXG5leHBvcnQgY29uc3QgRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMgPSB7XG4gIGdldDogXCJnZXRcIixcbiAgbGlzdDogXCJsaXN0XCIsXG4gIHF1ZXJ5OiBcInF1ZXJ5XCIsXG4gIGNyZWF0ZTogXCJjcmVhdGVcIixcbiAgdXBzZXJ0OiBcInVwc2VydFwiLFxuICB1cGRhdGU6IFwidXBkYXRlXCIsXG4gIGRlbGV0ZTogXCJkZWxldGVcIixcbiAgZHVwbGljYXRlOiBcImR1cGxpY2F0ZVwiLFxufSBhcyBjb25zdDtcblxuLyoqXG4gKiBUeXBlIGZvciB0aGUgZGVmYXVsdCBlbnRpdHkgb3BlcmF0aW9ucy5cbiAqIFVzZSB0aGlzIHdoZW4geW91IHdhbnQgYWxsIHN0YW5kYXJkIENSVUQgb3BlcmF0aW9ucy5cbiAqL1xuZXhwb3J0IHR5cGUgVERlZmF1bHRFbnRpdHlPcGVyYXRpb25zID0gdHlwZW9mIERlZmF1bHRFbnRpdHlPcGVyYXRpb25zO1xuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIGlucHV0IHNjaGVtYXMgZm9yIGVudGl0eSBvcGVyYXRpb25zLlxuICogUHJvdmlkZXMgdHlwZS1zYWZlIG1hcHBpbmcgb2Ygb3BlcmF0aW9uIG5hbWVzIHRvIHRoZWlyIGNvcnJlc3BvbmRpbmcgaW5wdXQgdHlwZXMuXG4gKiBFeHRlbmQgdGhpcyB0eXBlIGZvciBhZGRpdGlvbmFsIG9wZXJhdGlvbnMncyBpbnB1dC1zY2hlbWEgdHlwZXMuXG4gKiBcbiAqIEB0ZW1wbGF0ZSBTY2ggLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqIHR5cGUgVXNlck9wc0lucHV0cyA9IFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8VXNlckVudGl0eVNjaGVtYT47XG4gKiAvLyB7XG4gKiAvLyAgIGdldDogVXNlcklkZW50aWZpZXJzIHwgVXNlcklkZW50aWZpZXJzW10sXG4gKiAvLyAgIGNyZWF0ZTogQ3JlYXRlVXNlckl0ZW0sXG4gKiAvLyAgIHVwZGF0ZTogVXBkYXRlVXNlckl0ZW0sXG4gKiAvLyAgIC4uLlxuICogLy8gfVxuICogYGBgXG4gKi9cbmV4cG9ydCB0eXBlIFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8XG4gIFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55LCBhbnk+LFxuPiA9IHtcbiAgICByZWFkb25seSBbIG9wTmFtZSBpbiBrZXlvZiBTY2hbICdtb2RlbCcgXVsgJ2VudGl0eU9wZXJhdGlvbnMnIF0gXVxuICAgIDogb3BOYW1lIGV4dGVuZHMgJ2dldCcgPyBFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFNjaD4gfCBBcnJheTxFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFNjaD4+XG4gICAgOiBvcE5hbWUgZXh0ZW5kcyAnbGlzdCcgPyBuZXZlciAvLyBsaXN0IG9wZXJhdGlvbnMgdHlwaWNhbGx5IGRvbid0IHRha2UgaWRlbnRpZmllcnMgYXMgaW5wdXRcbiAgICA6IG9wTmFtZSBleHRlbmRzICdxdWVyeScgPyBuZXZlciAvLyBxdWVyeSBvcGVyYXRpb25zIHVzZSBFbnRpdHlRdWVyeSB0eXBlXG4gICAgOiBvcE5hbWUgZXh0ZW5kcyAnY3JlYXRlJyA/IENyZWF0ZUVudGl0eUl0ZW1UeXBlRnJvbVNjaGVtYTxTY2g+XG4gICAgOiBvcE5hbWUgZXh0ZW5kcyAndXBzZXJ0JyA/IFVwc2VydEVudGl0eUl0ZW1UeXBlRnJvbVNjaGVtYTxTY2g+XG4gICAgOiBvcE5hbWUgZXh0ZW5kcyAndXBkYXRlJyA/IFVwZGF0ZUVudGl0eUl0ZW1UeXBlRnJvbVNjaGVtYTxTY2g+XG4gICAgOiBvcE5hbWUgZXh0ZW5kcyAnZGVsZXRlJyA/IEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8U2NoPiB8IEFycmF5PEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8U2NoPj5cbiAgICA6IG9wTmFtZSBleHRlbmRzICdkdXBsaWNhdGUnID8gRW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTY2g+XG4gICAgOiB7fVxuICB9XG5cbmV4cG9ydCB0eXBlIENyZWF0ZUVsZWN0cm9EQkVudGl0eU9wdGlvbnM8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4gPSB7XG4gIHNjaGVtYTogUyxcbiAgZW50aXR5Q29uZmlndXJhdGlvbnM6IEVudGl0eUNvbmZpZ3VyYXRpb247XG59XG5cblxuLyoqXG4gKiBUaGlzIGZ1bmN0aW9uIGlzIHVzZWQgdG8gZGVmaW5lIGFuIGVudGl0eSBzY2hlbWEgZm9yIER5bmFtb0RCIGJhc2VkIGVudGl0eSwgYW5kIGl0IHVzZWQgRWxlY3Ryb0RCIHVuZGVyIHRoZSBob29kLiBcbiAqIEl0IHRha2VzIGFuIG9iamVjdCBhcyBhbiBhcmd1bWVudCB0aGF0IGRlc2NyaWJlcyB0aGUgbW9kZWwsIGF0dHJpYnV0ZXMsIGFuZCBpbmRleGVzIG9mIHRoZSBlbnRpdHkuXG4gKiB0aGUgZ2VuZXJpYyBwYXJhbXMgYXJlIG9ubHkgZm9yIHRoZSB0eXBlIGluZmVyZW5jZSwgYW5kIHRoZXkgYXJlIG5vdCB1c2VkIGluIHRoZSBmdW5jdGlvbi5cbiAqIFxuICogQHBhcmFtIHNjaGVtYSAtIFRoZSBlbnRpdHkgc2NoZW1hIGNvbmZpZ3VyYXRpb24uXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBpbXBvcnQgeyBjcmVhdGVFbnRpdHlTY2hlbWEgfSBmcm9tICdAdGVuMjRHcm91cC9mdzI0J1xuICogXG4gKiBjb25zdCBlbnRpdHlTY2hlbWEgPSBjcmVhdGVFbnRpdHlTY2hlbWEoe1xuICogICAvLyBlbnRpdHkgc2NoZW1hIGNvbmZpZ3VyYXRpb25cbiAqIFxuICogIC8vIG1ldGFkYXRhIGFib3V0IHRoZSBlbnRpdHlcbiAqICBtb2RlbDoge1xuICogICAgICB2ZXJzaW9uOiAnMScsXG4gKiAgICAgIGVudGl0eTogJ3VzZXInLCAgICAgICAgICAgICAvLyB0aGUgbmFtZSBvZiB0aGUgZW50aXR5XG4gKiAgICAgIGVudGl0eU5hbWVQbHVyYWw6ICdVc2VycycsIC8vIHVzZWQgYnkgYXV0byBnZW5lcmF0ZWQgVUlcbiAqICAgICAgZW50aXR5T3BlcmF0aW9uczogRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsIC8vIHRoZSBvcGVyYXRpb25zIHRoYXQgY2FuIGJlIHBlcmZvcm1lZCBvbiB0aGUgZW50aXR5XG4gKiAgICAgIHNlcnZpY2U6ICd1c2VycycsIC8vIEVsZWN0cm9EQiBzZXJ2aWNlIG5hbWUgW2xvZ2ljYWwgZ3JvdXAgb2YgZW50aXRpZXNdXG4gKiAgfSwgICBcbiAqIC8vIHRoZSBhdHRyaWJ1dGVzIGZvciB0aGUgZW50aXR5XG4gKiAgYXR0cmlidXRlczoge1xuICogICAgIHVzZXJJZDoge1xuICogICAgICB0eXBlOiAnc3RyaW5nJyxcbiAqICAgICAgcmVxdWlyZWQ6IHRydWUsICBcbiAqICAgICAgcmVhZE9ubHk6IHRydWUsXG4gKiAgICAgIGRlZmF1bHQ6ICgpID0+IHJhbmRvbVVVSUQoKVxuICogICAgfSxcbiAqICAgLy8gLi4uIG90aGVyIGF0dHJpYnV0ZXNcbiAqICB9LCAgICBcbiAqIC8vIHRoZSBhY2Nlc3MgcGF0dGVybnMgZm9yIHRoZSBlbnRpdHlcbiAqICBpbmRleGVzOiB7XG4gKiAgICAgIHByaW1hcnk6IHtcbiAqICAgICAgICAgIHBrOiB7XG4gKiAgICAgICAgICAgICAgZmllbGQ6ICdwcmltYXJ5X3BrJywgICAgXG4gKiAgICAgICAgICAgICAgY29tcG9zaXRlOiBbJ3VzZXJJZCddLFxuICogICAgICAgICAgfSxcbiAqICAgICAgICAgIHNrOiB7XG4gKiAgICAgICAgICAgICAgZmllbGQ6ICdwcmltYXJ5X3NrJyxcbiAqICAgICAgICAgICAgICBjb21wb3NpdGU6IFtdLFxuICogICAgICAgICAgfVxuICogICAgICB9LFxuICogICAgICAvLyAuLi4gb3RoZXIgaW5kZXhlc1xuICogIH0sICAgICAgICBcbiAqIH0gYXMgY29uc3QgKTtcbiAqIFxuICogXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVFbnRpdHlTY2hlbWE8XG4gIEEgZXh0ZW5kcyBzdHJpbmcsXG4gIEYgZXh0ZW5kcyBzdHJpbmcsXG4gIEMgZXh0ZW5kcyBzdHJpbmcsXG4gIFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8QSwgRiwgQywgT3BzPixcbiAgT3BzIGV4dGVuZHMgVERlZmF1bHRFbnRpdHlPcGVyYXRpb25zID0gVERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLFxuPihzY2hlbWE6IFMpOiBTIHtcbiAgLy8gQXV0b21hdGljYWxseSBpbmplY3QgX2FjdG9yIGZpZWxkIGludG8gZXZlcnkgc2NoZW1hIGZvciBhdWRpdCB0cmFja2luZ1xuICBjb25zdCBlbmhhbmNlZFNjaGVtYSA9IHtcbiAgICAuLi5zY2hlbWEsXG4gICAgYXR0cmlidXRlczoge1xuICAgICAgLi4uc2NoZW1hLmF0dHJpYnV0ZXMsXG4gICAgICBfYWN0b3I6IHtcbiAgICAgICAgdHlwZTogJ2FueScsXG4gICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgaGlkZGVuOiB0cnVlLCAgLy8gSGlkZGVuIGZyb20gRWxlY3Ryb0RCIG9wZXJhdGlvbnNcbiAgICAgICAgcmVhZE9ubHk6IGZhbHNlLFxuICAgICAgICAvLyBVSSBtZXRhZGF0YSAtIG1hcmsgYXMgbm90IHZpc2libGUgaW4gYW55IFVJXG4gICAgICAgIGlzVmlzaWJsZTogZmFsc2UsXG4gICAgICAgIGlzTGlzdGFibGU6IGZhbHNlLFxuICAgICAgICBpc0NyZWF0YWJsZTogZmFsc2UsXG4gICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICBpc0ZpbHRlcmFibGU6IGZhbHNlLFxuICAgICAgICBpc1NlYXJjaGFibGU6IGZhbHNlLFxuICAgICAgICBpc1NvcnRhYmxlOiBmYWxzZSxcbiAgICAgICAgbmFtZTogXCJBY3RvciBDb250ZXh0XCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkludGVybmFsIGZpZWxkIHN0b3JpbmcgY29tcGxldGUgYWN0b3IgY29udGV4dCBmb3IgYXVkaXQgcHVycG9zZXNcIlxuICAgICAgfVxuICAgIH1cbiAgfSBhcyBTO1xuXG4gIHJldHVybiBjcmVhdGVTY2hlbWEoZW5oYW5jZWRTY2hlbWEpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRWxlY3Ryb0RCRW50aXR5PFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KG9wdGlvbnM6IENyZWF0ZUVsZWN0cm9EQkVudGl0eU9wdGlvbnM8Uz4pIHtcbiAgY29uc3QgeyBzY2hlbWEsIGVudGl0eUNvbmZpZ3VyYXRpb25zIH0gPSBvcHRpb25zO1xuXG4gIGNvbnN0IG5ld0VsZWN0cm9EYkVudGl0eSA9IG5ldyBFbnRpdHkoXG4gICAgc2NoZW1hLFxuICAgIGVudGl0eUNvbmZpZ3VyYXRpb25zXG4gICk7XG5cbiAgcmV0dXJuIHtcbiAgICBuYW1lOiBzY2hlbWEubW9kZWwuZW50aXR5LFxuICAgIGVudGl0eTogbmV3RWxlY3Ryb0RiRW50aXR5LFxuICAgIHNjaGVtYTogc2NoZW1hLFxuICAgIHN5bWJvbDogU3ltYm9sLmZvcihzY2hlbWEubW9kZWwuZW50aXR5KSxcbiAgfVxufVxuXG4vLyBJbmZlciB0eXBlcyB1dGlsc1xuZXhwb3J0IHR5cGUgRW50aXR5VHlwZUZyb21TY2hlbWE8VFNjaGVtYT4gPSBUU2NoZW1hIGV4dGVuZHMgRW50aXR5U2NoZW1hPGluZmVyIEEsIGluZmVyIEYsIGluZmVyIEM+XG4gID8gRW50aXR5PEEsIEYsIEMsIFRTY2hlbWE+XG4gIDogbmV2ZXI7XG5cbmV4cG9ydCB0eXBlIEVudGl0eVJlc3BvbnNlSXRlbVR5cGVGcm9tU2NoZW1hPFRTY2hlbWE+ID0gVFNjaGVtYSBleHRlbmRzIEVudGl0eVNjaGVtYTxpbmZlciBBLCBpbmZlciBGLCBpbmZlciBDPlxuICA/IFJlc3BvbnNlSXRlbTxBLCBGLCBDLCBUU2NoZW1hPlxuICA6IG5ldmVyO1xuXG4vKipcbiAqIFV0aWxpdHkgdHlwZSB0byBleHRyYWN0IHRoZSB2YWx1ZSB0eXBlIG9mIGEgc3BlY2lmaWMgYXR0cmlidXRlIGZyb20gYW4gZW50aXR5IHNjaGVtYS5cbiAqIFVzZWZ1bCBmb3IgdHlwZS1zYWZlIGF0dHJpYnV0ZSB2YWx1ZSBoYW5kbGluZy5cbiAqIFxuICogQHRlbXBsYXRlIEUgLSBUaGUgZW50aXR5IHNjaGVtYVxuICogQHRlbXBsYXRlIEsgLSBUaGUgYXR0cmlidXRlIGtleVxuICovXG5leHBvcnQgdHlwZSBBdHRyaWJ1dGVWYWx1ZVR5cGU8XG4gIEUgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4sXG4gIEsgZXh0ZW5kcyBrZXlvZiBFWydhdHRyaWJ1dGVzJ11cbj4gPSBFWydhdHRyaWJ1dGVzJ11bS11bJ3R5cGUnXSBleHRlbmRzICdzdHJpbmcnID8gc3RyaW5nXG4gIDogRVsnYXR0cmlidXRlcyddW0tdWyd0eXBlJ10gZXh0ZW5kcyAnbnVtYmVyJyA/IG51bWJlclxuICA6IEVbJ2F0dHJpYnV0ZXMnXVtLXVsndHlwZSddIGV4dGVuZHMgJ2Jvb2xlYW4nID8gYm9vbGVhblxuICA6IEVbJ2F0dHJpYnV0ZXMnXVtLXVsndHlwZSddIGV4dGVuZHMgQXJyYXk8aW5mZXIgVD4gPyBUXG4gIDogRVsnYXR0cmlidXRlcyddW0tdWyd0eXBlJ10gZXh0ZW5kcyAnYW55JyA/IGFueVxuICA6IEVbJ2F0dHJpYnV0ZXMnXVtLXVsndHlwZSddIGV4dGVuZHMgJ3NldCcgPyBTZXQ8c3RyaW5nPlxuICA6IEVbJ2F0dHJpYnV0ZXMnXVtLXVsndHlwZSddIGV4dGVuZHMgJ2xpc3QnID8gQXJyYXk8YW55PlxuICA6IEVbJ2F0dHJpYnV0ZXMnXVtLXVsndHlwZSddIGV4dGVuZHMgJ21hcCcgPyBSZWNvcmQ8c3RyaW5nLCBhbnk+XG4gIDogYW55O1xuXG4vKipcbiAqIFV0aWxpdHkgdHlwZSB0byBleHRyYWN0IGFsbCBhdHRyaWJ1dGUgbmFtZXMgYW5kIHRoZWlyIHZhbHVlIHR5cGVzIGFzIGEga2V5LXZhbHVlIG1hcC5cbiAqIFxuICogQHRlbXBsYXRlIEUgLSBUaGUgZW50aXR5IHNjaGVtYVxuICovXG5leHBvcnQgdHlwZSBFbnRpdHlBdHRyaWJ1dGVWYWx1ZU1hcDxFIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiA9IHtcbiAgW0sgaW4ga2V5b2YgRVsnYXR0cmlidXRlcyddXTogQXR0cmlidXRlVmFsdWVUeXBlPEUsIEs+XG59O1xuXG5cbmV4cG9ydCB0eXBlIFVwc2VydEVudGl0eUl0ZW08RSBleHRlbmRzIEVudGl0eTxhbnksIGFueSwgYW55LCBhbnk+PiA9XG4gIEUgZXh0ZW5kcyBFbnRpdHk8aW5mZXIgQSwgaW5mZXIgRiwgaW5mZXIgQywgaW5mZXIgUz5cbiAgPyBVcHNlcnRJdGVtPEEsIEYsIEMsIFM+XG4gIDogbmV2ZXI7XG5cbmV4cG9ydCB0eXBlIEVudGl0eVJlY29yZFR5cGVGcm9tU2NoZW1hPFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4gPSBFbnRpdHlJdGVtPEVudGl0eVR5cGVGcm9tU2NoZW1hPFNjaD4+O1xuXG4vLyBFbnRpdHkgc2VydmljZVxuZXhwb3J0IHR5cGUgRW50aXR5U2VydmljZVR5cGVGcm9tU2NoZW1hPFRTY2hlbWEgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+ID0gQmFzZUVudGl0eVNlcnZpY2U8VFNjaGVtYT47XG5cbi8vIEVudGl0eSBpZGVudGlmaWVyc1xuZXhwb3J0IHR5cGUgRW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxUU2NoZW1hIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiA9IFdyaXRhYmxlPEVudGl0eUlkZW50aWZpZXJzPEVudGl0eVR5cGVGcm9tU2NoZW1hPFRTY2hlbWE+Pj47XG5cbi8vIENyZWF0ZSBlbnRpdHlcbmV4cG9ydCB0eXBlIENyZWF0ZUVudGl0eUl0ZW1UeXBlRnJvbVNjaGVtYTxUU2NoZW1hIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiA9IFdyaXRhYmxlPENyZWF0ZUVudGl0eUl0ZW08RW50aXR5VHlwZUZyb21TY2hlbWE8VFNjaGVtYT4+PjtcblxuLy8gVXBzZXJ0IGVudGl0eVxuZXhwb3J0IHR5cGUgVXBzZXJ0RW50aXR5SXRlbVR5cGVGcm9tU2NoZW1hPFRTY2hlbWEgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+ID0gV3JpdGFibGU8VXBzZXJ0RW50aXR5SXRlbTxFbnRpdHlUeXBlRnJvbVNjaGVtYTxUU2NoZW1hPj4+O1xuXG4vLyBVcGRhdGUgZW50aXR5XG5leHBvcnQgdHlwZSBVcGRhdGVFbnRpdHlJdGVtVHlwZUZyb21TY2hlbWE8VFNjaGVtYSBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4gPSBXcml0YWJsZTxVcGRhdGVFbnRpdHlJdGVtPEVudGl0eVR5cGVGcm9tU2NoZW1hPFRTY2hlbWE+Pj47Il19