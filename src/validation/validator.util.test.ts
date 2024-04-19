import { describe, expect, it } from '@jest/globals';
import { extractOpValidationFromEntityValidations, isHttpRequestValidationRule, isInputValidationRule, isValidationRule } from './validator.util';
import { EntityValidations } from './validator.type';
import { TDefaultEntityOperations } from '../entity';

describe('isValidationRule()', () => {
  it('should return true for valid ValidationRule objects', () => {
    const rule = {
      required: true
    };
    expect(isValidationRule(rule)).toBe(true);
  });

  it('should return false for non-objects', () => {
    expect(isValidationRule(123)).toBe(false);
    expect(isValidationRule('abc')).toBe(false);
    expect(isValidationRule(null)).toBe(false);
    expect(isValidationRule(undefined)).toBe(false);
  });

  it('should return false for objects without valid keys', () => {
    expect(isValidationRule({foo: 'bar'})).toBe(false);
  });
});

describe('isValidationRules()', () => {
  it('should return true for valid ValidationRules objects', () => {
    const rules = {
      name: {
        required: true
      },
      email: {
        required: true,
        datatype: 'email'
      }
    };
    expect(isInputValidationRule(rules)).toBe(true);
  });

  it('should return false for non-objects', () => {
    expect(isInputValidationRule(123)).toBe(false);
    expect(isInputValidationRule('abc')).toBe(false);
    expect(isInputValidationRule(null)).toBe(false);
    expect(isInputValidationRule(undefined)).toBe(false);
  });

  it('should return false for objects with invalid rules', () => {
    const rules = {
      name: {
        required: true
      },
      email: 'invalid'
    };
    expect(isInputValidationRule(rules)).toBe(false);
  });
});

describe('isHttpRequestValidationRule()', () => {
  it('should return true for valid HttpRequestValidationRule objects', () => {
    const rule = {
      body: {
        name: {
          required: true
        }
      }
    };
    expect(isHttpRequestValidationRule(rule)).toBe(true);
  });

  it('should return true for valid HttpRequestValidationRule objects 2', () => {
    const rule = {
      body: {
        email: { 
          required: true,
          datatype: 'email',
          maxLength: 40, 
        },
        password: {
          datatype: 'string',
          neq: "Blah"
        }
      }
    };
    expect(isHttpRequestValidationRule(rule)).toBe(true);
  });

  it('should return true for objects with valid query rules', () => {
    const rule = {
      query: {
        limit: {
          required: true,
          datatype: 'number'
        }  
      }
    };
    expect(isHttpRequestValidationRule(rule)).toBe(true);
  });

  it('should return true for objects with valid param rules', () => {
    const rule = {
      param: {
        id: {
          required: true,
          datatype: 'uuid'
        }
      }
    };
    expect(isHttpRequestValidationRule(rule)).toBe(true);
  });

  it('should return true for objects with valid header rules', () => {
    const rule = {
      header: {
        'Content-Type': {
          required: true,
          inList: ['application/json']
        }
      }
    };
    expect(isHttpRequestValidationRule(rule)).toBe(true);
  });

  it('should return false for non-objects', () => {
    expect(isHttpRequestValidationRule(123)).toBe(false);
    expect(isHttpRequestValidationRule('abc')).toBe(false);
    expect(isHttpRequestValidationRule(null)).toBe(false);
    expect(isHttpRequestValidationRule(undefined)).toBe(false);
  });

  it('should return false for objects without valid sub-rules', () => {
    const rule = {
      body: 'invalid'  
    };
    expect(isHttpRequestValidationRule(rule)).toBe(false);
  });
});

describe('extractOpValidationFromEntityValidations()', () => {

  it('should return empty validations when no entityValidations passed', () => {
    const result = extractOpValidationFromEntityValidations('create', {} as any);

    expect(result).toEqual({
      opValidations: {
        actor: {},
        input: {},
        record: {}
      },
      conditions: undefined
    });
  });

  it('should extract validations for given op from array', () => {
    const entityValidations: EntityValidations<any, any, any> = {
      actor: {
        id: [{
          operations: ['create'],
          required: true
        }]  
      }
    };
    
    const result = extractOpValidationFromEntityValidations('create', entityValidations);

    expect(result).toEqual({
      opValidations: {
        actor: {
          id: [{
            required: true
          }]
        },
        input: {},
        record: {}
      },
      conditions: undefined  
    });
  });

  it('should only extract validations for given op', () => {
    const entityValidations: EntityValidations<any, any>  = {
      // has validations for create and update op  
      actor: {
        id: [
          {operations: ['create'], required: true},
          {operations: ['update'], required: false}
        ]
      }
    };
    
    const resultForCreate = extractOpValidationFromEntityValidations('create', entityValidations);

    expect(resultForCreate).toEqual({
      opValidations: {
        actor: {
          id: [{required: true}] 
        },
        input: {},
        record: {}
      },
      conditions: undefined
    });

    const resultForUpdate = extractOpValidationFromEntityValidations('update', entityValidations);

    expect(resultForUpdate).toEqual({
      opValidations: {
        actor: {
          id: [{required: false}]
        },
        input: {},
        record: {}
      },
      conditions: undefined
    });
  });

  it('should handle no matching op validations', () => {
    const entityValidations: EntityValidations<any, any> = {
      actor: {
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
        actor: {},
        input: {},
        record: {}
      }
    });
  });

  it('should extract multiple validation rules for a property', () => {
    const entityValidations: EntityValidations<any, any> = {
      actor: {
        id: [
          {required: true}, 
          {datatype: 'string'}
        ]
      }
    };

    const result = extractOpValidationFromEntityValidations('update', entityValidations);

    expect(result).toEqual({
      opValidations: {
        actor: {
          id: [
            {required: true}, 
            {datatype: 'string'} 
          ]
        },
        input: {},
        record: {}
      },
      conditions: undefined
    });
  });

  it('should handle conditional validations from tuple', () => {
    const conditions = {
      recordIsNotNew: {
        record: {
          userId: {
            neq: ''
          }
        }
      }
    } as const;

    const entityValidations: EntityValidations<any, typeof conditions> = {
      conditions,
      actor: {
        id: [{
          operations: [['update', ['recordIsNotNew']]],
          required: true
        }]
      }  
    };

    const result = extractOpValidationFromEntityValidations('update', entityValidations);

    expect(result).toEqual({
      opValidations: {
        actor: {
          id: [{
            conditions: [ ['recordIsNotNew'], 'all'],
            required: true
          }]
        },
        input: {},
        record: {}
      },
      conditions
    });
  });

  it('should handle conditional validations from object', () => {
    const conditions = {
      recordIsNotNew: {
        record: {
          userId: {
            neq: ''
          }
        }
      }
    } as const;

    const entityValidations: EntityValidations<any, typeof conditions> = {
      conditions,
      actor: {
        id: [{
          operations: { 
            //@ts-ignore
            'update': [{ conditions: ['recordIsNotNew'] }],
          },
          required: true
        }]
      }  
    };

    const result = extractOpValidationFromEntityValidations('update', entityValidations);

    expect(result).toEqual({
      opValidations: {
        actor: {
          id: [{
            conditions: [ ['recordIsNotNew'], 'all' ],
            required: true
          }]
        },
        input: {},
        record: {}
      },
      conditions
    });
  });

  it('should extract validation conditions for given op from object', () => {
    const entityValidations: EntityValidations<any, any, any> = {
      actor: {
        id: [{
          required: true,
          operations: {
            //@ts-ignore
              create: [{
                conditions: ['recordIsNotNew', 'recordIsNotNew'],
                scope: 'any',
              }],
            }
        }]  
      }
    };
    
    const result = extractOpValidationFromEntityValidations('create', entityValidations);

    expect(result).toEqual({
      opValidations: {
        actor: {
          id: [{
            required: true, 
            conditions: [['recordIsNotNew', 'recordIsNotNew'], 'any'] 
          }]
        },
        input: {},
        record: {}
      },
      conditions: undefined 
    });
  });

  it('should handle invalid validation rules', () => {
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
    
    const entityValidations: EntityValidations<any, any> = {
      actor: {
        id: [
          {operations: ['update']} // no other validations
        ]
      }
    };

    const result = extractOpValidationFromEntityValidations('update', entityValidations);

    expect(result).toEqual({
      opValidations: {
        actor: {
          id: [{}]
        },
        input: {},
        record: {}
      },
      conditions: undefined
    });
  });
  
});