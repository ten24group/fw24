/* eslint-disable @typescript-eslint/no-namespace */

import { Narrow } from '../utils/types';

import { describe, expect, it } from '@jest/globals';
import { EntityFilterCriteria, EntityQuery, FilterGroup } from './query-types';
import { randomUUID } from 'crypto';
import {
  DefaultEntityOperations,
  EntityAttribute,
  EntitySchema,
  EntityAttributePaths,
  createElectroDBEntity,
  createEntityRelation,
  createEntitySchema,
} from './base-entity';
import { entityFilterCriteriaToExpression, parseEntityAttributePaths } from './query';
import { DIContainer } from '../di';
import { DI_TOKENS } from '../const';
import { registerEntitySchema } from '../decorators';
import { BaseEntityService } from './base-service';
import { IDIContainer } from '../interfaces';
namespace User {
  export const createUserSchema = () =>
    createEntitySchema({
      model: {
        version: '1',
        entity: 'user',
        entityNamePlural: 'Users',
        entityOperations: DefaultEntityOperations,
        service: 'users', // electro DB service name [logical group of entities]
      },
      attributes: {
        userId: {
          type: 'string',
          required: true,
          readOnly: true,
          default: () => randomUUID(),
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
          type: 'string',
          readOnly: true,
          required: true,
          default: () => Date.now().toString(),
          set: () => Date.now().toString(),
        },
        updatedAt: {
          type: 'string',
          watch: '*', // will be set every time any prop is updated
          required: true,
          readOnly: true,
          default: () => Date.now().toString(),
          set: () => Date.now().toString(),
        },
        deletedAt: {
          type: 'string',
          readOnly: false,
        },
      },
      indexes: {
        primary: {
          pk: {
            field: 'pk',
            template: 't_${tenantId}#u_${userId}',
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
            template: 't_${tenantId}#u_${email}',
            composite: ['tenantId', 'email'],
          },
          sk: {
            field: 'gsi1sk',
            composite: [],
          },
        },
      },
    } as const);

  export type TUserSchema = ReturnType<typeof createUserSchema>;

  export const schema = createUserSchema();
  export const entity = createElectroDBEntity({
    schema: schema,
    entityConfigurations: {
      table: 'xxxx',
    },
  });

  // @Service({forEntity: schema.model.entity})
  // class UserService extends BaseEntityService<User.TUserSchema> {
  //   constructor(){
  //     super(User.schema, null as any, DIContainer.ROOT);
  //   }
  // }

  export const createUserSchema2 = () =>
    createEntitySchema({
      model: {
        version: '2',
        entity: 'user2',
        entityNamePlural: 'Users2',
        entityOperations: {
          get: 'get',
          list: 'list',
          create: 'create',
          update: 'update',
          upsert: 'upsert',
          delete: 'delete',
          query: 'query',
          duplicate: 'duplicate',
          xxx: 'xxx',
          yyy: 'yyy',
        },
        service: 'users', // electro DB service name [logical group of entities]
      },
      attributes: {
        userId: {
          type: 'string',
          required: true,
          readOnly: true,
          default: () => randomUUID(),
        },
        tenant: {
          type: 'string',
          required: true,
          readOnly: true,
          default: () => 'xxx-yyy-zzz', // TODO: have some global logic drive this value
          relation: createEntityRelation<TUserSchema>({
            entityName: 'user',
            type: 'many-to-one',
            attributes: ['userId', 'updatedAt', 'createdAt'],
            identifiers: [
              {
                source: 'tenantId',
                target: 'userId',
              },
            ],
          } as const),
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
          type: 'string',
          readOnly: true,
          required: true,
          default: () => Date.now().toString(),
          set: () => Date.now().toString(),
        },
        updatedAt: {
          type: 'string',
          watch: '*', // will be set every time any prop is updated
          required: true,
          readOnly: true,
          default: () => Date.now().toString(),
          set: () => Date.now().toString(),
        },
        deletedAt: {
          type: 'string',
          readOnly: false,
        },
      },
      indexes: {
        primary: {
          pk: {
            field: 'pk',
            template: 't_${tenantId}#u_${userId}',
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
            template: 't_${tenantId}#u_${email}',
            composite: ['tenantId', 'email'],
          },
          sk: {
            field: 'gsi1sk',
            composite: [],
          },
        },
      },
    } as const);

  export type TUserSchema2 = ReturnType<typeof createUserSchema2>;
  export const userSch2 = createUserSchema2();

  export const createGroupSchema = () =>
    createEntitySchema({
      model: {
        version: '1',
        entity: 'group',
        entityNamePlural: 'Groups',
        entityOperations: DefaultEntityOperations,
        service: 'users', // electro DB service name [logical group of entities]
      },
      attributes: {
        groupId: {
          type: 'string',
          required: true,
          readOnly: true,
          default: () => randomUUID(),
        },
        admin: {
          type: 'string',
          required: true,
          readOnly: true,
          default: () => 'xxx-yyy-zzz', // TODO: have some global logic drive this value
          relation: createEntityRelation<TUserSchema2>({
            entityName: 'user2',
            type: 'many-to-one',
            identifiers: [
              {
                source: 'admin',
                target: 'userId',
              },
            ],
          } as const),

          fieldType: 'select',

          options: {
            apiMethod: 'GET',
            apiUrl: '/entity/user2',
            responseKey: 'items',
          },
        },
        name: {
          type: 'string',
          required: true,
        },
        createdAt: {
          // will be set once at the time of create
          type: 'string',
          readOnly: true,
          required: true,
          default: () => Date.now().toString(),
          set: () => Date.now().toString(),
        },
        updatedAt: {
          type: 'string',
          watch: '*', // will be set every time any prop is updated
          required: true,
          readOnly: true,
          default: () => Date.now().toString(),
          set: () => Date.now().toString(),
        },
      },
      indexes: {
        primary: {
          pk: {
            field: 'pk',
            template: 't_${tenantId}#u_${userId}',
            composite: ['tenantId', 'userId'],
          },
          sk: {
            field: 'sk',
            composite: [],
          },
        },
      },
    } as const);

  export type TGroupSchema = ReturnType<typeof createGroupSchema>;
  export const groupSch = createGroupSchema();

  // @Service({forEntity: groupSch.model.entity})
  // class GroupService extends BaseEntityService<User.TGroupSchema> {
  //   constructor(){
  //     super(User.groupSch, null as any, DIContainer.ROOT);
  //   }
  // }

  export function createEntityAttribute<A extends EntityAttribute>(att: A): A {
    return att;
  }

  export function createEntityModelMeta<M extends EntitySchema<any, any, any>['model']>(model: M): M {
    return model;
  }

  export function createEntityAccessPattern<
    Idx extends EntitySchema<any, any, any>['indexes'][keyof EntitySchema<any, any, any>['indexes']],
  >(idx: Idx): Idx {
    return idx;
  }

  export class BaseEntity {
    protected getModel() {
      return createEntityModelMeta({
        entity: this.constructor.name,
        version: '1',
        service: `${this.constructor.name}Service`,
        entityNamePlural: 'Tests', // pluralize `this.constructor.name` use `https://github.com/plurals/pluralize`
        entityOperations: DefaultEntityOperations,
      });
    }

    protected getAttributes() {
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
          set: () => new Date().toISOString(),
        }),
      } as const;
    }

    protected getAccessPatterns() {
      return {};
    }

    public getSchema() {
      return createEntitySchema({
        model: this.getModel(),
        attributes: this.getAttributes(),
        indexes: this.getAccessPatterns(),
      });
    }
  }

  export class TestEntity extends BaseEntity {
    readonly attributes = {
      id: createEntityAttribute({
        type: 'string',
        readOnly: true,
        isIdentifier: true,
      }),

      firstName: createEntityAttribute({
        type: 'string',
        required: true,
      }),

      lastName: createEntityAttribute({
        type: 'string',
      }),
    } as const;

    readonly indexes = {
      default: createEntityAccessPattern({
        pk: {
          field: 'pk',
          composite: ['id'],
        },
        sk: {
          field: 'sk',
          composite: [],
        },
      }),
    } as const;

    public getAttributes() {
      return {
        ...super.getAttributes(),
        ...this.attributes,
      };
    }

    public getAccessPatterns() {
      return {
        ...super.getAccessPatterns(),
        ...this.indexes,
      };
    }

    public test() {
      const sch = this.getSchema().attributes;
    }
  }
}

const testFilter: FilterGroup<any> = {
  or: [
    {
      attribute: 'lastName',
      eq: 'someName',
      between: {
        val: ['122', '126'],
        filterLabel: 'Between xxx and yyyy',
      },
    },
    {
      and: [
        {
          attribute: 'createdAt',
          bt: { from: 1, to: 2 },
          gt: `now()`,
        },
        {
          attribute: 'lastName',
          contains: 'Nit',
        },
      ],
    },
  ],
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
const userFilters: EntityFilterCriteria<User.TUserSchema> = {
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
        valLabel: 'Between xxx and yyyy',
      },
    },
  ],
  or: [
    {
      createdAt: {
        between: {
          val: ['YESTERDAY', '$now()'],
          valType: 'expression',
        },
        logicalOp: 'or',
        gte: '12343',
      },
      updatedAt: {
        between: ['YESTERDAY', '$now()'],
      },
      logicalOp: 'and',
    },
    {
      not: [
        {
          attribute: 'firstName',
          eq: '123',
        },
      ],
    },
  ],
};

const userFilters2: EntityFilterCriteria<User.TUserSchema> = {
  and: [
    {
      logicalOp: 'and',
      email: {
        logicalOp: 'or',
        eq: 'test@123.com',
        notContains: ['gmail.com', '.uk', '--'],
      },
      firstName: {
        contains: ['smith', 'johnson'],
      },
    },
    {
      createdAt: {
        between: {
          val: ['122', '126'],
          valLabel: 'Between xxx and yyyy',
        },
      },
    },
  ],
};

type tt = Narrow<EntityFilterCriteria<User.TUserSchema>>;
const userFilters3: tt = {
  and: [
    {
      logicalOp: 'and',
      email: {
        logicalOp: 'or',
        eq: 'test@123.com',
        notContains: ['gmail.com', '.uk', '--'],
      },
      firstName: {
        contains: ['smith', 'johnson'],
      },
    },
    {
      or: [
        {
          firstName: {
            '<': '1212',
          },
          logicalOp: 'not',
          email: {
            inList: ['sds', 'ee'],
          },
        },
      ],
    },
  ],
};

const usersQuery: EntityQuery<User.TUserSchema> = {
  attributes: ['email', 'firstName', 'lastName'],
  filters: userFilters,
  pagination: {
    limit: 10,
    count: 20,
    cursor: undefined,
  },
};

const usersQuery2: EntityQuery<User.TUserSchema> = {
  attributes: ['email', 'firstName', 'lastName'],
  filters: userFilters,
  pagination: {
    count: 20,
  },
};

const groupsQuery: EntityQuery<User.TGroupSchema> = {
  attributes: {
    name: true,
    groupId: true,
    admin: {
      relationType: 'many-to-one',
      entityName: 'user2',
      attributes: ['firstName', 'lastName', 'tenant'],
    },
  },
  pagination: {
    count: 20,
  },
};

type xyxxx = EntityAttributePaths<User.TGroupSchema>;

const groupsQuery2: EntityQuery<User.TGroupSchema> = {
  attributes: {
    name: true,
    groupId: true,
    admin: {
      relationType: 'many-to-one',
      entityName: 'user2',
      attributes: {
        firstName: true,
        lastName: true,
        tenant: {
          entityName: 'user',
          relationType: 'many-to-one',
          attributes: ['firstName', 'lastName'],
        },
      },
    },
  },
  pagination: {
    count: 20,
  },
};

const groupsQuery3: EntityQuery<User.TGroupSchema> = {
  attributes: [
    'name',
    'groupId',
    'admin',
    'admin.firstName',
    'admin.lastName',
    'admin.tenant.firstName',
    'admin.tenant.lastName',
  ],
  pagination: {
    count: 20,
  },
};

describe('query', () => {
  it('should return query object', () => {
    expect(1 === 1).toEqual(true);

    const qq2 = {
      pagination: {
        limit: 40,
      },
      filters: {
        or: [
          {
            and: [
              {
                attribute: 'lastName',
                eq: 'Author Name 002',
              },
              {
                attribute: 'firstName',
                neq: 'Book Name 000',
              },
            ],
          },
          {
            attribute: 'firstName',
            inList: ['Book Name 005'],
          },
        ],
      },
    };

    let exp: any;

    const res = User.entity.entity
      .match({})
      .where((attr, opp) => {
        exp = entityFilterCriteriaToExpression(qq2.filters as EntityFilterCriteria<User.TUserSchema>, attr, opp);
        return '';
      })
      .params();

    console.log(exp);
    console.log(res);
  });
});

describe('parseEntityAttributePaths', () => {
  it('should transform array to nested object', () => {
    const array = [
      'name',
      'groupId',
      'admin',
      'admin.firstName',
      'admin.lastName',
      'admin.tenant',
      'admin.tenant.firstName',
      'admin.tenant.lastName',
    ];

    const result = parseEntityAttributePaths(array);

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

    DIContainer.ROOT.register({
      useValue: {},
      provide: DI_TOKENS.DYNAMO_ENTITY_CONFIGURATIONS,
    });

    registerEntitySchema({
      forEntity: User.groupSch.model.entity,
      useValue: User.groupSch,
    });
    registerEntitySchema({
      forEntity: User.userSch2.model.entity,
      useValue: User.userSch2,
    });
    registerEntitySchema({
      forEntity: User.schema.model.entity,
      useValue: User.schema,
    });

    const entityService = DIContainer.ROOT.resolveEntityService(User.groupSch.model.entity) as any;

    const inferred = entityService.inferRelationshipsForEntitySelections(User.groupSch, result);

    const expected = {
      name: true,
      groupId: true,
      admin: {
        entityName: 'user2',
        relationType: 'many-to-one',
        identifiers: [{ source: 'admin', target: 'userId' }],
        attributes: {
          firstName: true,
          lastName: true,
          tenant: {
            entityName: 'user',
            relationType: 'many-to-one',
            identifiers: [{ source: 'tenantId', target: 'userId' }],
            attributes: {
              firstName: true,
              lastName: true,
            },
          },
        },
      },
    };

    console.log(JSON.stringify(inferred, null, 2));

    expect(inferred).toEqual(expected);
  });
});

describe('inferRelationshipsForEntitySelections - path-based cycle detection', () => {
  const userSchemaMock = createEntitySchema({
    model: {
      entity: 'User',
      entityNamePlural: 'Users',
      entityOperations: DefaultEntityOperations,
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
          attributes: { groupId: true, title: true }, // or something
        },
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
      },
    },
  } as const);

  const groupSchemaMock = createEntitySchema({
    model: {
      entity: 'Group',
      entityNamePlural: 'Groups',
      entityOperations: DefaultEntityOperations,
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
          attributes: { userId: true, name: true, group: true }, // can recursively point back
        },
      },
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
      },
    },
  });

  let diContainer: IDIContainer;

  beforeEach(() => {
    diContainer = DIContainer.ROOT.createChildContainer('CC-for-inferRelationshipsForEntitySelections');

    diContainer.register({
      useValue: {},
      provide: DI_TOKENS.DYNAMO_ENTITY_CONFIGURATIONS,
    });

    registerEntitySchema({
      forEntity: userSchemaMock.model.entity,
      useValue: userSchemaMock,
      providedIn: diContainer,
    });

    registerEntitySchema({
      forEntity: groupSchemaMock.model.entity,
      useValue: groupSchemaMock,
      providedIn: diContainer,
    });
  });

  it('should handle non-relational attributes only (no recursion)', () => {
    const parsed = parseEntityAttributePaths(['userId', 'name']);
    const userService = diContainer.resolveEntityService<BaseEntityService<typeof userSchemaMock>>(
      userSchemaMock.model.entity,
    );
    const result = userService.inferRelationshipsForEntitySelections(userSchemaMock, parsed);
    // We expect it to just copy them over
    expect(result).toEqual({
      userId: true,
      name: true,
    });
  });

  it('should expand single-level relation normally', () => {
    const parsed = parseEntityAttributePaths(['userId', 'group', 'group.members.userId']);
    const userService = diContainer.resolveEntityService<BaseEntityService<typeof userSchemaMock>>(
      userSchemaMock.model.entity,
    );
    const result = userService.inferRelationshipsForEntitySelections(userSchemaMock, parsed) as any;
    // We expect 'group' to expand into the relation structure referencing Group
    expect(result.group).toBeDefined();
    expect(result.group.relationType).toBe('many-to-one');
    expect(result.group.attributes).toHaveProperty('members'); // etc.
  });

  it('should skip expansions if cycle is detected (User->Group->User)', () => {
    // path: 'group.members.group.members...' leads to a cycle
    // We'll request deep expansions
    const parsed = parseEntityAttributePaths([
      'group',
      'group.members',
      'group.members.group.id',
      'group.members.group.members.id',
      // and so on
    ]);
    const userService = diContainer.resolveEntityService<BaseEntityService<typeof userSchemaMock>>(
      userSchemaMock.model.entity,
    );
    const result = userService.inferRelationshipsForEntitySelections(userSchemaMock, parsed);

    // We expect that once it cycles back to "User" from "Group.members" -> "User" -> "group",
    // it will skip expansions on that cyc attribute
    const grp = result.group as any;
    expect(grp).toMatchObject({
      entityName: 'Group',
      attributes: expect.any(Object),
    });
    const mem = (grp.attributes as any).members;
    expect(mem).toMatchObject({
      entityName: 'User',
      attributes: expect.any(Object),
    });
    // Then we see if mem.attributes.group was expanded or skipped
    // If cycle was detected, we either see a `skippedDueToCycle` or minimal object
    if (mem.attributes.group.skippedDueToCycle) {
      expect(mem.attributes.group.skippedDueToCycle).toBe(true);
    } else {
      // Or if your code sets something else
      throw new Error(`Cycle not detected where expected`);
    }
  });

  it('should continue hydrating sibling attributes even if one attribute is cyc', () => {
    // Suppose we ask for userId, name, group, group.members
    // The cycle is in "group.members.group...", but "userId" is unaffected
    const parsed = parseEntityAttributePaths(['userId', 'group', 'group.members.userId', 'group.members.group.id']);
    const userService = diContainer.resolveEntityService<BaseEntityService<typeof userSchemaMock>>(
      userSchemaMock.model.entity,
    );
    const result = userService.inferRelationshipsForEntitySelections(userSchemaMock, parsed) as any;

    // "userId" must be present
    expect(result.userId).toBe(true);

    // "group" expansions
    expect(result.group.entityName).toBe('Group');
    expect(result.group.attributes).toHaveProperty('members');
    // members expansions
    expect(result.group.attributes.members.entityName).toBe('User');

    // the cyc recursion is "group.members.group"
    // This should be a partial skip
    const cyc = result.group.attributes.members.attributes.group;
    expect(cyc).toHaveProperty('skippedDueToCycle', true);

    // But sibling attributes (like userId) are still expanded
    // e.g. "members.attributes.userId" or "members.attributes.name" if we had them in the parse
  });

  it('should respect maxDepth if recursion is too deep', () => {
    // We'll do a big chain: user->group->members->group->members->group...
    const parsed = parseEntityAttributePaths([
      'group',
      'group.members',
      'group.members.group',
      'group.members.group.members.userId',
      'group.members.group.members.group.id', // and so forth
    ]);
    const userService = diContainer.resolveEntityService<BaseEntityService<typeof userSchemaMock>>(
      userSchemaMock.model.entity,
    );
    const result = userService.inferRelationshipsForEntitySelections(
      userSchemaMock,
      parsed,
      'User', // initial path
      new Set(), // fresh visited
      3, // small maxDepth
    );
    // After depth=3, expansions should skip
    // e.g. at path depth 4 or more
    const grp = result.group as any;
    expect(grp.attributes.members).toBeDefined();
    // members => user, user => group => should skip expansions beyond that depth
    const maybeSkipped = grp.attributes.members.attributes.group;
    expect(maybeSkipped).toMatchObject({
      entityName: 'Group',
      skippedDueToCycle: true,
    });
  });
});
