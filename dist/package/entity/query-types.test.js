"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const crypto_1 = require("crypto");
const base_entity_1 = require("./base-entity");
const query_1 = require("./query");
const di_1 = require("../di");
const const_1 = require("../const");
const decorators_1 = require("../decorators");
var User;
(function (User) {
    User.createUserSchema = () => (0, base_entity_1.createEntitySchema)({
        model: {
            version: '1',
            entity: 'user',
            entityNamePlural: 'Users',
            entityOperations: base_entity_1.DefaultEntityOperations,
            service: 'users', // electro DB service name [logical group of entities]
        },
        attributes: {
            userId: {
                type: 'string',
                required: true,
                readOnly: true,
                default: () => (0, crypto_1.randomUUID)()
            },
            tenantId: {
                type: 'string',
                required: true,
                readOnly: true,
                default: () => 'xxx-yyy-zzz',
            },
            firstName: {
                type: 'string',
                required: true,
            },
            lastName: {
                type: 'string',
            },
            email: {
                type: 'string',
                required: true,
            },
            password: {
                type: 'string',
                hidden: true,
                required: true,
            },
            createdAt: {
                // will be set once at the time of create
                type: "string",
                readOnly: true,
                required: true,
                default: () => Date.now().toString(),
                set: () => Date.now().toString(),
            },
            updatedAt: {
                type: "string",
                watch: "*", // will be set every time any prop is updated
                required: true,
                readOnly: true,
                default: () => Date.now().toString(),
                set: () => Date.now().toString(),
            },
            deletedAt: {
                type: "string",
                readOnly: false
            },
        },
        indexes: {
            primary: {
                pk: {
                    field: 'pk',
                    template: "t_${tenantId}#u_${userId}",
                    composite: ['tenantId', 'userId'],
                },
                sk: {
                    field: 'sk',
                    composite: [],
                },
            },
            byEmail: {
                index: 'gsi1',
                pk: {
                    field: 'gsi1pk',
                    template: "t_${tenantId}#u_${email}",
                    composite: ['tenantId', 'email'],
                },
                sk: {
                    field: 'gsi1sk',
                    composite: [],
                },
            },
        },
    });
    User.schema = User.createUserSchema();
    User.entity = (0, base_entity_1.createElectroDBEntity)({
        schema: User.schema, entityConfigurations: {
            table: 'xxxx'
        }
    });
    // @Service({forEntity: schema.model.entity})
    // class UserService extends BaseEntityService<User.TUserSchema> {
    //   constructor(){
    //     super(User.schema, null as any, DIContainer.ROOT);
    //   }
    // }
    User.createUserSchema2 = () => (0, base_entity_1.createEntitySchema)({
        model: {
            version: '2',
            entity: 'user2',
            entityNamePlural: 'Users2',
            entityOperations: {
                get: "get",
                list: "list",
                create: "create",
                update: "update",
                upsert: "upsert",
                delete: "delete",
                query: "query",
                duplicate: "duplicate",
                xxx: "xxx",
                yyy: "yyy"
            },
            service: 'users', // electro DB service name [logical group of entities]
        },
        attributes: {
            userId: {
                type: 'string',
                required: true,
                readOnly: true,
                default: () => (0, crypto_1.randomUUID)()
            },
            tenant: {
                type: 'string',
                required: true,
                readOnly: true,
                default: () => 'xxx-yyy-zzz', // TODO: have some global logic drive this value
                relation: (0, base_entity_1.createEntityRelation)({
                    entityName: 'user',
                    type: 'many-to-one',
                    attributes: ['userId', 'updatedAt', 'createdAt'],
                    identifiers: [{
                            source: 'tenantId',
                            target: 'userId'
                        }],
                })
            },
            firstName: {
                type: 'string',
                required: true,
            },
            lastName: {
                type: 'string',
            },
            status: {
                type: 'string',
            },
            parentId: {
                type: 'string',
            },
            email: {
                type: 'string',
                required: true,
            },
            password: {
                type: 'string',
                hidden: true,
                required: true,
            },
            createdAt: {
                // will be set once at the time of create
                type: "string",
                readOnly: true,
                required: true,
                default: () => Date.now().toString(),
                set: () => Date.now().toString(),
            },
            updatedAt: {
                type: "string",
                watch: "*", // will be set every time any prop is updated
                required: true,
                readOnly: true,
                default: () => Date.now().toString(),
                set: () => Date.now().toString(),
            },
            deletedAt: {
                type: "string",
                readOnly: false
            },
        },
        indexes: {
            primary: {
                pk: {
                    field: 'pk',
                    template: "t_${tenantId}#u_${userId}",
                    composite: ['tenantId', 'userId'],
                },
                sk: {
                    field: 'sk',
                    composite: [],
                },
            },
            byEmail: {
                index: 'gsi1',
                pk: {
                    field: 'gsi1pk',
                    template: "t_${tenantId}#u_${email}",
                    composite: ['tenantId', 'email'],
                },
                sk: {
                    field: 'gsi1sk',
                    composite: [],
                },
            },
        },
    });
    User.userSch2 = User.createUserSchema2();
    User.createGroupSchema = () => (0, base_entity_1.createEntitySchema)({
        model: {
            version: '1',
            entity: 'group',
            entityNamePlural: 'Groups',
            entityOperations: base_entity_1.DefaultEntityOperations,
            service: 'users', // electro DB service name [logical group of entities]
        },
        attributes: {
            groupId: {
                type: 'string',
                required: true,
                readOnly: true,
                default: () => (0, crypto_1.randomUUID)()
            },
            admin: {
                type: 'string',
                required: true,
                readOnly: true,
                default: () => 'xxx-yyy-zzz', // TODO: have some global logic drive this value
                relation: (0, base_entity_1.createEntityRelation)({
                    entityName: 'user2',
                    type: 'many-to-one',
                    identifiers: [{
                            source: 'admin',
                            target: 'userId'
                        }],
                }),
                fieldType: 'select',
                options: {
                    apiMethod: 'GET',
                    apiUrl: '/entity/user2',
                    responseKey: 'items'
                }
            },
            name: {
                type: 'string',
                required: true,
            },
            createdAt: {
                // will be set once at the time of create
                type: "string",
                readOnly: true,
                required: true,
                default: () => Date.now().toString(),
                set: () => Date.now().toString(),
            },
            updatedAt: {
                type: "string",
                watch: "*", // will be set every time any prop is updated
                required: true,
                readOnly: true,
                default: () => Date.now().toString(),
                set: () => Date.now().toString(),
            }
        },
        indexes: {
            primary: {
                pk: {
                    field: 'pk',
                    template: "t_${tenantId}#u_${userId}",
                    composite: ['tenantId', 'userId'],
                },
                sk: {
                    field: 'sk',
                    composite: [],
                },
            }
        },
    });
    User.groupSch = User.createGroupSchema();
    // @Service({forEntity: groupSch.model.entity})
    // class GroupService extends BaseEntityService<User.TGroupSchema> {
    //   constructor(){
    //     super(User.groupSch, null as any, DIContainer.ROOT);
    //   }
    // }
    function createEntityAttribute(att) {
        return att;
    }
    User.createEntityAttribute = createEntityAttribute;
    function createEntityModelMeta(model) {
        return model;
    }
    User.createEntityModelMeta = createEntityModelMeta;
    function createEntityAccessPattern(idx) {
        return idx;
    }
    User.createEntityAccessPattern = createEntityAccessPattern;
    class BaseEntity {
        getModel() {
            return createEntityModelMeta({
                entity: this.constructor.name,
                version: '1',
                service: `${this.constructor.name}Service`,
                entityNamePlural: 'Tests', // pluralize `this.constructor.name` use `https://github.com/plurals/pluralize`
                entityOperations: base_entity_1.DefaultEntityOperations,
            });
        }
        getAttributes() {
            return {
                createdAt: createEntityAttribute({
                    type: 'string',
                    required: true,
                    set: () => new Date().toISOString(),
                }),
                updatedAt: createEntityAttribute({
                    type: 'string',
                    required: true,
                    readOnly: true,
                    set: () => new Date().toISOString()
                })
            };
        }
        getAccessPatterns() {
            return {};
        }
        getSchema() {
            return (0, base_entity_1.createEntitySchema)({
                model: this.getModel(),
                attributes: this.getAttributes(),
                indexes: this.getAccessPatterns(),
            });
        }
    }
    User.BaseEntity = BaseEntity;
    class TestEntity extends BaseEntity {
        attributes = {
            id: createEntityAttribute({
                type: 'string',
                readOnly: true,
                isIdentifier: true
            }),
            firstName: createEntityAttribute({
                type: 'string',
                required: true,
            }),
            lastName: createEntityAttribute({
                type: 'string'
            })
        };
        indexes = {
            default: createEntityAccessPattern({
                pk: {
                    field: 'pk',
                    composite: ['id'],
                },
                sk: {
                    field: 'sk',
                    composite: [],
                }
            }),
        };
        getAttributes() {
            return {
                ...super.getAttributes(),
                ...this.attributes
            };
        }
        getAccessPatterns() {
            return {
                ...super.getAccessPatterns(),
                ...this.indexes
            };
        }
        test() {
            const sch = this.getSchema().attributes;
        }
    }
    User.TestEntity = TestEntity;
})(User || (User = {}));
const testFilter = {
    or: [{
            attribute: 'lastName',
            eq: 'someName',
            between: {
                val: ['122', '126'],
                filterLabel: "Between xxx and yyyy"
            },
        },
        {
            and: [{
                    attribute: 'createdAt',
                    bt: { from: 1, to: 2 },
                    gt: `now()`
                },
                {
                    attribute: 'lastName',
                    contains: 'Nit',
                }]
        }]
};
/*
  Filter expression for electro DB
  `(
      (
        (
          #email = :email0
          OR
          contains(#email, :email1)
          OR
          begins_with(#email, :email2)
        )
        AND
        (#createdAt between :createdAt0 and :createdAt1)
      )
      AND
      (#deletedAt between :deletedAt0 and :deletedAt1)
    )`
*/
const userFilters = {
    and: [
        {
            attribute: 'email',
            logicalOp: 'or',
            eq: 'nitin@123.com',
            contains: '123.',
            startsWith: 'nit',
        },
        {
            attribute: 'createdAt',
            between: {
                val: ['122', '126'],
                valLabel: "Between xxx and yyyy"
            }
        },
    ],
    or: [{
            createdAt: {
                between: {
                    val: ['YESTERDAY', '$now()'],
                    valType: 'expression',
                },
                logicalOp: 'or',
                gte: "12343",
            },
            updatedAt: {
                between: ['YESTERDAY', '$now()']
            },
            logicalOp: 'and',
        },
        {
            not: [
                {
                    attribute: "firstName",
                    eq: '123',
                }
            ]
        }]
};
const userFilters2 = {
    and: [
        {
            logicalOp: 'and',
            email: {
                logicalOp: 'or',
                eq: 'test@123.com',
                notContains: ['gmail.com', '.uk', '--']
            },
            firstName: {
                contains: ['smith', 'johnson']
            },
        },
        {
            createdAt: {
                between: {
                    val: ['122', '126'],
                    valLabel: "Between xxx and yyyy"
                }
            }
        },
    ]
};
const userFilters3 = {
    and: [{
            logicalOp: 'and',
            email: {
                logicalOp: 'or',
                eq: 'test@123.com',
                notContains: ['gmail.com', '.uk', '--']
            },
            firstName: {
                contains: ['smith', 'johnson']
            }
        }, {
            or: [
                {
                    firstName: {
                        "<": '1212',
                    },
                    logicalOp: 'not',
                    email: {
                        inList: ["sds", "ee"]
                    },
                },
            ]
        }]
};
const usersQuery = {
    attributes: ['email', 'firstName', 'lastName'],
    filters: userFilters,
    pagination: {
        limit: 10,
        count: 20,
        cursor: undefined,
    }
};
const usersQuery2 = {
    attributes: ['email', 'firstName', 'lastName'],
    filters: userFilters,
    pagination: {
        count: 20,
    }
};
const groupsQuery = {
    attributes: {
        'name': true,
        'groupId': true,
        'admin': {
            relationType: 'many-to-one',
            entityName: 'user2',
            attributes: [
                'firstName',
                'lastName',
                'tenant',
            ]
        }
    },
    pagination: {
        count: 20,
    }
};
const groupsQuery2 = {
    attributes: {
        'name': true,
        'groupId': true,
        'admin': {
            relationType: 'many-to-one',
            entityName: 'user2',
            attributes: {
                'firstName': true,
                'lastName': true,
                'tenant': {
                    entityName: 'user',
                    relationType: 'many-to-one',
                    attributes: ['firstName', 'lastName']
                }
            }
        }
    },
    pagination: {
        count: 20,
    }
};
const groupsQuery3 = {
    attributes: ['name', 'groupId', 'admin', 'admin.firstName', 'admin.lastName', 'admin.tenant.firstName', 'admin.tenant.lastName'],
    pagination: {
        count: 20,
    },
    filters: {
        name: {
            eq: 'test',
            "!=": 'test2',
            "inList": ['test3', 'test4'],
            logicalOp: 'not',
        },
        admin: {
            eq: '123'
        }
    }
    // {
    //   or: [
    //     {
    //       attribute: 'admin',
    //       eq: '123'
    //     },
    //     {
    //       attribute: 'name',
    //       eq: 'test'
    //     }
    //   ]
    // }
};
(0, globals_1.describe)('query', () => {
    (0, globals_1.it)('should return query object', () => {
        (0, globals_1.expect)(1 === 1).toEqual(true);
        const qq2 = {
            "pagination": {
                "limit": 40
            },
            "filters": {
                "or": [
                    {
                        "and": [
                            {
                                "attribute": "lastName",
                                "eq": "Author Name 002",
                            },
                            {
                                "attribute": "firstName",
                                "neq": "Book Name 000"
                            }
                        ],
                    },
                    {
                        "attribute": "firstName",
                        "inList": ["Book Name 005"]
                    }
                ]
            }
        };
        let exp;
        const res = User.entity.entity.match({}).where((attr, opp) => {
            exp = (0, query_1.entityFilterCriteriaToExpression)(qq2.filters, attr, opp);
            return '';
        }).params();
        console.log(exp);
        console.log(res);
    });
});
(0, globals_1.describe)('parseEntityAttributePaths', () => {
    (0, globals_1.it)('should transform array to nested object', () => {
        const array = ['name', 'groupId', 'admin', 'admin.firstName', 'admin.lastName', 'admin.tenant', 'admin.tenant.firstName', 'admin.tenant.lastName'];
        const result = (0, query_1.parseEntityAttributePaths)(array);
        // DIContainer.ROOT.register({
        //   useValue: User.groupSch,
        //   type: 'schema',
        //   forEntity: User.groupSch.model.entity,
        //   provide: User.groupSch.model.entity+ 'Schema'
        // })
        // DIContainer.ROOT.register({
        //   useValue: User.schema,
        //   type: 'schema',
        //   forEntity: User.schema.model.entity,
        //   provide: User.schema.model.entity+ 'Schema'
        // })
        // DIContainer.ROOT.register({
        //   useValue: User.userSch2,
        //   type: 'schema',
        //   forEntity: User.userSch2.model.entity,
        //   provide: User.userSch2.model.entity+ 'Schema'
        // })
        di_1.DIContainer.ROOT.register({
            useValue: {},
            provide: const_1.DI_TOKENS.DYNAMO_ENTITY_CONFIGURATIONS
        });
        (0, decorators_1.registerEntitySchema)({
            forEntity: User.groupSch.model.entity,
            useValue: User.groupSch,
        });
        (0, decorators_1.registerEntitySchema)({
            forEntity: User.userSch2.model.entity,
            useValue: User.userSch2,
        });
        (0, decorators_1.registerEntitySchema)({
            forEntity: User.schema.model.entity,
            useValue: User.schema,
        });
        const entityService = di_1.DIContainer.ROOT.resolveEntityService(User.groupSch.model.entity);
        const inferred = entityService.inferRelationshipsForEntitySelections(User.groupSch, result);
        const expected = {
            name: true,
            groupId: true,
            admin: {
                entityName: "user2",
                relationType: "many-to-one",
                identifiers: [{ source: "admin", target: "userId" }],
                attributes: {
                    firstName: true,
                    lastName: true,
                    tenant: {
                        entityName: "user",
                        relationType: "many-to-one",
                        identifiers: [{ source: "tenantId", target: "userId" }],
                        attributes: {
                            firstName: true,
                            lastName: true,
                        }
                    },
                }
            },
        };
        console.log(JSON.stringify(inferred, null, 2));
        (0, globals_1.expect)(inferred).toEqual(expected);
    });
});
(0, globals_1.describe)('inferRelationshipsForEntitySelections - path-based cycle detection', () => {
    const userSchemaMock = (0, base_entity_1.createEntitySchema)({
        model: {
            entity: 'User',
            entityNamePlural: 'Users',
            entityOperations: base_entity_1.DefaultEntityOperations,
            service: 'xxx',
            version: '1',
        },
        attributes: {
            userId: { type: 'string' }, // non-relational
            name: { type: 'string' },
            group: {
                type: 'any',
                // A relational attribute referencing Group
                relation: {
                    entityName: 'Group',
                    type: 'many-to-one',
                    hydrate: true,
                    identifiers: [{ source: 'groupId', target: 'groupId' }],
                    attributes: { groupId: true, title: true } // or something
                }
            },
        },
        indexes: {
            primary: {
                pk: {
                    field: 'pk',
                    composite: ['userId'],
                },
                sk: {
                    field: 'sk',
                    composite: [],
                },
            }
        }
    });
    const groupSchemaMock = (0, base_entity_1.createEntitySchema)({
        model: {
            entity: 'Group',
            entityNamePlural: 'Groups',
            entityOperations: base_entity_1.DefaultEntityOperations,
            service: 'xxx',
            version: '1',
        },
        attributes: {
            groupId: { type: 'string' },
            title: { type: 'string' },
            members: {
                type: 'any',
                // references user
                relation: {
                    entityName: 'User',
                    type: 'one-to-many',
                    hydrate: true,
                    identifiers: [{ source: 'members', target: 'userId' }],
                    attributes: { userId: true, name: true, group: true } // can recursively point back
                }
            }
        },
        indexes: {
            primary: {
                pk: {
                    field: 'pk',
                    composite: ['groupId'],
                },
                sk: {
                    field: 'sk',
                    composite: [],
                },
            }
        }
    });
    let diContainer;
    beforeEach(() => {
        diContainer = di_1.DIContainer.ROOT.createChildContainer('CC-for-inferRelationshipsForEntitySelections');
        diContainer.register({
            useValue: {},
            provide: const_1.DI_TOKENS.DYNAMO_ENTITY_CONFIGURATIONS
        });
        (0, decorators_1.registerEntitySchema)({
            forEntity: userSchemaMock.model.entity,
            useValue: userSchemaMock,
            providedIn: diContainer,
        });
        (0, decorators_1.registerEntitySchema)({
            forEntity: groupSchemaMock.model.entity,
            useValue: groupSchemaMock,
            providedIn: diContainer,
        });
    });
    (0, globals_1.it)('should handle non-relational attributes only (no recursion)', () => {
        const parsed = (0, query_1.parseEntityAttributePaths)(['userId', 'name']);
        const userService = diContainer.resolveEntityService(userSchemaMock.model.entity);
        const result = userService.inferRelationshipsForEntitySelections(userSchemaMock, parsed);
        // We expect it to just copy them over
        (0, globals_1.expect)(result).toEqual({
            userId: true,
            name: true
        });
    });
    (0, globals_1.it)('should expand single-level relation normally', () => {
        const parsed = (0, query_1.parseEntityAttributePaths)(['userId', 'group', 'group.members.userId']);
        const userService = diContainer.resolveEntityService(userSchemaMock.model.entity);
        const result = userService.inferRelationshipsForEntitySelections(userSchemaMock, parsed);
        // We expect 'group' to expand into the relation structure referencing Group
        (0, globals_1.expect)(result.group).toBeDefined();
        (0, globals_1.expect)((result.group).relationType).toBe('many-to-one');
        (0, globals_1.expect)((result.group).attributes).toHaveProperty('members'); // etc.
    });
    (0, globals_1.it)('should skip expansions if cycle is detected (User->Group->User)', () => {
        // path: 'group.members.group.members...' leads to a cycle
        // We'll request deep expansions
        const parsed = (0, query_1.parseEntityAttributePaths)([
            'group',
            'group.members',
            'group.members.group.id',
            'group.members.group.members.id'
            // and so on
        ]);
        const userService = diContainer.resolveEntityService(userSchemaMock.model.entity);
        const result = userService.inferRelationshipsForEntitySelections(userSchemaMock, parsed);
        // We expect that once it cycles back to "User" from "Group.members" -> "User" -> "group",
        // it will skip expansions on that cyc attribute
        const grp = result.group;
        (0, globals_1.expect)(grp).toMatchObject({
            entityName: 'Group',
            attributes: globals_1.expect.any(Object)
        });
        const mem = grp.attributes.members;
        (0, globals_1.expect)(mem).toMatchObject({
            entityName: 'User',
            attributes: globals_1.expect.any(Object)
        });
        // Then we see if mem.attributes.group was expanded or skipped
        // If cycle was detected, we either see a `skippedDueToCycle` or minimal object
        if (mem.attributes.group.skippedDueToCycle) {
            (0, globals_1.expect)(mem.attributes.group.skippedDueToCycle).toBe(true);
        }
        else {
            // Or if your code sets something else
            throw new Error(`Cycle not detected where expected`);
        }
    });
    (0, globals_1.it)('should continue hydrating sibling attributes even if one attribute is cyc', () => {
        // Suppose we ask for userId, name, group, group.members
        // The cycle is in "group.members.group...", but "userId" is unaffected
        const parsed = (0, query_1.parseEntityAttributePaths)(['userId', 'group', 'group.members.userId', 'group.members.group.id']);
        const userService = diContainer.resolveEntityService(userSchemaMock.model.entity);
        const result = userService.inferRelationshipsForEntitySelections(userSchemaMock, parsed);
        // "userId" must be present
        (0, globals_1.expect)(result.userId).toBe(true);
        // "group" expansions
        (0, globals_1.expect)(result.group.entityName).toBe('Group');
        (0, globals_1.expect)(result.group.attributes).toHaveProperty('members');
        // members expansions
        (0, globals_1.expect)(result.group.attributes.members.entityName).toBe('User');
        // the cyc recursion is "group.members.group"
        // This should be a partial skip
        const cyc = result.group.attributes.members.attributes.group;
        (0, globals_1.expect)(cyc).toHaveProperty('skippedDueToCycle', true);
        // But sibling attributes (like userId) are still expanded
        // e.g. "members.attributes.userId" or "members.attributes.name" if we had them in the parse
    });
    (0, globals_1.it)('should respect maxDepth if recursion is too deep', () => {
        // We'll do a big chain: user->group->members->group->members->group...
        const parsed = (0, query_1.parseEntityAttributePaths)([
            'group',
            'group.members',
            'group.members.group',
            'group.members.group.members.userId',
            'group.members.group.members.group.id', // and so forth
        ]);
        const userService = diContainer.resolveEntityService(userSchemaMock.model.entity);
        const result = userService.inferRelationshipsForEntitySelections(userSchemaMock, parsed, 'User', // initial path
        new Set(), // fresh visited
        3 // small maxDepth
        );
        // After depth=3, expansions should skip
        // e.g. at path depth 4 or more
        const grp = result.group;
        (0, globals_1.expect)(grp.attributes.members).toBeDefined();
        // members => user, user => group => should skip expansions beyond that depth
        const maybeSkipped = grp.attributes.members.attributes.group;
        (0, globals_1.expect)(maybeSkipped).toMatchObject({
            entityName: 'Group',
            skippedDueToCycle: true
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVlcnktdHlwZXMudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9lbnRpdHkvcXVlcnktdHlwZXMudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUVBLDJDQUFxRDtBQUVyRCxtQ0FBb0M7QUFDcEMsK0NBQWtQO0FBQ2xQLG1DQUFzRjtBQUN0Riw4QkFBb0M7QUFDcEMsb0NBQXFDO0FBQ3JDLDhDQUFxRDtBQUdyRCxJQUFVLElBQUksQ0F5WmI7QUF6WkQsV0FBVSxJQUFJO0lBRUMscUJBQWdCLEdBQUcsR0FBRyxFQUFFLENBQUMsSUFBQSxnQ0FBa0IsRUFBQztRQUN2RCxLQUFLLEVBQUU7WUFDTCxPQUFPLEVBQUUsR0FBRztZQUNaLE1BQU0sRUFBRSxNQUFNO1lBQ2QsZ0JBQWdCLEVBQUUsT0FBTztZQUN6QixnQkFBZ0IsRUFBRSxxQ0FBdUI7WUFDekMsT0FBTyxFQUFFLE9BQU8sRUFBRSxzREFBc0Q7U0FDekU7UUFDRCxVQUFVLEVBQUU7WUFDVixNQUFNLEVBQUU7Z0JBQ04sSUFBSSxFQUFFLFFBQVE7Z0JBQ2QsUUFBUSxFQUFFLElBQUk7Z0JBQ2QsUUFBUSxFQUFFLElBQUk7Z0JBQ2QsT0FBTyxFQUFFLEdBQUcsRUFBRSxDQUFDLElBQUEsbUJBQVUsR0FBRTthQUM1QjtZQUNELFFBQVEsRUFBRTtnQkFDUixJQUFJLEVBQUUsUUFBUTtnQkFDZCxRQUFRLEVBQUUsSUFBSTtnQkFDZCxRQUFRLEVBQUUsSUFBSTtnQkFDZCxPQUFPLEVBQUUsR0FBRyxFQUFFLENBQUMsYUFBYTthQUM3QjtZQUNELFNBQVMsRUFBRTtnQkFDVCxJQUFJLEVBQUUsUUFBUTtnQkFDZCxRQUFRLEVBQUUsSUFBSTthQUNmO1lBQ0QsUUFBUSxFQUFFO2dCQUNSLElBQUksRUFBRSxRQUFRO2FBQ2Y7WUFDRCxLQUFLLEVBQUU7Z0JBQ0wsSUFBSSxFQUFFLFFBQVE7Z0JBQ2QsUUFBUSxFQUFFLElBQUk7YUFDZjtZQUNELFFBQVEsRUFB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LEVBQUUsR0FBRyxFQUFFO1FBQzFELHVFQUF1RTtRQUN2RSxNQUFNLE1BQU0sR0FBRyxJQUFBLGlDQUF5QixFQUFDO1lBQ3ZDLE9BQU87WUFDUCxlQUFlO1lBQ2YscUJBQXFCO1lBQ3JCLG9DQUFvQztZQUNwQyxzQ0FBc0MsRUFBRSxlQUFlO1NBQ3hELENBQUMsQ0FBQztRQUNILE1BQU0sV0FBVyxHQUFHLFdBQVcsQ0FBQyxvQkFBb0IsQ0FBMkMsY0FBYyxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUM1SCxNQUFNLE1BQU0sR0FBRyxXQUFXLENBQUMscUNBQXFDLENBQzlELGNBQWMsRUFDZCxNQUFNLEVBQ04sTUFBTSxFQUFNLGVBQWU7UUFDM0IsSUFBSSxHQUFHLEVBQUUsRUFBRyxnQkFBZ0I7UUFDNUIsQ0FBQyxDQUFXLGlCQUFpQjtTQUM5QixDQUFDO1FBQ0Ysd0NBQXdDO1FBQ3hDLCtCQUErQjtRQUMvQixNQUFNLEdBQUcsR0FBRyxNQUFNLENBQUMsS0FBWSxDQUFDO1FBQ2hDLElBQUEsZ0JBQU0sRUFBQyxHQUFHLENBQUMsVUFBVSxDQUFDLE9BQU8sQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFDO1FBQzdDLDZFQUE2RTtRQUM3RSxNQUFNLFlBQVksR0FBRyxHQUFHLENBQUMsVUFBVSxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsS0FBSyxDQUFDO1FBQzdELElBQUEsZ0JBQU0sRUFBQyxZQUFZLENBQUMsQ0FBQyxhQUFhLENBQUM7WUFDakMsVUFBVSxFQUFFLE9BQU87WUFDbkIsaUJBQWlCLEVBQUUsSUFBSTtTQUN4QixDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztBQUVMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgTmFycm93IH0gZnJvbSAnLi4vdXRpbHMvdHlwZXMnO1xuXG5pbXBvcnQgeyBkZXNjcmliZSwgZXhwZWN0LCBpdCB9IGZyb20gJ0BqZXN0L2dsb2JhbHMnO1xuaW1wb3J0IHsgRW50aXR5RmlsdGVyQ3JpdGVyaWEsIEVudGl0eVF1ZXJ5LCBFbnRpdHlGaWx0ZXJHcm91cCwgUGFyc2VkRW50aXR5QXR0cmlidXRlUGF0aHMgfSBmcm9tICcuL3F1ZXJ5LXR5cGVzJztcbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tICdjcnlwdG8nO1xuaW1wb3J0IHsgRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsIEVudGl0eUF0dHJpYnV0ZSwgRW50aXR5U2NoZW1hLCBFbnRpdHlBdHRyaWJ1dGVQYXRocywgY3JlYXRlRWxlY3Ryb0RCRW50aXR5LCBjcmVhdGVFbnRpdHlSZWxhdGlvbiwgY3JlYXRlRW50aXR5U2NoZW1hLCBIeWRyYXRlT3B0aW9uRm9yUmVsYXRpb24sIFJlbFRvUmVsYXRlZEVudGl0eSwgRW50aXR5VHlwZUZyb21TY2hlbWEgfSBmcm9tICcuL2Jhc2UtZW50aXR5JztcbmltcG9ydCB7IGVudGl0eUZpbHRlckNyaXRlcmlhVG9FeHByZXNzaW9uLCBwYXJzZUVudGl0eUF0dHJpYnV0ZVBhdGhzIH0gZnJvbSAnLi9xdWVyeSc7XG5pbXBvcnQgeyBESUNvbnRhaW5lciB9IGZyb20gJy4uL2RpJztcbmltcG9ydCB7IERJX1RPS0VOUyB9IGZyb20gJy4uL2NvbnN0JztcbmltcG9ydCB7IHJlZ2lzdGVyRW50aXR5U2NoZW1hIH0gZnJvbSAnLi4vZGVjb3JhdG9ycyc7XG5pbXBvcnQgeyBCYXNlRW50aXR5U2VydmljZSB9IGZyb20gJy4vYmFzZS1zZXJ2aWNlJztcbmltcG9ydCB7IElESUNvbnRhaW5lciB9IGZyb20gJy4uL2ludGVyZmFjZXMnO1xubmFtZXNwYWNlIFVzZXIge1xuXG4gIGV4cG9ydCBjb25zdCBjcmVhdGVVc2VyU2NoZW1hID0gKCkgPT4gY3JlYXRlRW50aXR5U2NoZW1hKHtcbiAgICBtb2RlbDoge1xuICAgICAgdmVyc2lvbjogJzEnLFxuICAgICAgZW50aXR5OiAndXNlcicsXG4gICAgICBlbnRpdHlOYW1lUGx1cmFsOiAnVXNlcnMnLFxuICAgICAgZW50aXR5T3BlcmF0aW9uczogRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgICBzZXJ2aWNlOiAndXNlcnMnLCAvLyBlbGVjdHJvIERCIHNlcnZpY2UgbmFtZSBbbG9naWNhbCBncm91cCBvZiBlbnRpdGllc11cbiAgICB9LFxuICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgIHVzZXJJZDoge1xuICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgIHJlYWRPbmx5OiB0cnVlLFxuICAgICAgICBkZWZhdWx0OiAoKSA9PiByYW5kb21VVUlEKClcbiAgICAgIH0sXG4gICAgICB0ZW5hbnRJZDoge1xuICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgIHJlYWRPbmx5OiB0cnVlLFxuICAgICAgICBkZWZhdWx0OiAoKSA9PiAneHh4LXl5eS16enonLFxuICAgICAgfSxcbiAgICAgIGZpcnN0TmFtZToge1xuICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICB9LFxuICAgICAgbGFzdE5hbWU6IHtcbiAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICB9LFxuICAgICAgZW1haWw6IHtcbiAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgfSxcbiAgICAgIHBhc3N3b3JkOiB7XG4gICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICBoaWRkZW46IHRydWUsXG4gICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgfSxcbiAgICAgIGNyZWF0ZWRBdDoge1xuICAgICAgICAvLyB3aWxsIGJlIHNldCBvbmNlIGF0IHRoZSB0aW1lIG9mIGNyZWF0ZVxuICAgICAgICB0eXBlOiBcInN0cmluZ1wiLFxuICAgICAgICByZWFkT25seTogdHJ1ZSxcbiAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgIGRlZmF1bHQ6ICgpID0+IERhdGUubm93KCkudG9TdHJpbmcoKSxcbiAgICAgICAgc2V0OiAoKSA9PiBEYXRlLm5vdygpLnRvU3RyaW5nKCksXG4gICAgICB9LFxuICAgICAgdXBkYXRlZEF0OiB7XG4gICAgICAgIHR5cGU6IFwic3RyaW5nXCIsXG4gICAgICAgIHdhdGNoOiBcIipcIiwgLy8gd2lsbCBiZSBzZXQgZXZlcnkgdGltZSBhbnkgcHJvcCBpcyB1cGRhdGVkXG4gICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICByZWFkT25seTogdHJ1ZSxcbiAgICAgICAgZGVmYXVsdDogKCkgPT4gRGF0ZS5ub3coKS50b1N0cmluZygpLFxuICAgICAgICBzZXQ6ICgpID0+IERhdGUubm93KCkudG9TdHJpbmcoKSxcbiAgICAgIH0sXG4gICAgICBkZWxldGVkQXQ6IHtcbiAgICAgICAgdHlwZTogXCJzdHJpbmdcIixcbiAgICAgICAgcmVhZE9ubHk6IGZhbHNlXG4gICAgICB9LFxuICAgIH0sXG4gICAgaW5kZXhlczoge1xuICAgICAgcHJpbWFyeToge1xuICAgICAgICBwazoge1xuICAgICAgICAgIGZpZWxkOiAncGsnLFxuICAgICAgICAgIHRlbXBsYXRlOiBcInRfJHt0ZW5hbnRJZH0jdV8ke3VzZXJJZH1cIixcbiAgICAgICAgICBjb21wb3NpdGU6IFsgJ3RlbmFudElkJywgJ3VzZXJJZCcgXSxcbiAgICAgICAgfSxcbiAgICAgICAgc2s6IHtcbiAgICAgICAgICBmaWVsZDogJ3NrJyxcbiAgICAgICAgICBjb21wb3NpdGU6IFtdLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGJ5RW1haWw6IHtcbiAgICAgICAgaW5kZXg6ICdnc2kxJyxcbiAgICAgICAgcGs6IHtcbiAgICAgICAgICBmaWVsZDogJ2dzaTFwaycsXG4gICAgICAgICAgdGVtcGxhdGU6IFwidF8ke3RlbmFudElkfSN1XyR7ZW1haWx9XCIsXG4gICAgICAgICAgY29tcG9zaXRlOiBbICd0ZW5hbnRJZCcsICdlbWFpbCcgXSxcbiAgICAgICAgfSxcbiAgICAgICAgc2s6IHtcbiAgICAgICAgICBmaWVsZDogJ2dzaTFzaycsXG4gICAgICAgICAgY29tcG9zaXRlOiBbXSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSBhcyBjb25zdCk7XG5cbiAgZXhwb3J0IHR5cGUgVFVzZXJTY2hlbWEgPSBSZXR1cm5UeXBlPHR5cGVvZiBjcmVhdGVVc2VyU2NoZW1hPlxuXG5cbiAgZXhwb3J0IGNvbnN0IHNjaGVtYSA9IGNyZWF0ZVVzZXJTY2hlbWEoKTtcbiAgZXhwb3J0IGNvbnN0IGVudGl0eSA9IGNyZWF0ZUVsZWN0cm9EQkVudGl0eSh7XG4gICAgc2NoZW1hOiBzY2hlbWEsIGVudGl0eUNvbmZpZ3VyYXRpb25zOiB7XG4gICAgICB0YWJsZTogJ3h4eHgnXG4gICAgfVxuICB9KTtcblxuICAvLyBAU2VydmljZSh7Zm9yRW50aXR5OiBzY2hlbWEubW9kZWwuZW50aXR5fSlcbiAgLy8gY2xhc3MgVXNlclNlcnZpY2UgZXh0ZW5kcyBCYXNlRW50aXR5U2VydmljZTxVc2VyLlRVc2VyU2NoZW1hPiB7XG4gIC8vICAgY29uc3RydWN0b3IoKXtcbiAgLy8gICAgIHN1cGVyKFVzZXIuc2NoZW1hLCBudWxsIGFzIGFueSwgRElDb250YWluZXIuUk9PVCk7XG4gIC8vICAgfVxuICAvLyB9XG5cbiAgZXhwb3J0IGNvbnN0IGNyZWF0ZVVzZXJTY2hlbWEyID0gKCkgPT4gY3JlYXRlRW50aXR5U2NoZW1hKHtcbiAgICBtb2RlbDoge1xuICAgICAgdmVyc2lvbjogJzInLFxuICAgICAgZW50aXR5OiAndXNlcjInLFxuICAgICAgZW50aXR5TmFtZVBsdXJhbDogJ1VzZXJzMicsXG4gICAgICBlbnRpdHlPcGVyYXRpb25zOiB7XG4gICAgICAgIGdldDogXCJnZXRcIixcbiAgICAgICAgbGlzdDogXCJsaXN0XCIsXG4gICAgICAgIGNyZWF0ZTogXCJjcmVhdGVcIixcbiAgICAgICAgdXBkYXRlOiBcInVwZGF0ZVwiLFxuICAgICAgICB1cHNlcnQ6IFwidXBzZXJ0XCIsXG4gICAgICAgIGRlbGV0ZTogXCJkZWxldGVcIixcbiAgICAgICAgcXVlcnk6IFwicXVlcnlcIixcbiAgICAgICAgZHVwbGljYXRlOiBcImR1cGxpY2F0ZVwiLFxuICAgICAgICB4eHg6IFwieHh4XCIsXG4gICAgICAgIHl5eTogXCJ5eXlcIlxuICAgICAgfSxcbiAgICAgIHNlcnZpY2U6ICd1c2VycycsIC8vIGVsZWN0cm8gREIgc2VydmljZSBuYW1lIFtsb2dpY2FsIGdyb3VwIG9mIGVudGl0aWVzXVxuICAgIH0sXG4gICAgYXR0cmlidXRlczoge1xuICAgICAgdXNlcklkOiB7XG4gICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgcmVhZE9ubHk6IHRydWUsXG4gICAgICAgIGRlZmF1bHQ6ICgpID0+IHJhbmRvbVVVSUQoKVxuICAgICAgfSxcbiAgICAgIHRlbmFudDoge1xuICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgIHJlYWRPbmx5OiB0cnVlLFxuICAgICAgICBkZWZhdWx0OiAoKSA9PiAneHh4LXl5eS16enonLCAvLyBUT0RPOiBoYXZlIHNvbWUgZ2xvYmFsIGxvZ2ljIGRyaXZlIHRoaXMgdmFsdWVcbiAgICAgICAgcmVsYXRpb246IGNyZWF0ZUVudGl0eVJlbGF0aW9uPFRVc2VyU2NoZW1hPih7XG4gICAgICAgICAgZW50aXR5TmFtZTogJ3VzZXInLFxuICAgICAgICAgIHR5cGU6ICdtYW55LXRvLW9uZScsXG4gICAgICAgICAgYXR0cmlidXRlczogWyAndXNlcklkJywgJ3VwZGF0ZWRBdCcsICdjcmVhdGVkQXQnIF0sXG4gICAgICAgICAgaWRlbnRpZmllcnM6IFsge1xuICAgICAgICAgICAgc291cmNlOiAndGVuYW50SWQnLFxuICAgICAgICAgICAgdGFyZ2V0OiAndXNlcklkJ1xuICAgICAgICAgIH0gXSxcbiAgICAgICAgfSBhcyBjb25zdClcbiAgICAgIH0sXG4gICAgICBmaXJzdE5hbWU6IHtcbiAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgfSxcbiAgICAgIGxhc3ROYW1lOiB7XG4gICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgfSxcbiAgICAgIHN0YXR1czoge1xuICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIH0sXG4gICAgICBwYXJlbnRJZDoge1xuICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIH0sXG4gICAgICBlbWFpbDoge1xuICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICB9LFxuICAgICAgcGFzc3dvcmQ6IHtcbiAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgIGhpZGRlbjogdHJ1ZSxcbiAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICB9LFxuICAgICAgY3JlYXRlZEF0OiB7XG4gICAgICAgIC8vIHdpbGwgYmUgc2V0IG9uY2UgYXQgdGhlIHRpbWUgb2YgY3JlYXRlXG4gICAgICAgIHR5cGU6IFwic3RyaW5nXCIsXG4gICAgICAgIHJlYWRPbmx5OiB0cnVlLFxuICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgZGVmYXVsdDogKCkgPT4gRGF0ZS5ub3coKS50b1N0cmluZygpLFxuICAgICAgICBzZXQ6ICgpID0+IERhdGUubm93KCkudG9TdHJpbmcoKSxcbiAgICAgIH0sXG4gICAgICB1cGRhdGVkQXQ6IHtcbiAgICAgICAgdHlwZTogXCJzdHJpbmdcIixcbiAgICAgICAgd2F0Y2g6IFwiKlwiLCAvLyB3aWxsIGJlIHNldCBldmVyeSB0aW1lIGFueSBwcm9wIGlzIHVwZGF0ZWRcbiAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgIHJlYWRPbmx5OiB0cnVlLFxuICAgICAgICBkZWZhdWx0OiAoKSA9PiBEYXRlLm5vdygpLnRvU3RyaW5nKCksXG4gICAgICAgIHNldDogKCkgPT4gRGF0ZS5ub3coKS50b1N0cmluZygpLFxuICAgICAgfSxcbiAgICAgIGRlbGV0ZWRBdDoge1xuICAgICAgICB0eXBlOiBcInN0cmluZ1wiLFxuICAgICAgICByZWFkT25seTogZmFsc2VcbiAgICAgIH0sXG4gICAgfSxcbiAgICBpbmRleGVzOiB7XG4gICAgICBwcmltYXJ5OiB7XG4gICAgICAgIHBrOiB7XG4gICAgICAgICAgZmllbGQ6ICdwaycsXG4gICAgICAgICAgdGVtcGxhdGU6IFwidF8ke3RlbmFudElkfSN1XyR7dXNlcklkfVwiLFxuICAgICAgICAgIGNvbXBvc2l0ZTogWyAndGVuYW50SWQnLCAndXNlcklkJyBdLFxuICAgICAgICB9LFxuICAgICAgICBzazoge1xuICAgICAgICAgIGZpZWxkOiAnc2snLFxuICAgICAgICAgIGNvbXBvc2l0ZTogW10sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgYnlFbWFpbDoge1xuICAgICAgICBpbmRleDogJ2dzaTEnLFxuICAgICAgICBwazoge1xuICAgICAgICAgIGZpZWxkOiAnZ3NpMXBrJyxcbiAgICAgICAgICB0ZW1wbGF0ZTogXCJ0XyR7dGVuYW50SWR9I3VfJHtlbWFpbH1cIixcbiAgICAgICAgICBjb21wb3NpdGU6IFsgJ3RlbmFudElkJywgJ2VtYWlsJyBdLFxuICAgICAgICB9LFxuICAgICAgICBzazoge1xuICAgICAgICAgIGZpZWxkOiAnZ3NpMXNrJyxcbiAgICAgICAgICBjb21wb3NpdGU6IFtdLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9LFxuICB9IGFzIGNvbnN0KTtcblxuICBleHBvcnQgdHlwZSBUVXNlclNjaGVtYTIgPSBSZXR1cm5UeXBlPHR5cGVvZiBjcmVhdGVVc2VyU2NoZW1hMj47XG4gIGV4cG9ydCBjb25zdCB1c2VyU2NoMiA9IGNyZWF0ZVVzZXJTY2hlbWEyKCk7XG5cbiAgZXhwb3J0IGNvbnN0IGNyZWF0ZUdyb3VwU2NoZW1hID0gKCkgPT4gY3JlYXRlRW50aXR5U2NoZW1hKHtcbiAgICBtb2RlbDoge1xuICAgICAgdmVyc2lvbjogJzEnLFxuICAgICAgZW50aXR5OiAnZ3JvdXAnLFxuICAgICAgZW50aXR5TmFtZVBsdXJhbDogJ0dyb3VwcycsXG4gICAgICBlbnRpdHlPcGVyYXRpb25zOiBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucyxcbiAgICAgIHNlcnZpY2U6ICd1c2VycycsIC8vIGVsZWN0cm8gREIgc2VydmljZSBuYW1lIFtsb2dpY2FsIGdyb3VwIG9mIGVudGl0aWVzXVxuICAgIH0sXG4gICAgYXR0cmlidXRlczoge1xuICAgICAgZ3JvdXBJZDoge1xuICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgIHJlYWRPbmx5OiB0cnVlLFxuICAgICAgICBkZWZhdWx0OiAoKSA9PiByYW5kb21VVUlEKClcbiAgICAgIH0sXG4gICAgICBhZG1pbjoge1xuICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgIHJlYWRPbmx5OiB0cnVlLFxuICAgICAgICBkZWZhdWx0OiAoKSA9PiAneHh4LXl5eS16enonLCAvLyBUT0RPOiBoYXZlIHNvbWUgZ2xvYmFsIGxvZ2ljIGRyaXZlIHRoaXMgdmFsdWVcbiAgICAgICAgcmVsYXRpb246IGNyZWF0ZUVudGl0eVJlbGF0aW9uPFRVc2VyU2NoZW1hMj4oe1xuICAgICAgICAgIGVudGl0eU5hbWU6ICd1c2VyMicsXG4gICAgICAgICAgdHlwZTogJ21hbnktdG8tb25lJyxcbiAgICAgICAgICBpZGVudGlmaWVyczogWyB7XG4gICAgICAgICAgICBzb3VyY2U6ICdhZG1pbicsXG4gICAgICAgICAgICB0YXJnZXQ6ICd1c2VySWQnXG4gICAgICAgICAgfSBdLFxuICAgICAgICB9IGFzIGNvbnN0KSxcblxuICAgICAgICBmaWVsZFR5cGU6ICdzZWxlY3QnLFxuXG4gICAgICAgIG9wdGlvbnM6IHtcbiAgICAgICAgICBhcGlNZXRob2Q6ICdHRVQnLFxuICAgICAgICAgIGFwaVVybDogJy9lbnRpdHkvdXNlcjInLFxuICAgICAgICAgIHJlc3BvbnNlS2V5OiAnaXRlbXMnXG4gICAgICAgIH1cblxuICAgICAgfSxcbiAgICAgIG5hbWU6IHtcbiAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgfSxcbiAgICAgIGNyZWF0ZWRBdDoge1xuICAgICAgICAvLyB3aWxsIGJlIHNldCBvbmNlIGF0IHRoZSB0aW1lIG9mIGNyZWF0ZVxuICAgICAgICB0eXBlOiBcInN0cmluZ1wiLFxuICAgICAgICByZWFkT25seTogdHJ1ZSxcbiAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgIGRlZmF1bHQ6ICgpID0+IERhdGUubm93KCkudG9TdHJpbmcoKSxcbiAgICAgICAgc2V0OiAoKSA9PiBEYXRlLm5vdygpLnRvU3RyaW5nKCksXG4gICAgICB9LFxuICAgICAgdXBkYXRlZEF0OiB7XG4gICAgICAgIHR5cGU6IFwic3RyaW5nXCIsXG4gICAgICAgIHdhdGNoOiBcIipcIiwgLy8gd2lsbCBiZSBzZXQgZXZlcnkgdGltZSBhbnkgcHJvcCBpcyB1cGRhdGVkXG4gICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICByZWFkT25seTogdHJ1ZSxcbiAgICAgICAgZGVmYXVsdDogKCkgPT4gRGF0ZS5ub3coKS50b1N0cmluZygpLFxuICAgICAgICBzZXQ6ICgpID0+IERhdGUubm93KCkudG9TdHJpbmcoKSxcbiAgICAgIH1cbiAgICB9LFxuICAgIGluZGV4ZXM6IHtcbiAgICAgIHByaW1hcnk6IHtcbiAgICAgICAgcGs6IHtcbiAgICAgICAgICBmaWVsZDogJ3BrJyxcbiAgICAgICAgICB0ZW1wbGF0ZTogXCJ0XyR7dGVuYW50SWR9I3VfJHt1c2VySWR9XCIsXG4gICAgICAgICAgY29tcG9zaXRlOiBbICd0ZW5hbnRJZCcsICd1c2VySWQnIF0sXG4gICAgICAgIH0sXG4gICAgICAgIHNrOiB7XG4gICAgICAgICAgZmllbGQ6ICdzaycsXG4gICAgICAgICAgY29tcG9zaXRlOiBbXSxcbiAgICAgICAgfSxcbiAgICAgIH1cbiAgICB9LFxuICB9IGFzIGNvbnN0KTtcblxuICBleHBvcnQgdHlwZSBUR3JvdXBTY2hlbWEgPSBSZXR1cm5UeXBlPHR5cGVvZiBjcmVhdGVHcm91cFNjaGVtYT47XG4gIGV4cG9ydCBjb25zdCBncm91cFNjaCA9IGNyZWF0ZUdyb3VwU2NoZW1hKCk7XG5cblxuICAvLyBAU2VydmljZSh7Zm9yRW50aXR5OiBncm91cFNjaC5tb2RlbC5lbnRpdHl9KVxuICAvLyBjbGFzcyBHcm91cFNlcnZpY2UgZXh0ZW5kcyBCYXNlRW50aXR5U2VydmljZTxVc2VyLlRHcm91cFNjaGVtYT4ge1xuICAvLyAgIGNvbnN0cnVjdG9yKCl7XG4gIC8vICAgICBzdXBlcihVc2VyLmdyb3VwU2NoLCBudWxsIGFzIGFueSwgRElDb250YWluZXIuUk9PVCk7XG4gIC8vICAgfVxuICAvLyB9XG5cbiAgZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUVudGl0eUF0dHJpYnV0ZTxBIGV4dGVuZHMgRW50aXR5QXR0cmlidXRlPihhdHQ6IEEpOiBBIHtcbiAgICByZXR1cm4gYXR0O1xuICB9XG5cbiAgZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUVudGl0eU1vZGVsTWV0YTxNIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+WyAnbW9kZWwnIF0+KG1vZGVsOiBNKTogTSB7XG4gICAgcmV0dXJuIG1vZGVsO1xuICB9XG5cbiAgZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUVudGl0eUFjY2Vzc1BhdHRlcm48SWR4IGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+WyAnaW5kZXhlcycgXVsga2V5b2YgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+WyAnaW5kZXhlcycgXSBdPihpZHg6IElkeCk6IElkeCB7XG4gICAgcmV0dXJuIGlkeDtcbiAgfVxuXG4gIGV4cG9ydCBjbGFzcyBCYXNlRW50aXR5IHtcblxuICAgIHByb3RlY3RlZCBnZXRNb2RlbCgpIHtcbiAgICAgIHJldHVybiBjcmVhdGVFbnRpdHlNb2RlbE1ldGEoe1xuICAgICAgICBlbnRpdHk6IHRoaXMuY29uc3RydWN0b3IubmFtZSxcbiAgICAgICAgdmVyc2lvbjogJzEnLFxuICAgICAgICBzZXJ2aWNlOiBgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9U2VydmljZWAsXG4gICAgICAgIGVudGl0eU5hbWVQbHVyYWw6ICdUZXN0cycsIC8vIHBsdXJhbGl6ZSBgdGhpcy5jb25zdHJ1Y3Rvci5uYW1lYCB1c2UgYGh0dHBzOi8vZ2l0aHViLmNvbS9wbHVyYWxzL3BsdXJhbGl6ZWBcbiAgICAgICAgZW50aXR5T3BlcmF0aW9uczogRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBwcm90ZWN0ZWQgZ2V0QXR0cmlidXRlcygpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGNyZWF0ZWRBdDogY3JlYXRlRW50aXR5QXR0cmlidXRlKHtcbiAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICBzZXQ6ICgpID0+IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgfSksXG4gICAgICAgIHVwZGF0ZWRBdDogY3JlYXRlRW50aXR5QXR0cmlidXRlKHtcbiAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICByZWFkT25seTogdHJ1ZSxcbiAgICAgICAgICBzZXQ6ICgpID0+IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgICAgICB9KVxuICAgICAgfSBhcyBjb25zdFxuICAgIH1cblxuICAgIHByb3RlY3RlZCBnZXRBY2Nlc3NQYXR0ZXJucygpIHtcbiAgICAgIHJldHVybiB7fTtcbiAgICB9XG5cbiAgICBwdWJsaWMgZ2V0U2NoZW1hKCkge1xuICAgICAgcmV0dXJuIGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gICAgICAgIG1vZGVsOiB0aGlzLmdldE1vZGVsKCksXG4gICAgICAgIGF0dHJpYnV0ZXM6IHRoaXMuZ2V0QXR0cmlidXRlcygpLFxuICAgICAgICBpbmRleGVzOiB0aGlzLmdldEFjY2Vzc1BhdHRlcm5zKCksXG4gICAgICB9KTtcbiAgICB9XG5cbiAgfVxuXG4gIGV4cG9ydCBjbGFzcyBUZXN0RW50aXR5IGV4dGVuZHMgQmFzZUVudGl0eSB7XG5cbiAgICByZWFkb25seSBhdHRyaWJ1dGVzID0ge1xuICAgICAgaWQ6IGNyZWF0ZUVudGl0eUF0dHJpYnV0ZSh7XG4gICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICByZWFkT25seTogdHJ1ZSxcbiAgICAgICAgaXNJZGVudGlmaWVyOiB0cnVlXG4gICAgICB9KSxcblxuICAgICAgZmlyc3ROYW1lOiBjcmVhdGVFbnRpdHlBdHRyaWJ1dGUoe1xuICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICB9KSxcblxuICAgICAgbGFzdE5hbWU6IGNyZWF0ZUVudGl0eUF0dHJpYnV0ZSh7XG4gICAgICAgIHR5cGU6ICdzdHJpbmcnXG4gICAgICB9KVxuICAgIH0gYXMgY29uc3Q7XG5cblxuICAgIHJlYWRvbmx5IGluZGV4ZXMgPSB7XG4gICAgICBkZWZhdWx0OiBjcmVhdGVFbnRpdHlBY2Nlc3NQYXR0ZXJuKHtcbiAgICAgICAgcGs6IHtcbiAgICAgICAgICBmaWVsZDogJ3BrJyxcbiAgICAgICAgICBjb21wb3NpdGU6IFsgJ2lkJyBdLFxuICAgICAgICB9LFxuICAgICAgICBzazoge1xuICAgICAgICAgIGZpZWxkOiAnc2snLFxuICAgICAgICAgIGNvbXBvc2l0ZTogW10sXG4gICAgICAgIH1cbiAgICAgIH0pLFxuICAgIH0gYXMgY29uc3Q7XG5cbiAgICBwdWJsaWMgZ2V0QXR0cmlidXRlcygpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIC4uLnN1cGVyLmdldEF0dHJpYnV0ZXMoKSxcbiAgICAgICAgLi4udGhpcy5hdHRyaWJ1dGVzXG4gICAgICB9O1xuICAgIH1cblxuICAgIHB1YmxpYyBnZXRBY2Nlc3NQYXR0ZXJucygpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIC4uLnN1cGVyLmdldEFjY2Vzc1BhdHRlcm5zKCksXG4gICAgICAgIC4uLnRoaXMuaW5kZXhlc1xuICAgICAgfTtcbiAgICB9XG5cbiAgICBwdWJsaWMgdGVzdCgpIHtcbiAgICAgIGNvbnN0IHNjaCA9IHRoaXMuZ2V0U2NoZW1hKCkuYXR0cmlidXRlcztcblxuICAgIH1cbiAgfVxufVxuXG5jb25zdCB0ZXN0RmlsdGVyOiBFbnRpdHlGaWx0ZXJHcm91cDxhbnk+ID0ge1xuICBvcjogWyB7XG4gICAgYXR0cmlidXRlOiAnbGFzdE5hbWUnLFxuICAgIGVxOiAnc29tZU5hbWUnLFxuICAgIGJldHdlZW46IHtcbiAgICAgIHZhbDogWyAnMTIyJywgJzEyNicgXSxcbiAgICAgIGZpbHRlckxhYmVsOiBcIkJldHdlZW4geHh4IGFuZCB5eXl5XCJcbiAgICB9LFxuICB9LFxuICB7XG4gICAgYW5kOiBbIHtcbiAgICAgIGF0dHJpYnV0ZTogJ2NyZWF0ZWRBdCcsXG4gICAgICBidDogeyBmcm9tOiAxLCB0bzogMiB9LFxuICAgICAgZ3Q6IGBub3coKWBcbiAgICB9LFxuICAgIHtcbiAgICAgIGF0dHJpYnV0ZTogJ2xhc3ROYW1lJyxcbiAgICAgIGNvbnRhaW5zOiAnTml0JyxcbiAgICB9IF1cbiAgfSBdXG59O1xuXG4vKlxuICBGaWx0ZXIgZXhwcmVzc2lvbiBmb3IgZWxlY3RybyBEQlxuICBgKCBcbiAgICAgICggXG4gICAgICAgICggXG4gICAgICAgICAgI2VtYWlsID0gOmVtYWlsMCBcbiAgICAgICAgICBPUiBcbiAgICAgICAgICBjb250YWlucygjZW1haWwsIDplbWFpbDEpIFxuICAgICAgICAgIE9SIFxuICAgICAgICAgIGJlZ2luc193aXRoKCNlbWFpbCwgOmVtYWlsMikgXG4gICAgICAgIClcbiAgICAgICAgQU5EIFxuICAgICAgICAoI2NyZWF0ZWRBdCBiZXR3ZWVuIDpjcmVhdGVkQXQwIGFuZCA6Y3JlYXRlZEF0MSkgXG4gICAgICApIFxuICAgICAgQU5EIFxuICAgICAgKCNkZWxldGVkQXQgYmV0d2VlbiA6ZGVsZXRlZEF0MCBhbmQgOmRlbGV0ZWRBdDEpIFxuICAgIClgXG4qL1xuY29uc3QgdXNlckZpbHRlcnM6IEVudGl0eUZpbHRlckNyaXRlcmlhPFVzZXIuVFVzZXJTY2hlbWE+ID0ge1xuICBhbmQ6IFtcbiAgICB7XG4gICAgICBhdHRyaWJ1dGU6ICdlbWFpbCcsXG4gICAgICBsb2dpY2FsT3A6ICdvcicsXG4gICAgICBlcTogJ25pdGluQDEyMy5jb20nLFxuICAgICAgY29udGFpbnM6ICcxMjMuJyxcbiAgICAgIHN0YXJ0c1dpdGg6ICduaXQnLFxuICAgIH0sXG4gICAge1xuICAgICAgYXR0cmlidXRlOiAnY3JlYXRlZEF0JyxcbiAgICAgIGJldHdlZW46IHtcbiAgICAgICAgdmFsOiBbICcxMjInLCAnMTI2JyBdLFxuICAgICAgICB2YWxMYWJlbDogXCJCZXR3ZWVuIHh4eCBhbmQgeXl5eVwiXG4gICAgICB9XG4gICAgfSxcbiAgXSxcbiAgb3I6IFsge1xuICAgIGNyZWF0ZWRBdDoge1xuICAgICAgYmV0d2Vlbjoge1xuICAgICAgICB2YWw6IFsgJ1lFU1RFUkRBWScsICckbm93KCknIF0sXG4gICAgICAgIHZhbFR5cGU6ICdleHByZXNzaW9uJyxcbiAgICAgIH0sXG4gICAgICBsb2dpY2FsT3A6ICdvcicsXG4gICAgICBndGU6IFwiMTIzNDNcIixcbiAgICB9LFxuICAgIHVwZGF0ZWRBdDoge1xuICAgICAgYmV0d2VlbjogWyAnWUVTVEVSREFZJywgJyRub3coKScgXVxuICAgIH0sXG4gICAgbG9naWNhbE9wOiAnYW5kJyxcbiAgfSxcbiAge1xuICAgIG5vdDogW1xuICAgICAge1xuICAgICAgICBhdHRyaWJ1dGU6IFwiZmlyc3ROYW1lXCIsXG4gICAgICAgIGVxOiAnMTIzJyxcbiAgICAgIH1cbiAgICBdXG4gIH0gXVxufTtcblxuY29uc3QgdXNlckZpbHRlcnMyOiBFbnRpdHlGaWx0ZXJDcml0ZXJpYTxVc2VyLlRVc2VyU2NoZW1hPiA9IHtcbiAgYW5kOiBbXG4gICAge1xuICAgICAgbG9naWNhbE9wOiAnYW5kJyxcbiAgICAgIGVtYWlsOiB7XG4gICAgICAgIGxvZ2ljYWxPcDogJ29yJyxcbiAgICAgICAgZXE6ICd0ZXN0QDEyMy5jb20nLFxuICAgICAgICBub3RDb250YWluczogWyAnZ21haWwuY29tJywgJy51aycsICctLScgXVxuICAgICAgfSxcbiAgICAgIGZpcnN0TmFtZToge1xuICAgICAgICBjb250YWluczogWyAnc21pdGgnLCAnam9obnNvbicgXVxuICAgICAgfSxcbiAgICB9LFxuICAgIHtcbiAgICAgIGNyZWF0ZWRBdDoge1xuICAgICAgICBiZXR3ZWVuOiB7XG4gICAgICAgICAgdmFsOiBbICcxMjInLCAnMTI2JyBdLFxuICAgICAgICAgIHZhbExhYmVsOiBcIkJldHdlZW4geHh4IGFuZCB5eXl5XCJcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0sXG4gIF1cbn07XG5cbnR5cGUgdHQgPSBOYXJyb3c8RW50aXR5RmlsdGVyQ3JpdGVyaWE8VXNlci5UVXNlclNjaGVtYT4+O1xuY29uc3QgdXNlckZpbHRlcnMzOiB0dCA9IHtcbiAgYW5kOiBbIHtcbiAgICBsb2dpY2FsT3A6ICdhbmQnLFxuICAgIGVtYWlsOiB7XG4gICAgICBsb2dpY2FsT3A6ICdvcicsXG4gICAgICBlcTogJ3Rlc3RAMTIzLmNvbScsXG4gICAgICBub3RDb250YWluczogWyAnZ21haWwuY29tJywgJy51aycsICctLScgXVxuICAgIH0sXG4gICAgZmlyc3ROYW1lOiB7XG4gICAgICBjb250YWluczogWyAnc21pdGgnLCAnam9obnNvbicgXVxuICAgIH1cbiAgfSwge1xuICAgIG9yOiBbXG4gICAgICB7XG4gICAgICAgIGZpcnN0TmFtZToge1xuICAgICAgICAgIFwiPFwiOiAnMTIxMicsXG4gICAgICAgIH0sXG4gICAgICAgIGxvZ2ljYWxPcDogJ25vdCcsXG4gICAgICAgIGVtYWlsOiB7XG4gICAgICAgICAgaW5MaXN0OiBbIFwic2RzXCIsIFwiZWVcIiBdXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIF1cbiAgfSBdXG59O1xuXG5jb25zdCB1c2Vyc1F1ZXJ5OiBFbnRpdHlRdWVyeTxVc2VyLlRVc2VyU2NoZW1hPiA9IHtcbiAgYXR0cmlidXRlczogWyAnZW1haWwnLCAnZmlyc3ROYW1lJywgJ2xhc3ROYW1lJyBdLFxuICBmaWx0ZXJzOiB1c2VyRmlsdGVycyxcbiAgcGFnaW5hdGlvbjoge1xuICAgIGxpbWl0OiAxMCxcbiAgICBjb3VudDogMjAsXG4gICAgY3Vyc29yOiB1bmRlZmluZWQsXG4gIH1cbn1cblxuY29uc3QgdXNlcnNRdWVyeTI6IEVudGl0eVF1ZXJ5PFVzZXIuVFVzZXJTY2hlbWE+ID0ge1xuICBhdHRyaWJ1dGVzOiBbICdlbWFpbCcsICdmaXJzdE5hbWUnLCAnbGFzdE5hbWUnIF0sXG4gIGZpbHRlcnM6IHVzZXJGaWx0ZXJzLFxuICBwYWdpbmF0aW9uOiB7XG4gICAgY291bnQ6IDIwLFxuICB9XG59XG5cbmNvbnN0IGdyb3Vwc1F1ZXJ5OiBFbnRpdHlRdWVyeTxVc2VyLlRHcm91cFNjaGVtYT4gPSB7XG4gIGF0dHJpYnV0ZXM6IHtcbiAgICAnbmFtZSc6IHRydWUsXG4gICAgJ2dyb3VwSWQnOiB0cnVlLFxuICAgICdhZG1pbic6IHtcbiAgICAgIHJlbGF0aW9uVHlwZTogJ21hbnktdG8tb25lJyxcbiAgICAgIGVudGl0eU5hbWU6ICd1c2VyMicsXG4gICAgICBhdHRyaWJ1dGVzOiBbXG4gICAgICAgICdmaXJzdE5hbWUnLFxuICAgICAgICAnbGFzdE5hbWUnLFxuICAgICAgICAndGVuYW50JyxcbiAgICAgIF1cbiAgICB9XG4gIH0sXG4gIHBhZ2luYXRpb246IHtcbiAgICBjb3VudDogMjAsXG4gIH1cbn07XG5cbnR5cGUgeHl4eHggPSBFbnRpdHlBdHRyaWJ1dGVQYXRoczxVc2VyLlRHcm91cFNjaGVtYT47XG5cbmNvbnN0IGdyb3Vwc1F1ZXJ5MjogRW50aXR5UXVlcnk8VXNlci5UR3JvdXBTY2hlbWE+ID0ge1xuICBhdHRyaWJ1dGVzOiB7XG4gICAgJ25hbWUnOiB0cnVlLFxuICAgICdncm91cElkJzogdHJ1ZSxcbiAgICAnYWRtaW4nOiB7XG4gICAgICByZWxhdGlvblR5cGU6ICdtYW55LXRvLW9uZScsXG4gICAgICBlbnRpdHlOYW1lOiAndXNlcjInLFxuICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAnZmlyc3ROYW1lJzogdHJ1ZSxcbiAgICAgICAgJ2xhc3ROYW1lJzogdHJ1ZSxcbiAgICAgICAgJ3RlbmFudCc6IHtcbiAgICAgICAgICBlbnRpdHlOYW1lOiAndXNlcicsXG4gICAgICAgICAgcmVsYXRpb25UeXBlOiAnbWFueS10by1vbmUnLFxuICAgICAgICAgIGF0dHJpYnV0ZXM6IFsgJ2ZpcnN0TmFtZScsICdsYXN0TmFtZScgXVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9LFxuICBwYWdpbmF0aW9uOiB7XG4gICAgY291bnQ6IDIwLFxuICB9XG59XG5cbmNvbnN0IGdyb3Vwc1F1ZXJ5MzogRW50aXR5UXVlcnk8VXNlci5UR3JvdXBTY2hlbWE+ID0ge1xuICBhdHRyaWJ1dGVzOiBbICduYW1lJywgJ2dyb3VwSWQnLCAnYWRtaW4nLCAnYWRtaW4uZmlyc3ROYW1lJywgJ2FkbWluLmxhc3ROYW1lJywgJ2FkbWluLnRlbmFudC5maXJzdE5hbWUnLCAnYWRtaW4udGVuYW50Lmxhc3ROYW1lJyBdLFxuICBwYWdpbmF0aW9uOiB7XG4gICAgY291bnQ6IDIwLFxuICB9LFxuICBmaWx0ZXJzOiB7XG4gICAgbmFtZToge1xuICAgICAgZXE6ICd0ZXN0JyxcbiAgICAgIFwiIT1cIjogJ3Rlc3QyJyxcbiAgICAgIFwiaW5MaXN0XCI6IFsgJ3Rlc3QzJywgJ3Rlc3Q0JyBdLFxuICAgICAgbG9naWNhbE9wOiAnbm90JyxcbiAgICB9LFxuICAgIGFkbWluOiB7XG4gICAgICBlcTogJzEyMydcbiAgICB9XG4gIH1cblxuXG4gIC8vIHtcbiAgLy8gICBvcjogW1xuICAvLyAgICAge1xuICAvLyAgICAgICBhdHRyaWJ1dGU6ICdhZG1pbicsXG4gIC8vICAgICAgIGVxOiAnMTIzJ1xuICAvLyAgICAgfSxcbiAgLy8gICAgIHtcbiAgLy8gICAgICAgYXR0cmlidXRlOiAnbmFtZScsXG4gIC8vICAgICAgIGVxOiAndGVzdCdcbiAgLy8gICAgIH1cbiAgLy8gICBdXG4gIC8vIH1cbn1cblxuXG5kZXNjcmliZSgncXVlcnknLCAoKSA9PiB7XG5cbiAgaXQoJ3Nob3VsZCByZXR1cm4gcXVlcnkgb2JqZWN0JywgKCkgPT4ge1xuICAgIGV4cGVjdCgxID09PSAxKS50b0VxdWFsKHRydWUpO1xuXG4gICAgY29uc3QgcXEyID0ge1xuICAgICAgXCJwYWdpbmF0aW9uXCI6IHtcbiAgICAgICAgXCJsaW1pdFwiOiA0MFxuICAgICAgfSxcbiAgICAgIFwiZmlsdGVyc1wiOiB7XG4gICAgICAgIFwib3JcIjogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIFwiYW5kXCI6IFtcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIFwiYXR0cmlidXRlXCI6IFwibGFzdE5hbWVcIixcbiAgICAgICAgICAgICAgICBcImVxXCI6IFwiQXV0aG9yIE5hbWUgMDAyXCIsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBcImF0dHJpYnV0ZVwiOiBcImZpcnN0TmFtZVwiLFxuICAgICAgICAgICAgICAgIFwibmVxXCI6IFwiQm9vayBOYW1lIDAwMFwiXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBcImF0dHJpYnV0ZVwiOiBcImZpcnN0TmFtZVwiLFxuICAgICAgICAgICAgXCJpbkxpc3RcIjogWyBcIkJvb2sgTmFtZSAwMDVcIiBdXG4gICAgICAgICAgfVxuICAgICAgICBdXG4gICAgICB9XG4gICAgfVxuXG5cbiAgICBsZXQgZXhwOiBhbnk7XG5cbiAgICBjb25zdCByZXMgPSBVc2VyLmVudGl0eS5lbnRpdHkubWF0Y2goe30pLndoZXJlKChhdHRyLCBvcHApID0+IHtcbiAgICAgIGV4cCA9IGVudGl0eUZpbHRlckNyaXRlcmlhVG9FeHByZXNzaW9uKHFxMi5maWx0ZXJzIGFzIEVudGl0eUZpbHRlckNyaXRlcmlhPFVzZXIuVFVzZXJTY2hlbWE+LCBhdHRyLCBvcHApO1xuICAgICAgcmV0dXJuICcnXG4gICAgfSkucGFyYW1zKCk7XG5cbiAgICBjb25zb2xlLmxvZyhleHApO1xuICAgIGNvbnNvbGUubG9nKHJlcyk7XG5cbiAgfSk7XG5cbn0pO1xuXG5kZXNjcmliZSgncGFyc2VFbnRpdHlBdHRyaWJ1dGVQYXRocycsICgpID0+IHtcbiAgaXQoJ3Nob3VsZCB0cmFuc2Zvcm0gYXJyYXkgdG8gbmVzdGVkIG9iamVjdCcsICgpID0+IHtcblxuICAgIGNvbnN0IGFycmF5ID0gWyAnbmFtZScsICdncm91cElkJywgJ2FkbWluJywgJ2FkbWluLmZpcnN0TmFtZScsICdhZG1pbi5sYXN0TmFtZScsICdhZG1pbi50ZW5hbnQnLCAnYWRtaW4udGVuYW50LmZpcnN0TmFtZScsICdhZG1pbi50ZW5hbnQubGFzdE5hbWUnIF07XG5cbiAgICBjb25zdCByZXN1bHQgPSBwYXJzZUVudGl0eUF0dHJpYnV0ZVBhdGhzKGFycmF5KTtcblxuICAgIC8vIERJQ29udGFpbmVyLlJPT1QucmVnaXN0ZXIoe1xuICAgIC8vICAgdXNlVmFsdWU6IFVzZXIuZ3JvdXBTY2gsXG4gICAgLy8gICB0eXBlOiAnc2NoZW1hJyxcbiAgICAvLyAgIGZvckVudGl0eTogVXNlci5ncm91cFNjaC5tb2RlbC5lbnRpdHksXG4gICAgLy8gICBwcm92aWRlOiBVc2VyLmdyb3VwU2NoLm1vZGVsLmVudGl0eSsgJ1NjaGVtYSdcbiAgICAvLyB9KVxuXG4gICAgLy8gRElDb250YWluZXIuUk9PVC5yZWdpc3Rlcih7XG4gICAgLy8gICB1c2VWYWx1ZTogVXNlci5zY2hlbWEsXG4gICAgLy8gICB0eXBlOiAnc2NoZW1hJyxcbiAgICAvLyAgIGZvckVudGl0eTogVXNlci5zY2hlbWEubW9kZWwuZW50aXR5LFxuICAgIC8vICAgcHJvdmlkZTogVXNlci5zY2hlbWEubW9kZWwuZW50aXR5KyAnU2NoZW1hJ1xuICAgIC8vIH0pXG5cbiAgICAvLyBESUNvbnRhaW5lci5ST09ULnJlZ2lzdGVyKHtcbiAgICAvLyAgIHVzZVZhbHVlOiBVc2VyLnVzZXJTY2gyLFxuICAgIC8vICAgdHlwZTogJ3NjaGVtYScsXG4gICAgLy8gICBmb3JFbnRpdHk6IFVzZXIudXNlclNjaDIubW9kZWwuZW50aXR5LFxuICAgIC8vICAgcHJvdmlkZTogVXNlci51c2VyU2NoMi5tb2RlbC5lbnRpdHkrICdTY2hlbWEnXG4gICAgLy8gfSlcblxuICAgIERJQ29udGFpbmVyLlJPT1QucmVnaXN0ZXIoe1xuICAgICAgdXNlVmFsdWU6IHt9LFxuICAgICAgcHJvdmlkZTogRElfVE9LRU5TLkRZTkFNT19FTlRJVFlfQ09ORklHVVJBVElPTlNcbiAgICB9KTtcblxuICAgIHJlZ2lzdGVyRW50aXR5U2NoZW1hKHtcbiAgICAgIGZvckVudGl0eTogVXNlci5ncm91cFNjaC5tb2RlbC5lbnRpdHksXG4gICAgICB1c2VWYWx1ZTogVXNlci5ncm91cFNjaCxcbiAgICB9KVxuICAgIHJlZ2lzdGVyRW50aXR5U2NoZW1hKHtcbiAgICAgIGZvckVudGl0eTogVXNlci51c2VyU2NoMi5tb2RlbC5lbnRpdHksXG4gICAgICB1c2VWYWx1ZTogVXNlci51c2VyU2NoMixcbiAgICB9KVxuICAgIHJlZ2lzdGVyRW50aXR5U2NoZW1hKHtcbiAgICAgIGZvckVudGl0eTogVXNlci5zY2hlbWEubW9kZWwuZW50aXR5LFxuICAgICAgdXNlVmFsdWU6IFVzZXIuc2NoZW1hLFxuICAgIH0pXG5cbiAgICBjb25zdCBlbnRpdHlTZXJ2aWNlID0gRElDb250YWluZXIuUk9PVC5yZXNvbHZlRW50aXR5U2VydmljZShVc2VyLmdyb3VwU2NoLm1vZGVsLmVudGl0eSkgYXMgYW55O1xuXG4gICAgY29uc3QgaW5mZXJyZWQgPSBlbnRpdHlTZXJ2aWNlLmluZmVyUmVsYXRpb25zaGlwc0ZvckVudGl0eVNlbGVjdGlvbnMoVXNlci5ncm91cFNjaCwgcmVzdWx0KTtcblxuICAgIGNvbnN0IGV4cGVjdGVkID0ge1xuICAgICAgbmFtZTogdHJ1ZSxcbiAgICAgIGdyb3VwSWQ6IHRydWUsXG4gICAgICBhZG1pbjoge1xuICAgICAgICBlbnRpdHlOYW1lOiBcInVzZXIyXCIsXG4gICAgICAgIHJlbGF0aW9uVHlwZTogXCJtYW55LXRvLW9uZVwiLFxuICAgICAgICBpZGVudGlmaWVyczogWyB7IHNvdXJjZTogXCJhZG1pblwiLCB0YXJnZXQ6IFwidXNlcklkXCIgfSBdLFxuICAgICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgZmlyc3ROYW1lOiB0cnVlLFxuICAgICAgICAgIGxhc3ROYW1lOiB0cnVlLFxuICAgICAgICAgIHRlbmFudDoge1xuICAgICAgICAgICAgZW50aXR5TmFtZTogXCJ1c2VyXCIsXG4gICAgICAgICAgICByZWxhdGlvblR5cGU6IFwibWFueS10by1vbmVcIixcbiAgICAgICAgICAgIGlkZW50aWZpZXJzOiBbIHsgc291cmNlOiBcInRlbmFudElkXCIsIHRhcmdldDogXCJ1c2VySWRcIiB9IF0sXG4gICAgICAgICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgICAgIGZpcnN0TmFtZTogdHJ1ZSxcbiAgICAgICAgICAgICAgbGFzdE5hbWU6IHRydWUsXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSxcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICB9O1xuXG4gICAgY29uc29sZS5sb2coSlNPTi5zdHJpbmdpZnkoaW5mZXJyZWQsIG51bGwsIDIpKTtcblxuICAgIGV4cGVjdChpbmZlcnJlZCkudG9FcXVhbChleHBlY3RlZCk7XG5cbiAgfSk7XG59KTtcblxuXG5kZXNjcmliZSgnaW5mZXJSZWxhdGlvbnNoaXBzRm9yRW50aXR5U2VsZWN0aW9ucyAtIHBhdGgtYmFzZWQgY3ljbGUgZGV0ZWN0aW9uJywgKCkgPT4ge1xuXG4gIGNvbnN0IHVzZXJTY2hlbWFNb2NrID0gY3JlYXRlRW50aXR5U2NoZW1hKHtcbiAgICBtb2RlbDoge1xuICAgICAgZW50aXR5OiAnVXNlcicsXG4gICAgICBlbnRpdHlOYW1lUGx1cmFsOiAnVXNlcnMnLFxuICAgICAgZW50aXR5T3BlcmF0aW9uczogRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgICBzZXJ2aWNlOiAneHh4JyxcbiAgICAgIHZlcnNpb246ICcxJyxcbiAgICB9LFxuICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgIHVzZXJJZDogeyB0eXBlOiAnc3RyaW5nJyB9LCAvLyBub24tcmVsYXRpb25hbFxuICAgICAgbmFtZTogeyB0eXBlOiAnc3RyaW5nJyB9LFxuICAgICAgZ3JvdXA6IHtcbiAgICAgICAgdHlwZTogJ2FueScsXG4gICAgICAgIC8vIEEgcmVsYXRpb25hbCBhdHRyaWJ1dGUgcmVmZXJlbmNpbmcgR3JvdXBcbiAgICAgICAgcmVsYXRpb246IHtcbiAgICAgICAgICBlbnRpdHlOYW1lOiAnR3JvdXAnLFxuICAgICAgICAgIHR5cGU6ICdtYW55LXRvLW9uZScsXG4gICAgICAgICAgaHlkcmF0ZTogdHJ1ZSxcbiAgICAgICAgICBpZGVudGlmaWVyczogWyB7IHNvdXJjZTogJ2dyb3VwSWQnLCB0YXJnZXQ6ICdncm91cElkJyB9IF0sXG4gICAgICAgICAgYXR0cmlidXRlczogeyBncm91cElkOiB0cnVlLCB0aXRsZTogdHJ1ZSB9IC8vIG9yIHNvbWV0aGluZ1xuICAgICAgICB9XG4gICAgICB9LFxuICAgIH0sXG4gICAgaW5kZXhlczoge1xuICAgICAgcHJpbWFyeToge1xuICAgICAgICBwazoge1xuICAgICAgICAgIGZpZWxkOiAncGsnLFxuICAgICAgICAgIGNvbXBvc2l0ZTogWyAndXNlcklkJyBdLFxuICAgICAgICB9LFxuICAgICAgICBzazoge1xuICAgICAgICAgIGZpZWxkOiAnc2snLFxuICAgICAgICAgIGNvbXBvc2l0ZTogW10sXG4gICAgICAgIH0sXG4gICAgICB9XG4gICAgfVxuICB9IGFzIGNvbnN0KTtcblxuICBjb25zdCBncm91cFNjaGVtYU1vY2sgPSBjcmVhdGVFbnRpdHlTY2hlbWEoe1xuICAgIG1vZGVsOiB7XG4gICAgICBlbnRpdHk6ICdHcm91cCcsXG4gICAgICBlbnRpdHlOYW1lUGx1cmFsOiAnR3JvdXBzJyxcbiAgICAgIGVudGl0eU9wZXJhdGlvbnM6IERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLFxuICAgICAgc2VydmljZTogJ3h4eCcsXG4gICAgICB2ZXJzaW9uOiAnMScsXG4gICAgfSxcbiAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICBncm91cElkOiB7IHR5cGU6ICdzdHJpbmcnIH0sXG4gICAgICB0aXRsZTogeyB0eXBlOiAnc3RyaW5nJyB9LFxuICAgICAgbWVtYmVyczoge1xuICAgICAgICB0eXBlOiAnYW55JyxcbiAgICAgICAgLy8gcmVmZXJlbmNlcyB1c2VyXG4gICAgICAgIHJlbGF0aW9uOiB7XG4gICAgICAgICAgZW50aXR5TmFtZTogJ1VzZXInLFxuICAgICAgICAgIHR5cGU6ICdvbmUtdG8tbWFueScsXG4gICAgICAgICAgaHlkcmF0ZTogdHJ1ZSxcbiAgICAgICAgICBpZGVudGlmaWVyczogWyB7IHNvdXJjZTogJ21lbWJlcnMnLCB0YXJnZXQ6ICd1c2VySWQnIH0gXSxcbiAgICAgICAgICBhdHRyaWJ1dGVzOiB7IHVzZXJJZDogdHJ1ZSwgbmFtZTogdHJ1ZSwgZ3JvdXA6IHRydWUgfSAvLyBjYW4gcmVjdXJzaXZlbHkgcG9pbnQgYmFja1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSxcbiAgICBpbmRleGVzOiB7XG4gICAgICBwcmltYXJ5OiB7XG4gICAgICAgIHBrOiB7XG4gICAgICAgICAgZmllbGQ6ICdwaycsXG4gICAgICAgICAgY29tcG9zaXRlOiBbICdncm91cElkJyBdLFxuICAgICAgICB9LFxuICAgICAgICBzazoge1xuICAgICAgICAgIGZpZWxkOiAnc2snLFxuICAgICAgICAgIGNvbXBvc2l0ZTogW10sXG4gICAgICAgIH0sXG4gICAgICB9XG4gICAgfVxuICB9KTtcblxuICBsZXQgZGlDb250YWluZXI6IElESUNvbnRhaW5lcjtcblxuICBiZWZvcmVFYWNoKCgpID0+IHtcblxuICAgIGRpQ29udGFpbmVyID0gRElDb250YWluZXIuUk9PVC5jcmVhdGVDaGlsZENvbnRhaW5lcignQ0MtZm9yLWluZmVyUmVsYXRpb25zaGlwc0ZvckVudGl0eVNlbGVjdGlvbnMnKTtcblxuICAgIGRpQ29udGFpbmVyLnJlZ2lzdGVyKHtcbiAgICAgIHVzZVZhbHVlOiB7fSxcbiAgICAgIHByb3ZpZGU6IERJX1RPS0VOUy5EWU5BTU9fRU5USVRZX0NPTkZJR1VSQVRJT05TXG4gICAgfSk7XG5cbiAgICByZWdpc3RlckVudGl0eVNjaGVtYSh7XG4gICAgICBmb3JFbnRpdHk6IHVzZXJTY2hlbWFNb2NrLm1vZGVsLmVudGl0eSxcbiAgICAgIHVzZVZhbHVlOiB1c2VyU2NoZW1hTW9jayxcbiAgICAgIHByb3ZpZGVkSW46IGRpQ29udGFpbmVyLFxuICAgIH0pXG5cbiAgICByZWdpc3RlckVudGl0eVNjaGVtYSh7XG4gICAgICBmb3JFbnRpdHk6IGdyb3VwU2NoZW1hTW9jay5tb2RlbC5lbnRpdHksXG4gICAgICB1c2VWYWx1ZTogZ3JvdXBTY2hlbWFNb2NrLFxuICAgICAgcHJvdmlkZWRJbjogZGlDb250YWluZXIsXG4gICAgfSlcblxuICB9KVxuXG4gIGl0KCdzaG91bGQgaGFuZGxlIG5vbi1yZWxhdGlvbmFsIGF0dHJpYnV0ZXMgb25seSAobm8gcmVjdXJzaW9uKScsICgpID0+IHtcbiAgICBjb25zdCBwYXJzZWQgPSBwYXJzZUVudGl0eUF0dHJpYnV0ZVBhdGhzKFsgJ3VzZXJJZCcsICduYW1lJyBdKTtcbiAgICBjb25zdCB1c2VyU2VydmljZSA9IGRpQ29udGFpbmVyLnJlc29sdmVFbnRpdHlTZXJ2aWNlPEJhc2VFbnRpdHlTZXJ2aWNlPHR5cGVvZiB1c2VyU2NoZW1hTW9jaz4+KHVzZXJTY2hlbWFNb2NrLm1vZGVsLmVudGl0eSk7XG4gICAgY29uc3QgcmVzdWx0ID0gdXNlclNlcnZpY2UuaW5mZXJSZWxhdGlvbnNoaXBzRm9yRW50aXR5U2VsZWN0aW9ucyhcbiAgICAgIHVzZXJTY2hlbWFNb2NrLFxuICAgICAgcGFyc2VkXG4gICAgKTtcbiAgICAvLyBXZSBleHBlY3QgaXQgdG8ganVzdCBjb3B5IHRoZW0gb3ZlclxuICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoe1xuICAgICAgdXNlcklkOiB0cnVlLFxuICAgICAgbmFtZTogdHJ1ZVxuICAgIH0pO1xuICB9KTtcblxuICBpdCgnc2hvdWxkIGV4cGFuZCBzaW5nbGUtbGV2ZWwgcmVsYXRpb24gbm9ybWFsbHknLCAoKSA9PiB7XG4gICAgY29uc3QgcGFyc2VkID0gcGFyc2VFbnRpdHlBdHRyaWJ1dGVQYXRocyhbICd1c2VySWQnLCAnZ3JvdXAnLCAnZ3JvdXAubWVtYmVycy51c2VySWQnIF0pO1xuICAgIGNvbnN0IHVzZXJTZXJ2aWNlID0gZGlDb250YWluZXIucmVzb2x2ZUVudGl0eVNlcnZpY2U8QmFzZUVudGl0eVNlcnZpY2U8dHlwZW9mIHVzZXJTY2hlbWFNb2NrPj4odXNlclNjaGVtYU1vY2subW9kZWwuZW50aXR5KTtcbiAgICBjb25zdCByZXN1bHQgPSB1c2VyU2VydmljZS5pbmZlclJlbGF0aW9uc2hpcHNGb3JFbnRpdHlTZWxlY3Rpb25zKFxuICAgICAgdXNlclNjaGVtYU1vY2ssXG4gICAgICBwYXJzZWRcbiAgICApIGFzIGFueTtcbiAgICAvLyBXZSBleHBlY3QgJ2dyb3VwJyB0byBleHBhbmQgaW50byB0aGUgcmVsYXRpb24gc3RydWN0dXJlIHJlZmVyZW5jaW5nIEdyb3VwXG4gICAgZXhwZWN0KHJlc3VsdC5ncm91cCkudG9CZURlZmluZWQoKTtcbiAgICBleHBlY3QoKHJlc3VsdC5ncm91cCkucmVsYXRpb25UeXBlKS50b0JlKCdtYW55LXRvLW9uZScpO1xuICAgIGV4cGVjdCgocmVzdWx0Lmdyb3VwKS5hdHRyaWJ1dGVzKS50b0hhdmVQcm9wZXJ0eSgnbWVtYmVycycpOyAvLyBldGMuXG4gIH0pO1xuXG4gIGl0KCdzaG91bGQgc2tpcCBleHBhbnNpb25zIGlmIGN5Y2xlIGlzIGRldGVjdGVkIChVc2VyLT5Hcm91cC0+VXNlciknLCAoKSA9PiB7XG4gICAgLy8gcGF0aDogJ2dyb3VwLm1lbWJlcnMuZ3JvdXAubWVtYmVycy4uLicgbGVhZHMgdG8gYSBjeWNsZVxuICAgIC8vIFdlJ2xsIHJlcXVlc3QgZGVlcCBleHBhbnNpb25zXG4gICAgY29uc3QgcGFyc2VkID0gcGFyc2VFbnRpdHlBdHRyaWJ1dGVQYXRocyhbXG4gICAgICAnZ3JvdXAnLFxuICAgICAgJ2dyb3VwLm1lbWJlcnMnLFxuICAgICAgJ2dyb3VwLm1lbWJlcnMuZ3JvdXAuaWQnLFxuICAgICAgJ2dyb3VwLm1lbWJlcnMuZ3JvdXAubWVtYmVycy5pZCdcbiAgICAgIC8vIGFuZCBzbyBvblxuICAgIF0pO1xuICAgIGNvbnN0IHVzZXJTZXJ2aWNlID0gZGlDb250YWluZXIucmVzb2x2ZUVudGl0eVNlcnZpY2U8QmFzZUVudGl0eVNlcnZpY2U8dHlwZW9mIHVzZXJTY2hlbWFNb2NrPj4odXNlclNjaGVtYU1vY2subW9kZWwuZW50aXR5KTtcbiAgICBjb25zdCByZXN1bHQgPSB1c2VyU2VydmljZS5pbmZlclJlbGF0aW9uc2hpcHNGb3JFbnRpdHlTZWxlY3Rpb25zKFxuICAgICAgdXNlclNjaGVtYU1vY2ssXG4gICAgICBwYXJzZWRcbiAgICApO1xuXG4gICAgLy8gV2UgZXhwZWN0IHRoYXQgb25jZSBpdCBjeWNsZXMgYmFjayB0byBcIlVzZXJcIiBmcm9tIFwiR3JvdXAubWVtYmVyc1wiIC0+IFwiVXNlclwiIC0+IFwiZ3JvdXBcIixcbiAgICAvLyBpdCB3aWxsIHNraXAgZXhwYW5zaW9ucyBvbiB0aGF0IGN5YyBhdHRyaWJ1dGVcbiAgICBjb25zdCBncnAgPSByZXN1bHQuZ3JvdXAgYXMgYW55O1xuICAgIGV4cGVjdChncnApLnRvTWF0Y2hPYmplY3Qoe1xuICAgICAgZW50aXR5TmFtZTogJ0dyb3VwJyxcbiAgICAgIGF0dHJpYnV0ZXM6IGV4cGVjdC5hbnkoT2JqZWN0KVxuICAgIH0pO1xuICAgIGNvbnN0IG1lbSA9IChncnAuYXR0cmlidXRlcyBhcyBhbnkpLm1lbWJlcnM7XG4gICAgZXhwZWN0KG1lbSkudG9NYXRjaE9iamVjdCh7XG4gICAgICBlbnRpdHlOYW1lOiAnVXNlcicsXG4gICAgICBhdHRyaWJ1dGVzOiBleHBlY3QuYW55KE9iamVjdClcbiAgICB9KTtcbiAgICAvLyBUaGVuIHdlIHNlZSBpZiBtZW0uYXR0cmlidXRlcy5ncm91cCB3YXMgZXhwYW5kZWQgb3Igc2tpcHBlZFxuICAgIC8vIElmIGN5Y2xlIHdhcyBkZXRlY3RlZCwgd2UgZWl0aGVyIHNlZSBhIGBza2lwcGVkRHVlVG9DeWNsZWAgb3IgbWluaW1hbCBvYmplY3RcbiAgICBpZiAobWVtLmF0dHJpYnV0ZXMuZ3JvdXAuc2tpcHBlZER1ZVRvQ3ljbGUpIHtcbiAgICAgIGV4cGVjdChtZW0uYXR0cmlidXRlcy5ncm91cC5za2lwcGVkRHVlVG9DeWNsZSkudG9CZSh0cnVlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gT3IgaWYgeW91ciBjb2RlIHNldHMgc29tZXRoaW5nIGVsc2VcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ3ljbGUgbm90IGRldGVjdGVkIHdoZXJlIGV4cGVjdGVkYCk7XG4gICAgfVxuICB9KTtcblxuICBpdCgnc2hvdWxkIGNvbnRpbnVlIGh5ZHJhdGluZyBzaWJsaW5nIGF0dHJpYnV0ZXMgZXZlbiBpZiBvbmUgYXR0cmlidXRlIGlzIGN5YycsICgpID0+IHtcbiAgICAvLyBTdXBwb3NlIHdlIGFzayBmb3IgdXNlcklkLCBuYW1lLCBncm91cCwgZ3JvdXAubWVtYmVyc1xuICAgIC8vIFRoZSBjeWNsZSBpcyBpbiBcImdyb3VwLm1lbWJlcnMuZ3JvdXAuLi5cIiwgYnV0IFwidXNlcklkXCIgaXMgdW5hZmZlY3RlZFxuICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlRW50aXR5QXR0cmlidXRlUGF0aHMoWyAndXNlcklkJywgJ2dyb3VwJywgJ2dyb3VwLm1lbWJlcnMudXNlcklkJywgJ2dyb3VwLm1lbWJlcnMuZ3JvdXAuaWQnIF0pO1xuICAgIGNvbnN0IHVzZXJTZXJ2aWNlID0gZGlDb250YWluZXIucmVzb2x2ZUVudGl0eVNlcnZpY2U8QmFzZUVudGl0eVNlcnZpY2U8dHlwZW9mIHVzZXJTY2hlbWFNb2NrPj4odXNlclNjaGVtYU1vY2subW9kZWwuZW50aXR5KTtcbiAgICBjb25zdCByZXN1bHQgPSB1c2VyU2VydmljZS5pbmZlclJlbGF0aW9uc2hpcHNGb3JFbnRpdHlTZWxlY3Rpb25zKHVzZXJTY2hlbWFNb2NrLCBwYXJzZWQpIGFzIGFueTtcblxuICAgIC8vIFwidXNlcklkXCIgbXVzdCBiZSBwcmVzZW50XG4gICAgZXhwZWN0KHJlc3VsdC51c2VySWQpLnRvQmUodHJ1ZSk7XG5cbiAgICAvLyBcImdyb3VwXCIgZXhwYW5zaW9uc1xuICAgIGV4cGVjdChyZXN1bHQuZ3JvdXAuZW50aXR5TmFtZSkudG9CZSgnR3JvdXAnKTtcbiAgICBleHBlY3QocmVzdWx0Lmdyb3VwLmF0dHJpYnV0ZXMpLnRvSGF2ZVByb3BlcnR5KCdtZW1iZXJzJyk7XG4gICAgLy8gbWVtYmVycyBleHBhbnNpb25zXG4gICAgZXhwZWN0KHJlc3VsdC5ncm91cC5hdHRyaWJ1dGVzLm1lbWJlcnMuZW50aXR5TmFtZSkudG9CZSgnVXNlcicpO1xuXG4gICAgLy8gdGhlIGN5YyByZWN1cnNpb24gaXMgXCJncm91cC5tZW1iZXJzLmdyb3VwXCJcbiAgICAvLyBUaGlzIHNob3VsZCBiZSBhIHBhcnRpYWwgc2tpcFxuICAgIGNvbnN0IGN5YyA9IHJlc3VsdC5ncm91cC5hdHRyaWJ1dGVzLm1lbWJlcnMuYXR0cmlidXRlcy5ncm91cDtcbiAgICBleHBlY3QoY3ljKS50b0hhdmVQcm9wZXJ0eSgnc2tpcHBlZER1ZVRvQ3ljbGUnLCB0cnVlKTtcblxuICAgIC8vIEJ1dCBzaWJsaW5nIGF0dHJpYnV0ZXMgKGxpa2UgdXNlcklkKSBhcmUgc3RpbGwgZXhwYW5kZWRcbiAgICAvLyBlLmcuIFwibWVtYmVycy5hdHRyaWJ1dGVzLnVzZXJJZFwiIG9yIFwibWVtYmVycy5hdHRyaWJ1dGVzLm5hbWVcIiBpZiB3ZSBoYWQgdGhlbSBpbiB0aGUgcGFyc2VcbiAgfSk7XG5cbiAgaXQoJ3Nob3VsZCByZXNwZWN0IG1heERlcHRoIGlmIHJlY3Vyc2lvbiBpcyB0b28gZGVlcCcsICgpID0+IHtcbiAgICAvLyBXZSdsbCBkbyBhIGJpZyBjaGFpbjogdXNlci0+Z3JvdXAtPm1lbWJlcnMtPmdyb3VwLT5tZW1iZXJzLT5ncm91cC4uLlxuICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlRW50aXR5QXR0cmlidXRlUGF0aHMoW1xuICAgICAgJ2dyb3VwJyxcbiAgICAgICdncm91cC5tZW1iZXJzJyxcbiAgICAgICdncm91cC5tZW1iZXJzLmdyb3VwJyxcbiAgICAgICdncm91cC5tZW1iZXJzLmdyb3VwLm1lbWJlcnMudXNlcklkJyxcbiAgICAgICdncm91cC5tZW1iZXJzLmdyb3VwLm1lbWJlcnMuZ3JvdXAuaWQnLCAvLyBhbmQgc28gZm9ydGhcbiAgICBdKTtcbiAgICBjb25zdCB1c2VyU2VydmljZSA9IGRpQ29udGFpbmVyLnJlc29sdmVFbnRpdHlTZXJ2aWNlPEJhc2VFbnRpdHlTZXJ2aWNlPHR5cGVvZiB1c2VyU2NoZW1hTW9jaz4+KHVzZXJTY2hlbWFNb2NrLm1vZGVsLmVudGl0eSk7XG4gICAgY29uc3QgcmVzdWx0ID0gdXNlclNlcnZpY2UuaW5mZXJSZWxhdGlvbnNoaXBzRm9yRW50aXR5U2VsZWN0aW9ucyhcbiAgICAgIHVzZXJTY2hlbWFNb2NrLFxuICAgICAgcGFyc2VkLFxuICAgICAgJ1VzZXInLCAgICAgLy8gaW5pdGlhbCBwYXRoXG4gICAgICBuZXcgU2V0KCksICAvLyBmcmVzaCB2aXNpdGVkXG4gICAgICAzICAgICAgICAgICAvLyBzbWFsbCBtYXhEZXB0aFxuICAgICk7XG4gICAgLy8gQWZ0ZXIgZGVwdGg9MywgZXhwYW5zaW9ucyBzaG91bGQgc2tpcFxuICAgIC8vIGUuZy4gYXQgcGF0aCBkZXB0aCA0IG9yIG1vcmVcbiAgICBjb25zdCBncnAgPSByZXN1bHQuZ3JvdXAgYXMgYW55O1xuICAgIGV4cGVjdChncnAuYXR0cmlidXRlcy5tZW1iZXJzKS50b0JlRGVmaW5lZCgpO1xuICAgIC8vIG1lbWJlcnMgPT4gdXNlciwgdXNlciA9PiBncm91cCA9PiBzaG91bGQgc2tpcCBleHBhbnNpb25zIGJleW9uZCB0aGF0IGRlcHRoXG4gICAgY29uc3QgbWF5YmVTa2lwcGVkID0gZ3JwLmF0dHJpYnV0ZXMubWVtYmVycy5hdHRyaWJ1dGVzLmdyb3VwO1xuICAgIGV4cGVjdChtYXliZVNraXBwZWQpLnRvTWF0Y2hPYmplY3Qoe1xuICAgICAgZW50aXR5TmFtZTogJ0dyb3VwJyxcbiAgICAgIHNraXBwZWREdWVUb0N5Y2xlOiB0cnVlXG4gICAgfSk7XG4gIH0pO1xuXG59KTsiXX0=