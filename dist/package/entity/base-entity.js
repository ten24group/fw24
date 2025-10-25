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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1lbnRpdHkuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZW50aXR5L2Jhc2UtZW50aXR5LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQThNQSxvREFJQztBQWdFRCw4Q0FJQztBQWlGRCxvREFJQztBQW1NRCxzREFPQztBQUdELG9EQU1DO0FBR0Qsa0RBTUM7QUFHRCxrREFNQztBQUdELDBEQU1DO0FBR0Qsc0RBTUM7QUFHRCx3REFNQztBQUdELHNEQU1DO0FBR0QsOERBTUM7QUFpS0QsZ0RBSUM7QUF3TEQsZ0RBZ0NDO0FBRUQsc0RBY0M7QUF6Z0NELHlDQUFpRDtBQW9LakQ7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0F3Q0c7QUFDSCxTQUFnQixvQkFBb0IsQ0FDbEMsT0FBa0M7SUFFbEMsT0FBTyxPQUFPLENBQUM7QUFDakIsQ0FBQztBQUVEOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBNkRHO0FBQ0gsU0FBZ0IsaUJBQWlCLENBQy9CLEtBQXFCO0lBRXJCLE9BQU8sS0FBSyxDQUFDO0FBQ2YsQ0FBQztBQW9DRDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0E0Q0c7QUFDSCxTQUFnQixvQkFBb0IsQ0FDbEMsUUFBMEM7SUFFMUMsT0FBTyxRQUFRLENBQUM7QUFDbEIsQ0FBQztBQWtNRCxxQ0FBcUM7QUFDckMsU0FBZ0IscUJBQXFCLENBQUMsR0FBUTtJQUM1QyxPQUFPLENBQ0wsT0FBTyxHQUFHLEtBQUssUUFBUTtXQUNwQixDQUFDLENBQUMsR0FBRztXQUNMLFNBQVMsSUFBSSxHQUFHO1dBQ2hCLENBQUUsUUFBUSxFQUFFLGNBQWMsRUFBRSxjQUFjLENBQUUsQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUN4RSxDQUFDO0FBQ0osQ0FBQztBQUVELG9DQUFvQztBQUNwQyxTQUFnQixvQkFBb0IsQ0FBQyxHQUFRO0lBQzNDLE9BQU8sQ0FDTCxPQUFPLEdBQUcsS0FBSyxRQUFRO1dBQ3BCLENBQUMsQ0FBQyxHQUFHO1dBQ0wsR0FBRyxDQUFDLFNBQVMsS0FBSyxPQUFPLENBQzdCLENBQUM7QUFDSixDQUFDO0FBRUQsbUNBQW1DO0FBQ25DLFNBQWdCLG1CQUFtQixDQUFDLEdBQVE7SUFDMUMsT0FBTyxDQUNMLE9BQU8sR0FBRyxLQUFLLFFBQVE7V0FDcEIsQ0FBQyxDQUFDLEdBQUc7V0FDTCxHQUFHLENBQUMsU0FBUyxLQUFLLE1BQU0sQ0FDNUIsQ0FBQztBQUNKLENBQUM7QUFFRCxtQ0FBbUM7QUFDbkMsU0FBZ0IsbUJBQW1CLENBQUMsR0FBUTtJQUMxQyxPQUFPLENBQ0wsT0FBTyxHQUFHLEtBQUssUUFBUTtXQUNwQixDQUFDLENBQUMsR0FBRztXQUNMLEdBQUcsQ0FBQyxTQUFTLEtBQUssTUFBTSxDQUM1QixDQUFDO0FBQ0osQ0FBQztBQUVELHVDQUF1QztBQUN2QyxTQUFnQix1QkFBdUIsQ0FBQyxHQUFRO0lBQzlDLE9BQU8sQ0FDTCxPQUFPLEdBQUcsS0FBSyxRQUFRO1dBQ3BCLENBQUMsQ0FBQyxHQUFHO1dBQ0wsR0FBRyxDQUFDLFNBQVMsS0FBSyxVQUFVLENBQ2hDLENBQUM7QUFDSixDQUFDO0FBRUQscUNBQXFDO0FBQ3JDLFNBQWdCLHFCQUFxQixDQUFDLEdBQVE7SUFDNUMsT0FBTyxDQUNMLE9BQU8sR0FBRyxLQUFLLFFBQVE7V0FDcEIsQ0FBQyxDQUFDLEdBQUc7V0FDTCxHQUFHLENBQUMsU0FBUyxLQUFLLFFBQVEsQ0FDOUIsQ0FBQztBQUNKLENBQUM7QUFFRCxzQ0FBc0M7QUFDdEMsU0FBZ0Isc0JBQXNCLENBQUMsR0FBUTtJQUM3QyxPQUFPLENBQ0wsT0FBTyxHQUFHLEtBQUssUUFBUTtXQUNwQixDQUFDLENBQUMsR0FBRztXQUNMLENBQUUsU0FBUyxFQUFFLFFBQVEsRUFBRSxRQUFRLENBQUUsQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUM3RCxDQUFDO0FBQ0osQ0FBQztBQUVELHFDQUFxQztBQUNyQyxTQUFnQixxQkFBcUIsQ0FBQyxHQUFRO0lBQzVDLE9BQU8sQ0FDTCxPQUFPLEdBQUcsS0FBSyxRQUFRO1dBQ3BCLENBQUMsQ0FBQyxHQUFHO1dBQ0wsQ0FBRSxXQUFXLEVBQUUsU0FBUyxDQUFFLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsQ0FDdEQsQ0FBQztBQUNKLENBQUM7QUFFRCx5Q0FBeUM7QUFDekMsU0FBZ0IseUJBQXlCLENBQUMsR0FBUTtJQUNoRCxPQUFPLENBQ0wsT0FBTyxHQUFHLEtBQUssUUFBUTtXQUNwQixDQUFDLENBQUMsR0FBRztXQUNMLENBQUUsTUFBTSxFQUFFLFVBQVUsRUFBRSxNQUFNLENBQUUsQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUMxRCxDQUFDO0FBQ0osQ0FBQztBQWlIRDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0ErQ0c7QUFDSCxTQUFnQixrQkFBa0IsQ0FDaEMsTUFBZ0M7SUFFaEMsT0FBTyxNQUFNLENBQUM7QUFDaEIsQ0FBQztBQUVZLFFBQUEscUJBQXFCLEdBQUc7SUFDbkMsSUFBSSxFQUFFLE1BQU07SUFDWixJQUFJLEVBQUUsTUFBTTtJQUNaLEtBQUssRUFBRSxPQUFPO0lBQ2QsS0FBSyxFQUFFLE9BQU87SUFDZCxXQUFXLEVBQUUsYUFBYTtJQUUxQixTQUFTLEVBQUUsV0FBVztJQUN0QixTQUFTLEVBQUUsV0FBVztJQUN0QixTQUFTLEVBQUUsV0FBVztDQUN2QixDQUFDO0FBK0RGOzs7R0FHRztBQUNVLFFBQUEsdUJBQXVCLEdBQUc7SUFDckMsR0FBRyxFQUFFLEtBQUs7SUFDVixJQUFJLEVBQUUsTUFBTTtJQUNaLEtBQUssRUFBRSxPQUFPO0lBQ2QsTUFBTSxFQUFFLFFBQVE7SUFDaEIsTUFBTSxFQUFFLFFBQVE7SUFDaEIsTUFBTSxFQUFFLFFBQVE7SUFDaEIsTUFBTSxFQUFFLFFBQVE7SUFDaEIsU0FBUyxFQUFFLFdBQVc7Q0FDZCxDQUFDO0FBK0NYOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FnREc7QUFDSCxTQUFnQixrQkFBa0IsQ0FNaEMsTUFBUztJQUNULHlFQUF5RTtJQUN6RSxNQUFNLGNBQWMsR0FBRztRQUNyQixHQUFHLE1BQU07UUFDVCxVQUFVLEVBQUU7WUFDVixHQUFHLE1BQU0sQ0FBQyxVQUFVO1lBQ3BCLE1BQU0sRUFBRTtnQkFDTixJQUFJLEVBQUUsS0FBSztnQkFDWCxRQUFRLEVBQUUsS0FBSztnQkFDZixNQUFNLEVBQUUsSUFBSSxFQUFHLG1DQUFtQztnQkFDbEQsUUFBUSxFQUFFLEtBQUs7Z0JBQ2YsOENBQThDO2dCQUM5QyxTQUFTLEVBQUUsS0FBSztnQkFDaEIsVUFBVSxFQUFFLEtBQUs7Z0JBQ2pCLFdBQVcsRUFBRSxLQUFLO2dCQUNsQixVQUFVLEVBQUUsS0FBSztnQkFDakIsWUFBWSxFQUFFLEtBQUs7Z0JBQ25CLFlBQVksRUFBRSxLQUFLO2dCQUNuQixVQUFVLEVBQUUsS0FBSztnQkFDakIsSUFBSSxFQUFFLGVBQWU7Z0JBQ3JCLFdBQVcsRUFBRSxrRUFBa0U7YUFDaEY7U0FDRjtLQUNHLENBQUM7SUFFUCxPQUFPLElBQUEsd0JBQVksRUFBQyxjQUFjLENBQUMsQ0FBQztBQUN0QyxDQUFDO0FBRUQsU0FBZ0IscUJBQXFCLENBQXdDLE9BQXdDO0lBQ25ILE1BQU0sRUFBRSxNQUFNLEVBQUUsb0JBQW9CLEVBQUUsR0FBRyxPQUFPLENBQUM7SUFFakQsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLGtCQUFNLENBQ25DLE1BQU0sRUFDTixvQkFBb0IsQ0FDckIsQ0FBQztJQUVGLE9BQU87UUFDTCxJQUFJLEVBQUUsTUFBTSxDQUFDLEtBQUssQ0FBQyxNQUFNO1FBQ3pCLE1BQU0sRUFBRSxrQkFBa0I7UUFDMUIsTUFBTSxFQUFFLE1BQU07UUFDZCxNQUFNLEVBQUUsTUFBTSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQztLQUN4QyxDQUFBO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgRW50aXR5Q29uZmlndXJhdGlvbiwgU2NoZW1hLCBFbnRpdHlJZGVudGlmaWVycywgQ3JlYXRlRW50aXR5SXRlbSwgVXBkYXRlRW50aXR5SXRlbSwgRW50aXR5SXRlbSwgQXR0cmlidXRlLCBSZXNwb25zZUl0ZW0sIFVwc2VydEl0ZW0gfSBmcm9tIFwiZWxlY3Ryb2RiXCI7XG5pbXBvcnQgeyBjcmVhdGVTY2hlbWEsIEVudGl0eSB9IGZyb20gXCJlbGVjdHJvZGJcIjtcblxuaW1wb3J0IHR5cGUgeyBFbnRpdHlRdWVyeSB9IGZyb20gJy4vcXVlcnktdHlwZXMnO1xuaW1wb3J0IHR5cGUgeyBCYXNlRW50aXR5U2VydmljZSB9IGZyb20gXCIuL2Jhc2Utc2VydmljZVwiO1xuaW1wb3J0IHR5cGUgeyBPbWl0TmV2ZXIsIFBhdGhzLCBXcml0YWJsZSB9IGZyb20gXCIuLi91dGlscy90eXBlc1wiO1xuaW1wb3J0IHsgU2VhcmNoSW5kZXhDb25maWcgfSBmcm9tICcuLi9zZWFyY2gvdHlwZXMnO1xuaW1wb3J0IHsgRW50aXR5U2VhcmNoU2VydmljZSB9IGZyb20gJy4uL3NlYXJjaC9zZXJ2aWNlcyc7XG5pbXBvcnQgeyBEZXBJZGVudGlmaWVyIH0gZnJvbSBcIi4uL2ludGVyZmFjZXNcIjtcblxuLyoqXG4gKiBAZmlsZW92ZXJ2aWV3IEVudGl0eSBTY2hlbWEgYW5kIFR5cGUtU2FmZSBIZWxwZXIgRnVuY3Rpb25zXG4gKiBcbiAqIFRoaXMgbW9kdWxlIHByb3ZpZGVzIGVzc2VudGlhbCB0eXBlLXNhZmUgaGVscGVycyBmb3IgZGVmaW5pbmcgZW50aXR5IHNjaGVtYXMsXG4gKiByZWxhdGlvbnMsIHF1ZXJpZXMsIGFuZCBjb25maWd1cmF0aW9ucyB3aXRoIGZ1bGwgVHlwZVNjcmlwdCBzdXBwb3J0LlxuICogXG4gKiAjIyBDb3JlIFR5cGUtU2FmZSBIZWxwZXIgRnVuY3Rpb25zXG4gKiBcbiAqICMjIyBFc3NlbnRpYWwgSGVscGVycyAoNCBmdW5jdGlvbnMpXG4gKiBcbiAqIDEuICoqYGNyZWF0ZUVudGl0eVJlbGF0aW9uPEU+KClgKiogLSBEZWZpbmUgZW50aXR5IHJlbGF0aW9ucyB3aXRoIGNpcmN1bGFyIGRlcGVuZGVuY3kgc3VwcG9ydFxuICogICAgLSBEaXJlY3Q6IGBjcmVhdGVFbnRpdHlSZWxhdGlvbjxUZWFtU2NoZW1hPih7IC4uLiB9KWBcbiAqICAgIC0gTGF6eTogYGNyZWF0ZUVudGl0eVJlbGF0aW9uPCgpID0+IFBvc3RTY2hlbWE+KHsgLi4uIH0pYFxuICogXG4gKiAyLiAqKmBjcmVhdGVFbnRpdHlRdWVyeTxFPigpYCoqIC0gQnVpbGQgdHlwZS1zYWZlIHF1ZXJpZXMgd2l0aCBmaWx0ZXJzLCBwYWdpbmF0aW9uLCBhbmQgaHlkcmF0aW9uXG4gKiBcbiAqIDMuICoqYGNyZWF0ZUh5ZHJhdGVPcHRpb25zPEU+KClgKiogLSBTcGVjaWZ5IHdoaWNoIGF0dHJpYnV0ZXMgYW5kIHJlbGF0aW9ucyB0byBsb2FkXG4gKiBcbiAqIDQuICoqYGNyZWF0ZUZpZWxkT3B0aW9uczxFPigpYCoqIC0gQ29uZmlndXJlIEFQSS1sb2FkZWQgb3B0aW9ucyBmb3Igc2VsZWN0L3JhZGlvL2NoZWNrYm94IGZpZWxkc1xuICogXG4gKiAjIyMgQ29yZSBTY2hlbWEgRnVuY3Rpb25zXG4gKiAtIGBjcmVhdGVFbnRpdHlTY2hlbWE8Li4uPigpYCAtIERlZmluZSBlbnRpdHkgc2NoZW1hcyB3aXRoIEVsZWN0cm9EQlxuICogLSBgY3JlYXRlRWxlY3Ryb0RCRW50aXR5PFM+KClgIC0gQ3JlYXRlIEVsZWN0cm9EQiBlbnRpdHkgaW5zdGFuY2VzXG4gKiBcbiAqICMjIFVzYWdlIEV4YW1wbGVzXG4gKiBcbiAqICMjIyBTaW1wbGUgUmVsYXRpb25cbiAqIGBgYHRzXG4gKiB0ZWFtSWQ6IHtcbiAqICAgdHlwZTogJ3N0cmluZycsXG4gKiAgIHJlbGF0aW9uOiBjcmVhdGVFbnRpdHlSZWxhdGlvbjxUZWFtU2NoZW1hPih7XG4gKiAgICAgZW50aXR5TmFtZTogJ3RlYW0nLFxuICogICAgIHR5cGU6ICdtYW55LXRvLW9uZScsXG4gKiAgICAgaWRlbnRpZmllcnM6IHsgc291cmNlOiAndGVhbUlkJywgdGFyZ2V0OiAndGVhbUlkJyB9XG4gKiAgIH0pXG4gKiB9XG4gKiBgYGBcbiAqIFxuICogIyMjIENpcmN1bGFyIERlcGVuZGVuY3kgUmVsYXRpb25cbiAqIGBgYHRzXG4gKiB1c2VySWQ6IHtcbiAqICAgdHlwZTogJ3N0cmluZycsXG4gKiAgIHJlbGF0aW9uOiBjcmVhdGVFbnRpdHlSZWxhdGlvbjwoKSA9PiBVc2VyU2NoZW1hPih7XG4gKiAgICAgZW50aXR5TmFtZTogJ3VzZXInLFxuICogICAgIHR5cGU6ICdtYW55LXRvLW9uZScsXG4gKiAgICAgaWRlbnRpZmllcnM6ICgpID0+ICh7IHNvdXJjZTogJ3VzZXJJZCcsIHRhcmdldDogJ3VzZXJJZCcgfSlcbiAqICAgfSlcbiAqIH1cbiAqIGBgYFxuICogXG4gKiAjIyMgUXVlcnkgd2l0aCBIeWRyYXRpb25cbiAqIGBgYHRzXG4gKiBjb25zdCBxdWVyeSA9IGNyZWF0ZUVudGl0eVF1ZXJ5PEdhbWVTY2hlbWE+KHtcbiAqICAgZmlsdGVyczogeyBzdGF0dXM6IHsgZXE6ICd1cGNvbWluZycgfSB9LFxuICogICBhdHRyaWJ1dGVzOiBjcmVhdGVIeWRyYXRlT3B0aW9uczxHYW1lU2NoZW1hPih7XG4gKiAgICAgZ2FtZUlkOiB0cnVlLFxuICogICAgIGhvbWVUZWFtOiB7IGF0dHJpYnV0ZXM6IHsgdGVhbUlkOiB0cnVlLCB0ZWFtTmFtZTogdHJ1ZSB9IH1cbiAqICAgfSlcbiAqIH0pXG4gKiBgYGBcbiAqIFxuICogIyMjIEZpZWxkIE9wdGlvbnNcbiAqIGBgYHRzXG4gKiAvLyBTdGF0aWMgb3B0aW9ucyAtIHVzZSBhcnJheSBkaXJlY3RseVxuICogb3B0aW9uczogW1xuICogICB7IHZhbHVlOiAnYWN0aXZlJywgbGFiZWw6ICdBY3RpdmUnIH0sXG4gKiAgIHsgdmFsdWU6ICdpbmFjdGl2ZScsIGxhYmVsOiAnSW5hY3RpdmUnIH1cbiAqIF1cbiAqIFxuICogLy8gQVBJLWxvYWRlZCBvcHRpb25zIC0gdXNlIGhlbHBlclxuICogb3B0aW9uczogY3JlYXRlRmllbGRPcHRpb25zPFRlYW1TY2hlbWE+KHtcbiAqICAgYXBpTWV0aG9kOiAnR0VUJyxcbiAqICAgYXBpVXJsOiAnL2FwaS90ZWFtcycsXG4gKiAgIHJlc3BvbnNlS2V5OiAnZGF0YScsXG4gKiAgIG9wdGlvbk1hcHBpbmc6IHsgbGFiZWw6ICd0ZWFtTmFtZScsIHZhbHVlOiAndGVhbUlkJyB9XG4gKiB9KVxuICogYGBgXG4gKiBcbiAqICMjIyBFbnRpdHkgT3BlcmF0aW9uc1xuICogIFxuICogYGBgdHNcbiAqIC8vIEZ1bGwgc2V0IChkZWZhdWx0KSAtIEFsbCBDUlVEIG9wZXJhdGlvbnNcbiAqIGVudGl0eU9wZXJhdGlvbnM6IERlZmF1bHRFbnRpdHlPcGVyYXRpb25zXG4gKlxuICogLy8gU3VwZXJzZXQgLSBBZGQgY3VzdG9tIG9wZXJhdGlvbnMgKGUuZy4sIHB1Ymxpc2gvYXBwcm92ZSB3b3JrZmxvd3MpXG4gKiBjb25zdCBBcnRpY2xlT3BzID0ge1xuICogICAuLi5EZWZhdWx0RW50aXR5T3BlcmF0aW9ucyxcbiAqICAgcHVibGlzaDogJ3B1Ymxpc2gnLFxuICogICB1bnB1Ymxpc2g6ICd1bnB1Ymxpc2gnLFxuICogICBhcmNoaXZlOiAnYXJjaGl2ZSdcbiAqIH0gYXMgY29uc3Q7XG4gKiBlbnRpdHlPcGVyYXRpb25zOiBBcnRpY2xlT3BzXG4gKiBgYGBcbiAqIFxuICogIyMgVHlwZSBVdGlsaXRpZXNcbiAqIFxuICogQWRkaXRpb25hbCB0eXBlIHV0aWxpdGllcyBmb3IgYWR2YW5jZWQgdXNlIGNhc2VzOlxuICogLSBgQXR0cmlidXRlc1RlbXBsYXRlPEU+YCAtIFR5cGUtc2FmZSBhdHRyaWJ1dGUgY29tcG9zaXRpb25cbiAqIC0gYFZpc2libGVBdHRyaWJ1dGVLZXlzPEU+YCAtIEV4dHJhY3QgdmlzaWJsZSBhdHRyaWJ1dGUgbmFtZXNcbiAqIC0gYFdyaXRhYmxlQXR0cmlidXRlS2V5czxFPmAgLSBFeHRyYWN0IHdyaXRhYmxlIGF0dHJpYnV0ZSBuYW1lc1xuICogLSBgQXR0cmlidXRlVmFsdWVUeXBlPEUsIEs+YCAtIEdldCB2YWx1ZSB0eXBlIGZvciBhbiBhdHRyaWJ1dGVcbiAqIC0gYEVudGl0eUF0dHJpYnV0ZVZhbHVlTWFwPEU+YCAtIE1hcCBvZiBhbGwgYXR0cmlidXRlcyB0byB2YWx1ZSB0eXBlc1xuICogXG4gKiAjIyBSZXNvdXJjZXNcbiAqIFxuICogLSBodHRwczovL2dpdGh1Yi5jb20vbmxqbXMvc3NpYS9ibG9iL21haW4vcGFja2FnZXMvZGF0YWJhc2Uvc3RvcmFnZXMvUGxheWVyU3RvcmFnZS50c1xuICogLSBodHRwczovL2dpdGh1Yi5jb20vdHl3YWxjaC9lbGVjdHJvLWRlbW8vYmxvYi9tYWluL25ldGxpZnkvZnVuY3Rpb25zL3NoYXJlL3JhdGVsaW1pdC50c1xuICogLSBodHRwczovL2dpc3QuZ2l0aHViLmNvbS90eXdhbGNoLzgwNDAwODdlMGZjODg2Y2E1Zjc0MmFhOTliNjIzZTFiXG4gKiAtIGh0dHBzOi8vbWVkaXVtLmNvbS9kZXZlbG9waW5nLWtvYW4vbW9kZWxpbmctZ3JhcGgtcmVsYXRpb25zaGlwcy1pbi1keW5hbW9kYi1jMDYxNDE2MTJhNzBcbiAqIC0gaHR0cHM6Ly9naXN0LmdpdGh1Yi5jb20vc2V2ZXJpLzVkMTgxYTNlNzc5ZjQxYTVlNWZjZTFiN2RjZDE3YTg5XG4gKiAtIGh0dHBzOi8vZ2l0aHViLmNvbS9pa3VzaGxpYW5za2kvZmFtaWx5LWNhci1ib29raW5nLWJhY2tlbmQvYmxvYi9tYWluL3NlcnZpY2VzL2NvcmUvYm9va2luZy9ib29raW5nLnJlcG9zaXRvcnkudHNcbiAqL1xuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIG9wdGlvbnMgZm9yIGh5ZHJhdGluZyBhbiBlbnRpdHkuXG4gKiBJdCBjYW4gYmUgYSBzdHJpbmcgcmVwcmVzZW50aW5nIHRoZSBlbnRpdHkgbmFtZSxcbiAqIG9yIGFuIG9iamVjdCB3aXRoIGFkZGl0aW9uYWwgYXR0cmlidXRlcyBhbmQgaHlkcmF0ZSBvcHRpb25zLlxuKi9cbmV4cG9ydCB0eXBlIFJlbGF0aW9uYWxBdHRyaWJ1dGVzPFQgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueSwgYW55Pj4gPSBPbWl0TmV2ZXI8e1xuICBbIEsgaW4ga2V5b2YgVFsgJ2F0dHJpYnV0ZXMnIF0gXTogVFsgJ2F0dHJpYnV0ZXMnIF1bIEsgXVsgJ2hpZGRlbicgXSBleHRlbmRzIHRydWUgPyBuZXZlclxuICA6IFBpY2tSZWxhdGlvbjxULCBLPiBleHRlbmRzIG5ldmVyID8gbmV2ZXJcbiAgOiBQaWNrUmVsYXRpb248VCwgSz47XG59PlxuXG5leHBvcnQgdHlwZSBOb25SZWxhdGlvbmFsQXR0cmlidXRlczxUIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnksIGFueT4+ID0gT21pdE5ldmVyPHtcbiAgWyBLIGluIGtleW9mIFRbICdhdHRyaWJ1dGVzJyBdIF06IFRbICdhdHRyaWJ1dGVzJyBdWyBLIF1bICdoaWRkZW4nIF0gZXh0ZW5kcyB0cnVlID8gbmV2ZXJcbiAgOiBQaWNrUmVsYXRpb248VCwgSz4gZXh0ZW5kcyBuZXZlciA/IFRbICdhdHRyaWJ1dGVzJyBdWyBLIF0gOiBuZXZlclxufT5cblxuZXhwb3J0IHR5cGUgUGlja1JlbGF0aW9uPEUgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueSwgYW55PiwgQSBleHRlbmRzIGtleW9mIEVbICdhdHRyaWJ1dGVzJyBdPiA9XG4gIEVbICdhdHRyaWJ1dGVzJyBdWyBBIF1bICdyZWxhdGlvbicgXSBleHRlbmRzIFJlbGF0aW9uPGluZmVyIFI+ID8gUmVsYXRpb248Uj4gOiBuZXZlcjtcblxuLy8gdXRpbGl0eSB0eXBlIGZvciBwcmVwYXJlIGFsbCB0aGUgcGF0aHMgZm9yIGVudGl0eSBhbmQgaXQncyByZWxhdGlvbnNcbnR5cGUgX0VudGl0eUF0dHJpYnV0ZVBhdGhzPEUgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueSwgYW55Pj4gPVxuICB7IFsgSyBpbiBrZXlvZiBOb25SZWxhdGlvbmFsQXR0cmlidXRlczxFPiBdPzogSyB9XG4gICZcbiAgeyBbIEsgaW4ga2V5b2YgUmVsYXRpb25hbEF0dHJpYnV0ZXM8RT4gXT86IF9FbnRpdHlBdHRyaWJ1dGVQYXRoczxSZWxUb1JlbGF0ZWRFbnRpdHk8UmVsYXRpb25hbEF0dHJpYnV0ZXM8RT5bIEsgXT4+IH1cbi8vIHV0aWxpdHkgdHlwZSBmb3IgcHJlcGFyZSBhbGwgdGhlIHBhdGhzIGZvciBlbnRpdHkgYW5kIGl0J3MgcmVsYXRpb25zXG5leHBvcnQgdHlwZSBFbnRpdHlBdHRyaWJ1dGVQYXRoczxFIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnksIGFueT4+ID0gUGF0aHM8X0VudGl0eUF0dHJpYnV0ZVBhdGhzPEU+PjtcblxuXG5leHBvcnQgdHlwZSBIeWRyYXRlT3B0aW9uc01hcEZvckVudGl0eTxUIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnksIGFueT4+ID1cbiAgeyBbIEsgaW4ga2V5b2YgTm9uUmVsYXRpb25hbEF0dHJpYnV0ZXM8VD4gXT86IGJvb2xlYW47IH1cbiAgJlxuICB7IFsgSyBpbiBrZXlvZiBSZWxhdGlvbmFsQXR0cmlidXRlczxUPiBdPzogYm9vbGVhbiB8IEh5ZHJhdGVPcHRpb25Gb3JSZWxhdGlvbjxSZWxhdGlvbmFsQXR0cmlidXRlczxUPlsgSyBdPiB9O1xuXG5leHBvcnQgdHlwZSBIeWRyYXRlT3B0aW9uRm9yRW50aXR5PEUgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueSwgYW55Pj4gPSBIeWRyYXRlT3B0aW9uc01hcEZvckVudGl0eTxFPiB8IEFycmF5PEVudGl0eUF0dHJpYnV0ZVBhdGhzPEU+PjtcblxuZXhwb3J0IHR5cGUgSHlkcmF0ZU9wdGlvbkZvclJlbGF0aW9uPFJlbCBleHRlbmRzIFJlbGF0aW9uPGFueT4gPSBhbnk+ID0ge1xuICBlbnRpdHlOYW1lPzogUmVsWyAnZW50aXR5TmFtZScgXSxcbiAgcmVsYXRpb25UeXBlPzogUmVsWyAndHlwZScgXSxcbiAgaWRlbnRpZmllcnM/OiBSZWxhdGlvbklkZW50aWZpZXJzPFJlbFRvUmVsYXRlZEVudGl0eTxSZWw+PixcbiAgYXR0cmlidXRlczogSHlkcmF0ZU9wdGlvbkZvckVudGl0eTxSZWxUb1JlbGF0ZWRFbnRpdHk8UmVsPj5cbn1cblxuLyoqXG4gKiBDcmVhdGVzIHR5cGUtc2FmZSBoeWRyYXRlIG9wdGlvbnMgZm9yIGVudGl0eSBxdWVyaWVzLlxuICogVXNlIHRoaXMgdG8gc3BlY2lmeSB3aGljaCBhdHRyaWJ1dGVzIChpbmNsdWRpbmcgcmVsYXRpb25zKSB0byBsb2FkIHdoZW4gcXVlcnlpbmcgZW50aXRpZXMuXG4gKiBcbiAqIEB0ZW1wbGF0ZSBFIC0gVGhlIGVudGl0eSBzY2hlbWEgdHlwZVxuICogQHBhcmFtIG9wdGlvbnMgLSBUaGUgaHlkcmF0ZSBvcHRpb25zIChtYXAgb3IgYXJyYXkgb2YgYXR0cmlidXRlIHBhdGhzKVxuICogQHJldHVybnMgVGhlIHR5cGVkIGh5ZHJhdGUgb3B0aW9uc1xuICogXG4gKiBAZXhhbXBsZVxuICogLy8gVXNpbmcgYXR0cmlidXRlIG1hcFxuICogY3JlYXRlSHlkcmF0ZU9wdGlvbnM8VXNlclNjaGVtYT4oe1xuICogICB1c2VySWQ6IHRydWUsXG4gKiAgIG5hbWU6IHRydWUsXG4gKiAgIGVtYWlsOiB0cnVlLFxuICogICBwb3N0czogdHJ1ZSAvLyBoeWRyYXRlIHJlbGF0aW9uXG4gKiB9KVxuICogXG4gKiBAZXhhbXBsZVxuICogLy8gVXNpbmcgYXJyYXkgb2YgcGF0aHNcbiAqIGNyZWF0ZUh5ZHJhdGVPcHRpb25zPFVzZXJTY2hlbWE+KFtcbiAqICAgJ3VzZXJJZCcsXG4gKiAgICduYW1lJyxcbiAqICAgJ2VtYWlsJyxcbiAqICAgJ3Bvc3RzLnRpdGxlJyxcbiAqICAgJ3Bvc3RzLmNvbnRlbnQnXG4gKiBdKVxuICogXG4gKiBAZXhhbXBsZVxuICogLy8gV2l0aCBuZXN0ZWQgcmVsYXRpb24gaHlkcmF0aW9uXG4gKiBjcmVhdGVIeWRyYXRlT3B0aW9uczxVc2VyU2NoZW1hPih7XG4gKiAgIHVzZXJJZDogdHJ1ZSxcbiAqICAgbmFtZTogdHJ1ZSxcbiAqICAgcG9zdHM6IHtcbiAqICAgICBhdHRyaWJ1dGVzOiB7XG4gKiAgICAgICBwb3N0SWQ6IHRydWUsXG4gKiAgICAgICB0aXRsZTogdHJ1ZSxcbiAqICAgICAgIGNvbW1lbnRzOiB0cnVlXG4gKiAgICAgfVxuICogICB9XG4gKiB9KVxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlSHlkcmF0ZU9wdGlvbnM8RSBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55LCBhbnk+PihcbiAgb3B0aW9uczogSHlkcmF0ZU9wdGlvbkZvckVudGl0eTxFPlxuKTogSHlkcmF0ZU9wdGlvbkZvckVudGl0eTxFPiB7XG4gIHJldHVybiBvcHRpb25zO1xufVxuXG4vKipcbiAqIENyZWF0ZXMgYSB0eXBlLXNhZmUgZW50aXR5IHF1ZXJ5IHdpdGggcHJvcGVyIHR5cGUgaW5mZXJlbmNlIGZvciBhbGwgcXVlcnkgcGFyYW1ldGVycy5cbiAqIEVuc3VyZXMgdGhhdCBmaWx0ZXJzLCBhdHRyaWJ1dGVzLCBhbmQgc2VhcmNoIHBhcmFtZXRlcnMgYXJlIHZhbGlkIGZvciB0aGUgZ2l2ZW4gZW50aXR5IHNjaGVtYS5cbiAqIFxuICogQHRlbXBsYXRlIEUgLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlXG4gKiBAcGFyYW0gcXVlcnkgLSBUaGUgZW50aXR5IHF1ZXJ5IGNvbmZpZ3VyYXRpb25cbiAqIEByZXR1cm5zIFRoZSB0eXBlZCBlbnRpdHkgcXVlcnlcbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIFNpbXBsZSBxdWVyeSB3aXRoIGZpbHRlcnNcbiAqIGNyZWF0ZUVudGl0eVF1ZXJ5PFVzZXJTY2hlbWE+KHtcbiAqICAgZmlsdGVyczoge1xuICogICAgIHN0YXR1czogeyBlcTogJ2FjdGl2ZScgfSxcbiAqICAgICBhZ2U6IHsgZ3RlOiAxOCB9XG4gKiAgIH0sXG4gKiAgIGF0dHJpYnV0ZXM6IFsndXNlcklkJywgJ25hbWUnLCAnZW1haWwnXVxuICogfSlcbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIFF1ZXJ5IHdpdGggcGFnaW5hdGlvbiBhbmQgc2VhcmNoXG4gKiBjcmVhdGVFbnRpdHlRdWVyeTxVc2VyU2NoZW1hPih7XG4gKiAgIHNlYXJjaDogJ2pvaG4nLFxuICogICBzZWFyY2hBdHRyaWJ1dGVzOiBbJ25hbWUnLCAnZW1haWwnXSxcbiAqICAgYXR0cmlidXRlczogY3JlYXRlSHlkcmF0ZU9wdGlvbnM8VXNlclNjaGVtYT4oe1xuICogICAgIHVzZXJJZDogdHJ1ZSxcbiAqICAgICBuYW1lOiB0cnVlLFxuICogICAgIGVtYWlsOiB0cnVlXG4gKiAgIH0pLFxuICogICBwYWdpbmF0aW9uOiB7XG4gKiAgICAgY291bnQ6IDIwLFxuICogICAgIG9yZGVyOiAnYXNjJyxcbiAqICAgICBjdXJzb3I6IG51bGxcbiAqICAgfVxuICogfSlcbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIFF1ZXJ5IHdpdGggcmVsYXRpb24gaHlkcmF0aW9uXG4gKiBjcmVhdGVFbnRpdHlRdWVyeTxHYW1lU2NoZW1hPih7XG4gKiAgIGZpbHRlcnM6IHtcbiAqICAgICBzdGF0dXM6IHsgZXE6ICd1cGNvbWluZycgfVxuICogICB9LFxuICogICBhdHRyaWJ1dGVzOiBjcmVhdGVIeWRyYXRlT3B0aW9uczxHYW1lU2NoZW1hPih7XG4gKiAgICAgZ2FtZUlkOiB0cnVlLFxuICogICAgIGdhbWVEYXRlOiB0cnVlLFxuICogICAgIGhvbWVUZWFtOiB7XG4gKiAgICAgICBhdHRyaWJ1dGVzOiB7XG4gKiAgICAgICAgIHRlYW1JZDogdHJ1ZSxcbiAqICAgICAgICAgdGVhbU5hbWU6IHRydWUsXG4gKiAgICAgICAgIGxvZ286IHRydWVcbiAqICAgICAgIH1cbiAqICAgICB9LFxuICogICAgIGF3YXlUZWFtOiB7XG4gKiAgICAgICBhdHRyaWJ1dGVzOiB7XG4gKiAgICAgICAgIHRlYW1JZDogdHJ1ZSxcbiAqICAgICAgICAgdGVhbU5hbWU6IHRydWUsXG4gKiAgICAgICAgIGxvZ286IHRydWVcbiAqICAgICAgIH1cbiAqICAgICB9XG4gKiAgIH0pLFxuICogICBwYWdpbmF0aW9uOiB7IGNvdW50OiAxMCB9XG4gKiB9KVxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRW50aXR5UXVlcnk8RSBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4oXG4gIHF1ZXJ5OiBFbnRpdHlRdWVyeTxFPlxuKTogRW50aXR5UXVlcnk8RT4ge1xuICByZXR1cm4gcXVlcnk7XG59XG5cblxuXG4vKipcbiAqIFV0aWxpdHkgdHlwZSB0byBleHRyYWN0IG9ubHkgdmlzaWJsZSAobm9uLWhpZGRlbikgYXR0cmlidXRlIGtleXMgZnJvbSBhbiBlbnRpdHkgc2NoZW1hXG4gKi9cbmV4cG9ydCB0eXBlIFZpc2libGVBdHRyaWJ1dGVLZXlzPEUgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueSwgYW55Pj4gPSB7XG4gIFtLIGluIGtleW9mIEVbJ2F0dHJpYnV0ZXMnXV06IEVbJ2F0dHJpYnV0ZXMnXVtLXVsnaGlkZGVuJ10gZXh0ZW5kcyB0cnVlID8gbmV2ZXIgOiBLXG59W2tleW9mIEVbJ2F0dHJpYnV0ZXMnXV07XG5cbi8qKlxuICogVXRpbGl0eSB0eXBlIHRvIGV4dHJhY3Qgb25seSB3cml0YWJsZSAobm9uLXJlYWRvbmx5KSBhdHRyaWJ1dGUga2V5cyBmcm9tIGFuIGVudGl0eSBzY2hlbWFcbiAqL1xuZXhwb3J0IHR5cGUgV3JpdGFibGVBdHRyaWJ1dGVLZXlzPEUgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueSwgYW55Pj4gPSB7XG4gIFtLIGluIGtleW9mIEVbJ2F0dHJpYnV0ZXMnXV06IEVbJ2F0dHJpYnV0ZXMnXVtLXVsncmVhZE9ubHknXSBleHRlbmRzIHRydWUgPyBuZXZlciA6IEtcbn1ba2V5b2YgRVsnYXR0cmlidXRlcyddXTtcblxuLyoqXG4gKiBSZXByZXNlbnRzIGFuIGlkZW50aWZpZXIgbWFwcGluZyBiZXR3ZWVuIHNvdXJjZSBhbmQgdGFyZ2V0IGVudGl0eSBhdHRyaWJ1dGVzLlxuICogVGhlIHRhcmdldCBpcyBjb25zdHJhaW5lZCB0byB2YWxpZCBhdHRyaWJ1dGUga2V5cyBvZiB0aGUgdGFyZ2V0IGVudGl0eS5cbiAqL1xuZXhwb3J0IHR5cGUgUmVsYXRpb25JZGVudGlmaWVyPEUgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueSwgYW55PiA9IGFueT4gPSB7IFxuICBzb3VyY2U6IHN0cmluZywgXG4gIHRhcmdldDoga2V5b2YgRVsgJ2F0dHJpYnV0ZXMnIF0gXG59O1xuXG5leHBvcnQgdHlwZSBSZWxhdGlvbklkZW50aWZpZXJzPEUgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueSwgYW55PiA9IGFueT4gPSBSZWxhdGlvbklkZW50aWZpZXI8RT4gfCBBcnJheTxSZWxhdGlvbklkZW50aWZpZXI8RT4+XG5cbi8qKlxuICogSGVscGVyIHR5cGUgdG8gcmVzb2x2ZSBlbnRpdHkgc2NoZW1hIGZyb20gZWl0aGVyIGRpcmVjdCB0eXBlIG9yIGxhenkgZnVuY3Rpb25cbiAqL1xuZXhwb3J0IHR5cGUgUmVzb2x2ZUVudGl0eVNjaGVtYTxUPiA9IFQgZXh0ZW5kcyAoKSA9PiBpbmZlciBFIFxuICA/IEUgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueSwgYW55PiA/IEUgOiBuZXZlclxuICA6IFQgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueSwgYW55PiA/IFQgOiBuZXZlcjtcblxuLyoqXG4gKiBDcmVhdGVzIGFuIGVudGl0eSByZWxhdGlvbiB3aXRoIGZ1bGwgdHlwZSBzYWZldHkgYW5kIGNpcmN1bGFyIGRlcGVuZGVuY3kgc3VwcG9ydC5cbiAqIFRoaXMgaXMgdGhlIHByaW1hcnkgaGVscGVyIGZvciBkZWZpbmluZyBlbnRpdHkgcmVsYXRpb25zLlxuICogXG4gKiBAdGVtcGxhdGUgVCAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUgKGRpcmVjdCBvciBsYXp5LWxvYWRlZCB2aWEgZnVuY3Rpb24pXG4gKiBAcGFyYW0gcmVsYXRpb24gLSBUaGUgcmVsYXRpb24gY29uZmlndXJhdGlvblxuICogQHJldHVybnMgVGhlIHR5cGVkIHJlbGF0aW9uXG4gKiBcbiAqIEBleGFtcGxlXG4gKiAvLyBTaW1wbGUgcmVsYXRpb24gKG5vIGNpcmN1bGFyIGRlcGVuZGVuY3kpXG4gKiBjcmVhdGVFbnRpdHlSZWxhdGlvbjxUZWFtU2NoZW1hPih7XG4gKiAgIGVudGl0eU5hbWU6ICd0ZWFtJyxcbiAqICAgdHlwZTogJ21hbnktdG8tb25lJyxcbiAqICAgaWRlbnRpZmllcnM6IHsgc291cmNlOiAndGVhbUlkJywgdGFyZ2V0OiAndGVhbUlkJyB9XG4gKiB9KVxuICogXG4gKiBAZXhhbXBsZVxuICogLy8gTXVsdGlwbGUgaWRlbnRpZmllcnNcbiAqIGNyZWF0ZUVudGl0eVJlbGF0aW9uPFRlYW1TY2hlbWE+KHtcbiAqICAgZW50aXR5TmFtZTogJ3RlYW0nLFxuICogICB0eXBlOiAnbWFueS10by1vbmUnLFxuICogICBpZGVudGlmaWVyczogW1xuICogICAgIHsgc291cmNlOiAndGVhbUlkJywgdGFyZ2V0OiAndGVhbUlkJyB9LFxuICogICAgIHsgc291cmNlOiAndGVuYW50SWQnLCB0YXJnZXQ6ICd0ZW5hbnRJZCcgfVxuICogICBdXG4gKiB9KVxuICogXG4gKiBAZXhhbXBsZVxuICogLy8gQ2lyY3VsYXIgZGVwZW5kZW5jeSAtIHVzZSBsYXp5IGxvYWRpbmcgd2l0aCBhcnJvdyBmdW5jdGlvblxuICogY3JlYXRlRW50aXR5UmVsYXRpb248KCkgPT4gUG9zdFNjaGVtYT4oe1xuICogICBlbnRpdHlOYW1lOiAncG9zdCcsXG4gKiAgIHR5cGU6ICdvbmUtdG8tbWFueScsXG4gKiAgIGlkZW50aWZpZXJzOiAoKSA9PiAoeyBzb3VyY2U6ICd1c2VySWQnLCB0YXJnZXQ6ICd1c2VySWQnIH0pXG4gKiB9KVxuICogXG4gKiBAZXhhbXBsZVxuICogLy8gV2l0aCBoeWRyYXRpb24gb3B0aW9uc1xuICogY3JlYXRlRW50aXR5UmVsYXRpb248VGVhbVNjaGVtYT4oe1xuICogICBlbnRpdHlOYW1lOiAndGVhbScsXG4gKiAgIHR5cGU6ICdtYW55LXRvLW9uZScsXG4gKiAgIGlkZW50aWZpZXJzOiB7IHNvdXJjZTogJ3RlYW1JZCcsIHRhcmdldDogJ3RlYW1JZCcgfSxcbiAqICAgaHlkcmF0ZTogdHJ1ZSxcbiAqICAgYXR0cmlidXRlczogeyB0ZWFtSWQ6IHRydWUsIHRlYW1OYW1lOiB0cnVlLCBsb2dvOiB0cnVlIH1cbiAqIH0pXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVFbnRpdHlSZWxhdGlvbjxUIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnksIGFueT4gfCAoKCkgPT4gRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnksIGFueT4pPihcbiAgcmVsYXRpb246IFJlbGF0aW9uPFJlc29sdmVFbnRpdHlTY2hlbWE8VD4+XG4pOiBSZWxhdGlvbjxSZXNvbHZlRW50aXR5U2NoZW1hPFQ+PiB7XG4gIHJldHVybiByZWxhdGlvbjtcbn1cblxuZXhwb3J0IHR5cGUgUmVsVG9SZWxhdGVkRW50aXR5PFJlbD4gPSBSZWwgZXh0ZW5kcyBSZWxhdGlvbjxpbmZlciBFPiA/IEUgOiBuZXZlcjtcbi8qKlxuICogUmVwcmVzZW50cyBhIHJlbGF0aW9uIGJldHdlZW4gZW50aXRpZXMuXG4gKiBTdXBwb3J0cyBsYXp5LWxvYWRlZCBlbnRpdHkgc2NoZW1hcyB0byBhdm9pZCBjaXJjdWxhciBkZXBlbmRlbmN5IGlzc3Vlcy5cbiAqXG4gKiBAdGVtcGxhdGUgRSAtIFRoZSB0eXBlIG9mIHRoZSByZWxhdGVkIGVudGl0eSBzY2hlbWEuXG4gKi9cbmV4cG9ydCB0eXBlIFJlbGF0aW9uPEUgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueSwgYW55PiA9IGFueT4gPSB7XG4gIC8qKlxuICAgKiBSZXByZXNlbnRzIGEgcmVsYXRpb24gYmV0d2VlbiBlbnRpdGllcy5cbiAgICovXG4gIGVudGl0eU5hbWU6IEVbICdtb2RlbCcgXVsgJ2VudGl0eScgXTtcblxuICAvKipcbiAgICogVGhlIHR5cGUgb2YgdGhlIHJlbGF0aW9uLlxuICAgKiBQb3NzaWJsZSB2YWx1ZXM6ICdvbmUtdG8tb25lJywgJ29uZS10by1tYW55JywgJ21hbnktdG8tb25lJywgJ21hbnktdG8tbWFueScuXG4gICAqL1xuICB0eXBlOiAnb25lLXRvLW1hbnknIHwgJ21hbnktdG8tb25lJzsgLy8gJ29uZS10by1vbmUnIHwgJ21hbnktdG8tbWFueSc7XG5cbiAgLyoqXG4gICAqIElkZW50aWZpZXJzIHRvIGxvYWQgdGhlIHJlbGF0ZWQgZW50aXR5LlxuICAgKiBUaGVzZSBhcmUgbWFwcGluZ3MgYmV0d2VlbiBzb3VyY2UgZW50aXR5IGF0dHJpYnV0ZXMgYW5kIHJlbGF0ZWQgZW50aXR5IGF0dHJpYnV0ZXMuXG4gICAqIFRoZSBrZXlzIGZvciBzb3VyY2UgZW50aXRpZXMgY2FuIHN1cHBvcnQgcGF0aHMgbGlrZSAnYXR0MS5uZXN0ZWRLZXkxJy5cbiAgICogVGhlIHZhbHVlcyBjYW4gYmUgYSBzdHJpbmcgcmVwcmVzZW50aW5nIHRoZSByZWxhdGVkIGVudGl0eSBhdHRyaWJ1dGUgb3IgYW4gYXJyYXkgb2Ygc3RyaW5ncy5cbiAgICogQ2FuIGJlIHByb3ZpZGVkIGRpcmVjdGx5IG9yIHZpYSBhIGZ1bmN0aW9uIHRvIGhhbmRsZSBjaXJjdWxhciBkZXBlbmRlbmNpZXMuXG4gICAqL1xuICBpZGVudGlmaWVyczogUmVsYXRpb25JZGVudGlmaWVyczxFPiB8ICgoKSA9PiBSZWxhdGlvbklkZW50aWZpZXJzPEU+KTtcblxuICAvLyBzZXQgdGhpcyB0byB0cnVlIGluIGVudGl0eS1kZWZpbml0aW9uIHRvIGF1dG8taHlkcmF0ZSB0aGlzIHJlbGF0aW9uXG4gIGh5ZHJhdGU/OiBib29sZWFuO1xuXG4gIC8qKlxuICAgKiBBdHRyaWJ1dGVzIHRvIGxvYWQgd2hlbiBoeWRyYXRpbmcgdGhpcyByZWxhdGlvbiBhbmQgT3B0aW9ucyBmb3IgaHlkcmF0aW5nIHRoZSByZWxhdGlvbmFsIGF0dHJpYnV0ZXMgb2YgdGhpcyByZWxhdGlvbi5cbiAgICogQ2FuIGJlIHByb3ZpZGVkIGRpcmVjdGx5IG9yIHZpYSBhIGZ1bmN0aW9uIHRvIGhhbmRsZSBjaXJjdWxhciBkZXBlbmRlbmNpZXMgaW4gY29tcGxleCByZWxhdGlvbiBjaGFpbnMuXG4gICAqL1xuICBhdHRyaWJ1dGVzPzogSHlkcmF0ZU9wdGlvbkZvckVudGl0eTxFPiB8ICgoKSA9PiBIeWRyYXRlT3B0aW9uRm9yRW50aXR5PEU+KTtcbn07XG5cblxuLyoqXG4gKiBSZXByZXNlbnRzIGFuIGVudGl0eSBhdHRyaWJ1dGUuXG4gKi9cbmV4cG9ydCB0eXBlIEVudGl0eUF0dHJpYnV0ZSA9IEF0dHJpYnV0ZSAmIHtcbiAgLyoqXG4gICAqIFRoZSBodW1hbiByZWFkYWJsZSBuYW1lIG9mIHRoZSBhdHRyaWJ1dGUuXG4gICAqL1xuICBuYW1lPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBJbmRpY2F0ZXMgd2hldGhlciB0aGUgYXR0cmlidXRlIGlzIGFuIGlkZW50aWZpZXIuXG4gICAqL1xuICBpc0lkZW50aWZpZXI/OiBib29sZWFuO1xuXG4gIC8qKlxuICAgKiBJbmRpY2F0ZXMgd2hldGhlciB0aGUgYXR0cmlidXRlIGlzIHVuaXF1ZSAoZm9yIHVuaXF1ZSBjb25zdHJhaW50cykuXG4gICAqL1xuICBpc1VuaXF1ZT86IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIERlZmluZXMgYSByZWxhdGlvbiB3aXRoIGFub3RoZXIgZW50aXR5LlxuICAgKiBVc2UgdGhlIHR5cGUtaGVscGVyIGBjcmVhdGVFbnRpdHlSZWxhdGlvbjxFbnRpdHlTY2hlbWE+KClgIGZ1bmN0aW9uIGZvciB0eXBlLXNhZmUgcmVsYXRpb24gY3JlYXRpb24uXG4gICAqIEZvciBjaXJjdWxhciBkZXBlbmRlbmNpZXMsIHVzZSBgY3JlYXRlRW50aXR5UmVsYXRpb248KCkgPT4gRW50aXR5U2NoZW1hPigpYCB3aXRoIGxhenkgbG9hZGluZy5cbiAgICovXG4gIHJlbGF0aW9uPzogUmVsYXRpb248YW55PjtcblxuICAvKipcbiAgICogVmFsaWRhdGlvbnMgZm9yIHRoZSBhdHRyaWJ1dGUuXG4gICAqL1xuICB2YWxpZGF0aW9ucz86IGFueVtdO1xuXG59XG4gICYgRmllbGRNZXRhZGF0YTtcblxuXG5leHBvcnQgdHlwZSBGaWVsZE1ldGFkYXRhID0gVGV4dEZpZWxkTWV0YWRhdGEgfCBOdW1iZXJGaWVsZE1ldGFkYXRhIHwgRGF0ZUZpZWxkTWV0YWRhdGFcbiAgfCBUaW1lRmllbGRNZXRhZGF0YSB8IERhdGVUaW1lRmllbGRNZXRhZGF0YSB8IEJvb2xlYW5GaWVsZE1ldGFkYXRhXG4gIHwgU2VsZWN0RmllbGRNZXRhZGF0YSB8IFJhZGlvRmllbGRNZXRhZGF0YSB8IENoZWNrYm94RmllbGRNZXRhZGF0YVxuICB8IEZpbGVGaWVsZE1ldGFkYXRhIHwgUmFuZ2VGaWVsZE1ldGFkYXRhIHwgQ29sb3JGaWVsZE1ldGFkYXRhXG4gIHwgSW1hZ2VGaWVsZE1ldGFkYXRhIHwgSGlkZGVuRmllbGRNZXRhZGF0YSB8IEN1c3RvbUZpZWxkTWV0YWRhdGFcbiAgfCBSYXRpbmdGaWVsZE1ldGFkYXRhIHwgRWRpdG9yRmllbGRNZXRhZGF0YSB8IENvZGVFZGl0b3JGaWVsZE1ldGFkYXRhO1xuXG4vLyBNZXRhZGF0YSBmb3IgVUlcbmV4cG9ydCBpbnRlcmZhY2UgQmFzZUZpZWxkTWV0YWRhdGEge1xuICBpc1Zpc2libGU/OiBib29sZWFuOyAvLyBpZiB0aGUgZmllbGQgaXMgdmlzaWJsZSBvciBoaWRkZW4gb24gYWxsIGRldGFpbC1wYWdlc1xuICBpc0xpc3RhYmxlPzogYm9vbGVhbjsgLy8gaWYgdGhlIGZpZWxkIGlzIHZpc2libGUgaW4gdGhlIGxpc3Qgdmlld1xuICBpc0NyZWF0YWJsZT86IGJvb2xlYW47IC8vIGlmIHRoZSBmaWVsZCBpcyBjcmVhdGFibGVcbiAgaXNFZGl0YWJsZT86IGJvb2xlYW47IC8vIGlmIHRoZSBmaWVsZCBpcyBlZGl0YWJsZVxuICBpc0ZpbHRlcmFibGU/OiBib29sZWFuOyAvLyBpZiB0aGUgZmllbGQgaXMgZmlsdGVyYWJsZVxuICBpc1NlYXJjaGFibGU/OiBib29sZWFuOyAvLyBpZiB0aGUgZmllbGQgaXMgc2VhcmNoYWJsZVxuICBpc1NvcnRhYmxlPzogYm9vbGVhbjsgLy8gaWYgdGhlIGZpZWxkIGlzIHNvcnRhYmxlXG4gIHBsYWNlaG9sZGVyPzogc3RyaW5nO1xuICBoZWxwVGV4dD86IHN0cmluZztcbiAgdG9vbHRpcD86IHN0cmluZzsgLy8gbWF5YmUgdGhpcyBjYW4gYmUgaW5mZXJyZWQgZnJvbSB0aGUgaGVscFRleHRcbiAgLy8gRmlsdGVyIGNvbmZpZ3VyYXRpb24gb3B0aW9uc1xuICBmaWx0ZXJDb25maWc/OiB7XG4gICAgZGVmYXVsdE9wZXJhdG9yPzogc3RyaW5nOyAvLyBEZWZhdWx0IGZpbHRlciBvcGVyYXRvciAoZS5nLiwgJ2NvbnRhaW5zJywgJ2VxJywgJ2luJylcbiAgICBhdmFpbGFibGVPcGVyYXRvcnM/OiBzdHJpbmdbXTsgLy8gUmVzdHJpY3QgYXZhaWxhYmxlIG9wZXJhdG9ycyBmb3IgdGhpcyBjb2x1bW5cbiAgICBwcmVkZWZpbmVkT3B0aW9ucz86IEFycmF5PHsgbGFiZWw6IHN0cmluZzsgdmFsdWU6IHN0cmluZyB9PjsgLy8gRm9yIGRyb3Bkb3duL3NlbGVjdCBmaWx0ZXJzXG4gICAgZmlsdGVyVHlwZT86ICd0ZXh0JyB8ICdzZWxlY3QnIHwgJ2RhdGV0aW1lJyB8ICdudW1iZXInIHwgJ2Jvb2xlYW4nOyAvLyBGaWx0ZXIgaW5wdXQgdHlwZVxuICB9O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIElQYWdlQWN0aW9uSXRlbSB7XG4gIGxhYmVsOiBzdHJpbmc7XG4gIHVybDogc3RyaW5nO1xuICBpY29uPzogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIElFbnRpdHlQYWdlQWN0aW9uIHtcbiAgbGFiZWw6IHN0cmluZztcbiAgdXJsPzogc3RyaW5nO1xuICBpY29uPzogc3RyaW5nO1xuICB0eXBlPzogJ2J1dHRvbicgfCAnZHJvcGRvd24nO1xuICBpdGVtcz86IElQYWdlQWN0aW9uSXRlbVtdO1xuICBvcGVuSW5Nb2RhbD86IGJvb2xlYW47XG4gIG1vZGFsQ29uZmlnPzoge1xuICAgIG1vZGFsVHlwZTogXCJjb25maXJtXCIgfCBcImxpc3RcIiB8IFwiZm9ybVwiIHwgXCJhY2NvcmRpb25cIiB8IFwiY3VzdG9tXCIgfCBcImRldGFpbHNcIjtcbiAgICBtb2RhbFBhZ2VDb25maWc6IGFueTtcbiAgICBhcGlDb25maWc/OiB7XG4gICAgICBhcGlNZXRob2Q6IHN0cmluZztcbiAgICAgIHJlc3BvbnNlS2V5OiBzdHJpbmc7XG4gICAgICBhcGlVcmw6IHN0cmluZztcbiAgICB9O1xuICAgIHN1Ym1pdFN1Y2Nlc3NSZWRpcmVjdD86IHN0cmluZztcbiAgfTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBJRW50aXR5UGFnZUNvbHVtbiB7XG4gIHNvcnRPcmRlcjogbnVtYmVyO1xuICBmaWVsZHM6IHN0cmluZ1tdO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIElFbnRpdHlQYWdlQ29sdW1uQ29uZmlnIHtcbiAgY29sdW1uczogSUVudGl0eVBhZ2VDb2x1bW5bXTtcbn1cblxuaW50ZXJmYWNlIFRleHRGaWVsZE1ldGFkYXRhIGV4dGVuZHMgQmFzZUZpZWxkTWV0YWRhdGEge1xuICBmaWVsZFR5cGU/OiAndGV4dCcgfCAndGV4dGFyZWEnIHwgJ3Bhc3N3b3JkJyB8ICdlbWFpbCc7XG4gIG1heExlbmd0aD86IG51bWJlcjtcbiAgbWFzaz86IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIE51bWJlckZpZWxkTWV0YWRhdGEgZXh0ZW5kcyBCYXNlRmllbGRNZXRhZGF0YSB7XG4gIGZpZWxkVHlwZT86ICdudW1iZXInO1xuICBtaW4/OiBudW1iZXI7XG4gIG1heD86IG51bWJlcjtcbiAgc3RlcD86IG51bWJlcjtcbn1cblxuaW50ZXJmYWNlIERhdGVGaWVsZE1ldGFkYXRhIGV4dGVuZHMgQmFzZUZpZWxkTWV0YWRhdGEge1xuICBmaWVsZFR5cGU/OiAnZGF0ZSc7XG4gIG1pbkRhdGU/OiBEYXRlO1xuICBtYXhEYXRlPzogRGF0ZTtcbiAgZGF0ZUZvcm1hdD86IHN0cmluZzsgLy8gZm9ybWF0IHRvIGRpc3BsYXkgdGhlIGRhdGVcbn1cblxuXG5pbnRlcmZhY2UgVGltZUZpZWxkTWV0YWRhdGEgZXh0ZW5kcyBCYXNlRmllbGRNZXRhZGF0YSB7XG4gIGZpZWxkVHlwZT86ICd0aW1lJztcbiAgbWluVGltZT86IHN0cmluZzsgLy8gaW4gSEg6bW0gZm9ybWF0XG4gIG1heFRpbWU/OiBzdHJpbmc7IC8vIGluIEhIOm1tIGZvcm1hdFxuICB0aW1lRm9ybWF0Pzogc3RyaW5nOyAvLyBmb3JtYXQgdG8gZGlzcGxheSB0aGUgdGltZVxufVxuXG5pbnRlcmZhY2UgRGF0ZVRpbWVGaWVsZE1ldGFkYXRhIGV4dGVuZHMgQmFzZUZpZWxkTWV0YWRhdGEge1xuICBmaWVsZFR5cGU/OiAnZGF0ZXRpbWUnO1xuICBtaW5EYXRlVGltZT86IERhdGU7XG4gIG1heERhdGVUaW1lPzogRGF0ZTtcbiAgZGF0ZVRpbWVGb3JtYXQ/OiBzdHJpbmc7IC8vIGZvcm1hdCB0byBkaXNwbGF5IHRoZSBkYXRlIGFuZCB0aW1lXG59XG5cbmludGVyZmFjZSBDb2xvckZpZWxkTWV0YWRhdGEgZXh0ZW5kcyBCYXNlRmllbGRNZXRhZGF0YSB7XG4gIGZpZWxkVHlwZT86ICdjb2xvcic7XG4gIGRlZmF1bHRDb2xvcj86IHN0cmluZzsgLy8gZGVmYXVsdCBjb2xvciB2YWx1ZVxufVxuXG5pbnRlcmZhY2UgQm9vbGVhbkZpZWxkTWV0YWRhdGEgZXh0ZW5kcyBCYXNlRmllbGRNZXRhZGF0YSB7XG4gIGZpZWxkVHlwZT86ICdib29sZWFuJyB8ICdzd2l0Y2gnIHwgJ3RvZ2dsZSc7XG4gIHRydWVMYWJlbD86IHN0cmluZzsgLy8gbGFiZWwgZm9yIHRoZSB0cnVlIHZhbHVlXG4gIGZhbHNlTGFiZWw/OiBzdHJpbmc7IC8vIGxhYmVsIGZvciB0aGUgZmFsc2UgdmFsdWVcbn1cblxuZXhwb3J0IGludGVyZmFjZSBTZWxlY3RGaWVsZE1ldGFkYXRhPEUgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4gPSBhbnk+IGV4dGVuZHMgQmFzZUZpZWxkTWV0YWRhdGEge1xuICBmaWVsZFR5cGU/OiAnc2VsZWN0JyB8ICdtdWx0aS1zZWxlY3QnIHwgJ2F1dG9jb21wbGV0ZSc7XG4gIG9wdGlvbnM6IEZpZWxkT3B0aW9uczxFPjtcbiAgbWF4U2VsZWN0aW9ucz86IG51bWJlcjsgLy8gbWF4aW11bSBudW1iZXIgb2Ygc2VsZWN0aW9uc1xuICAvLyB3aGV0aGVyIHRvIGFsbG93IGFkZGluZyBuZXcgb3B0aW9uc1xuICBhZGROZXdPcHRpb24/OiB7XG4gICAgZW50aXR5TmFtZTogc3RyaW5nOyAvLyBlbnRpdHkgbmFtZSB0byBjcmVhdGUgbmV3IG9wdGlvblxuICB9O1xufVxuXG4vLyBUeXBlIGd1YXJkIGZvciBTZWxlY3RGaWVsZE1ldGFkYXRhXG5leHBvcnQgZnVuY3Rpb24gaXNTZWxlY3RGaWVsZE1ldGFkYXRhKG9iajogYW55KTogb2JqIGlzIFNlbGVjdEZpZWxkTWV0YWRhdGEge1xuICByZXR1cm4gKFxuICAgIHR5cGVvZiBvYmogPT09ICdvYmplY3QnXG4gICAgJiYgISFvYmpcbiAgICAmJiAnb3B0aW9ucycgaW4gb2JqXG4gICAgJiYgWyAnc2VsZWN0JywgJ211bHRpLXNlbGVjdCcsICdhdXRvY29tcGxldGUnIF0uaW5jbHVkZXMob2JqLmZpZWxkVHlwZSlcbiAgKTtcbn1cblxuLy8gVHlwZSBndWFyZCBmb3IgSW1hZ2VGaWVsZE1ldGFkYXRhXG5leHBvcnQgZnVuY3Rpb24gaXNJbWFnZUZpZWxkTWV0YWRhdGEob2JqOiBhbnkpOiBvYmogaXMgSW1hZ2VGaWVsZE1ldGFkYXRhIHtcbiAgcmV0dXJuIChcbiAgICB0eXBlb2Ygb2JqID09PSAnb2JqZWN0J1xuICAgICYmICEhb2JqXG4gICAgJiYgb2JqLmZpZWxkVHlwZSA9PT0gJ2ltYWdlJ1xuICApO1xufVxuXG4vLyBUeXBlIGd1YXJkIGZvciBGaWxlRmllbGRNZXRhZGF0YVxuZXhwb3J0IGZ1bmN0aW9uIGlzRmlsZUZpZWxkTWV0YWRhdGEob2JqOiBhbnkpOiBvYmogaXMgRmlsZUZpZWxkTWV0YWRhdGEge1xuICByZXR1cm4gKFxuICAgIHR5cGVvZiBvYmogPT09ICdvYmplY3QnXG4gICAgJiYgISFvYmpcbiAgICAmJiBvYmouZmllbGRUeXBlID09PSAnZmlsZSdcbiAgKTtcbn1cblxuLy8gVHlwZSBndWFyZCBmb3IgRGF0ZUZpZWxkTWV0YWRhdGFcbmV4cG9ydCBmdW5jdGlvbiBpc0RhdGVGaWVsZE1ldGFkYXRhKG9iajogYW55KTogb2JqIGlzIERhdGVGaWVsZE1ldGFkYXRhIHtcbiAgcmV0dXJuIChcbiAgICB0eXBlb2Ygb2JqID09PSAnb2JqZWN0J1xuICAgICYmICEhb2JqXG4gICAgJiYgb2JqLmZpZWxkVHlwZSA9PT0gJ2RhdGUnXG4gICk7XG59XG5cbi8vIFR5cGUgZ3VhcmQgZm9yIERhdGVUaW1lRmllbGRNZXRhZGF0YVxuZXhwb3J0IGZ1bmN0aW9uIGlzRGF0ZVRpbWVGaWVsZE1ldGFkYXRhKG9iajogYW55KTogb2JqIGlzIERhdGVUaW1lRmllbGRNZXRhZGF0YSB7XG4gIHJldHVybiAoXG4gICAgdHlwZW9mIG9iaiA9PT0gJ29iamVjdCdcbiAgICAmJiAhIW9ialxuICAgICYmIG9iai5maWVsZFR5cGUgPT09ICdkYXRldGltZSdcbiAgKTtcbn1cblxuLy8gVHlwZSBndWFyZCBmb3IgTnVtYmVyRmllbGRNZXRhZGF0YVxuZXhwb3J0IGZ1bmN0aW9uIGlzTnVtYmVyRmllbGRNZXRhZGF0YShvYmo6IGFueSk6IG9iaiBpcyBOdW1iZXJGaWVsZE1ldGFkYXRhIHtcbiAgcmV0dXJuIChcbiAgICB0eXBlb2Ygb2JqID09PSAnb2JqZWN0J1xuICAgICYmICEhb2JqXG4gICAgJiYgb2JqLmZpZWxkVHlwZSA9PT0gJ251bWJlcidcbiAgKTtcbn1cblxuLy8gVHlwZSBndWFyZCBmb3IgQm9vbGVhbkZpZWxkTWV0YWRhdGFcbmV4cG9ydCBmdW5jdGlvbiBpc0Jvb2xlYW5GaWVsZE1ldGFkYXRhKG9iajogYW55KTogb2JqIGlzIEJvb2xlYW5GaWVsZE1ldGFkYXRhIHtcbiAgcmV0dXJuIChcbiAgICB0eXBlb2Ygb2JqID09PSAnb2JqZWN0J1xuICAgICYmICEhb2JqXG4gICAgJiYgWyAnYm9vbGVhbicsICdzd2l0Y2gnLCAndG9nZ2xlJyBdLmluY2x1ZGVzKG9iai5maWVsZFR5cGUpXG4gICk7XG59XG5cbi8vIFR5cGUgZ3VhcmQgZm9yIEVkaXRvckZpZWxkTWV0YWRhdGFcbmV4cG9ydCBmdW5jdGlvbiBpc0VkaXRvckZpZWxkTWV0YWRhdGEob2JqOiBhbnkpOiBvYmogaXMgRWRpdG9yRmllbGRNZXRhZGF0YSB7XG4gIHJldHVybiAoXG4gICAgdHlwZW9mIG9iaiA9PT0gJ29iamVjdCdcbiAgICAmJiAhIW9ialxuICAgICYmIFsgJ3JpY2gtdGV4dCcsICd3eXNpd3lnJyBdLmluY2x1ZGVzKG9iai5maWVsZFR5cGUpXG4gICk7XG59XG5cbi8vIFR5cGUgZ3VhcmQgZm9yIENvZGVFZGl0b3JGaWVsZE1ldGFkYXRhXG5leHBvcnQgZnVuY3Rpb24gaXNDb2RlRWRpdG9yRmllbGRNZXRhZGF0YShvYmo6IGFueSk6IG9iaiBpcyBDb2RlRWRpdG9yRmllbGRNZXRhZGF0YSB7XG4gIHJldHVybiAoXG4gICAgdHlwZW9mIG9iaiA9PT0gJ29iamVjdCdcbiAgICAmJiAhIW9ialxuICAgICYmIFsgJ2NvZGUnLCAnbWFya2Rvd24nLCAnanNvbicgXS5pbmNsdWRlcyhvYmouZmllbGRUeXBlKVxuICApO1xufVxuXG5cblxuaW50ZXJmYWNlIFJhZGlvRmllbGRNZXRhZGF0YTxFIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+ID0gYW55PiBleHRlbmRzIEJhc2VGaWVsZE1ldGFkYXRhIHtcbiAgZmllbGRUeXBlPzogJ3JhZGlvJztcbiAgb3B0aW9uczogRmllbGRPcHRpb25zPEU+O1xuICBsYXlvdXQ/OiAnaG9yaXpvbnRhbCcgfCAndmVydGljYWwnOyAvLyBsYXlvdXQgb2YgdGhlIHJhZGlvIGJ1dHRvbnNcbn1cblxuaW50ZXJmYWNlIENoZWNrYm94RmllbGRNZXRhZGF0YTxFIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+ID0gYW55PiBleHRlbmRzIEJhc2VGaWVsZE1ldGFkYXRhIHtcbiAgZmllbGRUeXBlPzogJ2NoZWNrYm94JztcbiAgb3B0aW9uczogRmllbGRPcHRpb25zPEU+O1xuICBsYXlvdXQ/OiAnaG9yaXpvbnRhbCcgfCAndmVydGljYWwnOyAvLyBsYXlvdXQgb2YgdGhlIHJhZGlvIGJ1dHRvbnNcbn1cblxuaW50ZXJmYWNlIENvbW1vbkZpbGVGaWVsZE1ldGFkYXRhIHtcbiAgYWNjZXB0Pzogc3RyaW5nOyAvLyBmaWxlIHR5cGVzIHRvIGFjY2VwdCBlLmcuIFwiaW1hZ2UvKlwiIHwgXCJpbWFnZS9wbmdcIiB8IFwiaW1hZ2UvanBlZ1wiIHwgXCJpbWFnZS9naWZcIiB8IFwiaW1hZ2UvYm1wXCIgfCBcImltYWdlL3dlYnBcIiB8IFwiYXBwbGljYXRpb24vcGRmXCIgfCBcImFwcGxpY2F0aW9uL21zd29yZFwiXG4gIG1heEZpbGVTaXplPzogbnVtYmVyOyAvLyBtYXhpbXVtIGZpbGUgc2l6ZSBpbiBieXRlc1xuICBmaWxlTmFtZVByZWZpeD86IHN0cmluZzsgLy8gcHJlZml4IGZvciB0aGUgZmlsZSBuYW1lIGUuZy4gJ3Byb2ZpbGUtcGljLScgfCAnZG9jdW1lbnRzLycgfCAnbmVzdGVkL3BhdGgvdG8vaW1hZ2VzLydcbiAgZ2V0U2lnbmVkVXBsb2FkVXJsQVBJQ29uZmlnPzogR2V0U2lnbmVkVXBsb2FkVXJsQVBJQ29uZmlnLCAvLyBBUEkgY29uZmlnIHRvIGdldCBzaWduZWQgdXBsb2FkIFVSTFxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEZpbGVGaWVsZE1ldGFkYXRhIGV4dGVuZHMgQmFzZUZpZWxkTWV0YWRhdGEsIENvbW1vbkZpbGVGaWVsZE1ldGFkYXRhIHtcbiAgZmllbGRUeXBlPzogJ2ZpbGUnO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEltYWdlRmllbGRNZXRhZGF0YSBleHRlbmRzIEJhc2VGaWVsZE1ldGFkYXRhLCBDb21tb25GaWxlRmllbGRNZXRhZGF0YSB7XG4gIGZpZWxkVHlwZT86ICdpbWFnZSc7XG4gIGFzcGVjdFJhdGlvPzogc3RyaW5nOyAvLyBkZXNpcmVkIGFzcGVjdCByYXRpbyBmb3IgdGhlIGltYWdlXG4gIHdpdGhJbWFnZUNyb3A/OiBib29sZWFuOyAvLyB3aGV0aGVyIHRvIGFsbG93IGltYWdlIGNyb3BwaW5nIGF0IHRoZSB0aW1lIG9mIHVwbG9hZGluZ1xuICBhY2NlcHQ/OiBcImltYWdlLypcIiB8IFwiaW1hZ2UvcG5nXCIgfCBcImltYWdlL2pwZWdcIiB8IFwiaW1hZ2UvZ2lmXCIgfCBcImltYWdlL2JtcFwiIHwgXCJpbWFnZS93ZWJwXCI7XG59XG5cbmludGVyZmFjZSBSYW5nZUZpZWxkTWV0YWRhdGEgZXh0ZW5kcyBCYXNlRmllbGRNZXRhZGF0YSB7XG4gIGZpZWxkVHlwZT86ICdyYW5nZSc7XG4gIG1pbj86IG51bWJlcjtcbiAgbWF4PzogbnVtYmVyO1xuICBzdGVwPzogbnVtYmVyO1xuICBzaG93VmFsdWU/OiBib29sZWFuOyAvLyB3aGV0aGVyIHRvIHNob3cgdGhlIGN1cnJlbnQgdmFsdWVcbn1cblxuZXhwb3J0IHR5cGUgR2V0U2lnbmVkVXBsb2FkVXJsQVBJQ29uZmlnID0ge1xuICBhcGlVcmw6IHN0cmluZztcbiAgYXBpTWV0aG9kOiAnR0VUJyB8ICdQT1NUJztcbn07XG5cbmludGVyZmFjZSBIaWRkZW5GaWVsZE1ldGFkYXRhIGV4dGVuZHMgQmFzZUZpZWxkTWV0YWRhdGEge1xuICBmaWVsZFR5cGU/OiAnaGlkZGVuJztcbn1cblxuaW50ZXJmYWNlIEN1c3RvbUZpZWxkTWV0YWRhdGEgZXh0ZW5kcyBCYXNlRmllbGRNZXRhZGF0YSB7XG4gIGZpZWxkVHlwZT86ICdjdXN0b20nO1xufVxuXG5pbnRlcmZhY2UgUmF0aW5nRmllbGRNZXRhZGF0YSBleHRlbmRzIEJhc2VGaWVsZE1ldGFkYXRhIHtcbiAgZmllbGRUeXBlPzogJ3JhdGluZyc7XG4gIG1heFJhdGluZz86IG51bWJlcjsgLy8gbWF4aW11bSByYXRpbmcgdmFsdWVcbn1cblxuaW50ZXJmYWNlIEVkaXRvckZpZWxkTWV0YWRhdGEgZXh0ZW5kcyBCYXNlRmllbGRNZXRhZGF0YSwgQ29tbW9uRmlsZUZpZWxkTWV0YWRhdGEge1xuICBmaWVsZFR5cGU/OiAncmljaC10ZXh0JyB8ICd3eXNpd3lnJztcbn1cblxuaW50ZXJmYWNlIENvZGVFZGl0b3JGaWVsZE1ldGFkYXRhIGV4dGVuZHMgQmFzZUZpZWxkTWV0YWRhdGEge1xuICBmaWVsZFR5cGU/OiAnY29kZScgfCAnbWFya2Rvd24nIHwgJ2pzb24nO1xufVxuXG5leHBvcnQgdHlwZSBGaWVsZE9wdGlvbnM8RSBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PiA9IGFueT4gPSBBcnJheTxGaWVsZE9wdGlvbj4gfCBGaWVsZE9wdGlvbnNBUElDb25maWc8RT47XG5cbmV4cG9ydCB0eXBlIEZpZWxkT3B0aW9uID0ge1xuICB2YWx1ZTogc3RyaW5nLFxuICBsYWJlbDogc3RyaW5nLFxufVxuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIHRlbXBsYXRlIGZvciBhdHRyaWJ1dGVzLlxuICogQWxsb3dzIGNvbXBvc2luZyBtdWx0aXBsZSBhdHRyaWJ1dGVzIGludG8gYSBmb3JtYXR0ZWQgc3RyaW5nLlxuICogUHJvdmlkZXMgdHlwZS1zYWZlIGF0dHJpYnV0ZSBuYW1lIHZhbGlkYXRpb24gdmlhIGdlbmVyaWNzLlxuICogXG4gKiBAdGVtcGxhdGUgRSAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGVcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHRzXG4gKiAvLyBEZWZpbmUgZGlyZWN0bHkgaW4gZmllbGQgb3B0aW9ucyBjb25maWdcbiAqIGNvbnN0IHRlbXBsYXRlOiBBdHRyaWJ1dGVzVGVtcGxhdGU8VXNlclNjaGVtYT4gPSB7XG4gKiAgIGNvbXBvc2l0ZTogWydmaXJzdE5hbWUnLCAnbGFzdE5hbWUnXSxcbiAqICAgdGVtcGxhdGU6ICd7Zmlyc3ROYW1lfS1BTkQte2xhc3ROYW1lfSdcbiAqIH1cbiAqIGBgYFxuICovXG5leHBvcnQgdHlwZSBBdHRyaWJ1dGVzVGVtcGxhdGU8RSBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PiA9IGFueT4gPSB7XG4gIGNvbXBvc2l0ZTogQXJyYXk8a2V5b2YgRVsnYXR0cmlidXRlcyddICYgc3RyaW5nPixcbiAgdGVtcGxhdGU6IHN0cmluZyxcbn1cblxuLyoqXG4gKiBDb25maWd1cmF0aW9uIGZvciBsb2FkaW5nIGZpZWxkIG9wdGlvbnMgZnJvbSBhbiBBUEkgZW5kcG9pbnQuXG4gKiBQcm92aWRlcyB0eXBlLXNhZmUgYXR0cmlidXRlIHJlZmVyZW5jZXMgZm9yIHRoZSBnaXZlbiBlbnRpdHkgc2NoZW1hLlxuICogXG4gKiBAdGVtcGxhdGUgRSAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUgZm9yIHR5cGUtc2FmZSBhdHRyaWJ1dGUgcmVmZXJlbmNlc1xuICovXG5leHBvcnQgdHlwZSBGaWVsZE9wdGlvbnNBUElDb25maWc8RSBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4gPSB7XG4gIGFwaU1ldGhvZDogJ0dFVCcgfCAnUE9TVCcsXG4gIGFwaVVybDogc3RyaW5nLFxuICByZXNwb25zZUtleTogc3RyaW5nLFxuICBxdWVyeT86IEVudGl0eVF1ZXJ5PEU+LFxuICBvcHRpb25NYXBwaW5nPzoge1xuICAgIGxhYmVsOiAoa2V5b2YgRVsnYXR0cmlidXRlcyddICYgc3RyaW5nKSB8IEF0dHJpYnV0ZXNUZW1wbGF0ZTxFPixcbiAgICB2YWx1ZTogKGtleW9mIEVbJ2F0dHJpYnV0ZXMnXSAmIHN0cmluZykgfCBBdHRyaWJ1dGVzVGVtcGxhdGU8RT4sXG4gIH0sXG59XG5cbi8qKlxuICogQ3JlYXRlcyB0eXBlLXNhZmUgZmllbGQgb3B0aW9ucyBjb25maWd1cmF0aW9uIGZvciBBUEktbG9hZGVkIHNlbGVjdC9yYWRpby9jaGVja2JveCBvcHRpb25zLlxuICogUHJvdmlkZXMgZnVsbCB0eXBlIHNhZmV0eSBmb3IgYXR0cmlidXRlIHJlZmVyZW5jZXMgaW4gb3B0aW9uIG1hcHBpbmdzIGFuZCBxdWVyeSBmaWx0ZXJzLlxuICogXG4gKiBAdGVtcGxhdGUgRSAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUgZm9yIHRoZSBvcHRpb25zIHNvdXJjZVxuICogQHBhcmFtIGNvbmZpZyAtIFRoZSBmaWVsZCBvcHRpb25zIEFQSSBjb25maWd1cmF0aW9uXG4gKiBAcmV0dXJucyBUaGUgdHlwZWQgZmllbGQgb3B0aW9ucyBBUEkgY29uZmlnXG4gKiBcbiAqIEBleGFtcGxlXG4gKiAvLyBTaW1wbGUgYXR0cmlidXRlIG1hcHBpbmdcbiAqIGNyZWF0ZUZpZWxkT3B0aW9uczxVc2VyU2NoZW1hPih7XG4gKiAgIGFwaU1ldGhvZDogJ0dFVCcsXG4gKiAgIGFwaVVybDogJy9hcGkvdXNlcnMnLFxuICogICByZXNwb25zZUtleTogJ2RhdGEnLFxuICogICBvcHRpb25NYXBwaW5nOiB7XG4gKiAgICAgbGFiZWw6ICduYW1lJyxcbiAqICAgICB2YWx1ZTogJ3VzZXJJZCdcbiAqICAgfVxuICogfSlcbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIFdpdGggcXVlcnkgZmlsdGVyc1xuICogY3JlYXRlRmllbGRPcHRpb25zPFRlYW1TY2hlbWE+KHtcbiAqICAgYXBpTWV0aG9kOiAnR0VUJyxcbiAqICAgYXBpVXJsOiAnL2FwaS90ZWFtcycsXG4gKiAgIHJlc3BvbnNlS2V5OiAndGVhbXMnLFxuICogICBxdWVyeTogeyBmaWx0ZXJzOiB7IHN0YXR1czogeyBlcTogJ2FjdGl2ZScgfSB9IH0sXG4gKiAgIG9wdGlvbk1hcHBpbmc6IHtcbiAqICAgICBsYWJlbDogJ3RlYW1OYW1lJyxcbiAqICAgICB2YWx1ZTogJ3RlYW1JZCdcbiAqICAgfVxuICogfSlcbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIFdpdGggYXR0cmlidXRlIHRlbXBsYXRlIGZvciBjb21wb3NlZCBsYWJlbHNcbiAqIGNyZWF0ZUZpZWxkT3B0aW9uczxUZWFtU2NoZW1hPih7XG4gKiAgIGFwaU1ldGhvZDogJ0dFVCcsXG4gKiAgIGFwaVVybDogJy9hcGkvdGVhbXMnLFxuICogICByZXNwb25zZUtleTogJ3RlYW1zJyxcbiAqICAgb3B0aW9uTWFwcGluZzoge1xuICogICAgIGxhYmVsOiB7XG4gKiAgICAgICBjb21wb3NpdGU6IFsndGVhbU5hbWUnLCAnY2l0eSddLFxuICogICAgICAgdGVtcGxhdGU6ICd7dGVhbU5hbWV9ICh7Y2l0eX0pJ1xuICogICAgIH0sXG4gKiAgICAgdmFsdWU6ICd0ZWFtSWQnXG4gKiAgIH1cbiAqIH0pXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVGaWVsZE9wdGlvbnM8RSBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4oXG4gIGNvbmZpZzogRmllbGRPcHRpb25zQVBJQ29uZmlnPEU+XG4pOiBGaWVsZE9wdGlvbnNBUElDb25maWc8RT4ge1xuICByZXR1cm4gY29uZmlnO1xufVxuXG5leHBvcnQgY29uc3QgU3BlY2lhbEF0dHJpYnV0ZVR5cGVzID0ge1xuICBuYW1lOiAnbmFtZScsXG4gIHNsdWc6ICdzbHVnJyxcbiAgY29sb3I6ICdjb2xvcicsXG4gIGltYWdlOiAnaW1hZ2UnLFxuICBkZXNjcmlwdGlvbjogJ2Rlc2NyaXB0aW9uJyxcblxuICBjcmVhdGVkQXQ6ICdjcmVhdGVkQXQnLFxuICB1cGRhdGVkQXQ6ICd1cGRhdGVkQXQnLFxuICBkZWxldGVkQXQ6ICdkZWxldGVkQXQnXG59O1xuXG5leHBvcnQgdHlwZSBTcGVjaWFsQXR0cmlidXRlVHlwZSA9IGtleW9mIHR5cGVvZiBTcGVjaWFsQXR0cmlidXRlVHlwZXM7XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgc2NoZW1hIGZvciBhbiBlbnRpdHkuXG4gKlxuICogQHRlbXBsYXRlIEEgLSBBdHRyaWJ1dGUgbmFtZXNcbiAqIEB0ZW1wbGF0ZSBGIC0gRmFjZXQgbmFtZXNcbiAqIEB0ZW1wbGF0ZSBDIC0gQ29sbGVjdGlvbiBuYW1lc1xuICogQHRlbXBsYXRlIE9wcCAtIFRoZSB0eXBlIG9mIGVudGl0eSBvcGVyYXRpb25zLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEVudGl0eVNjaGVtYTxcbiAgQSBleHRlbmRzIHN0cmluZyxcbiAgRiBleHRlbmRzIHN0cmluZyxcbiAgQyBleHRlbmRzIHN0cmluZyxcbiAgT3BwIGV4dGVuZHMgVERlZmF1bHRFbnRpdHlPcGVyYXRpb25zID0gVERlZmF1bHRFbnRpdHlPcGVyYXRpb25zXG4+IGV4dGVuZHMgU2NoZW1hPEEsIEYsIEM+IHtcbiAgcmVhZG9ubHkgbW9kZWw6IFNjaGVtYTxBLCBGLCBDPlsgJ21vZGVsJyBdICYge1xuICAgIHJlYWRvbmx5IGVudGl0eU5hbWVQbHVyYWw6IHN0cmluZztcbiAgICByZWFkb25seSBlbnRpdHlPcGVyYXRpb25zOiBPcHA7XG4gICAgcmVhZG9ubHkgZW50aXR5TWVudUljb24/OiBzdHJpbmcsIC8vIGRlZmF1bHQgaXMgJ2FwcFN0b3JlJ1xuICAgIHJlYWRvbmx5IGVudGl0eU5hbWVBdHRyaWJ1dGU/OiBzdHJpbmcsIC8vIGRlZmF1bHQgaXMgJ25hbWUnXG4gICAgcmVhZG9ubHkgZW50aXR5U2x1Z0F0dHJpYnV0ZT86IHN0cmluZywgLy8gZGVmYXVsdCBpcyAnc2x1ZydcbiAgICByZWFkb25seSBlbnRpdHlJbWFnZUF0dHJpYnV0ZT86IHN0cmluZywgLy8gZGVmYXVsdCBpcyAnaW1hZ2UnXG4gICAgcmVhZG9ubHkgZW50aXR5RGVzY3JpcHRpb25BdHRyaWJ1dGU/OiBzdHJpbmcsIC8vIGRlZmF1bHQgaXMgJ2Rlc2NyaXB0aW9uJ1xuXG4gICAgcmVhZG9ubHkgZXhjbHVkZUZyb21BZG1pbk1lbnU/OiBib29sZWFuLCAvLyBkZWZhdWx0IGlzIGZhbHNlXG4gICAgcmVhZG9ubHkgZXhjbHVkZUZyb21BZG1pbkxpc3Q/OiBib29sZWFuLCAvLyBkZWZhdWx0IGlzIGZhbHNlXG4gICAgcmVhZG9ubHkgZXhjbHVkZUZyb21BZG1pbkRldGFpbD86IGJvb2xlYW4sIC8vIGRlZmF1bHQgaXMgZmFsc2VcbiAgICByZWFkb25seSBleGNsdWRlRnJvbUFkbWluQ3JlYXRlPzogYm9vbGVhbiwgLy8gZGVmYXVsdCBpcyBmYWxzZVxuICAgIHJlYWRvbmx5IGV4Y2x1ZGVGcm9tQWRtaW5VcGRhdGU/OiBib29sZWFuLCAvLyBkZWZhdWx0IGlzIGZhbHNlXG4gICAgcmVhZG9ubHkgZXhjbHVkZUZyb21BZG1pbkRlbGV0ZT86IGJvb2xlYW4sIC8vIGRlZmF1bHQgaXMgZmFsc2VcbiAgICByZWFkb25seSBleGNsdWRlRnJvbUFkbWluRHVwbGljYXRlPzogYm9vbGVhbiwgLy8gZGVmYXVsdCBpcyBmYWxzZVxuXG4gICAgcmVhZG9ubHkgQ1JVREFwaVBhdGg/OiBzdHJpbmcsIC8vIGRlZmF1bHQgaXMgJydcblxuICAgIC8vIE1lbnUgY29uZmlndXJhdGlvblxuICAgIHJlYWRvbmx5IG1lbnVHcm91cD86IHN0cmluZzsgLy8gR3JvdXAgdGhpcyBlbnRpdHkgYmVsb25ncyB0byBpbiB0aGUgbWVudVxuICAgIHJlYWRvbmx5IG1lbnVPcmRlcj86IG51bWJlcjsgLy8gT3JkZXIgd2l0aGluIHRoZSBncm91cCAoZGVmYXVsdDogMClcblxuICAgIC8vIFZpZXcgcGFnZSBjb25maWd1cmF0aW9uXG4gICAgcmVhZG9ubHkgdmlld1BhZ2VBY3Rpb25zPzogSUVudGl0eVBhZ2VBY3Rpb25bXSxcbiAgICByZWFkb25seSB2aWV3UGFnZUJyZWFkY3J1bWJzPzogQXJyYXk8eyBsYWJlbDogc3RyaW5nOyB1cmw/OiBzdHJpbmcgfT4sXG4gICAgcmVhZG9ubHkgdmlld1BhZ2VDb2x1bW5zQ29uZmlnPzogSUVudGl0eVBhZ2VDb2x1bW5Db25maWcsXG4gICAgLy8gRWRpdCBwYWdlIGNvbmZpZ3VyYXRpb25cbiAgICByZWFkb25seSBlZGl0UGFnZUFjdGlvbnM/OiBJRW50aXR5UGFnZUFjdGlvbltdLFxuICAgIHJlYWRvbmx5IGVkaXRQYWdlQnJlYWRjcnVtYnM/OiBBcnJheTx7IGxhYmVsOiBzdHJpbmc7IHVybD86IHN0cmluZyB9PixcbiAgICByZWFkb25seSBlZGl0UGFnZUNvbHVtbnNDb25maWc/OiBJRW50aXR5UGFnZUNvbHVtbkNvbmZpZyxcblxuICAgIHJlYWRvbmx5IHNlYXJjaD86IHtcbiAgICAgIGVuYWJsZWQ6IGJvb2xlYW47XG4gICAgICBpbmRleENvbmZpZz86IFNlYXJjaEluZGV4Q29uZmlnO1xuICAgICAgc2VydmljZUNsYXNzPzogRGVwSWRlbnRpZmllcjxFbnRpdHlTZWFyY2hTZXJ2aWNlPGFueT4+IHwgdHlwZW9mIEVudGl0eVNlYXJjaFNlcnZpY2UgfCBFbnRpdHlTZWFyY2hTZXJ2aWNlPGFueT47XG4gICAgICAvLyBEb2N1bWVudCB0cmFuc2Zvcm1hdGlvbiBmb3IgaW5kZXhpbmdcbiAgICAgIGRvY3VtZW50VHJhbnNmb3JtZXI/OiAoZW50aXR5OiBFbnRpdHlSZWNvcmRUeXBlRnJvbVNjaGVtYTxFbnRpdHlTY2hlbWE8QSwgRiwgQz4+KSA9PiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIGFueT4+O1xuICAgIH07XG4gIH07XG4gIHJlYWRvbmx5IGF0dHJpYnV0ZXM6IHtcbiAgICByZWFkb25seSBbIGEgaW4gQSBdOiBFbnRpdHlBdHRyaWJ1dGU7XG4gIH07XG59XG5cbi8qKlxuICogRGVmYXVsdCBlbnRpdHkgb3BlcmF0aW9ucyB0aGF0IGFyZSBjb21tb25seSB1c2VkLlxuICogVXNlIHRoaXMgYXMgYSBiYXNlIG9yIGRlZmluZSB5b3VyIG93biBzdWJzZXQvc3VwZXJzZXQuXG4gKi9cbmV4cG9ydCBjb25zdCBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucyA9IHtcbiAgZ2V0OiBcImdldFwiLFxuICBsaXN0OiBcImxpc3RcIixcbiAgcXVlcnk6IFwicXVlcnlcIixcbiAgY3JlYXRlOiBcImNyZWF0ZVwiLFxuICB1cHNlcnQ6IFwidXBzZXJ0XCIsXG4gIHVwZGF0ZTogXCJ1cGRhdGVcIixcbiAgZGVsZXRlOiBcImRlbGV0ZVwiLFxuICBkdXBsaWNhdGU6IFwiZHVwbGljYXRlXCIsXG59IGFzIGNvbnN0O1xuXG4vKipcbiAqIFR5cGUgZm9yIHRoZSBkZWZhdWx0IGVudGl0eSBvcGVyYXRpb25zLlxuICogVXNlIHRoaXMgd2hlbiB5b3Ugd2FudCBhbGwgc3RhbmRhcmQgQ1JVRCBvcGVyYXRpb25zLlxuICovXG5leHBvcnQgdHlwZSBURGVmYXVsdEVudGl0eU9wZXJhdGlvbnMgPSB0eXBlb2YgRGVmYXVsdEVudGl0eU9wZXJhdGlvbnM7XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgaW5wdXQgc2NoZW1hcyBmb3IgZW50aXR5IG9wZXJhdGlvbnMuXG4gKiBQcm92aWRlcyB0eXBlLXNhZmUgbWFwcGluZyBvZiBvcGVyYXRpb24gbmFtZXMgdG8gdGhlaXIgY29ycmVzcG9uZGluZyBpbnB1dCB0eXBlcy5cbiAqIEV4dGVuZCB0aGlzIHR5cGUgZm9yIGFkZGl0aW9uYWwgb3BlcmF0aW9ucydzIGlucHV0LXNjaGVtYSB0eXBlcy5cbiAqIFxuICogQHRlbXBsYXRlIFNjaCAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUuXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0c1xuICogdHlwZSBVc2VyT3BzSW5wdXRzID0gVEVudGl0eU9wc0lucHV0U2NoZW1hczxVc2VyRW50aXR5U2NoZW1hPjtcbiAqIC8vIHtcbiAqIC8vICAgZ2V0OiBVc2VySWRlbnRpZmllcnMgfCBVc2VySWRlbnRpZmllcnNbXSxcbiAqIC8vICAgY3JlYXRlOiBDcmVhdGVVc2VySXRlbSxcbiAqIC8vICAgdXBkYXRlOiBVcGRhdGVVc2VySXRlbSxcbiAqIC8vICAgLi4uXG4gKiAvLyB9XG4gKiBgYGBcbiAqL1xuZXhwb3J0IHR5cGUgVEVudGl0eU9wc0lucHV0U2NoZW1hczxcbiAgU2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnksIGFueT4sXG4+ID0ge1xuICAgIHJlYWRvbmx5IFsgb3BOYW1lIGluIGtleW9mIFNjaFsgJ21vZGVsJyBdWyAnZW50aXR5T3BlcmF0aW9ucycgXSBdXG4gICAgOiBvcE5hbWUgZXh0ZW5kcyAnZ2V0JyA/IEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8U2NoPiB8IEFycmF5PEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8U2NoPj5cbiAgICA6IG9wTmFtZSBleHRlbmRzICdsaXN0JyA/IG5ldmVyIC8vIGxpc3Qgb3BlcmF0aW9ucyB0eXBpY2FsbHkgZG9uJ3QgdGFrZSBpZGVudGlmaWVycyBhcyBpbnB1dFxuICAgIDogb3BOYW1lIGV4dGVuZHMgJ3F1ZXJ5JyA/IG5ldmVyIC8vIHF1ZXJ5IG9wZXJhdGlvbnMgdXNlIEVudGl0eVF1ZXJ5IHR5cGVcbiAgICA6IG9wTmFtZSBleHRlbmRzICdjcmVhdGUnID8gQ3JlYXRlRW50aXR5SXRlbVR5cGVGcm9tU2NoZW1hPFNjaD5cbiAgICA6IG9wTmFtZSBleHRlbmRzICd1cHNlcnQnID8gVXBzZXJ0RW50aXR5SXRlbVR5cGVGcm9tU2NoZW1hPFNjaD5cbiAgICA6IG9wTmFtZSBleHRlbmRzICd1cGRhdGUnID8gVXBkYXRlRW50aXR5SXRlbVR5cGVGcm9tU2NoZW1hPFNjaD5cbiAgICA6IG9wTmFtZSBleHRlbmRzICdkZWxldGUnID8gRW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTY2g+IHwgQXJyYXk8RW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTY2g+PlxuICAgIDogb3BOYW1lIGV4dGVuZHMgJ2R1cGxpY2F0ZScgPyBFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFNjaD5cbiAgICA6IHt9XG4gIH1cblxuZXhwb3J0IHR5cGUgQ3JlYXRlRWxlY3Ryb0RCRW50aXR5T3B0aW9uczxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiA9IHtcbiAgc2NoZW1hOiBTLFxuICBlbnRpdHlDb25maWd1cmF0aW9uczogRW50aXR5Q29uZmlndXJhdGlvbjtcbn1cblxuXG4vKipcbiAqIFRoaXMgZnVuY3Rpb24gaXMgdXNlZCB0byBkZWZpbmUgYW4gZW50aXR5IHNjaGVtYSBmb3IgRHluYW1vREIgYmFzZWQgZW50aXR5LCBhbmQgaXQgdXNlZCBFbGVjdHJvREIgdW5kZXIgdGhlIGhvb2QuIFxuICogSXQgdGFrZXMgYW4gb2JqZWN0IGFzIGFuIGFyZ3VtZW50IHRoYXQgZGVzY3JpYmVzIHRoZSBtb2RlbCwgYXR0cmlidXRlcywgYW5kIGluZGV4ZXMgb2YgdGhlIGVudGl0eS5cbiAqIHRoZSBnZW5lcmljIHBhcmFtcyBhcmUgb25seSBmb3IgdGhlIHR5cGUgaW5mZXJlbmNlLCBhbmQgdGhleSBhcmUgbm90IHVzZWQgaW4gdGhlIGZ1bmN0aW9uLlxuICogXG4gKiBAcGFyYW0gc2NoZW1hIC0gVGhlIGVudGl0eSBzY2hlbWEgY29uZmlndXJhdGlvbi5cbiAqIFxuICogQGV4YW1wbGVcbiAqIGltcG9ydCB7IGNyZWF0ZUVudGl0eVNjaGVtYSB9IGZyb20gJ0B0ZW4yNEdyb3VwL2Z3MjQnXG4gKiBcbiAqIGNvbnN0IGVudGl0eVNjaGVtYSA9IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gKiAgIC8vIGVudGl0eSBzY2hlbWEgY29uZmlndXJhdGlvblxuICogXG4gKiAgLy8gbWV0YWRhdGEgYWJvdXQgdGhlIGVudGl0eVxuICogIG1vZGVsOiB7XG4gKiAgICAgIHZlcnNpb246ICcxJyxcbiAqICAgICAgZW50aXR5OiAndXNlcicsICAgICAgICAgICAgIC8vIHRoZSBuYW1lIG9mIHRoZSBlbnRpdHlcbiAqICAgICAgZW50aXR5TmFtZVBsdXJhbDogJ1VzZXJzJywgLy8gdXNlZCBieSBhdXRvIGdlbmVyYXRlZCBVSVxuICogICAgICBlbnRpdHlPcGVyYXRpb25zOiBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucywgLy8gdGhlIG9wZXJhdGlvbnMgdGhhdCBjYW4gYmUgcGVyZm9ybWVkIG9uIHRoZSBlbnRpdHlcbiAqICAgICAgc2VydmljZTogJ3VzZXJzJywgLy8gRWxlY3Ryb0RCIHNlcnZpY2UgbmFtZSBbbG9naWNhbCBncm91cCBvZiBlbnRpdGllc11cbiAqICB9LCAgIFxuICogLy8gdGhlIGF0dHJpYnV0ZXMgZm9yIHRoZSBlbnRpdHlcbiAqICBhdHRyaWJ1dGVzOiB7XG4gKiAgICAgdXNlcklkOiB7XG4gKiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICogICAgICByZXF1aXJlZDogdHJ1ZSwgIFxuICogICAgICByZWFkT25seTogdHJ1ZSxcbiAqICAgICAgZGVmYXVsdDogKCkgPT4gcmFuZG9tVVVJRCgpXG4gKiAgICB9LFxuICogICAvLyAuLi4gb3RoZXIgYXR0cmlidXRlc1xuICogIH0sICAgIFxuICogLy8gdGhlIGFjY2VzcyBwYXR0ZXJucyBmb3IgdGhlIGVudGl0eVxuICogIGluZGV4ZXM6IHtcbiAqICAgICAgcHJpbWFyeToge1xuICogICAgICAgICAgcGs6IHtcbiAqICAgICAgICAgICAgICBmaWVsZDogJ3ByaW1hcnlfcGsnLCAgICBcbiAqICAgICAgICAgICAgICBjb21wb3NpdGU6IFsndXNlcklkJ10sXG4gKiAgICAgICAgICB9LFxuICogICAgICAgICAgc2s6IHtcbiAqICAgICAgICAgICAgICBmaWVsZDogJ3ByaW1hcnlfc2snLFxuICogICAgICAgICAgICAgIGNvbXBvc2l0ZTogW10sXG4gKiAgICAgICAgICB9XG4gKiAgICAgIH0sXG4gKiAgICAgIC8vIC4uLiBvdGhlciBpbmRleGVzXG4gKiAgfSwgICAgICAgIFxuICogfSBhcyBjb25zdCApO1xuICogXG4gKiBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUVudGl0eVNjaGVtYTxcbiAgQSBleHRlbmRzIHN0cmluZyxcbiAgRiBleHRlbmRzIHN0cmluZyxcbiAgQyBleHRlbmRzIHN0cmluZyxcbiAgUyBleHRlbmRzIEVudGl0eVNjaGVtYTxBLCBGLCBDLCBPcHM+LFxuICBPcHMgZXh0ZW5kcyBURGVmYXVsdEVudGl0eU9wZXJhdGlvbnMgPSBURGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4+KHNjaGVtYTogUyk6IFMge1xuICAvLyBBdXRvbWF0aWNhbGx5IGluamVjdCBfYWN0b3IgZmllbGQgaW50byBldmVyeSBzY2hlbWEgZm9yIGF1ZGl0IHRyYWNraW5nXG4gIGNvbnN0IGVuaGFuY2VkU2NoZW1hID0ge1xuICAgIC4uLnNjaGVtYSxcbiAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAuLi5zY2hlbWEuYXR0cmlidXRlcyxcbiAgICAgIF9hY3Rvcjoge1xuICAgICAgICB0eXBlOiAnYW55JyxcbiAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICBoaWRkZW46IHRydWUsICAvLyBIaWRkZW4gZnJvbSBFbGVjdHJvREIgb3BlcmF0aW9uc1xuICAgICAgICByZWFkT25seTogZmFsc2UsXG4gICAgICAgIC8vIFVJIG1ldGFkYXRhIC0gbWFyayBhcyBub3QgdmlzaWJsZSBpbiBhbnkgVUlcbiAgICAgICAgaXNWaXNpYmxlOiBmYWxzZSxcbiAgICAgICAgaXNMaXN0YWJsZTogZmFsc2UsXG4gICAgICAgIGlzQ3JlYXRhYmxlOiBmYWxzZSxcbiAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgIGlzRmlsdGVyYWJsZTogZmFsc2UsXG4gICAgICAgIGlzU2VhcmNoYWJsZTogZmFsc2UsXG4gICAgICAgIGlzU29ydGFibGU6IGZhbHNlLFxuICAgICAgICBuYW1lOiBcIkFjdG9yIENvbnRleHRcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiSW50ZXJuYWwgZmllbGQgc3RvcmluZyBjb21wbGV0ZSBhY3RvciBjb250ZXh0IGZvciBhdWRpdCBwdXJwb3Nlc1wiXG4gICAgICB9XG4gICAgfVxuICB9IGFzIFM7XG5cbiAgcmV0dXJuIGNyZWF0ZVNjaGVtYShlbmhhbmNlZFNjaGVtYSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVFbGVjdHJvREJFbnRpdHk8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ob3B0aW9uczogQ3JlYXRlRWxlY3Ryb0RCRW50aXR5T3B0aW9uczxTPikge1xuICBjb25zdCB7IHNjaGVtYSwgZW50aXR5Q29uZmlndXJhdGlvbnMgfSA9IG9wdGlvbnM7XG5cbiAgY29uc3QgbmV3RWxlY3Ryb0RiRW50aXR5ID0gbmV3IEVudGl0eShcbiAgICBzY2hlbWEsXG4gICAgZW50aXR5Q29uZmlndXJhdGlvbnNcbiAgKTtcblxuICByZXR1cm4ge1xuICAgIG5hbWU6IHNjaGVtYS5tb2RlbC5lbnRpdHksXG4gICAgZW50aXR5OiBuZXdFbGVjdHJvRGJFbnRpdHksXG4gICAgc2NoZW1hOiBzY2hlbWEsXG4gICAgc3ltYm9sOiBTeW1ib2wuZm9yKHNjaGVtYS5tb2RlbC5lbnRpdHkpLFxuICB9XG59XG5cbi8vIEluZmVyIHR5cGVzIHV0aWxzXG5leHBvcnQgdHlwZSBFbnRpdHlUeXBlRnJvbVNjaGVtYTxUU2NoZW1hPiA9IFRTY2hlbWEgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8aW5mZXIgQSwgaW5mZXIgRiwgaW5mZXIgQz5cbiAgPyBFbnRpdHk8QSwgRiwgQywgVFNjaGVtYT5cbiAgOiBuZXZlcjtcblxuZXhwb3J0IHR5cGUgRW50aXR5UmVzcG9uc2VJdGVtVHlwZUZyb21TY2hlbWE8VFNjaGVtYT4gPSBUU2NoZW1hIGV4dGVuZHMgRW50aXR5U2NoZW1hPGluZmVyIEEsIGluZmVyIEYsIGluZmVyIEM+XG4gID8gUmVzcG9uc2VJdGVtPEEsIEYsIEMsIFRTY2hlbWE+XG4gIDogbmV2ZXI7XG5cbi8qKlxuICogVXRpbGl0eSB0eXBlIHRvIGV4dHJhY3QgdGhlIHZhbHVlIHR5cGUgb2YgYSBzcGVjaWZpYyBhdHRyaWJ1dGUgZnJvbSBhbiBlbnRpdHkgc2NoZW1hLlxuICogVXNlZnVsIGZvciB0eXBlLXNhZmUgYXR0cmlidXRlIHZhbHVlIGhhbmRsaW5nLlxuICogXG4gKiBAdGVtcGxhdGUgRSAtIFRoZSBlbnRpdHkgc2NoZW1hXG4gKiBAdGVtcGxhdGUgSyAtIFRoZSBhdHRyaWJ1dGUga2V5XG4gKi9cbmV4cG9ydCB0eXBlIEF0dHJpYnV0ZVZhbHVlVHlwZTxcbiAgRSBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PixcbiAgSyBleHRlbmRzIGtleW9mIEVbJ2F0dHJpYnV0ZXMnXVxuPiA9IEVbJ2F0dHJpYnV0ZXMnXVtLXVsndHlwZSddIGV4dGVuZHMgJ3N0cmluZycgPyBzdHJpbmdcbiAgOiBFWydhdHRyaWJ1dGVzJ11bS11bJ3R5cGUnXSBleHRlbmRzICdudW1iZXInID8gbnVtYmVyXG4gIDogRVsnYXR0cmlidXRlcyddW0tdWyd0eXBlJ10gZXh0ZW5kcyAnYm9vbGVhbicgPyBib29sZWFuXG4gIDogRVsnYXR0cmlidXRlcyddW0tdWyd0eXBlJ10gZXh0ZW5kcyBBcnJheTxpbmZlciBUPiA/IFRcbiAgOiBFWydhdHRyaWJ1dGVzJ11bS11bJ3R5cGUnXSBleHRlbmRzICdhbnknID8gYW55XG4gIDogRVsnYXR0cmlidXRlcyddW0tdWyd0eXBlJ10gZXh0ZW5kcyAnc2V0JyA/IFNldDxzdHJpbmc+XG4gIDogRVsnYXR0cmlidXRlcyddW0tdWyd0eXBlJ10gZXh0ZW5kcyAnbGlzdCcgPyBBcnJheTxhbnk+XG4gIDogRVsnYXR0cmlidXRlcyddW0tdWyd0eXBlJ10gZXh0ZW5kcyAnbWFwJyA/IFJlY29yZDxzdHJpbmcsIGFueT5cbiAgOiBhbnk7XG5cbi8qKlxuICogVXRpbGl0eSB0eXBlIHRvIGV4dHJhY3QgYWxsIGF0dHJpYnV0ZSBuYW1lcyBhbmQgdGhlaXIgdmFsdWUgdHlwZXMgYXMgYSBrZXktdmFsdWUgbWFwLlxuICogXG4gKiBAdGVtcGxhdGUgRSAtIFRoZSBlbnRpdHkgc2NoZW1hXG4gKi9cbmV4cG9ydCB0eXBlIEVudGl0eUF0dHJpYnV0ZVZhbHVlTWFwPEUgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+ID0ge1xuICBbSyBpbiBrZXlvZiBFWydhdHRyaWJ1dGVzJ11dOiBBdHRyaWJ1dGVWYWx1ZVR5cGU8RSwgSz5cbn07XG5cblxuZXhwb3J0IHR5cGUgVXBzZXJ0RW50aXR5SXRlbTxFIGV4dGVuZHMgRW50aXR5PGFueSwgYW55LCBhbnksIGFueT4+ID1cbiAgRSBleHRlbmRzIEVudGl0eTxpbmZlciBBLCBpbmZlciBGLCBpbmZlciBDLCBpbmZlciBTPlxuICA/IFVwc2VydEl0ZW08QSwgRiwgQywgUz5cbiAgOiBuZXZlcjtcblxuZXhwb3J0IHR5cGUgRW50aXR5UmVjb3JkVHlwZUZyb21TY2hlbWE8U2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiA9IEVudGl0eUl0ZW08RW50aXR5VHlwZUZyb21TY2hlbWE8U2NoPj47XG5cbi8vIEVudGl0eSBzZXJ2aWNlXG5leHBvcnQgdHlwZSBFbnRpdHlTZXJ2aWNlVHlwZUZyb21TY2hlbWE8VFNjaGVtYSBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4gPSBCYXNlRW50aXR5U2VydmljZTxUU2NoZW1hPjtcblxuLy8gRW50aXR5IGlkZW50aWZpZXJzXG5leHBvcnQgdHlwZSBFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFRTY2hlbWEgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+ID0gV3JpdGFibGU8RW50aXR5SWRlbnRpZmllcnM8RW50aXR5VHlwZUZyb21TY2hlbWE8VFNjaGVtYT4+PjtcblxuLy8gQ3JlYXRlIGVudGl0eVxuZXhwb3J0IHR5cGUgQ3JlYXRlRW50aXR5SXRlbVR5cGVGcm9tU2NoZW1hPFRTY2hlbWEgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+ID0gV3JpdGFibGU8Q3JlYXRlRW50aXR5SXRlbTxFbnRpdHlUeXBlRnJvbVNjaGVtYTxUU2NoZW1hPj4+O1xuXG4vLyBVcHNlcnQgZW50aXR5XG5leHBvcnQgdHlwZSBVcHNlcnRFbnRpdHlJdGVtVHlwZUZyb21TY2hlbWE8VFNjaGVtYSBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4gPSBXcml0YWJsZTxVcHNlcnRFbnRpdHlJdGVtPEVudGl0eVR5cGVGcm9tU2NoZW1hPFRTY2hlbWE+Pj47XG5cbi8vIFVwZGF0ZSBlbnRpdHlcbmV4cG9ydCB0eXBlIFVwZGF0ZUVudGl0eUl0ZW1UeXBlRnJvbVNjaGVtYTxUU2NoZW1hIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiA9IFdyaXRhYmxlPFVwZGF0ZUVudGl0eUl0ZW08RW50aXR5VHlwZUZyb21TY2hlbWE8VFNjaGVtYT4+PjsiXX0=