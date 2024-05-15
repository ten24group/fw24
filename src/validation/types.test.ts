import { randomUUID } from "crypto";
import { DefaultEntityOperations, TEntityOpsInputSchemas, createEntitySchema } from "../entity";
import { EntityOperationsValidation, EntityValidations, InputApplicableConditionsMap, PropertyApplicableEntityOperations, TestComplexValidationRuleResult, TestValidationResult, TestValidationRuleResult, InputValidationRule, EntityInputValidations } from "./types";
import { Narrow, OmitNever } from "../utils";

import { describe, expect, it } from '@jest/globals';

describe('Validation.types', () => {
  it('should narrow', () => {
        const a: Narrow<number> = 1;
        const b: Narrow<number> = 2;
        const c: Narrow<number> = 3;
        expect(a).toBe(1);
        expect(b).toBe(2);
        expect(c).toBe(3);
    });
});

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

  export const createUserSchema2 = () => createEntitySchema({
      model: {
        version: '1',
        entity: 'user',
        entityNamePlural: 'Users',
        entityOperations: {
            get: "get",
            list: "list",
            create: "create",
            update: "update",
            delete: "delete",
            query: "query",
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

  export type TUserSchema2 = ReturnType<typeof createUserSchema2>;
}

const UserValidationConditions =  {
    tenantIsXYZ: { actor: {
        tenantId: { eq: 'xxx-yyy-zzz' }
    }},
    inputIsNitin: { input: { 
        email: { eq: 'nitin@gmail.com' }
    }},
    recordIsNotNew: { record: {
        userId: { neq: '' }
    }},
} as const;

const SignInValidations: InputValidationRule<{email: string, lastName: string, anotherProp: string}> = {
    lastName: {
      datatype: 'string',
      neq: "Blah",
      custom: (val: string): boolean | Promise<boolean> => {
        // you can define a custom function to validate the input ['lastName']
        return !!val;
      }
    },
    anotherProp: {
      maxLength: 30,
      pattern: /^[a-z,A-Z]/,
      // ** standard validator with overridden error-message
      minLength: {
        value: 10,
        message: 'custom error message'
      },
      // ** standard validator with overridden validator-function
      eq: {  
        validator: (value: string | undefined): Promise<TestValidationResult>  => {
          return Promise.resolve({
            pass: value !== undefined && value == 'xyz',
            expected: ['custom', 'whatever'],
            received: [value],
            message: 'some error message'
          });
        }
      },
      // **  custom validator with a message
      custom: {
        message: 'some error message if validator resolves to false',
        validator: (value): Promise<TestValidationResult> => {
            return Promise.resolve({
              pass: value !== undefined ,
              expected: ['datatype', 'email'],
              received: [value],
            });
        }
      }

    },
    email: {
      // ** custom validation rule, with it's own validator; all other validations will be ignored here
      validator: (email: string ): Promise<TestValidationRuleResult> => {
        const res: TestComplexValidationRuleResult = {
          pass: !!email,
          customMessage: "you can return a custom message from the validator as well; and it takes precedence over the error-message defined in the rule(if any)"
        };

        //... your logic to validate the input

        return Promise.resolve(res);
      }
    },
};

const UserOppValidations: EntityOperationsValidation<User.TUserSchema2, typeof UserValidationConditions> = {
  conditions: UserValidationConditions,  
  delete: {
    actor: {
        tenantId: [{ eq: 'xxx-yyy-zzz' }]
    },
    record: {
        userId: [{ neq: '' }]
    },
    input: {
        userId: [{ eq: 'nitin@gmail.com', conditions: [['recordIsNotNew', 'recordIsNotNew'], 'all']  }],
    }
  },
  create: {
      actor: {
          tenantId: [{ eq: 'xxx-yyy-zzz' }]
      },
      input: {
          email: [{ eq: 'nitin@gmail.com', conditions: ['tenantIsXYZ'] }]
      }
  },
  update: {
      actor: {
          tenantId: [{ eq: 'xxx-yyy-zzz' }]
      },
      input: {
          email: [{ eq: 'nitin@gmail.com', conditions: ['tenantIsXYZ'] }]
      },
      record: {
          userId: [{ neq: '' }]
      }
  },
  xxx: {}
}



type yy1 = keyof OmitNever<InputApplicableConditionsMap<Narrow<TEntityOpsInputSchemas<User.TUserSchema>['create']>, typeof UserValidationConditions>>
type yy  = keyof OmitNever<InputApplicableConditionsMap<Narrow<TEntityOpsInputSchemas<User.TUserSchema>>, typeof UserValidationConditions>>
type cxx = Narrow<TEntityOpsInputSchemas<User.TUserSchema2>>;
type cc = keyof OmitNever<PropertyApplicableEntityOperations<
    'userId', 
    User.TUserSchema, 
    Narrow<TEntityOpsInputSchemas<User.TUserSchema2>>
>>;

type xpx = cc extends keyof User.TUserSchema2['model']['entityOperations'] ? 'ccc' : '';

interface ppp extends TEntityOpsInputSchemas<User.TUserSchema2>{
  xxx: {
    'a': {},
    b: {}
  }
}

type t2 = ppp['xxx'];

type rty = 
  keyof OmitNever<PropertyApplicableEntityOperations<'email', User.TUserSchema, TEntityOpsInputSchemas<User.TUserSchema2>>> extends 
  keyof TEntityOpsInputSchemas<User.TUserSchema2>
  ? keyof OmitNever<PropertyApplicableEntityOperations<'email', User.TUserSchema, TEntityOpsInputSchemas<User.TUserSchema2>>> : never

conditions: UserValidationConditions;

type ExtendedSchema = Narrow<TEntityOpsInputSchemas<User.TUserSchema2> & {
    'xxx': {
        parentId: string;
        status: number;
    }
}>

const inpVal: EntityInputValidations<User.TUserSchema2, ExtendedSchema> = {
  firstName: [{
		operations: ['create', 'update'],
		required: true,
		minLength: 2,
		maxLength: 10,
		notInList: ['Abc', 'Xyz'],
	}],
	password: [{
		required: true,
		minLength: 8,
		operations: ['create']
	}],
  parentId: [{
    operations: [ 'update', 'xxx'],
      required: true,
      datatype: 'uuid'
  }]
}

const UserValidations: EntityValidations<User.TUserSchema2, typeof UserValidationConditions> = {
    actor: {
        tenantId: [{
            eq: 'xxx-yyy-zzz',
            operations: [
              'create',
              'update',
              'xxx',
              ['update', ['recordIsNotNew', 'inputIsNitin', 'tenantIsXYZ']],
              ['update', ['recordIsNotNew', 'inputIsNitin'], 'any'],
              ['delete', ['recordIsNotNew', 'tenantIsXYZ'], 'all' ]
            ],
        }],
    },
    input: {
        email: [{
            eq: 'nitin@gmail.com',
            operations: [['create', ['inputIsNitin', 'recordIsNotNew', 'tenantIsXYZ']]],
        }],
        userId: [{
            required: true,
            operations: [
              ['delete'], 
              ['delete', ['tenantIsXYZ', 'recordIsNotNew']], 
              ['create', ['inputIsNitin', 'recordIsNotNew', 'tenantIsXYZ'], 'any' ]
            ],
        }],
        lastName:[{
            required: true,
            operations: {
              create: [{
                conditions: ['recordIsNotNew', 'recordIsNotNew'],
                scope: 'any',
              }],
            }
        }]
    },
    record: {
        userId: [{
            required: true,
            operations:['xxx']
        }]
    }
}
