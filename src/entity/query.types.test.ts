import { And } from '../utils/types';
import { describe, expect, it } from '@jest/globals';
import { EntityFilters, EntityQuery, FilterGroup } from './query.types';
import { randomUUID } from 'crypto';
import { DefaultEntityOperations, createElectroDBEntity, createEntitySchema } from './base-entity';
import { entityFiltersToFilterExpression, parseUrlQueryStringParameters, queryStringParamsToEntityFilters } from './query';

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
          default: () => 'xxx-yyy-zzz' // TODO: have some global logic drive this value
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
      prop: 'userName',
      eq: 'someName',
      between: {
        val: [122, 126],
        label: "Between xxx and yyyy"
      },
    },
    {
      and: [{
        prop: 'createdAt',
        bt: { from: 1, to: 2 },
        gt: `now()`
      }, 
      {
        prop: 'lastName',
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
const userFilters: EntityFilters<User.TUserSchema> = {
  and: [
    {
      prop: 'email',
      logicalOp: 'or',
      eq: 'nitin@123.com',
      contains: '123.',
      startsWith: 'nit',
    },
    {
      prop: 'createdAt',
      between: {
        val: ['122', '126'],
        label: "Between xxx and yyyy"
      }
    },
  ],
  or: [{
    prop: 'deletedAt',
    between: {
      val: ['YESTERDAY', '$now()'],
      valType: 'expression',
    }
  }]
};

const usersQuery: EntityQuery<User.TUserSchema> = {
  selection: ['email', 'firstName', 'lastName'],
  filters: userFilters,
  pagination: {
    limit: 10,
    count: 20,
    cursor: undefined,
  }
}

const usersQuery2: EntityQuery<User.TUserSchema> = {
  selection: {
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
                  "prop": "authorName",
                  "eq": "Author Name 002"
                },
                {
                  "prop": "bookName",
                  "neq": "Book Name 000"
                }
              ]
            },
            {
                "prop": "bookName",
                "inList": ["Book Name 005"]
            }
          ]
        }
      }
    

    let exp: any;

    const res = User.entity.entity.match({}).where( (attr, opp) => {
      exp = entityFiltersToFilterExpression(qq2.filters as EntityFilters<User.TUserSchema>, attr, opp);
      return ''
    }).params();

    console.log(exp);
    console.log(res);

  });


  describe('parseUrlQueryStringParameters', () => {

    it('should parse simple query string params successfully', ()=>{
      const parsed = parseUrlQueryStringParameters({
        "foo[eq]" : "1",
        "foo.neq": "3",
        "bar[contains]": "fluffy",
        "baz[in]": "4,34&343+787",
      });
      
      console.log(parsed);

      expect(parsed).toEqual({
        foo: {
          eq: '1',
          neq: '3'
        },
        bar: {
          contains: 'fluffy'
        },
        baz: {
          in: '4,34&343+787'
        }
      });

      const etQ = queryStringParamsToEntityFilters(parsed);
      console.log(etQ);

      expect(etQ).toEqual({
        and: [
          {
            prop: 'foo',
            eq: 1,
            neq: 3
          },
          {
            prop: 'bar',
            contains: [ 'fluffy' ]
          },
          {
            prop: 'baz',
            in: [ 4, 34, 343, 787 ]
          }
        ],
        not: [],
        or: []
      });
    });

    it('should parse query strings with and/or groups having ( [] array, and `.` dot ) notation successfully', () => {

      const parsed = parseUrlQueryStringParameters({
        "or[][foo][eq]" : "1",
        "or[].foo.neq": "3",
        "and[].bar[contains]": "fluffy",
        "and[].baz[in]": "4,34",
      });

      console.log(parsed);

      expect(parsed).toEqual({
        or: [{
          foo: {
            eq: '1',
            neq: '3'
          }
        }],
        and: [{
            bar: { contains: 'fluffy' },
            baz: { in: '4,34' }
        }]
      });

      const etQ = queryStringParamsToEntityFilters(parsed);
      console.log(etQ);

      expect(etQ).toEqual({
        and: [{
          prop: 'bar',
          contains: [ 'fluffy' ]
        },
        {
          prop: 'baz',
          in: [ 4, 34]
        }],
        not: [],
        or: [{
          prop: 'foo',
          eq: 1,
          neq: 3
        }]
      });

    });

    it('should parse query strings with and/or groups and [split/combine/parse] values successfully', () => {

      const parsed = parseUrlQueryStringParameters({
        "or.0.foo.eq" : "1",
        "or.1.foo.neq": "3",
        "and.0.bar[contains]": "fluffy",
        "and.1.baz[in]": "4,34",
        "and.1.baz.nin": "8989",
        "and.1.baz[nin]": "565",
      });

      console.log(parsed);

      expect(parsed).toEqual({
        "or":[
          {"foo": {"eq": "1"} },
          {"foo": {"neq": "3"} }
        ],
        "and":[{
            "bar": { "contains": "fluffy"}
          },
          {
            "baz": {
              "in": "4,34",
              "nin": ["8989", "565"]
            }
        }]
      });

      const etQ = queryStringParamsToEntityFilters(parsed);

      expect(etQ).toEqual({
        and: [
          {
            prop: 'bar',
            contains: [ 'fluffy' ]
          },
          {
            prop: 'baz',
            in: [4, 34], // splitted value
            nin: [8989, 565] // combined values
          }
        ],
        not: [],
        or: [
          {
            prop: 'foo',
            eq: 1 // parsed type
          },
          {
            prop: 'foo',
            neq: 3 // parsed type
          }
        ]
      });

    });


  });

});
