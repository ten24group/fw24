import { ValueOf } from './../utils/types';

import { randomUUID } from 'crypto';
import {
  createElectroDBEntity, createEntityRelation, createEntitySchema,
  DefaultEntityOperations, EntityAttribute, EntitySchema
} from '../entity/base-entity';
import { EntitySearchQuery, ExtractEntityAttributesOfType, ExtractEntityFilterableAttributes, ExtractEntitySearchableAttributes, ExtractEntitySelectableAttributes, ExtractEntitySortableAttributes, InferIndexSearchFilterCriteria, InferEntitySearchIndexConfig } from './types';

namespace User {

  export const createUserSchema = () => createEntitySchema({
    model: {
      version: '1',
      entity: 'user',
      entityNamePlural: 'Users',
      entityOperations: DefaultEntityOperations,
      service: 'users', // electro DB service name [logical group of entities]
      search: {
        enabled: true,
        config: {
          settings: {
            searchableAttributes: [ 'firstName', 'lastName' ],
          }
        }
      }
    },
    attributes: {
      userId: {
        type: 'string',
        required: true,
        readOnly: true,
        isSearchable: false,
        default: () => randomUUID()
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
        isFilterable: false,
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
          composite: [ 'tenantId', 'userId' ],
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
          composite: [ 'tenantId', 'email' ],
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
  export const entity = createElectroDBEntity({
    schema: schema, entityConfigurations: {
      table: 'xxxx'
    }
  });

  // @Service({forEntity: schema.model.entity})
  // class UserService extends BaseEntityService<User.TUserSchema> {
  //   constructor(){
  //     super(User.schema, null as any, DIContainer.ROOT);
  //   }
  // }

  type xx = InferEntitySearchIndexConfig<TUserSchema>

  const abc: xx = {
    searchableAttributes: [ 'firstName', 'lastName' ],
    filterableAttributes: [ 'tenantId' ],
    sortableAttributes: [ 'createdAt' ],
    selectableAttributes: [ 'userId', 'firstName', 'lastName', 'email' ],
  }

  type yy = xx[ 'sortableAttributes' ][ number ]

  type etsq = EntitySearchQuery<TUserSchema>

  type sCnf = InferEntitySearchIndexConfig<TUserSchema>;

  type cf = Extract<ValueOf<sCnf[ 'filterableAttributes' ]>, string>

  type sSarch = ExtractEntitySearchableAttributes<TUserSchema>
  type sFilter = ExtractEntityFilterableAttributes<TUserSchema>
  type sFilter2 = ExtractEntitySortableAttributes<TUserSchema>
  type sFilter3 = ExtractEntitySelectableAttributes<TUserSchema>


  const x: EntitySearchQuery<TUserSchema> = {
    search: 'test',
    sort: [ { field: 'createdAt', dir: 'asc' } ],
    select: [ 'userId', 'firstName', 'lastName', 'email' ],
    distinctAttribute: 'userId',
    facets: [ 'tenantId' ],
    facetFilters: [ "tenantId:xxx-yyy-zzz" ],
    filters: {
      and: [
        {
          tenantId: {
            equalTo: 'xxx-yyy-zzz'
          }
        },
        {
          deletedAt: {
            exists: true
          }
        },
        {
          or: [
            {
              firstName: {
                contains: 'test'
              },
            },
            {
              not: [ {
                firstName: {
                  contains: 'test'
                }
              } ]
            }
          ]
        }
      ]
    },
    pagination: {
      page: 1,
      limit: 10
    },
    rawOptions: {
      highlight: true
    },
    crop: {
      fields: [ 'firstName', 'lastName' ],
      length: 10,
      marker: '...'
    },
    matchingStrategy: 'all',
    geo: {
      lat: 12.345678,
      lng: 98.765432,
      radius: 100,
      precision: 10
    },
    highlight: {
      fields: [ 'firstName', 'lastName' ],
      preTag: '<b>',
      postTag: '</b>',
      showMatchesPosition: true
    },
    returnFacets: [ 'tenantId' ],
    searchAttributes: [ 'firstName', 'lastName' ],
  }

}


describe('test', () => {
  it('should be defined', () => {
    expect(1).toBe(1);
  });
});

