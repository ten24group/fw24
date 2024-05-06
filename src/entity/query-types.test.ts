import { And, Narrow, PrettyPrint } from '../utils/types';
import { describe, expect, it } from '@jest/globals';
import { EntityFilterCriteria, EntityQuery, FilterGroup } from './query-types';
import { randomUUID } from 'crypto';
import { DefaultEntityOperations, createElectroDBEntity, createEntitySchema } from './base-entity';
import { entityFilterCriteriaToExpression, parseUrlQueryStringParameters, queryStringParamsToFilterGroup } from './query';

namespace User {
    export const createUserSchema = () => createEntitySchema({
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
          default: () => randomUUID()
        },
        tenantId: {
          type: 'string',
          required: true,
          readOnly: true,
          default: () => 'xxx-yyy-zzz'
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
        updatedAt:{
          type: "string",
          watch: "*", // will be set every time any prop is updated
          required: true,
          readOnly: true,
          default: () => Date.now().toString(),
          set: () => Date.now().toString(),
        },
        deletedAt:{
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
    } as const);

  export type TUserSchema = ReturnType<typeof createUserSchema>

  export const schema = createUserSchema();
  export const entity = createElectroDBEntity({schema: schema, entityConfigurations: {
    table: 'xxxx'
  }});
}

const testFilter: FilterGroup<any> = {
    or: [{
      attribute: 'lastName',
      eq: 'someName',
      between: {
        val: ['122', '126'],
        label: "Between xxx and yyyy"
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
        label: "Between xxx and yyyy"
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

const userFilters2: EntityFilterCriteria<User.TUserSchema> = {
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
          label: "Between xxx and yyyy"
        }
      }
    },
  ]
};

type tt = Narrow<EntityFilterCriteria<User.TUserSchema>>;
const userFilters3: tt = {
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
  },{
    or: [
      {
        firstName: {
          "<" : '1212',
        },      
        logicalOp: 'not',
        email: {
          inList: [ "sds", "ee"]
        },
      },
    ]
  }]
};

const usersQuery: EntityQuery<User.TUserSchema> = {
  attributes: ['email', 'firstName', 'lastName'],
  filters: userFilters,
  pagination: {
    limit: 10,
    count: 20,
    cursor: undefined,
  }
}

const usersQuery2: EntityQuery<User.TUserSchema> = {
  attributes: {
    email: true,
    firstName: true,
    lastName: true,
  },
  filters: userFilters,
  pagination: {
    count: 20,
  }
}

describe('query', () => {

  it('should return query object', () => {
    expect(1===1).toEqual(true);

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
                "eq": "Author Name 002"
              },
              {
                "attribute": "firstName",
                "neq": "Book Name 000"
              }
            ]
          },
          {
              "attribute": "firstName",
              "inList": ["Book Name 005"]
          }
        ]
      }
    }
    

    let exp: any;

    const res = User.entity.entity.match({}).where( (attr, opp) => {
      exp = entityFilterCriteriaToExpression(qq2.filters as EntityFilterCriteria<User.TUserSchema>, attr, opp);
      return ''
    }).params();

    console.log(exp);
    console.log(res);

  });

});
