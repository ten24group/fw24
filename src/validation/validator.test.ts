import { Schema} from "electrodb";
import { Narrow, OmitNever } from "../utils";
import { EntityOpsValidations, EntityValidations, InputApplicableConditionsMap, TConditionalValidationRule, TMapOfValidationConditions } from "./validator.type";

import { describe, expect, it } from '@jest/globals';
import { randomUUID } from "node:crypto";
import { TDefaultEntityOperations, DefaultEntityOperations, TEntityOpsInputSchemas, createEntitySchema, EntitySchema } from "../entity";
import { Validator, extractOpValidationFromEntityValidations } from "./validator";


export namespace User {
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
    tenantIsXYZ: { actorRules: {
        tenantId: { eq: 'xxx-yyy-zzz' }
    }},
    inputIsNitin: { inputRules: { 
        email: { eq: 'nitin@gmail.com' }
    }},
    recordIsNotNew: { recordRules: {
        userId: { neq: '' }
    }},
} as const;

const UserOppValidations: EntityOpsValidations<User.TUserSchema2, typeof UserValidationConditions, DefaultEntityOperations2> = {
  conditions: UserValidationConditions,  
  delete: {
    actorRules: {
        tenantId: [{ eq: 'xxx-yyy-zzz' }]
    },
    recordRules: {
        userId: [{ neq: '' }]
    },
    inputRules: {
        userId: [{ eq: 'nitin@gmail.com', conditions: [['recordIsNotNew', 'recordIsNotNew'], 'all']  }],
    }
  },
  create: {
      actorRules: {
          tenantId: [{ eq: 'xxx-yyy-zzz' }]
      },
      inputRules: {
          email: [{ eq: 'nitin@gmail.com', conditions: ['tenantIsXYZ'] }]
      }
  },
  update: {
      actorRules: {
          tenantId: [{ eq: 'xxx-yyy-zzz' }]
      },
      inputRules: {
          email: [{ eq: 'nitin@gmail.com', conditions: ['tenantIsXYZ'] }]
      },
      recordRules: {
          userId: [{ neq: '' }]
      }
  },
  xxx: {}
}


export type DefaultEntityOperations2 = {
    get: "get",
    list: "list",
    create: "create",
    update: "update",
    delete: "delete",
    xxx: "xxx",
    yyy: "yyy"
};

type PropertyApplicableEntityOperations<
  Prop extends unknown, 
  Sch extends EntitySchema<any, any, any, OPs>, 
  OPs extends TDefaultEntityOperations = TDefaultEntityOperations,
  OpsInpSch extends TEntityOpsInputSchemas<Sch, OPs> = TEntityOpsInputSchemas<Sch, OPs>,
> = {
  [OppName in keyof OpsInpSch]: Prop extends keyof Narrow<OpsInpSch[OppName]> ? '' : never;
}

type yy1 = keyof OmitNever<InputApplicableConditionsMap<Narrow<TEntityOpsInputSchemas<User.TUserSchema, TDefaultEntityOperations>['create']>, typeof UserValidationConditions>>
type yy  = keyof OmitNever<InputApplicableConditionsMap<Narrow<TEntityOpsInputSchemas<User.TUserSchema, TDefaultEntityOperations>>, typeof UserValidationConditions>>
type cxx = Narrow<TEntityOpsInputSchemas<User.TUserSchema2, DefaultEntityOperations2>>;
type cc = keyof OmitNever<PropertyApplicableEntityOperations<
    'userId', 
    User.TUserSchema, 
    TDefaultEntityOperations, 
    Narrow<TEntityOpsInputSchemas<User.TUserSchema, TDefaultEntityOperations>>
>>;

type xpx = cc extends keyof DefaultEntityOperations2 ? 'ccc' : '';

type rty = keyof OmitNever<PropertyApplicableEntityOperations<'email', User.TUserSchema, TDefaultEntityOperations, Narrow<TEntityOpsInputSchemas<User.TUserSchema2, DefaultEntityOperations2>>>> extends keyof Narrow<TEntityOpsInputSchemas<User.TUserSchema2, DefaultEntityOperations2>> 
    ? OmitNever<PropertyApplicableEntityOperations<'email', User.TUserSchema, TDefaultEntityOperations, Narrow<TEntityOpsInputSchemas<User.TUserSchema2, DefaultEntityOperations2>>>> 
    : never

const UserValidations: EntityValidations<User.TUserSchema2, typeof UserValidationConditions, DefaultEntityOperations2> = {
    conditions: UserValidationConditions,
    actorRules: {
        tenantId: [{
            eq: 'xxx-yyy-zzz',
            operations: [
              '*',
              'create',
              'update',
              'xxx',
              ['update', ['recordIsNotNew', 'tenantIsXYZ']],
              ['update', [['recordIsNotNew', 'inputIsNitin'], 'any']],
              ['delete', [['inputIsNitin', 'tenantIsXYZ'], 'all'] ]
            ],
        }],
    },
    inputRules: {
        email: [{
            eq: 'nitin@gmail.com',
            operations: [['create', ['inputIsNitin', 'recordIsNotNew', 'tenantIsXYZ']]],
        }],
        userId: [{
            required: true,
            operations: [
              ['delete', ['tenantIsXYZ', 'recordIsNotNew']], 
              ['create', [['inputIsNitin', 'recordIsNotNew', 'tenantIsXYZ'], 'any' ] ]
            ],
        }],
        lastName:[{
            required: true,
            operations: [
              '*',
              'update',
              ['update', ['recordIsNotNew', 'tenantIsXYZ']],
              ['update', [['recordIsNotNew', 'inputIsNitin'], 'any']]
            ]
        }]
    },
    recordRules: {
        userId: [{
            required: true,
            operations:['xxx']
        }]
    }
}

describe('Validator', () => {

  describe('validate()', () => {

    it('should return validation passed if no rules', async () => {
      const validator = new Validator();
      const result = await validator.validate({
        operationName: 'create',
        entityValidations: {},
      });
      expect(result.pass).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should validate actor rules', async () => {
      const validator = new Validator();
      const actor = {
        role: 'admin'  
      };
      const result = await validator.validate({
        operationName: 'create',
        entityValidations: {
          actorRules: {
            role: [{ eq: 'admin' }]
          }
        },
        actor
      });
      console.warn('should validate actor rules result:', result);
      expect(result.pass).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return actor rule errors', async () => {
      const validator = new Validator();
      const actor = {
        role: 'user'
      };
      const result = await validator.validate({
        operationName: 'create',
        entityValidations: {
          actorRules: {
            role: [{ eq: 'admin' }]  
          }
        },
        actor
      });
      expect(result.pass).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0]).toContain('actor.role');
    });

    it('should validate input rules', async () => {
      const validator = new Validator();
      const input = {
        email: 'test@example.com'
      };
      const result = await validator.validate({
        operationName: 'create',
        entityValidations: {
          inputRules: {
            email: [{ datatype: 'email' }]
          }
        },
        input  
      });
      expect(result.pass).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should return input rule errors', async () => {
      const validator = new Validator();
      const input = {
        email: 'invalid'
      };
      const result = await validator.validate({
        operationName: 'create',
        entityValidations: {
          inputRules: {
            email: [{ datatype: 'email' }]
          }
        },
        input
      });
      expect(result.pass).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0]).toContain('input.email');
    });
  });


  describe('extractOpValidationFromEntityValidations', () => {

    it('should return empty validations when no entityValidations passed', () => {
      const result = extractOpValidationFromEntityValidations('create', {} as any);

      expect(result).toEqual({
        opValidations: {
          actorRules: {},
          inputRules: {},
          recordRules: {}
        },
        conditions: undefined
      });
    });

    it('should extract validations for given op', () => {
      const entityValidations: EntityValidations<any, any> = {
        actorRules: {
          id: [{
            operations: ['create'],
            required: true
          }]  
        }
      };
      
      const result = extractOpValidationFromEntityValidations('create', entityValidations);

      expect(result).toEqual({
        opValidations: {
          actorRules: {
            id: [{
              required: true
            }]
          },
          inputRules: {},
          recordRules: {}
        },
        conditions: undefined  
      });
    });

    it('should only extract validations for given op', () => {
      const entityValidations: EntityValidations<any, any>  = {
        // has validations for create and update op  
        actorRules: {
          id: [
            {operations: ['create'], required: true},
            {operations: ['update'], required: false}
          ]
        }
      };
      
      const resultForCreate = extractOpValidationFromEntityValidations('create', entityValidations);

      expect(resultForCreate).toEqual({
        opValidations: {
          actorRules: {
            id: [{required: true}] 
          },
          inputRules: {},
          recordRules: {}
        },
        conditions: undefined
      });

      const resultForUpdate = extractOpValidationFromEntityValidations('update', entityValidations);

      expect(resultForUpdate).toEqual({
        opValidations: {
          actorRules: {
            id: [{required: false}]
          },
          inputRules: {},
          recordRules: {}
        },
        conditions: undefined
      });
    });

    it('should handle no matching op validations', () => {
      const entityValidations: EntityValidations<any, any> = {
        actorRules: {
          id: [{
            operations: ['create'],
            required: true
          }]
        }
      };

      const result = extractOpValidationFromEntityValidations('read' as keyof TDefaultEntityOperations, entityValidations);

      expect(result).toEqual({
        conditions: undefined,
        opValidations: {
          actorRules: {},
          inputRules: {},
          recordRules: {}
        }
      });
    });

    it('should extract validations for "*" op', () => {
      const entityValidations: EntityValidations<any, any>  = {
        actorRules: {
          id: [{
            required: true,
            operations: ['*']
          }]  
        }
      };

      const expectedResult = {
        opValidations: {
          actorRules: {
            id: [{
              required: true  
            }]
          },
          inputRules: {},
          recordRules: {}
        },
        conditions: undefined
      };
      
      const result_update = extractOpValidationFromEntityValidations('update', entityValidations);
      expect(result_update).toEqual(expectedResult);

      const result_delete = extractOpValidationFromEntityValidations('delete', entityValidations);
      expect(result_delete).toEqual(expectedResult);

      const result_get = extractOpValidationFromEntityValidations('get', entityValidations);
      expect(result_get).toEqual(expectedResult);

    });

    it('should extract multiple validation rules for a property', () => {
      const entityValidations: EntityValidations<any, any> = {
        actorRules: {
          id: [
            {required: true}, 
            {datatype: 'string'}
          ]
        }
      };

      const result = extractOpValidationFromEntityValidations('update', entityValidations);

      expect(result).toEqual({
        opValidations: {
          actorRules: {
            id: [
              {required: true}, 
              {datatype: 'string'} 
            ]
          },
          inputRules: {},
          recordRules: {}
        },
        conditions: undefined
      });
    });

    it('should handle conditional validations', () => {
      const conditions = {
        recordIsNotNew: {
          recordRules: {
            userId: {
              neq: ''
            }
          }
        }
      } as const;

      const entityValidations: EntityValidations<any, typeof conditions> = {
        conditions,
        actorRules: {
          id: [{
            operations: [['update', ['recordIsNotNew']]],
            required: true
          }]
        }  
      };

      const result = extractOpValidationFromEntityValidations('update', entityValidations);

      expect(result).toEqual({
        opValidations: {
          actorRules: {
            id: [{
              conditions: ['recordIsNotNew'],
              required: true
            }]
          },
          inputRules: {},
          recordRules: {}
        },
        conditions
      });
    });

    it('should handle invalid validation rules', () => {
      const consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
      
      const entityValidations: EntityValidations<any, any> = {
        actorRules: {
          id: [
            {operations: ['update']} // no other validations
          ]
        }
      };

      const result = extractOpValidationFromEntityValidations('update', entityValidations);

      expect(result).toEqual({
        opValidations: {
          actorRules: {
            id: [{}]
          },
          inputRules: {},
          recordRules: {}
        },
        conditions: undefined
      });
    });
    
  });

  describe('testAllValidationsWithErrors()', () => {

    it('should return validation passed if no rules', () => {
      const validator = new Validator();
      const result = validator.testAllValidationsWithErrors({}, 'test');
      expect(result.pass).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should return validation errors if rules fail', () => {
      const validator = new Validator();
      const partialValidation = {
        required: true
      };
      const result = validator.testAllValidationsWithErrors(partialValidation, undefined);
      expect(result.pass).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBeInstanceOf(Error);
    });

    it('should collect multiple validation errors', () => {
      const validator = new Validator();
      const partialValidation = {
        required: true,
        minLength: 5,
        maxLength: 2
      };
      const result = validator.testAllValidationsWithErrors(partialValidation, 'abc');
      expect(result.pass).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]).toBeInstanceOf(Error);
      expect(result.errors[1]).toBeInstanceOf(Error);
    });

  });

  describe('testValidation()', () => {

    it('should validate required', () => {
      const validator = new Validator();
      const result_false = validator.testValidation({required: true}, undefined);
      expect(result_false).toBe(false);

      const result_true = validator.testValidation({required: true}, '');
      expect(result_true).toBe(true);
    });

    it('should validate minLength', () => {
      const validator = new Validator();
      const result_false = validator.testValidation({minLength: 5}, 'abc');
      expect(result_false).toBe(false);

      const result_true = validator.testValidation({minLength: 3}, 'abc');
      expect(result_true).toBe(true);
    });

    it('should validate maxLength', () => {
      const validator = new Validator();
      const result_false = validator.testValidation({maxLength: 5}, 'abcdef');
      expect(result_false).toBe(false);

      const result_true = validator.testValidation({maxLength: 6}, 'abcdef');
      expect(result_true).toBe(true);
    });

    it('should validate pattern', () => {
      const validator = new Validator();
      const result = validator.testValidation({pattern: /^[0-9]+$/}, 'abc123');
      expect(result).toBe(false);

      const result2 = validator.testValidation({pattern: /^[0-9]+$/}, '12323232323');
      expect(result2).toBe(true);
    });

    it('should validate datatype', () => {
      const validator = new Validator();
      const result = validator.testValidation({datatype: 'number'}, '123');
      expect(result).toBe(true);
    });

  });

  describe('validateRuleWithCriteria', () => {

    const CONDITION: TMapOfValidationConditions<any, {}> = {
        actorIs123: {
            actorRules: {
                actorId: { eq: '123' } 
            },
        }
    } as const;

    it('should validate rules if criteria rules pass', async () => {
      const validator = new Validator();
      
      const validationRule: TConditionalValidationRule<any, typeof CONDITION>  = {
        conditions: [['actorIs123'], 'all'],
        minLength: 10
      };

      const actor = {
        actorId: '123'
      };

      const result = await validator.validateRuleWithCriteria({
        rule: validationRule, 
        allConditions: CONDITION, 
        inputVal: 'input', 
        input: {}, 
        record: {}, 
        actor: actor
      });

      expect(result.pass).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0]).toBeInstanceOf(Error);
      const err = result.errors?.[0] as Error;
      expect(err.message).toContain('minLength');
    });

    it('should skip validation if criteria rules fail', async () => {
      const validator = new Validator();
      
      const validationRule: TConditionalValidationRule<any, typeof CONDITION> = {
        conditions: [['actorIs123'], 'all'],
        minLength: 5
      };

      const actor = {
        actorId: '456'
      };

      const result = await validator.validateRuleWithCriteria({
        rule: validationRule, 
        allConditions: CONDITION, 
        inputVal: 'in', 
        input: {}, 
        record: {}, 
        actor: actor
      });

      expect(result.pass).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

  });

});
