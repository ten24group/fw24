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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1lbnRpdHkuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZW50aXR5L2Jhc2UtZW50aXR5LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQStNQSxvREFJQztBQWdFRCw4Q0FJQztBQWlGRCxvREFJQztBQXVPRCxzREFPQztBQUdELG9EQU1DO0FBR0Qsa0RBTUM7QUFHRCxrREFNQztBQUdELDBEQU1DO0FBR0Qsc0RBTUM7QUFHRCx3REFNQztBQUdELHNEQU1DO0FBR0QsOERBTUM7QUFpS0QsZ0RBSUM7QUFnTUQsZ0RBZ0NDO0FBRUQsc0RBY0M7QUF0akNELHlDQUFpRDtBQXFLakQ7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0F3Q0c7QUFDSCxTQUFnQixvQkFBb0IsQ0FDbEMsT0FBa0M7SUFFbEMsT0FBTyxPQUFPLENBQUM7QUFDakIsQ0FBQztBQUVEOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBNkRHO0FBQ0gsU0FBZ0IsaUJBQWlCLENBQy9CLEtBQXFCO0lBRXJCLE9BQU8sS0FBSyxDQUFDO0FBQ2YsQ0FBQztBQW9DRDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0E0Q0c7QUFDSCxTQUFnQixvQkFBb0IsQ0FDbEMsUUFBMEM7SUFFMUMsT0FBTyxRQUFRLENBQUM7QUFDbEIsQ0FBQztBQXNPRCxxQ0FBcUM7QUFDckMsU0FBZ0IscUJBQXFCLENBQUMsR0FBUTtJQUM1QyxPQUFPLENBQ0wsT0FBTyxHQUFHLEtBQUssUUFBUTtXQUNwQixDQUFDLENBQUMsR0FBRztXQUNMLFNBQVMsSUFBSSxHQUFHO1dBQ2hCLENBQUUsUUFBUSxFQUFFLGNBQWMsRUFBRSxjQUFjLENBQUUsQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUN4RSxDQUFDO0FBQ0osQ0FBQztBQUVELG9D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QUMsS0FBSyxDQUFDLE1BQU0sQ0FBQztLQUN4QyxDQUFBO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgRW50aXR5Q29uZmlndXJhdGlvbiwgU2NoZW1hLCBFbnRpdHlJZGVudGlmaWVycywgQ3JlYXRlRW50aXR5SXRlbSwgVXBkYXRlRW50aXR5SXRlbSwgRW50aXR5SXRlbSwgQXR0cmlidXRlLCBSZXNwb25zZUl0ZW0sIFVwc2VydEl0ZW0gfSBmcm9tIFwiZWxlY3Ryb2RiXCI7XG5pbXBvcnQgeyBjcmVhdGVTY2hlbWEsIEVudGl0eSB9IGZyb20gXCJlbGVjdHJvZGJcIjtcblxuaW1wb3J0IHR5cGUgeyBFbnRpdHlRdWVyeSwgRmlsdGVyT3BlcmF0b3JzRXh0ZW5kZWQgfSBmcm9tICcuL3F1ZXJ5LXR5cGVzJztcbmltcG9ydCB0eXBlIHsgQmFzZUVudGl0eVNlcnZpY2UgfSBmcm9tIFwiLi9iYXNlLXNlcnZpY2VcIjtcbmltcG9ydCB0eXBlIHsgT21pdE5ldmVyLCBQYXRocywgV3JpdGFibGUgfSBmcm9tIFwiLi4vdXRpbHMvdHlwZXNcIjtcbmltcG9ydCB7IFNlYXJjaEluZGV4Q29uZmlnIH0gZnJvbSAnLi4vc2VhcmNoL3R5cGVzJztcbmltcG9ydCB7IEVudGl0eVNlYXJjaFNlcnZpY2UgfSBmcm9tICcuLi9zZWFyY2gvc2VydmljZXMnO1xuaW1wb3J0IHsgRGVwSWRlbnRpZmllciB9IGZyb20gXCIuLi9pbnRlcmZhY2VzXCI7XG5pbXBvcnQgdHlwZSB7IEZvcm1QYWdlQ29uZmlnU3RydWN0dXJlLCBMaXN0UGFnZUNvbmZpZ1N0cnVjdHVyZSwgRGV0YWlsc1BhZ2VDb25maWdTdHJ1Y3R1cmUgfSBmcm9tICcuLi91aS1jb25maWctZ2VuL3RlbXBsYXRlcy9jdXN0b20tcGFnZSc7XG5cbi8qKlxuICogQGZpbGVvdmVydmlldyBFbnRpdHkgU2NoZW1hIGFuZCBUeXBlLVNhZmUgSGVscGVyIEZ1bmN0aW9uc1xuICogXG4gKiBUaGlzIG1vZHVsZSBwcm92aWRlcyBlc3NlbnRpYWwgdHlwZS1zYWZlIGhlbHBlcnMgZm9yIGRlZmluaW5nIGVudGl0eSBzY2hlbWFzLFxuICogcmVsYXRpb25zLCBxdWVyaWVzLCBhbmQgY29uZmlndXJhdGlvbnMgd2l0aCBmdWxsIFR5cGVTY3JpcHQgc3VwcG9ydC5cbiAqIFxuICogIyMgQ29yZSBUeXBlLVNhZmUgSGVscGVyIEZ1bmN0aW9uc1xuICogXG4gKiAjIyMgRXNzZW50aWFsIEhlbHBlcnMgKDQgZnVuY3Rpb25zKVxuICogXG4gKiAxLiAqKmBjcmVhdGVFbnRpdHlSZWxhdGlvbjxFPigpYCoqIC0gRGVmaW5lIGVudGl0eSByZWxhdGlvbnMgd2l0aCBjaXJjdWxhciBkZXBlbmRlbmN5IHN1cHBvcnRcbiAqICAgIC0gRGlyZWN0OiBgY3JlYXRlRW50aXR5UmVsYXRpb248VGVhbVNjaGVtYT4oeyAuLi4gfSlgXG4gKiAgICAtIExhenk6IGBjcmVhdGVFbnRpdHlSZWxhdGlvbjwoKSA9PiBQb3N0U2NoZW1hPih7IC4uLiB9KWBcbiAqIFxuICogMi4gKipgY3JlYXRlRW50aXR5UXVlcnk8RT4oKWAqKiAtIEJ1aWxkIHR5cGUtc2FmZSBxdWVyaWVzIHdpdGggZmlsdGVycywgcGFnaW5hdGlvbiwgYW5kIGh5ZHJhdGlvblxuICogXG4gKiAzLiAqKmBjcmVhdGVIeWRyYXRlT3B0aW9uczxFPigpYCoqIC0gU3BlY2lmeSB3aGljaCBhdHRyaWJ1dGVzIGFuZCByZWxhdGlvbnMgdG8gbG9hZFxuICogXG4gKiA0LiAqKmBjcmVhdGVGaWVsZE9wdGlvbnM8RT4oKWAqKiAtIENvbmZpZ3VyZSBBUEktbG9hZGVkIG9wdGlvbnMgZm9yIHNlbGVjdC9yYWRpby9jaGVja2JveCBmaWVsZHNcbiAqIFxuICogIyMjIENvcmUgU2NoZW1hIEZ1bmN0aW9uc1xuICogLSBgY3JlYXRlRW50aXR5U2NoZW1hPC4uLj4oKWAgLSBEZWZpbmUgZW50aXR5IHNjaGVtYXMgd2l0aCBFbGVjdHJvREJcbiAqIC0gYGNyZWF0ZUVsZWN0cm9EQkVudGl0eTxTPigpYCAtIENyZWF0ZSBFbGVjdHJvREIgZW50aXR5IGluc3RhbmNlc1xuICogXG4gKiAjIyBVc2FnZSBFeGFtcGxlc1xuICogXG4gKiAjIyMgU2ltcGxlIFJlbGF0aW9uXG4gKiBgYGB0c1xuICogdGVhbUlkOiB7XG4gKiAgIHR5cGU6ICdzdHJpbmcnLFxuICogICByZWxhdGlvbjogY3JlYXRlRW50aXR5UmVsYXRpb248VGVhbVNjaGVtYT4oe1xuICogICAgIGVudGl0eU5hbWU6ICd0ZWFtJyxcbiAqICAgICB0eXBlOiAnbWFueS10by1vbmUnLFxuICogICAgIGlkZW50aWZpZXJzOiB7IHNvdXJjZTogJ3RlYW1JZCcsIHRhcmdldDogJ3RlYW1JZCcgfVxuICogICB9KVxuICogfVxuICogYGBgXG4gKiBcbiAqICMjIyBDaXJjdWxhciBEZXBlbmRlbmN5IFJlbGF0aW9uXG4gKiBgYGB0c1xuICogdXNlcklkOiB7XG4gKiAgIHR5cGU6ICdzdHJpbmcnLFxuICogICByZWxhdGlvbjogY3JlYXRlRW50aXR5UmVsYXRpb248KCkgPT4gVXNlclNjaGVtYT4oe1xuICogICAgIGVudGl0eU5hbWU6ICd1c2VyJyxcbiAqICAgICB0eXBlOiAnbWFueS10by1vbmUnLFxuICogICAgIGlkZW50aWZpZXJzOiAoKSA9PiAoeyBzb3VyY2U6ICd1c2VySWQnLCB0YXJnZXQ6ICd1c2VySWQnIH0pXG4gKiAgIH0pXG4gKiB9XG4gKiBgYGBcbiAqIFxuICogIyMjIFF1ZXJ5IHdpdGggSHlkcmF0aW9uXG4gKiBgYGB0c1xuICogY29uc3QgcXVlcnkgPSBjcmVhdGVFbnRpdHlRdWVyeTxHYW1lU2NoZW1hPih7XG4gKiAgIGZpbHRlcnM6IHsgc3RhdHVzOiB7IGVxOiAndXBjb21pbmcnIH0gfSxcbiAqICAgYXR0cmlidXRlczogY3JlYXRlSHlkcmF0ZU9wdGlvbnM8R2FtZVNjaGVtYT4oe1xuICogICAgIGdhbWVJZDogdHJ1ZSxcbiAqICAgICBob21lVGVhbTogeyBhdHRyaWJ1dGVzOiB7IHRlYW1JZDogdHJ1ZSwgdGVhbU5hbWU6IHRydWUgfSB9XG4gKiAgIH0pXG4gKiB9KVxuICogYGBgXG4gKiBcbiAqICMjIyBGaWVsZCBPcHRpb25zXG4gKiBgYGB0c1xuICogLy8gU3RhdGljIG9wdGlvbnMgLSB1c2UgYXJyYXkgZGlyZWN0bHlcbiAqIG9wdGlvbnM6IFtcbiAqICAgeyB2YWx1ZTogJ2FjdGl2ZScsIGxhYmVsOiAnQWN0aXZlJyB9LFxuICogICB7IHZhbHVlOiAnaW5hY3RpdmUnLCBsYWJlbDogJ0luYWN0aXZlJyB9XG4gKiBdXG4gKiBcbiAqIC8vIEFQSS1sb2FkZWQgb3B0aW9ucyAtIHVzZSBoZWxwZXJcbiAqIG9wdGlvbnM6IGNyZWF0ZUZpZWxkT3B0aW9uczxUZWFtU2NoZW1hPih7XG4gKiAgIGFwaU1ldGhvZDogJ0dFVCcsXG4gKiAgIGFwaVVybDogJy9hcGkvdGVhbXMnLFxuICogICByZXNwb25zZUtleTogJ2RhdGEnLFxuICogICBvcHRpb25NYXBwaW5nOiB7IGxhYmVsOiAndGVhbU5hbWUnLCB2YWx1ZTogJ3RlYW1JZCcgfVxuICogfSlcbiAqIGBgYFxuICogXG4gKiAjIyMgRW50aXR5IE9wZXJhdGlvbnNcbiAqICBcbiAqIGBgYHRzXG4gKiAvLyBGdWxsIHNldCAoZGVmYXVsdCkgLSBBbGwgQ1JVRCBvcGVyYXRpb25zXG4gKiBlbnRpdHlPcGVyYXRpb25zOiBEZWZhdWx0RW50aXR5T3BlcmF0aW9uc1xuICpcbiAqIC8vIFN1cGVyc2V0IC0gQWRkIGN1c3RvbSBvcGVyYXRpb25zIChlLmcuLCBwdWJsaXNoL2FwcHJvdmUgd29ya2Zsb3dzKVxuICogY29uc3QgQXJ0aWNsZU9wcyA9IHtcbiAqICAgLi4uRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gKiAgIHB1Ymxpc2g6ICdwdWJsaXNoJyxcbiAqICAgdW5wdWJsaXNoOiAndW5wdWJsaXNoJyxcbiAqICAgYXJjaGl2ZTogJ2FyY2hpdmUnXG4gKiB9IGFzIGNvbnN0O1xuICogZW50aXR5T3BlcmF0aW9uczogQXJ0aWNsZU9wc1xuICogYGBgXG4gKiBcbiAqICMjIFR5cGUgVXRpbGl0aWVzXG4gKiBcbiAqIEFkZGl0aW9uYWwgdHlwZSB1dGlsaXRpZXMgZm9yIGFkdmFuY2VkIHVzZSBjYXNlczpcbiAqIC0gYEF0dHJpYnV0ZXNUZW1wbGF0ZTxFPmAgLSBUeXBlLXNhZmUgYXR0cmlidXRlIGNvbXBvc2l0aW9uXG4gKiAtIGBWaXNpYmxlQXR0cmlidXRlS2V5czxFPmAgLSBFeHRyYWN0IHZpc2libGUgYXR0cmlidXRlIG5hbWVzXG4gKiAtIGBXcml0YWJsZUF0dHJpYnV0ZUtleXM8RT5gIC0gRXh0cmFjdCB3cml0YWJsZSBhdHRyaWJ1dGUgbmFtZXNcbiAqIC0gYEF0dHJpYnV0ZVZhbHVlVHlwZTxFLCBLPmAgLSBHZXQgdmFsdWUgdHlwZSBmb3IgYW4gYXR0cmlidXRlXG4gKiAtIGBFbnRpdHlBdHRyaWJ1dGVWYWx1ZU1hcDxFPmAgLSBNYXAgb2YgYWxsIGF0dHJpYnV0ZXMgdG8gdmFsdWUgdHlwZXNcbiAqIFxuICogIyMgUmVzb3VyY2VzXG4gKiBcbiAqIC0gaHR0cHM6Ly9naXRodWIuY29tL25sam1zL3NzaWEvYmxvYi9tYWluL3BhY2thZ2VzL2RhdGFiYXNlL3N0b3JhZ2VzL1BsYXllclN0b3JhZ2UudHNcbiAqIC0gaHR0cHM6Ly9naXRodWIuY29tL3R5d2FsY2gvZWxlY3Ryby1kZW1vL2Jsb2IvbWFpbi9uZXRsaWZ5L2Z1bmN0aW9ucy9zaGFyZS9yYXRlbGltaXQudHNcbiAqIC0gaHR0cHM6Ly9naXN0LmdpdGh1Yi5jb20vdHl3YWxjaC84MDQwMDg3ZTBmYzg4NmNhNWY3NDJhYTk5YjYyM2UxYlxuICogLSBodHRwczovL21lZGl1bS5jb20vZGV2ZWxvcGluZy1rb2FuL21vZGVsaW5nLWdyYXBoLXJlbGF0aW9uc2hpcHMtaW4tZHluYW1vZGItYzA2MTQxNjEyYTcwXG4gKiAtIGh0dHBzOi8vZ2lzdC5naXRodWIuY29tL3NldmVyaS81ZDE4MWEzZTc3OWY0MWE1ZTVmY2UxYjdkY2QxN2E4OVxuICogLSBodHRwczovL2dpdGh1Yi5jb20vaWt1c2hsaWFuc2tpL2ZhbWlseS1jYXItYm9va2luZy1iYWNrZW5kL2Jsb2IvbWFpbi9zZXJ2aWNlcy9jb3JlL2Jvb2tpbmcvYm9va2luZy5yZXBvc2l0b3J5LnRzXG4gKi9cblxuLyoqXG4gKiBSZXByZXNlbnRzIHRoZSBvcHRpb25zIGZvciBoeWRyYXRpbmcgYW4gZW50aXR5LlxuICogSXQgY2FuIGJlIGEgc3RyaW5nIHJlcHJlc2VudGluZyB0aGUgZW50aXR5IG5hbWUsXG4gKiBvciBhbiBvYmplY3Qgd2l0aCBhZGRpdGlvbmFsIGF0dHJpYnV0ZXMgYW5kIGh5ZHJhdGUgb3B0aW9ucy5cbiovXG5leHBvcnQgdHlwZSBSZWxhdGlvbmFsQXR0cmlidXRlczxUIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnksIGFueT4+ID0gT21pdE5ldmVyPHtcbiAgWyBLIGluIGtleW9mIFRbICdhdHRyaWJ1dGVzJyBdIF06IFRbICdhdHRyaWJ1dGVzJyBdWyBLIF1bICdoaWRkZW4nIF0gZXh0ZW5kcyB0cnVlID8gbmV2ZXJcbiAgOiBQaWNrUmVsYXRpb248VCwgSz4gZXh0ZW5kcyBuZXZlciA/IG5ldmVyXG4gIDogUGlja1JlbGF0aW9uPFQsIEs+O1xufT5cblxuZXhwb3J0IHR5cGUgTm9uUmVsYXRpb25hbEF0dHJpYnV0ZXM8VCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55LCBhbnk+PiA9IE9taXROZXZlcjx7XG4gIFsgSyBpbiBrZXlvZiBUWyAnYXR0cmlidXRlcycgXSBdOiBUWyAnYXR0cmlidXRlcycgXVsgSyBdWyAnaGlkZGVuJyBdIGV4dGVuZHMgdHJ1ZSA/IG5ldmVyXG4gIDogUGlja1JlbGF0aW9uPFQsIEs+IGV4dGVuZHMgbmV2ZXIgPyBUWyAnYXR0cmlidXRlcycgXVsgSyBdIDogbmV2ZXJcbn0+XG5cbmV4cG9ydCB0eXBlIFBpY2tSZWxhdGlvbjxFIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnksIGFueT4sIEEgZXh0ZW5kcyBrZXlvZiBFWyAnYXR0cmlidXRlcycgXT4gPVxuICBFWyAnYXR0cmlidXRlcycgXVsgQSBdWyAncmVsYXRpb24nIF0gZXh0ZW5kcyBSZWxhdGlvbjxpbmZlciBSPiA/IFJlbGF0aW9uPFI+IDogbmV2ZXI7XG5cbi8vIHV0aWxpdHkgdHlwZSBmb3IgcHJlcGFyZSBhbGwgdGhlIHBhdGhzIGZvciBlbnRpdHkgYW5kIGl0J3MgcmVsYXRpb25zXG50eXBlIF9FbnRpdHlBdHRyaWJ1dGVQYXRoczxFIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnksIGFueT4+ID1cbiAgeyBbIEsgaW4ga2V5b2YgTm9uUmVsYXRpb25hbEF0dHJpYnV0ZXM8RT4gXT86IEsgfVxuICAmXG4gIHsgWyBLIGluIGtleW9mIFJlbGF0aW9uYWxBdHRyaWJ1dGVzPEU+IF0/OiBfRW50aXR5QXR0cmlidXRlUGF0aHM8UmVsVG9SZWxhdGVkRW50aXR5PFJlbGF0aW9uYWxBdHRyaWJ1dGVzPEU+WyBLIF0+PiB9XG4vLyB1dGlsaXR5IHR5cGUgZm9yIHByZXBhcmUgYWxsIHRoZSBwYXRocyBmb3IgZW50aXR5IGFuZCBpdCdzIHJlbGF0aW9uc1xuZXhwb3J0IHR5cGUgRW50aXR5QXR0cmlidXRlUGF0aHM8RSBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55LCBhbnk+PiA9IFBhdGhzPF9FbnRpdHlBdHRyaWJ1dGVQYXRoczxFPj47XG5cblxuZXhwb3J0IHR5cGUgSHlkcmF0ZU9wdGlvbnNNYXBGb3JFbnRpdHk8VCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55LCBhbnk+PiA9XG4gIHsgWyBLIGluIGtleW9mIE5vblJlbGF0aW9uYWxBdHRyaWJ1dGVzPFQ+IF0/OiBib29sZWFuOyB9XG4gICZcbiAgeyBbIEsgaW4ga2V5b2YgUmVsYXRpb25hbEF0dHJpYnV0ZXM8VD4gXT86IGJvb2xlYW4gfCBIeWRyYXRlT3B0aW9uRm9yUmVsYXRpb248UmVsYXRpb25hbEF0dHJpYnV0ZXM8VD5bIEsgXT4gfTtcblxuZXhwb3J0IHR5cGUgSHlkcmF0ZU9wdGlvbkZvckVudGl0eTxFIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnksIGFueT4+ID0gSHlkcmF0ZU9wdGlvbnNNYXBGb3JFbnRpdHk8RT4gfCBBcnJheTxFbnRpdHlBdHRyaWJ1dGVQYXRoczxFPj47XG5cbmV4cG9ydCB0eXBlIEh5ZHJhdGVPcHRpb25Gb3JSZWxhdGlvbjxSZWwgZXh0ZW5kcyBSZWxhdGlvbjxhbnk+ID0gYW55PiA9IHtcbiAgZW50aXR5TmFtZT86IFJlbFsgJ2VudGl0eU5hbWUnIF0sXG4gIHJlbGF0aW9uVHlwZT86IFJlbFsgJ3R5cGUnIF0sXG4gIGlkZW50aWZpZXJzPzogUmVsYXRpb25JZGVudGlmaWVyczxSZWxUb1JlbGF0ZWRFbnRpdHk8UmVsPj4sXG4gIGF0dHJpYnV0ZXM6IEh5ZHJhdGVPcHRpb25Gb3JFbnRpdHk8UmVsVG9SZWxhdGVkRW50aXR5PFJlbD4+XG59XG5cbi8qKlxuICogQ3JlYXRlcyB0eXBlLXNhZmUgaHlkcmF0ZSBvcHRpb25zIGZvciBlbnRpdHkgcXVlcmllcy5cbiAqIFVzZSB0aGlzIHRvIHNwZWNpZnkgd2hpY2ggYXR0cmlidXRlcyAoaW5jbHVkaW5nIHJlbGF0aW9ucykgdG8gbG9hZCB3aGVuIHF1ZXJ5aW5nIGVudGl0aWVzLlxuICogXG4gKiBAdGVtcGxhdGUgRSAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGVcbiAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIGh5ZHJhdGUgb3B0aW9ucyAobWFwIG9yIGFycmF5IG9mIGF0dHJpYnV0ZSBwYXRocylcbiAqIEByZXR1cm5zIFRoZSB0eXBlZCBoeWRyYXRlIG9wdGlvbnNcbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIFVzaW5nIGF0dHJpYnV0ZSBtYXBcbiAqIGNyZWF0ZUh5ZHJhdGVPcHRpb25zPFVzZXJTY2hlbWE+KHtcbiAqICAgdXNlcklkOiB0cnVlLFxuICogICBuYW1lOiB0cnVlLFxuICogICBlbWFpbDogdHJ1ZSxcbiAqICAgcG9zdHM6IHRydWUgLy8gaHlkcmF0ZSByZWxhdGlvblxuICogfSlcbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIFVzaW5nIGFycmF5IG9mIHBhdGhzXG4gKiBjcmVhdGVIeWRyYXRlT3B0aW9uczxVc2VyU2NoZW1hPihbXG4gKiAgICd1c2VySWQnLFxuICogICAnbmFtZScsXG4gKiAgICdlbWFpbCcsXG4gKiAgICdwb3N0cy50aXRsZScsXG4gKiAgICdwb3N0cy5jb250ZW50J1xuICogXSlcbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIFdpdGggbmVzdGVkIHJlbGF0aW9uIGh5ZHJhdGlvblxuICogY3JlYXRlSHlkcmF0ZU9wdGlvbnM8VXNlclNjaGVtYT4oe1xuICogICB1c2VySWQ6IHRydWUsXG4gKiAgIG5hbWU6IHRydWUsXG4gKiAgIHBvc3RzOiB7XG4gKiAgICAgYXR0cmlidXRlczoge1xuICogICAgICAgcG9zdElkOiB0cnVlLFxuICogICAgICAgdGl0bGU6IHRydWUsXG4gKiAgICAgICBjb21tZW50czogdHJ1ZVxuICogICAgIH1cbiAqICAgfVxuICogfSlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUh5ZHJhdGVPcHRpb25zPEUgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueSwgYW55Pj4oXG4gIG9wdGlvbnM6IEh5ZHJhdGVPcHRpb25Gb3JFbnRpdHk8RT5cbik6IEh5ZHJhdGVPcHRpb25Gb3JFbnRpdHk8RT4ge1xuICByZXR1cm4gb3B0aW9ucztcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGEgdHlwZS1zYWZlIGVudGl0eSBxdWVyeSB3aXRoIHByb3BlciB0eXBlIGluZmVyZW5jZSBmb3IgYWxsIHF1ZXJ5IHBhcmFtZXRlcnMuXG4gKiBFbnN1cmVzIHRoYXQgZmlsdGVycywgYXR0cmlidXRlcywgYW5kIHNlYXJjaCBwYXJhbWV0ZXJzIGFyZSB2YWxpZCBmb3IgdGhlIGdpdmVuIGVudGl0eSBzY2hlbWEuXG4gKiBcbiAqIEB0ZW1wbGF0ZSBFIC0gVGhlIGVudGl0eSBzY2hlbWEgdHlwZVxuICogQHBhcmFtIHF1ZXJ5IC0gVGhlIGVudGl0eSBxdWVyeSBjb25maWd1cmF0aW9uXG4gKiBAcmV0dXJucyBUaGUgdHlwZWQgZW50aXR5IHF1ZXJ5XG4gKiBcbiAqIEBleGFtcGxlXG4gKiAvLyBTaW1wbGUgcXVlcnkgd2l0aCBmaWx0ZXJzXG4gKiBjcmVhdGVFbnRpdHlRdWVyeTxVc2VyU2NoZW1hPih7XG4gKiAgIGZpbHRlcnM6IHtcbiAqICAgICBzdGF0dXM6IHsgZXE6ICdhY3RpdmUnIH0sXG4gKiAgICAgYWdlOiB7IGd0ZTogMTggfVxuICogICB9LFxuICogICBhdHRyaWJ1dGVzOiBbJ3VzZXJJZCcsICduYW1lJywgJ2VtYWlsJ11cbiAqIH0pXG4gKiBcbiAqIEBleGFtcGxlXG4gKiAvLyBRdWVyeSB3aXRoIHBhZ2luYXRpb24gYW5kIHNlYXJjaFxuICogY3JlYXRlRW50aXR5UXVlcnk8VXNlclNjaGVtYT4oe1xuICogICBzZWFyY2g6ICdqb2huJyxcbiAqICAgc2VhcmNoQXR0cmlidXRlczogWyduYW1lJywgJ2VtYWlsJ10sXG4gKiAgIGF0dHJpYnV0ZXM6IGNyZWF0ZUh5ZHJhdGVPcHRpb25zPFVzZXJTY2hlbWE+KHtcbiAqICAgICB1c2VySWQ6IHRydWUsXG4gKiAgICAgbmFtZTogdHJ1ZSxcbiAqICAgICBlbWFpbDogdHJ1ZVxuICogICB9KSxcbiAqICAgcGFnaW5hdGlvbjoge1xuICogICAgIGNvdW50OiAyMCxcbiAqICAgICBvcmRlcjogJ2FzYycsXG4gKiAgICAgY3Vyc29yOiBudWxsXG4gKiAgIH1cbiAqIH0pXG4gKiBcbiAqIEBleGFtcGxlXG4gKiAvLyBRdWVyeSB3aXRoIHJlbGF0aW9uIGh5ZHJhdGlvblxuICogY3JlYXRlRW50aXR5UXVlcnk8R2FtZVNjaGVtYT4oe1xuICogICBmaWx0ZXJzOiB7XG4gKiAgICAgc3RhdHVzOiB7IGVxOiAndXBjb21pbmcnIH1cbiAqICAgfSxcbiAqICAgYXR0cmlidXRlczogY3JlYXRlSHlkcmF0ZU9wdGlvbnM8R2FtZVNjaGVtYT4oe1xuICogICAgIGdhbWVJZDogdHJ1ZSxcbiAqICAgICBnYW1lRGF0ZTogdHJ1ZSxcbiAqICAgICBob21lVGVhbToge1xuICogICAgICAgYXR0cmlidXRlczoge1xuICogICAgICAgICB0ZWFtSWQ6IHRydWUsXG4gKiAgICAgICAgIHRlYW1OYW1lOiB0cnVlLFxuICogICAgICAgICBsb2dvOiB0cnVlXG4gKiAgICAgICB9XG4gKiAgICAgfSxcbiAqICAgICBhd2F5VGVhbToge1xuICogICAgICAgYXR0cmlidXRlczoge1xuICogICAgICAgICB0ZWFtSWQ6IHRydWUsXG4gKiAgICAgICAgIHRlYW1OYW1lOiB0cnVlLFxuICogICAgICAgICBsb2dvOiB0cnVlXG4gKiAgICAgICB9XG4gKiAgICAgfVxuICogICB9KSxcbiAqICAgcGFnaW5hdGlvbjogeyBjb3VudDogMTAgfVxuICogfSlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUVudGl0eVF1ZXJ5PEUgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KFxuICBxdWVyeTogRW50aXR5UXVlcnk8RT5cbik6IEVudGl0eVF1ZXJ5PEU+IHtcbiAgcmV0dXJuIHF1ZXJ5O1xufVxuXG5cblxuLyoqXG4gKiBVdGlsaXR5IHR5cGUgdG8gZXh0cmFjdCBvbmx5IHZpc2libGUgKG5vbi1oaWRkZW4pIGF0dHJpYnV0ZSBrZXlzIGZyb20gYW4gZW50aXR5IHNjaGVtYVxuICovXG5leHBvcnQgdHlwZSBWaXNpYmxlQXR0cmlidXRlS2V5czxFIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnksIGFueT4+ID0ge1xuICBbSyBpbiBrZXlvZiBFWydhdHRyaWJ1dGVzJ11dOiBFWydhdHRyaWJ1dGVzJ11bS11bJ2hpZGRlbiddIGV4dGVuZHMgdHJ1ZSA/IG5ldmVyIDogS1xufVtrZXlvZiBFWydhdHRyaWJ1dGVzJ11dO1xuXG4vKipcbiAqIFV0aWxpdHkgdHlwZSB0byBleHRyYWN0IG9ubHkgd3JpdGFibGUgKG5vbi1yZWFkb25seSkgYXR0cmlidXRlIGtleXMgZnJvbSBhbiBlbnRpdHkgc2NoZW1hXG4gKi9cbmV4cG9ydCB0eXBlIFdyaXRhYmxlQXR0cmlidXRlS2V5czxFIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnksIGFueT4+ID0ge1xuICBbSyBpbiBrZXlvZiBFWydhdHRyaWJ1dGVzJ11dOiBFWydhdHRyaWJ1dGVzJ11bS11bJ3JlYWRPbmx5J10gZXh0ZW5kcyB0cnVlID8gbmV2ZXIgOiBLXG59W2tleW9mIEVbJ2F0dHJpYnV0ZXMnXV07XG5cbi8qKlxuICogUmVwcmVzZW50cyBhbiBpZGVudGlmaWVyIG1hcHBpbmcgYmV0d2VlbiBzb3VyY2UgYW5kIHRhcmdldCBlbnRpdHkgYXR0cmlidXRlcy5cbiAqIFRoZSB0YXJnZXQgaXMgY29uc3RyYWluZWQgdG8gdmFsaWQgYXR0cmlidXRlIGtleXMgb2YgdGhlIHRhcmdldCBlbnRpdHkuXG4gKi9cbmV4cG9ydCB0eXBlIFJlbGF0aW9uSWRlbnRpZmllcjxFIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnksIGFueT4gPSBhbnk+ID0geyBcbiAgc291cmNlOiBzdHJpbmcsIFxuICB0YXJnZXQ6IGtleW9mIEVbICdhdHRyaWJ1dGVzJyBdIFxufTtcblxuZXhwb3J0IHR5cGUgUmVsYXRpb25JZGVudGlmaWVyczxFIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnksIGFueT4gPSBhbnk+ID0gUmVsYXRpb25JZGVudGlmaWVyPEU+IHwgQXJyYXk8UmVsYXRpb25JZGVudGlmaWVyPEU+PlxuXG4vKipcbiAqIEhlbHBlciB0eXBlIHRvIHJlc29sdmUgZW50aXR5IHNjaGVtYSBmcm9tIGVpdGhlciBkaXJlY3QgdHlwZSBvciBsYXp5IGZ1bmN0aW9uXG4gKi9cbmV4cG9ydCB0eXBlIFJlc29sdmVFbnRpdHlTY2hlbWE8VD4gPSBUIGV4dGVuZHMgKCkgPT4gaW5mZXIgRSBcbiAgPyBFIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnksIGFueT4gPyBFIDogbmV2ZXJcbiAgOiBUIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnksIGFueT4gPyBUIDogbmV2ZXI7XG5cbi8qKlxuICogQ3JlYXRlcyBhbiBlbnRpdHkgcmVsYXRpb24gd2l0aCBmdWxsIHR5cGUgc2FmZXR5IGFuZCBjaXJjdWxhciBkZXBlbmRlbmN5IHN1cHBvcnQuXG4gKiBUaGlzIGlzIHRoZSBwcmltYXJ5IGhlbHBlciBmb3IgZGVmaW5pbmcgZW50aXR5IHJlbGF0aW9ucy5cbiAqIFxuICogQHRlbXBsYXRlIFQgLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlIChkaXJlY3Qgb3IgbGF6eS1sb2FkZWQgdmlhIGZ1bmN0aW9uKVxuICogQHBhcmFtIHJlbGF0aW9uIC0gVGhlIHJlbGF0aW9uIGNvbmZpZ3VyYXRpb25cbiAqIEByZXR1cm5zIFRoZSB0eXBlZCByZWxhdGlvblxuICogXG4gKiBAZXhhbXBsZVxuICogLy8gU2ltcGxlIHJlbGF0aW9uIChubyBjaXJjdWxhciBkZXBlbmRlbmN5KVxuICogY3JlYXRlRW50aXR5UmVsYXRpb248VGVhbVNjaGVtYT4oe1xuICogICBlbnRpdHlOYW1lOiAndGVhbScsXG4gKiAgIHR5cGU6ICdtYW55LXRvLW9uZScsXG4gKiAgIGlkZW50aWZpZXJzOiB7IHNvdXJjZTogJ3RlYW1JZCcsIHRhcmdldDogJ3RlYW1JZCcgfVxuICogfSlcbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIE11bHRpcGxlIGlkZW50aWZpZXJzXG4gKiBjcmVhdGVFbnRpdHlSZWxhdGlvbjxUZWFtU2NoZW1hPih7XG4gKiAgIGVudGl0eU5hbWU6ICd0ZWFtJyxcbiAqICAgdHlwZTogJ21hbnktdG8tb25lJyxcbiAqICAgaWRlbnRpZmllcnM6IFtcbiAqICAgICB7IHNvdXJjZTogJ3RlYW1JZCcsIHRhcmdldDogJ3RlYW1JZCcgfSxcbiAqICAgICB7IHNvdXJjZTogJ3RlbmFudElkJywgdGFyZ2V0OiAndGVuYW50SWQnIH1cbiAqICAgXVxuICogfSlcbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIENpcmN1bGFyIGRlcGVuZGVuY3kgLSB1c2UgbGF6eSBsb2FkaW5nIHdpdGggYXJyb3cgZnVuY3Rpb25cbiAqIGNyZWF0ZUVudGl0eVJlbGF0aW9uPCgpID0+IFBvc3RTY2hlbWE+KHtcbiAqICAgZW50aXR5TmFtZTogJ3Bvc3QnLFxuICogICB0eXBlOiAnb25lLXRvLW1hbnknLFxuICogICBpZGVudGlmaWVyczogKCkgPT4gKHsgc291cmNlOiAndXNlcklkJywgdGFyZ2V0OiAndXNlcklkJyB9KVxuICogfSlcbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIFdpdGggaHlkcmF0aW9uIG9wdGlvbnNcbiAqIGNyZWF0ZUVudGl0eVJlbGF0aW9uPFRlYW1TY2hlbWE+KHtcbiAqICAgZW50aXR5TmFtZTogJ3RlYW0nLFxuICogICB0eXBlOiAnbWFueS10by1vbmUnLFxuICogICBpZGVudGlmaWVyczogeyBzb3VyY2U6ICd0ZWFtSWQnLCB0YXJnZXQ6ICd0ZWFtSWQnIH0sXG4gKiAgIGh5ZHJhdGU6IHRydWUsXG4gKiAgIGF0dHJpYnV0ZXM6IHsgdGVhbUlkOiB0cnVlLCB0ZWFtTmFtZTogdHJ1ZSwgbG9nbzogdHJ1ZSB9XG4gKiB9KVxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRW50aXR5UmVsYXRpb248VCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55LCBhbnk+IHwgKCgpID0+IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55LCBhbnk+KT4oXG4gIHJlbGF0aW9uOiBSZWxhdGlvbjxSZXNvbHZlRW50aXR5U2NoZW1hPFQ+PlxuKTogUmVsYXRpb248UmVzb2x2ZUVudGl0eVNjaGVtYTxUPj4ge1xuICByZXR1cm4gcmVsYXRpb247XG59XG5cbmV4cG9ydCB0eXBlIFJlbFRvUmVsYXRlZEVudGl0eTxSZWw+ID0gUmVsIGV4dGVuZHMgUmVsYXRpb248aW5mZXIgRT4gPyBFIDogbmV2ZXI7XG4vKipcbiAqIFJlcHJlc2VudHMgYSByZWxhdGlvbiBiZXR3ZWVuIGVudGl0aWVzLlxuICogU3VwcG9ydHMgbGF6eS1sb2FkZWQgZW50aXR5IHNjaGVtYXMgdG8gYXZvaWQgY2lyY3VsYXIgZGVwZW5kZW5jeSBpc3N1ZXMuXG4gKlxuICogQHRlbXBsYXRlIEUgLSBUaGUgdHlwZSBvZiB0aGUgcmVsYXRlZCBlbnRpdHkgc2NoZW1hLlxuICovXG5leHBvcnQgdHlwZSBSZWxhdGlvbjxFIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnksIGFueT4gPSBhbnk+ID0ge1xuICAvKipcbiAgICogUmVwcmVzZW50cyBhIHJlbGF0aW9uIGJldHdlZW4gZW50aXRpZXMuXG4gICAqL1xuICBlbnRpdHlOYW1lOiBFWyAnbW9kZWwnIF1bICdlbnRpdHknIF07XG5cbiAgLyoqXG4gICAqIFRoZSB0eXBlIG9mIHRoZSByZWxhdGlvbi5cbiAgICogUG9zc2libGUgdmFsdWVzOiAnb25lLXRvLW9uZScsICdvbmUtdG8tbWFueScsICdtYW55LXRvLW9uZScsICdtYW55LXRvLW1hbnknLlxuICAgKi9cbiAgdHlwZTogJ29uZS10by1tYW55JyB8ICdtYW55LXRvLW9uZSc7IC8vICdvbmUtdG8tb25lJyB8ICdtYW55LXRvLW1hbnknO1xuXG4gIC8qKlxuICAgKiBJZGVudGlmaWVycyB0byBsb2FkIHRoZSByZWxhdGVkIGVudGl0eS5cbiAgICogVGhlc2UgYXJlIG1hcHBpbmdzIGJldHdlZW4gc291cmNlIGVudGl0eSBhdHRyaWJ1dGVzIGFuZCByZWxhdGVkIGVudGl0eSBhdHRyaWJ1dGVzLlxuICAgKiBUaGUga2V5cyBmb3Igc291cmNlIGVudGl0aWVzIGNhbiBzdXBwb3J0IHBhdGhzIGxpa2UgJ2F0dDEubmVzdGVkS2V5MScuXG4gICAqIFRoZSB2YWx1ZXMgY2FuIGJlIGEgc3RyaW5nIHJlcHJlc2VudGluZyB0aGUgcmVsYXRlZCBlbnRpdHkgYXR0cmlidXRlIG9yIGFuIGFycmF5IG9mIHN0cmluZ3MuXG4gICAqIENhbiBiZSBwcm92aWRlZCBkaXJlY3RseSBvciB2aWEgYSBmdW5jdGlvbiB0byBoYW5kbGUgY2lyY3VsYXIgZGVwZW5kZW5jaWVzLlxuICAgKi9cbiAgaWRlbnRpZmllcnM6IFJlbGF0aW9uSWRlbnRpZmllcnM8RT4gfCAoKCkgPT4gUmVsYXRpb25JZGVudGlmaWVyczxFPik7XG5cbiAgLy8gc2V0IHRoaXMgdG8gdHJ1ZSBpbiBlbnRpdHktZGVmaW5pdGlvbiB0byBhdXRvLWh5ZHJhdGUgdGhpcyByZWxhdGlvblxuICBoeWRyYXRlPzogYm9vbGVhbjtcblxuICAvKipcbiAgICogQXR0cmlidXRlcyB0byBsb2FkIHdoZW4gaHlkcmF0aW5nIHRoaXMgcmVsYXRpb24gYW5kIE9wdGlvbnMgZm9yIGh5ZHJhdGluZyB0aGUgcmVsYXRpb25hbCBhdHRyaWJ1dGVzIG9mIHRoaXMgcmVsYXRpb24uXG4gICAqIENhbiBiZSBwcm92aWRlZCBkaXJlY3RseSBvciB2aWEgYSBmdW5jdGlvbiB0byBoYW5kbGUgY2lyY3VsYXIgZGVwZW5kZW5jaWVzIGluIGNvbXBsZXggcmVsYXRpb24gY2hhaW5zLlxuICAgKi9cbiAgYXR0cmlidXRlcz86IEh5ZHJhdGVPcHRpb25Gb3JFbnRpdHk8RT4gfCAoKCkgPT4gSHlkcmF0ZU9wdGlvbkZvckVudGl0eTxFPik7XG59O1xuXG5cbi8qKlxuICogUmVwcmVzZW50cyBhbiBlbnRpdHkgYXR0cmlidXRlLlxuICovXG5leHBvcnQgdHlwZSBFbnRpdHlBdHRyaWJ1dGUgPSBBdHRyaWJ1dGUgJiB7XG4gIC8qKlxuICAgKiBUaGUgaHVtYW4gcmVhZGFibGUgbmFtZSBvZiB0aGUgYXR0cmlidXRlLlxuICAgKi9cbiAgbmFtZT86IHN0cmluZztcblxuICAvKipcbiAgICogSW5kaWNhdGVzIHdoZXRoZXIgdGhlIGF0dHJpYnV0ZSBpcyBhbiBpZGVudGlmaWVyLlxuICAgKi9cbiAgaXNJZGVudGlmaWVyPzogYm9vbGVhbjtcblxuICAvKipcbiAgICogSW5kaWNhdGVzIHdoZXRoZXIgdGhlIGF0dHJpYnV0ZSBpcyB1bmlxdWUgKGZvciB1bmlxdWUgY29uc3RyYWludHMpLlxuICAgKi9cbiAgaXNVbmlxdWU/OiBib29sZWFuO1xuXG4gIC8qKlxuICAgKiBEZWZpbmVzIGEgcmVsYXRpb24gd2l0aCBhbm90aGVyIGVudGl0eS5cbiAgICogVXNlIHRoZSB0eXBlLWhlbHBlciBgY3JlYXRlRW50aXR5UmVsYXRpb248RW50aXR5U2NoZW1hPigpYCBmdW5jdGlvbiBmb3IgdHlwZS1zYWZlIHJlbGF0aW9uIGNyZWF0aW9uLlxuICAgKiBGb3IgY2lyY3VsYXIgZGVwZW5kZW5jaWVzLCB1c2UgYGNyZWF0ZUVudGl0eVJlbGF0aW9uPCgpID0+IEVudGl0eVNjaGVtYT4oKWAgd2l0aCBsYXp5IGxvYWRpbmcuXG4gICAqL1xuICByZWxhdGlvbj86IFJlbGF0aW9uPGFueT47XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRpb25zIGZvciB0aGUgYXR0cmlidXRlLlxuICAgKi9cbiAgdmFsaWRhdGlvbnM/OiBhbnlbXTtcblxufVxuICAmIEZpZWxkTWV0YWRhdGE7XG5cblxuZXhwb3J0IHR5cGUgRmllbGRNZXRhZGF0YSA9IFRleHRGaWVsZE1ldGFkYXRhIHwgTnVtYmVyRmllbGRNZXRhZGF0YSB8IERhdGVGaWVsZE1ldGFkYXRhXG4gIHwgVGltZUZpZWxkTWV0YWRhdGEgfCBEYXRlVGltZUZpZWxkTWV0YWRhdGEgfCBCb29sZWFuRmllbGRNZXRhZGF0YVxuICB8IFNlbGVjdEZpZWxkTWV0YWRhdGEgfCBSYWRpb0ZpZWxkTWV0YWRhdGEgfCBDaGVja2JveEZpZWxkTWV0YWRhdGFcbiAgfCBGaWxlRmllbGRNZXRhZGF0YSB8IFJhbmdlRmllbGRNZXRhZGF0YSB8IENvbG9yRmllbGRNZXRhZGF0YVxuICB8IEltYWdlRmllbGRNZXRhZGF0YSB8IEhpZGRlbkZpZWxkTWV0YWRhdGEgfCBDdXN0b21GaWVsZE1ldGFkYXRhXG4gIHwgUmF0aW5nRmllbGRNZXRhZGF0YSB8IEVkaXRvckZpZWxkTWV0YWRhdGEgfCBDb2RlRWRpdG9yRmllbGRNZXRhZGF0YTtcblxuLy8gTWV0YWRhdGEgZm9yIFVJXG5leHBvcnQgaW50ZXJmYWNlIEJhc2VGaWVsZE1ldGFkYXRhIHtcbiAgaXNWaXNpYmxlPzogYm9vbGVhbjsgLy8gaWYgdGhlIGZpZWxkIGlzIHZpc2libGUgb3IgaGlkZGVuIG9uIGFsbCBkZXRhaWwtcGFnZXNcbiAgaXNMaXN0YWJsZT86IGJvb2xlYW47IC8vIGlmIHRoZSBmaWVsZCBpcyB2aXNpYmxlIGluIHRoZSBsaXN0IHZpZXdcbiAgaXNDcmVhdGFibGU/OiBib29sZWFuOyAvLyBpZiB0aGUgZmllbGQgaXMgY3JlYXRhYmxlXG4gIGlzRWRpdGFibGU/OiBib29sZWFuOyAvLyBpZiB0aGUgZmllbGQgaXMgZWRpdGFibGVcbiAgaXNGaWx0ZXJhYmxlPzogYm9vbGVhbjsgLy8gaWYgdGhlIGZpZWxkIGlzIGZpbHRlcmFibGVcbiAgaXNTZWFyY2hhYmxlPzogYm9vbGVhbjsgLy8gaWYgdGhlIGZpZWxkIGlzIHNlYXJjaGFibGVcbiAgaXNTb3J0YWJsZT86IGJvb2xlYW47IC8vIGlmIHRoZSBmaWVsZCBpcyBzb3J0YWJsZVxuICBwbGFjZWhvbGRlcj86IHN0cmluZztcbiAgaGVscFRleHQ/OiBzdHJpbmc7XG4gIHRvb2x0aXA/OiBzdHJpbmc7IC8vIG1heWJlIHRoaXMgY2FuIGJlIGluZmVycmVkIGZyb20gdGhlIGhlbHBUZXh0XG4gIC8vIEZpbHRlciBjb25maWd1cmF0aW9uIG9wdGlvbnNcbiAgZmlsdGVyQ29uZmlnPzoge1xuICAgIGZpbHRlclR5cGU/OiAndGV4dCcgfCAnc2VsZWN0JyB8ICdkYXRldGltZScgfCAnbnVtYmVyJyB8ICdib29sZWFuJzsgLy8gRmlsdGVyIGlucHV0IHR5cGVcbiAgICBkZWZhdWx0T3BlcmF0b3I/OiBGaWx0ZXJPcGVyYXRvcnNFeHRlbmRlZDxhbnk+OyAvLyBEZWZhdWx0IGZpbHRlciBvcGVyYXRvciAoZS5nLiwgJ2NvbnRhaW5zJywgJ2VxJywgJ2luJylcbiAgICBhdmFpbGFibGVPcGVyYXRvcnM/OiBGaWx0ZXJPcGVyYXRvcnNFeHRlbmRlZDxhbnk+W107IC8vIFJlc3RyaWN0IGF2YWlsYWJsZSBvcGVyYXRvcnMgZm9yIHRoaXMgY29sdW1uXG4gICAgcHJlZGVmaW5lZE9wdGlvbnM/OiBBcnJheTx7IGxhYmVsOiBzdHJpbmc7IHZhbHVlOiBzdHJpbmcgfT47IC8vIEZvciBkcm9wZG93bi9zZWxlY3QgZmlsdGVyc1xuICB9O1xuICAvLyBMaW5rIGNvbmZpZ3VyYXRpb24gZm9yIHJlbmRlcmluZyBmaWVsZCBhcyBpbnRlcm5hbCBsaW5rXG4gIGlzTGluaz86IGJvb2xlYW47XG4gIGxpbmtDb25maWc/OiB7XG4gICAgcm91dGVQYXR0ZXJuOiBzdHJpbmc7XG4gICAgZGlzcGxheVRleHQ/OiBzdHJpbmc7XG4gIH07XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSVBhZ2VBY3Rpb25JdGVtIHtcbiAgbGFiZWw6IHN0cmluZztcbiAgdXJsOiBzdHJpbmc7XG4gIGljb24/OiBzdHJpbmc7XG59XG5cbi8qKlxuICogTW9kYWwgdHlwZSBmb3IgYWN0aW9uc1xuICovXG5leHBvcnQgdHlwZSBNb2RhbFR5cGUgPSBcImNvbmZpcm1cIiB8IFwibGlzdFwiIHwgXCJmb3JtXCIgfCBcImFjY29yZGlvblwiIHwgXCJjdXN0b21cIiB8IFwiZGV0YWlsc1wiIHwgXCJkYXNoYm9hcmRcIjtcblxuLyoqXG4gKiBBUEkgbWV0aG9kIHR5cGUgLSBtdXN0IG1hdGNoIGZyb250ZW5kIElBcGlDb25maWdcbiAqL1xuZXhwb3J0IHR5cGUgQXBpTWV0aG9kID0gJ0dFVCcgfCAnUE9TVCcgfCAnUFVUJyB8ICdERUxFVEUnIHwgJ1BBVENIJztcblxuLyoqXG4gKiBDb25maXJtIG1vZGFsIGNvbmZpZ3VyYXRpb25cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJQ29uZmlybU1vZGFsIHtcbiAgdGl0bGU6IHN0cmluZztcbiAgY29udGVudD86IHN0cmluZztcbn1cblxuLyoqXG4gKiBBUEkgY29uZmlndXJhdGlvbiBmb3IgbW9kYWwgYWN0aW9uc1xuICovXG5leHBvcnQgaW50ZXJmYWNlIElNb2RhbEFwaUNvbmZpZyB7XG4gIGFwaU1ldGhvZDogQXBpTWV0aG9kO1xuICByZXNwb25zZUtleT86IHN0cmluZztcbiAgYXBpVXJsOiBzdHJpbmc7XG59XG5cbi8qKlxuICogTW9kYWwgY29uZmlndXJhdGlvbiBmb3IgZW50aXR5IHBhZ2UgYWN0aW9uc1xuICogTm90ZTogVGhpcyBpcyBhIHN1YnNldCBvZiB0aGUgZnJvbnRlbmQgSU1vZGFsQ29uZmlnLCBleGNsdWRpbmcgcnVudGltZSBwcm9wc1xuICovXG5leHBvcnQgaW50ZXJmYWNlIElFbnRpdHlQYWdlQWN0aW9uTW9kYWxDb25maWcge1xuICBtb2RhbFR5cGU6IE1vZGFsVHlwZTtcbiAgbW9kYWxQYWdlQ29uZmlnPzogSUNvbmZpcm1Nb2RhbCB8IEZvcm1QYWdlQ29uZmlnU3RydWN0dXJlIHwgTGlzdFBhZ2VDb25maWdTdHJ1Y3R1cmUgfCBEZXRhaWxzUGFnZUNvbmZpZ1N0cnVjdHVyZTtcbiAgYXBpQ29uZmlnPzogSU1vZGFsQXBpQ29uZmlnO1xuICBzdWJtaXRTdWNjZXNzUmVkaXJlY3Q/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSUVudGl0eVBhZ2VBY3Rpb24ge1xuICBsYWJlbDogc3RyaW5nO1xuICB1cmw/OiBzdHJpbmc7XG4gIGljb24/OiBzdHJpbmc7XG4gIHR5cGU/OiAnYnV0dG9uJyB8ICdkcm9wZG93bic7XG4gIGl0ZW1zPzogSVBhZ2VBY3Rpb25JdGVtW107XG4gIG9wZW5Jbk1vZGFsPzogYm9vbGVhbjtcbiAgbW9kYWxDb25maWc/OiBJRW50aXR5UGFnZUFjdGlvbk1vZGFsQ29uZmlnO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIElFbnRpdHlQYWdlQ29sdW1uIHtcbiAgc29ydE9yZGVyOiBudW1iZXI7XG4gIGZpZWxkczogc3RyaW5nW107XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSUVudGl0eVBhZ2VDb2x1bW5Db25maWcge1xuICBudW1Db2x1bW5zPzogbnVtYmVyO1xuICBjb2x1bW5zOiBJRW50aXR5UGFnZUNvbHVtbltdO1xufVxuXG5pbnRlcmZhY2UgVGV4dEZpZWxkTWV0YWRhdGEgZXh0ZW5kcyBCYXNlRmllbGRNZXRhZGF0YSB7XG4gIGZpZWxkVHlwZT86ICd0ZXh0JyB8ICd0ZXh0YXJlYScgfCAncGFzc3dvcmQnIHwgJ2VtYWlsJztcbiAgbWF4TGVuZ3RoPzogbnVtYmVyO1xuICBtYXNrPzogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgTnVtYmVyRmllbGRNZXRhZGF0YSBleHRlbmRzIEJhc2VGaWVsZE1ldGFkYXRhIHtcbiAgZmllbGRUeXBlPzogJ251bWJlcic7XG4gIG1pbj86IG51bWJlcjtcbiAgbWF4PzogbnVtYmVyO1xuICBzdGVwPzogbnVtYmVyO1xufVxuXG5pbnRlcmZhY2UgRGF0ZUZpZWxkTWV0YWRhdGEgZXh0ZW5kcyBCYXNlRmllbGRNZXRhZGF0YSB7XG4gIGZpZWxkVHlwZT86ICdkYXRlJztcbiAgbWluRGF0ZT86IERhdGU7XG4gIG1heERhdGU/OiBEYXRlO1xuICBkYXRlRm9ybWF0Pzogc3RyaW5nOyAvLyBmb3JtYXQgdG8gZGlzcGxheSB0aGUgZGF0ZVxufVxuXG5cbmludGVyZmFjZSBUaW1lRmllbGRNZXRhZGF0YSBleHRlbmRzIEJhc2VGaWVsZE1ldGFkYXRhIHtcbiAgZmllbGRUeXBlPzogJ3RpbWUnO1xuICBtaW5UaW1lPzogc3RyaW5nOyAvLyBpbiBISDptbSBmb3JtYXRcbiAgbWF4VGltZT86IHN0cmluZzsgLy8gaW4gSEg6bW0gZm9ybWF0XG4gIHRpbWVGb3JtYXQ/OiBzdHJpbmc7IC8vIGZvcm1hdCB0byBkaXNwbGF5IHRoZSB0aW1lXG59XG5cbmludGVyZmFjZSBEYXRlVGltZUZpZWxkTWV0YWRhdGEgZXh0ZW5kcyBCYXNlRmllbGRNZXRhZGF0YSB7XG4gIGZpZWxkVHlwZT86ICdkYXRldGltZSc7XG4gIG1pbkRhdGVUaW1lPzogRGF0ZTtcbiAgbWF4RGF0ZVRpbWU/OiBEYXRlO1xuICBkYXRlVGltZUZvcm1hdD86IHN0cmluZzsgLy8gZm9ybWF0IHRvIGRpc3BsYXkgdGhlIGRhdGUgYW5kIHRpbWVcbn1cblxuaW50ZXJmYWNlIENvbG9yRmllbGRNZXRhZGF0YSBleHRlbmRzIEJhc2VGaWVsZE1ldGFkYXRhIHtcbiAgZmllbGRUeXBlPzogJ2NvbG9yJztcbiAgZGVmYXVsdENvbG9yPzogc3RyaW5nOyAvLyBkZWZhdWx0IGNvbG9yIHZhbHVlXG59XG5cbmludGVyZmFjZSBCb29sZWFuRmllbGRNZXRhZGF0YSBleHRlbmRzIEJhc2VGaWVsZE1ldGFkYXRhIHtcbiAgZmllbGRUeXBlPzogJ2Jvb2xlYW4nIHwgJ3N3aXRjaCcgfCAndG9nZ2xlJztcbiAgdHJ1ZUxhYmVsPzogc3RyaW5nOyAvLyBsYWJlbCBmb3IgdGhlIHRydWUgdmFsdWVcbiAgZmFsc2VMYWJlbD86IHN0cmluZzsgLy8gbGFiZWwgZm9yIHRoZSBmYWxzZSB2YWx1ZVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIFNlbGVjdEZpZWxkTWV0YWRhdGE8RSBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PiA9IGFueT4gZXh0ZW5kcyBCYXNlRmllbGRNZXRhZGF0YSB7XG4gIGZpZWxkVHlwZT86ICdzZWxlY3QnIHwgJ211bHRpLXNlbGVjdCcgfCAnYXV0b2NvbXBsZXRlJztcbiAgb3B0aW9uczogRmllbGRPcHRpb25zPEU+O1xuICBtYXhTZWxlY3Rpb25zPzogbnVtYmVyOyAvLyBtYXhpbXVtIG51bWJlciBvZiBzZWxlY3Rpb25zXG4gIC8vIHdoZXRoZXIgdG8gYWxsb3cgYWRkaW5nIG5ldyBvcHRpb25zXG4gIGFkZE5ld09wdGlvbj86IHtcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmc7IC8vIGVudGl0eSBuYW1lIHRvIGNyZWF0ZSBuZXcgb3B0aW9uXG4gIH07XG59XG5cbi8vIFR5cGUgZ3VhcmQgZm9yIFNlbGVjdEZpZWxkTWV0YWRhdGFcbmV4cG9ydCBmdW5jdGlvbiBpc1NlbGVjdEZpZWxkTWV0YWRhdGEob2JqOiBhbnkpOiBvYmogaXMgU2VsZWN0RmllbGRNZXRhZGF0YSB7XG4gIHJldHVybiAoXG4gICAgdHlwZW9mIG9iaiA9PT0gJ29iamVjdCdcbiAgICAmJiAhIW9ialxuICAgICYmICdvcHRpb25zJyBpbiBvYmpcbiAgICAmJiBbICdzZWxlY3QnLCAnbXVsdGktc2VsZWN0JywgJ2F1dG9jb21wbGV0ZScgXS5pbmNsdWRlcyhvYmouZmllbGRUeXBlKVxuICApO1xufVxuXG4vLyBUeXBlIGd1YXJkIGZvciBJbWFnZUZpZWxkTWV0YWRhdGFcbmV4cG9ydCBmdW5jdGlvbiBpc0ltYWdlRmllbGRNZXRhZGF0YShvYmo6IGFueSk6IG9iaiBpcyBJbWFnZUZpZWxkTWV0YWRhdGEge1xuICByZXR1cm4gKFxuICAgIHR5cGVvZiBvYmogPT09ICdvYmplY3QnXG4gICAgJiYgISFvYmpcbiAgICAmJiBvYmouZmllbGRUeXBlID09PSAnaW1hZ2UnXG4gICk7XG59XG5cbi8vIFR5cGUgZ3VhcmQgZm9yIEZpbGVGaWVsZE1ldGFkYXRhXG5leHBvcnQgZnVuY3Rpb24gaXNGaWxlRmllbGRNZXRhZGF0YShvYmo6IGFueSk6IG9iaiBpcyBGaWxlRmllbGRNZXRhZGF0YSB7XG4gIHJldHVybiAoXG4gICAgdHlwZW9mIG9iaiA9PT0gJ29iamVjdCdcbiAgICAmJiAhIW9ialxuICAgICYmIG9iai5maWVsZFR5cGUgPT09ICdmaWxlJ1xuICApO1xufVxuXG4vLyBUeXBlIGd1YXJkIGZvciBEYXRlRmllbGRNZXRhZGF0YVxuZXhwb3J0IGZ1bmN0aW9uIGlzRGF0ZUZpZWxkTWV0YWRhdGEob2JqOiBhbnkpOiBvYmogaXMgRGF0ZUZpZWxkTWV0YWRhdGEge1xuICByZXR1cm4gKFxuICAgIHR5cGVvZiBvYmogPT09ICdvYmplY3QnXG4gICAgJiYgISFvYmpcbiAgICAmJiBvYmouZmllbGRUeXBlID09PSAnZGF0ZSdcbiAgKTtcbn1cblxuLy8gVHlwZSBndWFyZCBmb3IgRGF0ZVRpbWVGaWVsZE1ldGFkYXRhXG5leHBvcnQgZnVuY3Rpb24gaXNEYXRlVGltZUZpZWxkTWV0YWRhdGEob2JqOiBhbnkpOiBvYmogaXMgRGF0ZVRpbWVGaWVsZE1ldGFkYXRhIHtcbiAgcmV0dXJuIChcbiAgICB0eXBlb2Ygb2JqID09PSAnb2JqZWN0J1xuICAgICYmICEhb2JqXG4gICAgJiYgb2JqLmZpZWxkVHlwZSA9PT0gJ2RhdGV0aW1lJ1xuICApO1xufVxuXG4vLyBUeXBlIGd1YXJkIGZvciBOdW1iZXJGaWVsZE1ldGFkYXRhXG5leHBvcnQgZnVuY3Rpb24gaXNOdW1iZXJGaWVsZE1ldGFkYXRhKG9iajogYW55KTogb2JqIGlzIE51bWJlckZpZWxkTWV0YWRhdGEge1xuICByZXR1cm4gKFxuICAgIHR5cGVvZiBvYmogPT09ICdvYmplY3QnXG4gICAgJiYgISFvYmpcbiAgICAmJiBvYmouZmllbGRUeXBlID09PSAnbnVtYmVyJ1xuICApO1xufVxuXG4vLyBUeXBlIGd1YXJkIGZvciBCb29sZWFuRmllbGRNZXRhZGF0YVxuZXhwb3J0IGZ1bmN0aW9uIGlzQm9vbGVhbkZpZWxkTWV0YWRhdGEob2JqOiBhbnkpOiBvYmogaXMgQm9vbGVhbkZpZWxkTWV0YWRhdGEge1xuICByZXR1cm4gKFxuICAgIHR5cGVvZiBvYmogPT09ICdvYmplY3QnXG4gICAgJiYgISFvYmpcbiAgICAmJiBbICdib29sZWFuJywgJ3N3aXRjaCcsICd0b2dnbGUnIF0uaW5jbHVkZXMob2JqLmZpZWxkVHlwZSlcbiAgKTtcbn1cblxuLy8gVHlwZSBndWFyZCBmb3IgRWRpdG9yRmllbGRNZXRhZGF0YVxuZXhwb3J0IGZ1bmN0aW9uIGlzRWRpdG9yRmllbGRNZXRhZGF0YShvYmo6IGFueSk6IG9iaiBpcyBFZGl0b3JGaWVsZE1ldGFkYXRhIHtcbiAgcmV0dXJuIChcbiAgICB0eXBlb2Ygb2JqID09PSAnb2JqZWN0J1xuICAgICYmICEhb2JqXG4gICAgJiYgWyAncmljaC10ZXh0JywgJ3d5c2l3eWcnIF0uaW5jbHVkZXMob2JqLmZpZWxkVHlwZSlcbiAgKTtcbn1cblxuLy8gVHlwZSBndWFyZCBmb3IgQ29kZUVkaXRvckZpZWxkTWV0YWRhdGFcbmV4cG9ydCBmdW5jdGlvbiBpc0NvZGVFZGl0b3JGaWVsZE1ldGFkYXRhKG9iajogYW55KTogb2JqIGlzIENvZGVFZGl0b3JGaWVsZE1ldGFkYXRhIHtcbiAgcmV0dXJuIChcbiAgICB0eXBlb2Ygb2JqID09PSAnb2JqZWN0J1xuICAgICYmICEhb2JqXG4gICAgJiYgWyAnY29kZScsICdtYXJrZG93bicsICdqc29uJyBdLmluY2x1ZGVzKG9iai5maWVsZFR5cGUpXG4gICk7XG59XG5cblxuXG5pbnRlcmZhY2UgUmFkaW9GaWVsZE1ldGFkYXRhPEUgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4gPSBhbnk+IGV4dGVuZHMgQmFzZUZpZWxkTWV0YWRhdGEge1xuICBmaWVsZFR5cGU/OiAncmFkaW8nO1xuICBvcHRpb25zOiBGaWVsZE9wdGlvbnM8RT47XG4gIGxheW91dD86ICdob3Jpem9udGFsJyB8ICd2ZXJ0aWNhbCc7IC8vIGxheW91dCBvZiB0aGUgcmFkaW8gYnV0dG9uc1xufVxuXG5pbnRlcmZhY2UgQ2hlY2tib3hGaWVsZE1ldGFkYXRhPEUgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4gPSBhbnk+IGV4dGVuZHMgQmFzZUZpZWxkTWV0YWRhdGEge1xuICBmaWVsZFR5cGU/OiAnY2hlY2tib3gnO1xuICBvcHRpb25zOiBGaWVsZE9wdGlvbnM8RT47XG4gIGxheW91dD86ICdob3Jpem9udGFsJyB8ICd2ZXJ0aWNhbCc7IC8vIGxheW91dCBvZiB0aGUgcmFkaW8gYnV0dG9uc1xufVxuXG5pbnRlcmZhY2UgQ29tbW9uRmlsZUZpZWxkTWV0YWRhdGEge1xuICBhY2NlcHQ/OiBzdHJpbmc7IC8vIGZpbGUgdHlwZXMgdG8gYWNjZXB0IGUuZy4gXCJpbWFnZS8qXCIgfCBcImltYWdlL3BuZ1wiIHwgXCJpbWFnZS9qcGVnXCIgfCBcImltYWdlL2dpZlwiIHwgXCJpbWFnZS9ibXBcIiB8IFwiaW1hZ2Uvd2VicFwiIHwgXCJhcHBsaWNhdGlvbi9wZGZcIiB8IFwiYXBwbGljYXRpb24vbXN3b3JkXCJcbiAgbWF4RmlsZVNpemU/OiBudW1iZXI7IC8vIG1heGltdW0gZmlsZSBzaXplIGluIGJ5dGVzXG4gIGZpbGVOYW1lUHJlZml4Pzogc3RyaW5nOyAvLyBwcmVmaXggZm9yIHRoZSBmaWxlIG5hbWUgZS5nLiAncHJvZmlsZS1waWMtJyB8ICdkb2N1bWVudHMvJyB8ICduZXN0ZWQvcGF0aC90by9pbWFnZXMvJ1xuICBnZXRTaWduZWRVcGxvYWRVcmxBUElDb25maWc/OiBHZXRTaWduZWRVcGxvYWRVcmxBUElDb25maWcsIC8vIEFQSSBjb25maWcgdG8gZ2V0IHNpZ25lZCB1cGxvYWQgVVJMXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgRmlsZUZpZWxkTWV0YWRhdGEgZXh0ZW5kcyBCYXNlRmllbGRNZXRhZGF0YSwgQ29tbW9uRmlsZUZpZWxkTWV0YWRhdGEge1xuICBmaWVsZFR5cGU/OiAnZmlsZSc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSW1hZ2VGaWVsZE1ldGFkYXRhIGV4dGVuZHMgQmFzZUZpZWxkTWV0YWRhdGEsIENvbW1vbkZpbGVGaWVsZE1ldGFkYXRhIHtcbiAgZmllbGRUeXBlPzogJ2ltYWdlJztcbiAgYXNwZWN0UmF0aW8/OiBzdHJpbmc7IC8vIGRlc2lyZWQgYXNwZWN0IHJhdGlvIGZvciB0aGUgaW1hZ2VcbiAgd2l0aEltYWdlQ3JvcD86IGJvb2xlYW47IC8vIHdoZXRoZXIgdG8gYWxsb3cgaW1hZ2UgY3JvcHBpbmcgYXQgdGhlIHRpbWUgb2YgdXBsb2FkaW5nXG4gIGFjY2VwdD86IFwiaW1hZ2UvKlwiIHwgXCJpbWFnZS9wbmdcIiB8IFwiaW1hZ2UvanBlZ1wiIHwgXCJpbWFnZS9naWZcIiB8IFwiaW1hZ2UvYm1wXCIgfCBcImltYWdlL3dlYnBcIjtcbn1cblxuaW50ZXJmYWNlIFJhbmdlRmllbGRNZXRhZGF0YSBleHRlbmRzIEJhc2VGaWVsZE1ldGFkYXRhIHtcbiAgZmllbGRUeXBlPzogJ3JhbmdlJztcbiAgbWluPzogbnVtYmVyO1xuICBtYXg/OiBudW1iZXI7XG4gIHN0ZXA/OiBudW1iZXI7XG4gIHNob3dWYWx1ZT86IGJvb2xlYW47IC8vIHdoZXRoZXIgdG8gc2hvdyB0aGUgY3VycmVudCB2YWx1ZVxufVxuXG5leHBvcnQgdHlwZSBHZXRTaWduZWRVcGxvYWRVcmxBUElDb25maWcgPSB7XG4gIGFwaVVybDogc3RyaW5nO1xuICBhcGlNZXRob2Q6ICdHRVQnIHwgJ1BPU1QnO1xufTtcblxuaW50ZXJmYWNlIEhpZGRlbkZpZWxkTWV0YWRhdGEgZXh0ZW5kcyBCYXNlRmllbGRNZXRhZGF0YSB7XG4gIGZpZWxkVHlwZT86ICdoaWRkZW4nO1xufVxuXG5pbnRlcmZhY2UgQ3VzdG9tRmllbGRNZXRhZGF0YSBleHRlbmRzIEJhc2VGaWVsZE1ldGFkYXRhIHtcbiAgZmllbGRUeXBlPzogJ2N1c3RvbSc7XG59XG5cbmludGVyZmFjZSBSYXRpbmdGaWVsZE1ldGFkYXRhIGV4dGVuZHMgQmFzZUZpZWxkTWV0YWRhdGEge1xuICBmaWVsZFR5cGU/OiAncmF0aW5nJztcbiAgbWF4UmF0aW5nPzogbnVtYmVyOyAvLyBtYXhpbXVtIHJhdGluZyB2YWx1ZVxufVxuXG5pbnRlcmZhY2UgRWRpdG9yRmllbGRNZXRhZGF0YSBleHRlbmRzIEJhc2VGaWVsZE1ldGFkYXRhLCBDb21tb25GaWxlRmllbGRNZXRhZGF0YSB7XG4gIGZpZWxkVHlwZT86ICdyaWNoLXRleHQnIHwgJ3d5c2l3eWcnO1xufVxuXG5pbnRlcmZhY2UgQ29kZUVkaXRvckZpZWxkTWV0YWRhdGEgZXh0ZW5kcyBCYXNlRmllbGRNZXRhZGF0YSB7XG4gIGZpZWxkVHlwZT86ICdjb2RlJyB8ICdtYXJrZG93bicgfCAnanNvbic7XG59XG5cbmV4cG9ydCB0eXBlIEZpZWxkT3B0aW9uczxFIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+ID0gYW55PiA9IEFycmF5PEZpZWxkT3B0aW9uPiB8IEZpZWxkT3B0aW9uc0FQSUNvbmZpZzxFPjtcblxuZXhwb3J0IHR5cGUgRmllbGRPcHRpb24gPSB7XG4gIHZhbHVlOiBzdHJpbmcsXG4gIGxhYmVsOiBzdHJpbmcsXG59XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgdGVtcGxhdGUgZm9yIGF0dHJpYnV0ZXMuXG4gKiBBbGxvd3MgY29tcG9zaW5nIG11bHRpcGxlIGF0dHJpYnV0ZXMgaW50byBhIGZvcm1hdHRlZCBzdHJpbmcuXG4gKiBQcm92aWRlcyB0eXBlLXNhZmUgYXR0cmlidXRlIG5hbWUgdmFsaWRhdGlvbiB2aWEgZ2VuZXJpY3MuXG4gKiBcbiAqIEB0ZW1wbGF0ZSBFIC0gVGhlIGVudGl0eSBzY2hlbWEgdHlwZVxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqIC8vIERlZmluZSBkaXJlY3RseSBpbiBmaWVsZCBvcHRpb25zIGNvbmZpZ1xuICogY29uc3QgdGVtcGxhdGU6IEF0dHJpYnV0ZXNUZW1wbGF0ZTxVc2VyU2NoZW1hPiA9IHtcbiAqICAgY29tcG9zaXRlOiBbJ2ZpcnN0TmFtZScsICdsYXN0TmFtZSddLFxuICogICB0ZW1wbGF0ZTogJ3tmaXJzdE5hbWV9LUFORC17bGFzdE5hbWV9J1xuICogfVxuICogYGBgXG4gKi9cbmV4cG9ydCB0eXBlIEF0dHJpYnV0ZXNUZW1wbGF0ZTxFIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+ID0gYW55PiA9IHtcbiAgY29tcG9zaXRlOiBBcnJheTxrZXlvZiBFWydhdHRyaWJ1dGVzJ10gJiBzdHJpbmc+LFxuICB0ZW1wbGF0ZTogc3RyaW5nLFxufVxuXG4vKipcbiAqIENvbmZpZ3VyYXRpb24gZm9yIGxvYWRpbmcgZmllbGQgb3B0aW9ucyBmcm9tIGFuIEFQSSBlbmRwb2ludC5cbiAqIFByb3ZpZGVzIHR5cGUtc2FmZSBhdHRyaWJ1dGUgcmVmZXJlbmNlcyBmb3IgdGhlIGdpdmVuIGVudGl0eSBzY2hlbWEuXG4gKiBcbiAqIEB0ZW1wbGF0ZSBFIC0gVGhlIGVudGl0eSBzY2hlbWEgdHlwZSBmb3IgdHlwZS1zYWZlIGF0dHJpYnV0ZSByZWZlcmVuY2VzXG4gKi9cbmV4cG9ydCB0eXBlIEZpZWxkT3B0aW9uc0FQSUNvbmZpZzxFIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiA9IHtcbiAgYXBpTWV0aG9kOiAnR0VUJyB8ICdQT1NUJyxcbiAgYXBpVXJsOiBzdHJpbmcsXG4gIHJlc3BvbnNlS2V5OiBzdHJpbmcsXG4gIHF1ZXJ5PzogRW50aXR5UXVlcnk8RT4sXG4gIG9wdGlvbk1hcHBpbmc/OiB7XG4gICAgbGFiZWw6IChrZXlvZiBFWydhdHRyaWJ1dGVzJ10gJiBzdHJpbmcpIHwgQXR0cmlidXRlc1RlbXBsYXRlPEU+LFxuICAgIHZhbHVlOiAoa2V5b2YgRVsnYXR0cmlidXRlcyddICYgc3RyaW5nKSB8IEF0dHJpYnV0ZXNUZW1wbGF0ZTxFPixcbiAgfSxcbn1cblxuLyoqXG4gKiBDcmVhdGVzIHR5cGUtc2FmZSBmaWVsZCBvcHRpb25zIGNvbmZpZ3VyYXRpb24gZm9yIEFQSS1sb2FkZWQgc2VsZWN0L3JhZGlvL2NoZWNrYm94IG9wdGlvbnMuXG4gKiBQcm92aWRlcyBmdWxsIHR5cGUgc2FmZXR5IGZvciBhdHRyaWJ1dGUgcmVmZXJlbmNlcyBpbiBvcHRpb24gbWFwcGluZ3MgYW5kIHF1ZXJ5IGZpbHRlcnMuXG4gKiBcbiAqIEB0ZW1wbGF0ZSBFIC0gVGhlIGVudGl0eSBzY2hlbWEgdHlwZSBmb3IgdGhlIG9wdGlvbnMgc291cmNlXG4gKiBAcGFyYW0gY29uZmlnIC0gVGhlIGZpZWxkIG9wdGlvbnMgQVBJIGNvbmZpZ3VyYXRpb25cbiAqIEByZXR1cm5zIFRoZSB0eXBlZCBmaWVsZCBvcHRpb25zIEFQSSBjb25maWdcbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIFNpbXBsZSBhdHRyaWJ1dGUgbWFwcGluZ1xuICogY3JlYXRlRmllbGRPcHRpb25zPFVzZXJTY2hlbWE+KHtcbiAqICAgYXBpTWV0aG9kOiAnR0VUJyxcbiAqICAgYXBpVXJsOiAnL2FwaS91c2VycycsXG4gKiAgIHJlc3BvbnNlS2V5OiAnZGF0YScsXG4gKiAgIG9wdGlvbk1hcHBpbmc6IHtcbiAqICAgICBsYWJlbDogJ25hbWUnLFxuICogICAgIHZhbHVlOiAndXNlcklkJ1xuICogICB9XG4gKiB9KVxuICogXG4gKiBAZXhhbXBsZVxuICogLy8gV2l0aCBxdWVyeSBmaWx0ZXJzXG4gKiBjcmVhdGVGaWVsZE9wdGlvbnM8VGVhbVNjaGVtYT4oe1xuICogICBhcGlNZXRob2Q6ICdHRVQnLFxuICogICBhcGlVcmw6ICcvYXBpL3RlYW1zJyxcbiAqICAgcmVzcG9uc2VLZXk6ICd0ZWFtcycsXG4gKiAgIHF1ZXJ5OiB7IGZpbHRlcnM6IHsgc3RhdHVzOiB7IGVxOiAnYWN0aXZlJyB9IH0gfSxcbiAqICAgb3B0aW9uTWFwcGluZzoge1xuICogICAgIGxhYmVsOiAndGVhbU5hbWUnLFxuICogICAgIHZhbHVlOiAndGVhbUlkJ1xuICogICB9XG4gKiB9KVxuICogXG4gKiBAZXhhbXBsZVxuICogLy8gV2l0aCBhdHRyaWJ1dGUgdGVtcGxhdGUgZm9yIGNvbXBvc2VkIGxhYmVsc1xuICogY3JlYXRlRmllbGRPcHRpb25zPFRlYW1TY2hlbWE+KHtcbiAqICAgYXBpTWV0aG9kOiAnR0VUJyxcbiAqICAgYXBpVXJsOiAnL2FwaS90ZWFtcycsXG4gKiAgIHJlc3BvbnNlS2V5OiAndGVhbXMnLFxuICogICBvcHRpb25NYXBwaW5nOiB7XG4gKiAgICAgbGFiZWw6IHtcbiAqICAgICAgIGNvbXBvc2l0ZTogWyd0ZWFtTmFtZScsICdjaXR5J10sXG4gKiAgICAgICB0ZW1wbGF0ZTogJ3t0ZWFtTmFtZX0gKHtjaXR5fSknXG4gKiAgICAgfSxcbiAqICAgICB2YWx1ZTogJ3RlYW1JZCdcbiAqICAgfVxuICogfSlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUZpZWxkT3B0aW9uczxFIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihcbiAgY29uZmlnOiBGaWVsZE9wdGlvbnNBUElDb25maWc8RT5cbik6IEZpZWxkT3B0aW9uc0FQSUNvbmZpZzxFPiB7XG4gIHJldHVybiBjb25maWc7XG59XG5cbmV4cG9ydCBjb25zdCBTcGVjaWFsQXR0cmlidXRlVHlwZXMgPSB7XG4gIG5hbWU6ICduYW1lJyxcbiAgc2x1ZzogJ3NsdWcnLFxuICBjb2xvcjogJ2NvbG9yJyxcbiAgaW1hZ2U6ICdpbWFnZScsXG4gIGRlc2NyaXB0aW9uOiAnZGVzY3JpcHRpb24nLFxuXG4gIGNyZWF0ZWRBdDogJ2NyZWF0ZWRBdCcsXG4gIHVwZGF0ZWRBdDogJ3VwZGF0ZWRBdCcsXG4gIGRlbGV0ZWRBdDogJ2RlbGV0ZWRBdCdcbn07XG5cbmV4cG9ydCB0eXBlIFNwZWNpYWxBdHRyaWJ1dGVUeXBlID0ga2V5b2YgdHlwZW9mIFNwZWNpYWxBdHRyaWJ1dGVUeXBlcztcblxuLyoqXG4gKiBSZXByZXNlbnRzIHRoZSBzY2hlbWEgZm9yIGFuIGVudGl0eS5cbiAqXG4gKiBAdGVtcGxhdGUgQSAtIEF0dHJpYnV0ZSBuYW1lc1xuICogQHRlbXBsYXRlIEYgLSBGYWNldCBuYW1lc1xuICogQHRlbXBsYXRlIEMgLSBDb2xsZWN0aW9uIG5hbWVzXG4gKiBAdGVtcGxhdGUgT3BwIC0gVGhlIHR5cGUgb2YgZW50aXR5IG9wZXJhdGlvbnMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRW50aXR5U2NoZW1hPFxuICBBIGV4dGVuZHMgc3RyaW5nLFxuICBGIGV4dGVuZHMgc3RyaW5nLFxuICBDIGV4dGVuZHMgc3RyaW5nLFxuICBPcHAgZXh0ZW5kcyBURGVmYXVsdEVudGl0eU9wZXJhdGlvbnMgPSBURGVmYXVsdEVudGl0eU9wZXJhdGlvbnNcbj4gZXh0ZW5kcyBTY2hlbWE8QSwgRiwgQz4ge1xuICByZWFkb25seSBtb2RlbDogU2NoZW1hPEEsIEYsIEM+WyAnbW9kZWwnIF0gJiB7XG4gICAgcmVhZG9ubHkgZW50aXR5TmFtZVBsdXJhbDogc3RyaW5nO1xuICAgIHJlYWRvbmx5IGVudGl0eU9wZXJhdGlvbnM6IE9wcDtcbiAgICByZWFkb25seSBlbnRpdHlNZW51SWNvbj86IHN0cmluZywgLy8gZGVmYXVsdCBpcyAnYXBwU3RvcmUnXG4gICAgcmVhZG9ubHkgZW50aXR5TmFtZUF0dHJpYnV0ZT86IHN0cmluZywgLy8gZGVmYXVsdCBpcyAnbmFtZSdcbiAgICByZWFkb25seSBlbnRpdHlTbHVnQXR0cmlidXRlPzogc3RyaW5nLCAvLyBkZWZhdWx0IGlzICdzbHVnJ1xuICAgIHJlYWRvbmx5IGVudGl0eUltYWdlQXR0cmlidXRlPzogc3RyaW5nLCAvLyBkZWZhdWx0IGlzICdpbWFnZSdcbiAgICByZWFkb25seSBlbnRpdHlEZXNjcmlwdGlvbkF0dHJpYnV0ZT86IHN0cmluZywgLy8gZGVmYXVsdCBpcyAnZGVzY3JpcHRpb24nXG5cbiAgICByZWFkb25seSBleGNsdWRlRnJvbUFkbWluTWVudT86IGJvb2xlYW4sIC8vIGRlZmF1bHQgaXMgZmFsc2VcbiAgICByZWFkb25seSBleGNsdWRlRnJvbUFkbWluTGlzdD86IGJvb2xlYW4sIC8vIGRlZmF1bHQgaXMgZmFsc2VcbiAgICByZWFkb25seSBleGNsdWRlRnJvbUFkbWluRGV0YWlsPzogYm9vbGVhbiwgLy8gZGVmYXVsdCBpcyBmYWxzZVxuICAgIHJlYWRvbmx5IGV4Y2x1ZGVGcm9tQWRtaW5DcmVhdGU/OiBib29sZWFuLCAvLyBkZWZhdWx0IGlzIGZhbHNlXG4gICAgcmVhZG9ubHkgZXhjbHVkZUZyb21BZG1pblVwZGF0ZT86IGJvb2xlYW4sIC8vIGRlZmF1bHQgaXMgZmFsc2VcbiAgICByZWFkb25seSBleGNsdWRlRnJvbUFkbWluRGVsZXRlPzogYm9vbGVhbiwgLy8gZGVmYXVsdCBpcyBmYWxzZVxuICAgIHJlYWRvbmx5IGV4Y2x1ZGVGcm9tQWRtaW5EdXBsaWNhdGU/OiBib29sZWFuLCAvLyBkZWZhdWx0IGlzIGZhbHNlXG5cbiAgICByZWFkb25seSBDUlVEQXBpUGF0aD86IHN0cmluZywgLy8gZGVmYXVsdCBpcyAnJ1xuXG4gICAgLy8gTWVudSBjb25maWd1cmF0aW9uXG4gICAgcmVhZG9ubHkgbWVudUdyb3VwPzogc3RyaW5nOyAvLyBHcm91cCB0aGlzIGVudGl0eSBiZWxvbmdzIHRvIGluIHRoZSBtZW51XG4gICAgcmVhZG9ubHkgbWVudU9yZGVyPzogbnVtYmVyOyAvLyBPcmRlciB3aXRoaW4gdGhlIGdyb3VwIChkZWZhdWx0OiAwKVxuXG4gICAgLy8gQ3JlYXRlIHBhZ2UgY29uZmlndXJhdGlvblxuICAgIHJlYWRvbmx5IGNyZWF0ZVBhZ2VCcmVhZGNydW1icz86IEFycmF5PHsgbGFiZWw6IHN0cmluZzsgdXJsPzogc3RyaW5nIH0+LFxuICAgIHJlYWRvbmx5IGNyZWF0ZVBhZ2VDb2x1bW5zQ29uZmlnPzogSUVudGl0eVBhZ2VDb2x1bW5Db25maWcsXG4gICAgLy8gTGlzdCBwYWdlIGNvbmZpZ3VyYXRpb25cbiAgICByZWFkb25seSBsaXN0UGFnZUFjdGlvbnM/OiBJRW50aXR5UGFnZUFjdGlvbltdLFxuICAgIHJlYWRvbmx5IGxpc3RQYWdlQnJlYWRjcnVtYnM/OiBBcnJheTx7IGxhYmVsOiBzdHJpbmc7IHVybD86IHN0cmluZyB9PixcbiAgICByZWFkb25seSBsaXN0UGFnZURlZmF1bHRTb3J0PzogeyBmaWVsZDogc3RyaW5nOyBvcmRlcjogJ2FzYycgfCAnZGVzYycgfSB8IEFycmF5PHsgZmllbGQ6IHN0cmluZzsgb3JkZXI6ICdhc2MnIHwgJ2Rlc2MnIH0+IHwgc3RyaW5nLFxuICAgIC8vIFZpZXcgcGFnZSBjb25maWd1cmF0aW9uXG4gICAgcmVhZG9ubHkgdmlld1BhZ2VBY3Rpb25zPzogSUVudGl0eVBhZ2VBY3Rpb25bXSxcbiAgICByZWFkb25seSB2aWV3UGFnZUJyZWFkY3J1bWJzPzogQXJyYXk8eyBsYWJlbDogc3RyaW5nOyB1cmw/OiBzdHJpbmcgfT4sXG4gICAgcmVhZG9ubHkgdmlld1BhZ2VDb2x1bW5zQ29uZmlnPzogSUVudGl0eVBhZ2VDb2x1bW5Db25maWcsXG4gICAgLy8gRWRpdCBwYWdlIGNvbmZpZ3VyYXRpb25cbiAgICByZWFkb25seSBlZGl0UGFnZUFjdGlvbnM/OiBJRW50aXR5UGFnZUFjdGlvbltdLFxuICAgIHJlYWRvbmx5IGVkaXRQYWdlQnJlYWRjcnVtYnM/OiBBcnJheTx7IGxhYmVsOiBzdHJpbmc7IHVybD86IHN0cmluZyB9PixcbiAgICByZWFkb25seSBlZGl0UGFnZUNvbHVtbnNDb25maWc/OiBJRW50aXR5UGFnZUNvbHVtbkNvbmZpZyxcbiAgICBcblxuICAgIHJlYWRvbmx5IHNlYXJjaD86IHtcbiAgICAgIGVuYWJsZWQ6IGJvb2xlYW47XG4gICAgICBpbmRleENvbmZpZz86IFNlYXJjaEluZGV4Q29uZmlnO1xuICAgICAgc2VydmljZUNsYXNzPzogRGVwSWRlbnRpZmllcjxFbnRpdHlTZWFyY2hTZXJ2aWNlPGFueT4+IHwgdHlwZW9mIEVudGl0eVNlYXJjaFNlcnZpY2UgfCBFbnRpdHlTZWFyY2hTZXJ2aWNlPGFueT47XG4gICAgICAvLyBEb2N1bWVudCB0cmFuc2Zvcm1hdGlvbiBmb3IgaW5kZXhpbmdcbiAgICAgIGRvY3VtZW50VHJhbnNmb3JtZXI/OiAoZW50aXR5OiBFbnRpdHlSZWNvcmRUeXBlRnJvbVNjaGVtYTxFbnRpdHlTY2hlbWE8QSwgRiwgQz4+KSA9PiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIGFueT4+O1xuICAgIH07XG4gIH07XG4gIHJlYWRvbmx5IGF0dHJpYnV0ZXM6IHtcbiAgICByZWFkb25seSBbIGEgaW4gQSBdOiBFbnRpdHlBdHRyaWJ1dGU7XG4gIH07XG59XG5cbi8qKlxuICogRGVmYXVsdCBlbnRpdHkgb3BlcmF0aW9ucyB0aGF0IGFyZSBjb21tb25seSB1c2VkLlxuICogVXNlIHRoaXMgYXMgYSBiYXNlIG9yIGRlZmluZSB5b3VyIG93biBzdWJzZXQvc3VwZXJzZXQuXG4gKi9cbmV4cG9ydCBjb25zdCBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucyA9IHtcbiAgZ2V0OiBcImdldFwiLFxuICBsaXN0OiBcImxpc3RcIixcbiAgcXVlcnk6IFwicXVlcnlcIixcbiAgY3JlYXRlOiBcImNyZWF0ZVwiLFxuICB1cHNlcnQ6IFwidXBzZXJ0XCIsXG4gIHVwZGF0ZTogXCJ1cGRhdGVcIixcbiAgZGVsZXRlOiBcImRlbGV0ZVwiLFxuICBkdXBsaWNhdGU6IFwiZHVwbGljYXRlXCIsXG59IGFzIGNvbnN0O1xuXG4vKipcbiAqIFR5cGUgZm9yIHRoZSBkZWZhdWx0IGVudGl0eSBvcGVyYXRpb25zLlxuICogVXNlIHRoaXMgd2hlbiB5b3Ugd2FudCBhbGwgc3RhbmRhcmQgQ1JVRCBvcGVyYXRpb25zLlxuICovXG5leHBvcnQgdHlwZSBURGVmYXVsdEVudGl0eU9wZXJhdGlvbnMgPSB0eXBlb2YgRGVmYXVsdEVudGl0eU9wZXJhdGlvbnM7XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgaW5wdXQgc2NoZW1hcyBmb3IgZW50aXR5IG9wZXJhdGlvbnMuXG4gKiBQcm92aWRlcyB0eXBlLXNhZmUgbWFwcGluZyBvZiBvcGVyYXRpb24gbmFtZXMgdG8gdGhlaXIgY29ycmVzcG9uZGluZyBpbnB1dCB0eXBlcy5cbiAqIEV4dGVuZCB0aGlzIHR5cGUgZm9yIGFkZGl0aW9uYWwgb3BlcmF0aW9ucydzIGlucHV0LXNjaGVtYSB0eXBlcy5cbiAqIFxuICogQHRlbXBsYXRlIFNjaCAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUuXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0c1xuICogdHlwZSBVc2VyT3BzSW5wdXRzID0gVEVudGl0eU9wc0lucHV0U2NoZW1hczxVc2VyRW50aXR5U2NoZW1hPjtcbiAqIC8vIHtcbiAqIC8vICAgZ2V0OiBVc2VySWRlbnRpZmllcnMgfCBVc2VySWRlbnRpZmllcnNbXSxcbiAqIC8vICAgY3JlYXRlOiBDcmVhdGVVc2VySXRlbSxcbiAqIC8vICAgdXBkYXRlOiBVcGRhdGVVc2VySXRlbSxcbiAqIC8vICAgLi4uXG4gKiAvLyB9XG4gKiBgYGBcbiAqL1xuZXhwb3J0IHR5cGUgVEVudGl0eU9wc0lucHV0U2NoZW1hczxcbiAgU2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnksIGFueT4sXG4+ID0ge1xuICAgIHJlYWRvbmx5IFsgb3BOYW1lIGluIGtleW9mIFNjaFsgJ21vZGVsJyBdWyAnZW50aXR5T3BlcmF0aW9ucycgXSBdXG4gICAgOiBvcE5hbWUgZXh0ZW5kcyAnZ2V0JyA/IEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8U2NoPiB8IEFycmF5PEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8U2NoPj5cbiAgICA6IG9wTmFtZSBleHRlbmRzICdsaXN0JyA/IG5ldmVyIC8vIGxpc3Qgb3BlcmF0aW9ucyB0eXBpY2FsbHkgZG9uJ3QgdGFrZSBpZGVudGlmaWVycyBhcyBpbnB1dFxuICAgIDogb3BOYW1lIGV4dGVuZHMgJ3F1ZXJ5JyA/IG5ldmVyIC8vIHF1ZXJ5IG9wZXJhdGlvbnMgdXNlIEVudGl0eVF1ZXJ5IHR5cGVcbiAgICA6IG9wTmFtZSBleHRlbmRzICdjcmVhdGUnID8gQ3JlYXRlRW50aXR5SXRlbVR5cGVGcm9tU2NoZW1hPFNjaD5cbiAgICA6IG9wTmFtZSBleHRlbmRzICd1cHNlcnQnID8gVXBzZXJ0RW50aXR5SXRlbVR5cGVGcm9tU2NoZW1hPFNjaD5cbiAgICA6IG9wTmFtZSBleHRlbmRzICd1cGRhdGUnID8gVXBkYXRlRW50aXR5SXRlbVR5cGVGcm9tU2NoZW1hPFNjaD5cbiAgICA6IG9wTmFtZSBleHRlbmRzICdkZWxldGUnID8gRW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTY2g+IHwgQXJyYXk8RW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTY2g+PlxuICAgIDogb3BOYW1lIGV4dGVuZHMgJ2R1cGxpY2F0ZScgPyBFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFNjaD5cbiAgICA6IHt9XG4gIH1cblxuZXhwb3J0IHR5cGUgQ3JlYXRlRWxlY3Ryb0RCRW50aXR5T3B0aW9uczxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiA9IHtcbiAgc2NoZW1hOiBTLFxuICBlbnRpdHlDb25maWd1cmF0aW9uczogRW50aXR5Q29uZmlndXJhdGlvbjtcbn1cblxuXG4vKipcbiAqIFRoaXMgZnVuY3Rpb24gaXMgdXNlZCB0byBkZWZpbmUgYW4gZW50aXR5IHNjaGVtYSBmb3IgRHluYW1vREIgYmFzZWQgZW50aXR5LCBhbmQgaXQgdXNlZCBFbGVjdHJvREIgdW5kZXIgdGhlIGhvb2QuIFxuICogSXQgdGFrZXMgYW4gb2JqZWN0IGFzIGFuIGFyZ3VtZW50IHRoYXQgZGVzY3JpYmVzIHRoZSBtb2RlbCwgYXR0cmlidXRlcywgYW5kIGluZGV4ZXMgb2YgdGhlIGVudGl0eS5cbiAqIHRoZSBnZW5lcmljIHBhcmFtcyBhcmUgb25seSBmb3IgdGhlIHR5cGUgaW5mZXJlbmNlLCBhbmQgdGhleSBhcmUgbm90IHVzZWQgaW4gdGhlIGZ1bmN0aW9uLlxuICogXG4gKiBAcGFyYW0gc2NoZW1hIC0gVGhlIGVudGl0eSBzY2hlbWEgY29uZmlndXJhdGlvbi5cbiAqIFxuICogQGV4YW1wbGVcbiAqIGltcG9ydCB7IGNyZWF0ZUVudGl0eVNjaGVtYSB9IGZyb20gJ0B0ZW4yNEdyb3VwL2Z3MjQnXG4gKiBcbiAqIGNvbnN0IGVudGl0eVNjaGVtYSA9IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gKiAgIC8vIGVudGl0eSBzY2hlbWEgY29uZmlndXJhdGlvblxuICogXG4gKiAgLy8gbWV0YWRhdGEgYWJvdXQgdGhlIGVudGl0eVxuICogIG1vZGVsOiB7XG4gKiAgICAgIHZlcnNpb246ICcxJyxcbiAqICAgICAgZW50aXR5OiAndXNlcicsICAgICAgICAgICAgIC8vIHRoZSBuYW1lIG9mIHRoZSBlbnRpdHlcbiAqICAgICAgZW50aXR5TmFtZVBsdXJhbDogJ1VzZXJzJywgLy8gdXNlZCBieSBhdXRvIGdlbmVyYXRlZCBVSVxuICogICAgICBlbnRpdHlPcGVyYXRpb25zOiBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucywgLy8gdGhlIG9wZXJhdGlvbnMgdGhhdCBjYW4gYmUgcGVyZm9ybWVkIG9uIHRoZSBlbnRpdHlcbiAqICAgICAgc2VydmljZTogJ3VzZXJzJywgLy8gRWxlY3Ryb0RCIHNlcnZpY2UgbmFtZSBbbG9naWNhbCBncm91cCBvZiBlbnRpdGllc11cbiAqICB9LCAgIFxuICogLy8gdGhlIGF0dHJpYnV0ZXMgZm9yIHRoZSBlbnRpdHlcbiAqICBhdHRyaWJ1dGVzOiB7XG4gKiAgICAgdXNlcklkOiB7XG4gKiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICogICAgICByZXF1aXJlZDogdHJ1ZSwgIFxuICogICAgICByZWFkT25seTogdHJ1ZSxcbiAqICAgICAgZGVmYXVsdDogKCkgPT4gcmFuZG9tVVVJRCgpXG4gKiAgICB9LFxuICogICAvLyAuLi4gb3RoZXIgYXR0cmlidXRlc1xuICogIH0sICAgIFxuICogLy8gdGhlIGFjY2VzcyBwYXR0ZXJucyBmb3IgdGhlIGVudGl0eVxuICogIGluZGV4ZXM6IHtcbiAqICAgICAgcHJpbWFyeToge1xuICogICAgICAgICAgcGs6IHtcbiAqICAgICAgICAgICAgICBmaWVsZDogJ3ByaW1hcnlfcGsnLCAgICBcbiAqICAgICAgICAgICAgICBjb21wb3NpdGU6IFsndXNlcklkJ10sXG4gKiAgICAgICAgICB9LFxuICogICAgICAgICAgc2s6IHtcbiAqICAgICAgICAgICAgICBmaWVsZDogJ3ByaW1hcnlfc2snLFxuICogICAgICAgICAgICAgIGNvbXBvc2l0ZTogW10sXG4gKiAgICAgICAgICB9XG4gKiAgICAgIH0sXG4gKiAgICAgIC8vIC4uLiBvdGhlciBpbmRleGVzXG4gKiAgfSwgICAgICAgIFxuICogfSBhcyBjb25zdCApO1xuICogXG4gKiBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUVudGl0eVNjaGVtYTxcbiAgQSBleHRlbmRzIHN0cmluZyxcbiAgRiBleHRlbmRzIHN0cmluZyxcbiAgQyBleHRlbmRzIHN0cmluZyxcbiAgUyBleHRlbmRzIEVudGl0eVNjaGVtYTxBLCBGLCBDLCBPcHM+LFxuICBPcHMgZXh0ZW5kcyBURGVmYXVsdEVudGl0eU9wZXJhdGlvbnMgPSBURGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4+KHNjaGVtYTogUyk6IFMge1xuICAvLyBBdXRvbWF0aWNhbGx5IGluamVjdCBfYWN0b3IgZmllbGQgaW50byBldmVyeSBzY2hlbWEgZm9yIGF1ZGl0IHRyYWNraW5nXG4gIGNvbnN0IGVuaGFuY2VkU2NoZW1hID0ge1xuICAgIC4uLnNjaGVtYSxcbiAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAuLi5zY2hlbWEuYXR0cmlidXRlcyxcbiAgICAgIF9hY3Rvcjoge1xuICAgICAgICB0eXBlOiAnYW55JyxcbiAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICBoaWRkZW46IHRydWUsICAvLyBIaWRkZW4gZnJvbSBFbGVjdHJvREIgb3BlcmF0aW9uc1xuICAgICAgICByZWFkT25seTogZmFsc2UsXG4gICAgICAgIC8vIFVJIG1ldGFkYXRhIC0gbWFyayBhcyBub3QgdmlzaWJsZSBpbiBhbnkgVUlcbiAgICAgICAgaXNWaXNpYmxlOiBmYWxzZSxcbiAgICAgICAgaXNMaXN0YWJsZTogZmFsc2UsXG4gICAgICAgIGlzQ3JlYXRhYmxlOiBmYWxzZSxcbiAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgIGlzRmlsdGVyYWJsZTogZmFsc2UsXG4gICAgICAgIGlzU2VhcmNoYWJsZTogZmFsc2UsXG4gICAgICAgIGlzU29ydGFibGU6IGZhbHNlLFxuICAgICAgICBuYW1lOiBcIkFjdG9yIENvbnRleHRcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiSW50ZXJuYWwgZmllbGQgc3RvcmluZyBjb21wbGV0ZSBhY3RvciBjb250ZXh0IGZvciBhdWRpdCBwdXJwb3Nlc1wiXG4gICAgICB9XG4gICAgfVxuICB9IGFzIFM7XG5cbiAgcmV0dXJuIGNyZWF0ZVNjaGVtYShlbmhhbmNlZFNjaGVtYSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVFbGVjdHJvREJFbnRpdHk8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ob3B0aW9uczogQ3JlYXRlRWxlY3Ryb0RCRW50aXR5T3B0aW9uczxTPikge1xuICBjb25zdCB7IHNjaGVtYSwgZW50aXR5Q29uZmlndXJhdGlvbnMgfSA9IG9wdGlvbnM7XG5cbiAgY29uc3QgbmV3RWxlY3Ryb0RiRW50aXR5ID0gbmV3IEVudGl0eShcbiAgICBzY2hlbWEsXG4gICAgZW50aXR5Q29uZmlndXJhdGlvbnNcbiAgKTtcblxuICByZXR1cm4ge1xuICAgIG5hbWU6IHNjaGVtYS5tb2RlbC5lbnRpdHksXG4gICAgZW50aXR5OiBuZXdFbGVjdHJvRGJFbnRpdHksXG4gICAgc2NoZW1hOiBzY2hlbWEsXG4gICAgc3ltYm9sOiBTeW1ib2wuZm9yKHNjaGVtYS5tb2RlbC5lbnRpdHkpLFxuICB9XG59XG5cbi8vIEluZmVyIHR5cGVzIHV0aWxzXG5leHBvcnQgdHlwZSBFbnRpdHlUeXBlRnJvbVNjaGVtYTxUU2NoZW1hPiA9IFRTY2hlbWEgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8aW5mZXIgQSwgaW5mZXIgRiwgaW5mZXIgQz5cbiAgPyBFbnRpdHk8QSwgRiwgQywgVFNjaGVtYT5cbiAgOiBuZXZlcjtcblxuZXhwb3J0IHR5cGUgRW50aXR5UmVzcG9uc2VJdGVtVHlwZUZyb21TY2hlbWE8VFNjaGVtYT4gPSBUU2NoZW1hIGV4dGVuZHMgRW50aXR5U2NoZW1hPGluZmVyIEEsIGluZmVyIEYsIGluZmVyIEM+XG4gID8gUmVzcG9uc2VJdGVtPEEsIEYsIEMsIFRTY2hlbWE+XG4gIDogbmV2ZXI7XG5cbi8qKlxuICogVXRpbGl0eSB0eXBlIHRvIGV4dHJhY3QgdGhlIHZhbHVlIHR5cGUgb2YgYSBzcGVjaWZpYyBhdHRyaWJ1dGUgZnJvbSBhbiBlbnRpdHkgc2NoZW1hLlxuICogVXNlZnVsIGZvciB0eXBlLXNhZmUgYXR0cmlidXRlIHZhbHVlIGhhbmRsaW5nLlxuICogXG4gKiBAdGVtcGxhdGUgRSAtIFRoZSBlbnRpdHkgc2NoZW1hXG4gKiBAdGVtcGxhdGUgSyAtIFRoZSBhdHRyaWJ1dGUga2V5XG4gKi9cbmV4cG9ydCB0eXBlIEF0dHJpYnV0ZVZhbHVlVHlwZTxcbiAgRSBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PixcbiAgSyBleHRlbmRzIGtleW9mIEVbJ2F0dHJpYnV0ZXMnXVxuPiA9IEVbJ2F0dHJpYnV0ZXMnXVtLXVsndHlwZSddIGV4dGVuZHMgJ3N0cmluZycgPyBzdHJpbmdcbiAgOiBFWydhdHRyaWJ1dGVzJ11bS11bJ3R5cGUnXSBleHRlbmRzICdudW1iZXInID8gbnVtYmVyXG4gIDogRVsnYXR0cmlidXRlcyddW0tdWyd0eXBlJ10gZXh0ZW5kcyAnYm9vbGVhbicgPyBib29sZWFuXG4gIDogRVsnYXR0cmlidXRlcyddW0tdWyd0eXBlJ10gZXh0ZW5kcyBBcnJheTxpbmZlciBUPiA/IFRcbiAgOiBFWydhdHRyaWJ1dGVzJ11bS11bJ3R5cGUnXSBleHRlbmRzICdhbnknID8gYW55XG4gIDogRVsnYXR0cmlidXRlcyddW0tdWyd0eXBlJ10gZXh0ZW5kcyAnc2V0JyA/IFNldDxzdHJpbmc+XG4gIDogRVsnYXR0cmlidXRlcyddW0tdWyd0eXBlJ10gZXh0ZW5kcyAnbGlzdCcgPyBBcnJheTxhbnk+XG4gIDogRVsnYXR0cmlidXRlcyddW0tdWyd0eXBlJ10gZXh0ZW5kcyAnbWFwJyA/IFJlY29yZDxzdHJpbmcsIGFueT5cbiAgOiBhbnk7XG5cbi8qKlxuICogVXRpbGl0eSB0eXBlIHRvIGV4dHJhY3QgYWxsIGF0dHJpYnV0ZSBuYW1lcyBhbmQgdGhlaXIgdmFsdWUgdHlwZXMgYXMgYSBrZXktdmFsdWUgbWFwLlxuICogXG4gKiBAdGVtcGxhdGUgRSAtIFRoZSBlbnRpdHkgc2NoZW1hXG4gKi9cbmV4cG9ydCB0eXBlIEVudGl0eUF0dHJpYnV0ZVZhbHVlTWFwPEUgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+ID0ge1xuICBbSyBpbiBrZXlvZiBFWydhdHRyaWJ1dGVzJ11dOiBBdHRyaWJ1dGVWYWx1ZVR5cGU8RSwgSz5cbn07XG5cblxuZXhwb3J0IHR5cGUgVXBzZXJ0RW50aXR5SXRlbTxFIGV4dGVuZHMgRW50aXR5PGFueSwgYW55LCBhbnksIGFueT4+ID1cbiAgRSBleHRlbmRzIEVudGl0eTxpbmZlciBBLCBpbmZlciBGLCBpbmZlciBDLCBpbmZlciBTPlxuICA/IFVwc2VydEl0ZW08QSwgRiwgQywgUz5cbiAgOiBuZXZlcjtcblxuZXhwb3J0IHR5cGUgRW50aXR5UmVjb3JkVHlwZUZyb21TY2hlbWE8U2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiA9IEVudGl0eUl0ZW08RW50aXR5VHlwZUZyb21TY2hlbWE8U2NoPj47XG5cbi8vIEVudGl0eSBzZXJ2aWNlXG5leHBvcnQgdHlwZSBFbnRpdHlTZXJ2aWNlVHlwZUZyb21TY2hlbWE8VFNjaGVtYSBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4gPSBCYXNlRW50aXR5U2VydmljZTxUU2NoZW1hPjtcblxuLy8gRW50aXR5IGlkZW50aWZpZXJzXG5leHBvcnQgdHlwZSBFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFRTY2hlbWEgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+ID0gV3JpdGFibGU8RW50aXR5SWRlbnRpZmllcnM8RW50aXR5VHlwZUZyb21TY2hlbWE8VFNjaGVtYT4+PjtcblxuLy8gQ3JlYXRlIGVudGl0eVxuZXhwb3J0IHR5cGUgQ3JlYXRlRW50aXR5SXRlbVR5cGVGcm9tU2NoZW1hPFRTY2hlbWEgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+ID0gV3JpdGFibGU8Q3JlYXRlRW50aXR5SXRlbTxFbnRpdHlUeXBlRnJvbVNjaGVtYTxUU2NoZW1hPj4+O1xuXG4vLyBVcHNlcnQgZW50aXR5XG5leHBvcnQgdHlwZSBVcHNlcnRFbnRpdHlJdGVtVHlwZUZyb21TY2hlbWE8VFNjaGVtYSBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4gPSBXcml0YWJsZTxVcHNlcnRFbnRpdHlJdGVtPEVudGl0eVR5cGVGcm9tU2NoZW1hPFRTY2hlbWE+Pj47XG5cbi8vIFVwZGF0ZSBlbnRpdHlcbmV4cG9ydCB0eXBlIFVwZGF0ZUVudGl0eUl0ZW1UeXBlRnJvbVNjaGVtYTxUU2NoZW1hIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiA9IFdyaXRhYmxlPFVwZGF0ZUVudGl0eUl0ZW08RW50aXR5VHlwZUZyb21TY2hlbWE8VFNjaGVtYT4+PjsiXX0=