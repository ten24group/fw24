"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.User = void 0;
const base_entity_1 = require("./../entity/base-entity");
const crypto_1 = require("crypto");
const entity_1 = require("../entity");
const globals_1 = require("@jest/globals");
(0, globals_1.describe)('Validation.types', () => {
    (0, globals_1.it)('should narrow', () => {
        const a = 1;
        const b = 2;
        const c = 3;
        (0, globals_1.expect)(a).toBe(1);
        (0, globals_1.expect)(b).toBe(2);
        (0, globals_1.expect)(c).toBe(3);
    });
});
var User;
(function (User) {
    User.createUserSchema = () => (0, entity_1.createEntitySchema)({
        model: {
            version: '1',
            entity: 'user',
            entityNamePlural: 'Users',
            entityOperations: entity_1.DefaultEntityOperations,
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
            updatedAt: {
                type: "string",
                watch: "*", // will be set every time any prop is updated
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
    const userSch1 = User.createUserSchema();
    User.createUserSchema2 = () => (0, entity_1.createEntitySchema)({
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
            tenantId: {
                type: 'string',
                required: true,
                readOnly: true,
                default: () => 'xxx-yyy-zzz', // TODO: have some global logic drive this value
                relation: (0, base_entity_1.createEntityRelation)({
                    entityName: userSch1.model.entity,
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
    User.createGroupSchema = () => (0, entity_1.createEntitySchema)({
        model: {
            version: '1',
            entity: 'group',
            entityNamePlural: 'Groups',
            entityOperations: entity_1.DefaultEntityOperations,
            service: 'users', // electro DB service name [logical group of entities]
        },
        attributes: {
            groupId: {
                type: 'string',
                required: true,
                readOnly: true,
                default: () => (0, crypto_1.randomUUID)()
            },
            adminId: {
                type: 'string',
                required: true,
                readOnly: true,
                default: () => 'xxx-yyy-zzz', // TODO: have some global logic drive this value
                relation: (0, base_entity_1.createEntityRelation)({
                    entityName: User.userSch2.model.entity,
                    type: 'many-to-one',
                    identifiers: [{
                            source: 'adminId',
                            target: 'userId'
                        }],
                })
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
})(User || (exports.User = User = {}));
const UserValidationConditions = {
    tenantIsXYZ: { actor: {
            tenantId: { eq: 'xxx-yyy-zzz' }
        } },
    inputIsNitin: { input: {
            email: { eq: 'nitin@gmail.com' }
        } },
    recordIsNotNew: { record: {
            userId: { neq: '' }
        } },
};
const SignInValidations = {
    lastName: {
        datatype: 'string',
        neq: "Blah",
        custom: (val) => {
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
            validator: (value) => {
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
            validator: (value) => {
                return Promise.resolve({
                    pass: value !== undefined,
                    expected: ['datatype', 'email'],
                    received: [value],
                });
            }
        }
    },
    email: {
        // ** custom validation rule, with it's own validator; all other validations will be ignored here
        validator: (email) => {
            const res = {
                pass: !!email,
                customMessage: "you can return a custom message from the validator as well; and it takes precedence over the error-message defined in the rule(if any)"
            };
            //... your logic to validate the input
            return Promise.resolve(res);
        }
    },
};
const UserOppValidations = {
    conditions: UserValidationConditions,
    delete: {
        actor: {
            tenantId: [{ eq: 'xxx-yyy-zzz' }]
        },
        record: {
            userId: [{ neq: '' }]
        },
        input: {
            userId: [{ eq: 'nitin@gmail.com', conditions: [['recordIsNotNew', 'recordIsNotNew'], 'all'] }],
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
};
conditions: UserValidationConditions;
const inpVal = {
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
            operations: ['update', 'xxx'],
            required: true,
            datatype: 'uuid'
        }]
};
const UserValidations = {
    actor: {
        tenantId: [{
                eq: 'xxx-yyy-zzz',
                operations: [
                    'create',
                    'update',
                    'xxx',
                    ['update', ['recordIsNotNew', 'inputIsNitin', 'tenantIsXYZ']],
                    ['update', ['recordIsNotNew', 'inputIsNitin'], 'any'],
                    ['delete', ['recordIsNotNew', 'tenantIsXYZ'], 'all']
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
                    ['create', ['inputIsNitin', 'recordIsNotNew', 'tenantIsXYZ'], 'any']
                ],
            }],
        lastName: [{
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
                operations: ['xxx']
            }]
    }
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHlwZXMudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy92YWxpZGF0aW9uL3R5cGVzLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEseURBQXFJO0FBQ3JJLG1DQUFvQztBQUNwQyxzQ0FBZ0c7QUFJaEcsMkNBQXFEO0FBR3JELElBQUEsa0JBQVEsRUFBQyxrQkFBa0IsRUFBRSxHQUFHLEVBQUU7SUFDaEMsSUFBQSxZQUFFLEVBQUMsZUFBZSxFQUFFLEdBQUcsRUFBRTtRQUNuQixNQUFNLENBQUMsR0FBbUIsQ0FBQyxDQUFDO1FBQzVCLE1BQU0sQ0FBQyxHQUFtQixDQUFDLENBQUM7UUFDNUIsTUFBTSxDQUFDLEdBQW1CLENBQUMsQ0FBQztRQUM1QixJQUFBLGdCQUFNLEVBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ2xCLElBQUEsZ0JBQU0sRUFBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDbEIsSUFBQSxnQkFBTSxFQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUN0QixDQUFDLENBQUMsQ0FBQztBQUNQLENBQUMsQ0FBQyxDQUFDO0FBRUgsSUFBaUIsSUFBSSxDQTZRcEI7QUE3UUQsV0FBaUIsSUFBSTtJQUVKLHFCQUFnQixHQUFHLEdBQUcsRUFBRSxDQUFDLElBQUEsMkJBQWtCLEVBQUM7UUFDdkQsS0FBSyxFQUFFO1lBQ0wsT0FBTyxFQUFFLEdBQUc7WUFDWixNQUFNLEVBQUUsTUFBTTtZQUNkLGdCQUFnQixFQUFFLE9BQU87WUFDekIsZ0JBQWdCLEVBQUUsZ0NBQXVCO1lBQ3pDLE9BQU8sRUFBRSxPQUFPLEVBQUUsc0RBQXNEO1NBQ3pFO1FBQ0QsVUFBVSxFQUFFO1lBQ1YsTUFBTSxFQUFFO2dCQUNOLElBQUksRUFBRSxRQUFRO2dCQUNkLFFBQVEsRUFBRSxJQUFJO2dCQUNkLFFBQVEsRUFBRSxJQUFJO2dCQUNkLE9BQU8sRUFBRSxHQUFHLEVBQUUsQ0FBQyxJQUFBLG1CQUFVLEdBQUU7YUFDNUI7WUFDRCxRQUFRLEVBQUU7Z0JBQ1IsSUFBSSxFQUFFLFFBQVE7Z0JBQ2QsUUFBUSxFQUFFLElBQUk7Z0JBQ2QsUUFBUSxFQUFFLElBQUk7Z0JBQ2QsT0FBTyxFQUFFLEdBQUcsRUFBRSxDQUFDLGFBQWEsQ0FBQyxnREFBZ0Q7YUFDOUU7WUFDRCxTQUFTLEVBQUU7Z0JBQ1QsSUFBSSxFQUFFLFFBQVE7Z0JBQ2QsUUFBUSxFQUFFLElBQUk7YUFDZjtZQUNELFFBQVEsRUFBRTtnQkFDUixJQUFJLEVBQUUsUUFBUTthQUNmO1lBQ0QsS0FBSyxFQUFFO2dCQUNMLElBQUksRUFBRSxRQUFRO2dCQUNkLFFBQVEsRUFBRSxJQUFJO2FBQ2Y7WUFDRCxRQUFRLEVBQUU7Z0JBQ1IsSUFBSSxFQUFFLFFBQVE7Z0JBQ2QsUUFBUSxFQUFFLElBQUk7YUFDZjtZQUNELFNBQVMsRUFBRTtnQkFDVCx5Q0FBeUM7Z0JBQ3pDLElBQUksRUFBRSxRQUFRO2dCQUNkLFFBQVEsRUFBRSxJQUFJO2dCQUNkLFFBQVEsRUFBRSxJQUFJO2dCQUNkLE9BQU8sRUFBRSxHQUFHLEVBQUUsQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsUUFBUSxFQUFFO2dCQUNwQyxHQUFHLEVBQUUsR0FBRyxFQUFFLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDLFFBQVEsRUFBRTthQUNqQztZQUNELFNBQVMsRUFBQztnQkFDUixJQUFJLEVBQUUsUUFBUTtnQkFDZCxLQUFLLEVBQUUsR0FBRyxFQUFFLDZDQUE2QztnQkFDekQsUUFBUSxFQUFFLElBQUk7Z0JBQ2QsUUFBUSxFQUFFLElBQUk7Z0JBQ2QsT0FBTyxFQUFFLEdBQUcsRUFBRSxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQyxRQUFRLEVBQUU7Z0JBQ3BDLEdBQUcsRUFBRSxHQUFHLEVBQUUsQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsUUFBUSxFQUFFO2FBQ2pDO1NBQ0Y7UUFDRCxPQUFPLEVBQUU7WUFDUCxPQUFPLEVBQUU7Z0JBQ1AsRUFBRSxFQUFFO29CQUNGLEtBQUssRUFBRSxJQUFJO29CQUNYLFFBQVEsRUFBRSwyQkFBMkI7b0JBQ3JDLFNBQVMsRUFBRSxDQUFDLFVBQVUsRUFBRSxRQUFRLENBQUM7aUJBQ2xDO2dCQUNELEVBQUUsRUFBRTtvQkFDRixLQUFLLEVBQUUsSUFBSTtvQkFDWCxTQUFTLEVBQUUsRUFBRTtpQkFDZDthQUNGO1lBQ0QsT0FBTyxFQUFFO2dCQUNQLEtBQUssRUFBRSxNQUFNO2dCQUNiLEVBQUUsRUFBRTtvQkFDRixLQUFLLEVBQUUsUUFBUTtvQkFDZixRQUFRLEVBQUUsMEJBQTBCO29CQUNwQyxTQUFTLEVBQUUsQ0FBQyxVQUFVLEVBQUUsT0FBTyxDQUFDO2lCQUNqQztnQkFDRCxFQUFFLEVBQUU7b0JBQ0YsS0FBSyxFQUFFLFFBQVE7b0JBQ2YsU0FBUyxFQUFFLEVBQUU7aUJBQ2Q7YUFDRjtTQUNGO0tBQ08sQ0FBQyxDQUFDO0lBSVosTUFBTSxRQUFRLEdBQUcsS0FBQSxnQkFBZ0IsRUFBRSxDQUFDO0lBRXZCLHNCQUFpQixHQUFHLEdBQUcsRUFBRSxDQUFDLElBQUEsMkJBQWtCLEVBQUM7UUFDdEQsS0FBSyxFQUFFO1lBQ0wsT0FBTyxFQUFFLEdBQUc7WUFDWixNQUFNLEVBQUUsT0FBTztZQUNmLGdCQUFnQixFQUFFLFFBQVE7WUFDMUIsZ0JBQWdCLEVBQUU7Z0JBQ2QsR0FBRyxFQUFFLEtBQUs7Z0JBQ1YsSUFBSSxFQUFFLE1BQU07Z0JBQ1osTUFBTSxFQUFFLFFBQVE7Z0JBQ2hCLE1BQU0sRUFBRSxRQUFRO2dCQUNoQixNQUFNLEVBQUUsUUFBUTtnQkFDaEIsTUFBTSxFQUFFLFFBQVE7Z0JBQ2hCLEtBQUssRUFBRSxPQUFPO2dCQUNkLFNBQVMsRUFBRSxXQUFXO2dCQUN0QixHQUFHLEVBQUUsS0FBSztnQkFDVixHQUFHLEVBQUUsS0FBSzthQUNiO1lBQ0QsT0FBTyxFQUFFLE9BQU8sRUFBRSxzREFBc0Q7U0FDekU7UUFDRCxVQUFVLEVBQUU7WUFDVixNQUFNLEVBQUU7Z0JBQ04sSUFBSSxFQUFFLFFBQVE7Z0JBQ2QsUUFBUSxFQUFFLElBQUk7Z0JBQ2QsUUFBUSxFQUFFLElBQUk7Z0JBQ2QsT0FBTyxFQUFFLEdBQUcsRUFBRSxDQUFDLElBQUEsbUJBQVUsR0FBRTthQUM1QjtZQUNELFFBQVEsRUFBRTtnQkFDUixJQUFJLEVBQUUsUUFBUTtnQkFDZCxRQUFRLEVBQUUsSUFBSTtnQkFDZCxRQUFRLEVBQUUsSUFBSTtnQkFDZCxPQUFPLEVBQUUsR0FBRyxFQUFFLENBQUMsYUFBYSxFQUFFLGdEQUFnRDtnQkFDOUUsUUFBUSxFQUFFLElBQUEsa0NBQW9CLEVBQUM7b0JBQzdCLFVBQVUsRUFBRSxRQUFRLENBQUMsS0FBSyxDQUFDLE1BQU07b0JBQ2pDLElBQUksRUFBRSxhQUFhO29CQUNuQixVQUFVLEVBQUUsQ0FBQyxRQUFRLEVBQUUsV0FBVyxFQUFFLFdBQVcsQ0FBQztvQkFDaEQsV0FBVyxFQUFFLENBQUM7NEJBQ1osTUFBTSxFQUFFLFVBQVU7NEJBQ2xCLE1BQU0sRUFBRSxRQUFRO3lCQUNqQixDQUFDO2lCQUNNLENBQUM7YUFDWjtZQUNELFNBQVMsRUFBRTtnQkFDVCxJQUFJLEVBQUUsUUFBUTtnQkFDZCxRQUFRLEVBQUUsSUFBSTthQUNmO1lBQ0QsUUFBUSxFQUFFO2dCQUNSLElBQUksRUFBRSxRQUFRO2FBQ2Y7WUFDRCxNQUFNLEVBQUU7Z0JBQ04sSUFBSSxFQUFFLFFBQVE7YUFDZjtZQUNELFFBQVEsRUFBRTtnQkFDUixJQUFJLEVBQUUsUUFBUTthQUNmO1lBQ0QsS0FBSyxFQUFFO2dCQUNMLElBQUksRUFBRSxRQUFRO2dCQUNkLFFBQVEsRUFBRSxJQUFJO2FBQ2Y7WUFDRCxRQUFRLEVBQUU7Z0JBQ1IsSUFBSSxFQUFFLFFBQVE7Z0JBQ2QsUUFBUSxFQUFFLElBQUk7YUFDZjtZQUNELFNBQVMsRUFBRTtnQkFDVCx5Q0FBeUM7Z0JBQ3pDLElBQUksRUFBRSxRQUFRO2dCQUNkLFFBQVEsRUFBRSxJQUFJO2dCQUNkLFFBQVEsRUFBRSxJQUFJO2dCQUNkLE9BQU8sRUFBRSxHQUFHLEVBQUUsQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsUUFBUSxFQUFFO2dCQUNwQyxHQUFHLEVBQUUsR0FBRyxFQUFFLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDLFFBQVEsRUFBRTthQUNqQztZQUNELFNBQVMsRUFBQztnQkFDUixJQUFJLEVBQUUsUUFBUTtnQkFDZCxLQUFLLEVBQUUsR0FBRyxFQUFFLDZDQUE2QztnQkFDekQsUUFBUSxFQUFFLElBQUk7Z0JBQ2QsUUFBUSxFQUFFLElBQUk7Z0JBQ2QsT0FBTyxFQUFFLEdBQUcsRUFBRSxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQyxRQUFRLEVBQUU7Z0JBQ3BDLEdBQUcsRUFBRSxHQUFHLEVBQUUsQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsUUFBUSxFQUFFO2FBQ2pDO1lBQ0QsU0FBUyxFQUFDO2dCQUNSLElBQUksRUFBRSxRQUFRO2dCQUNkLFFBQVEsRUFBRSxLQUFLO2FBQ2hCO1NBQ0Y7UUFDRCxPQUFPLEVBQUU7WUFDUCxPQUFPLEVBQUU7Z0JBQ1AsRUFBRSxFQUFFO29CQUNGLEtBQUssRUFBRSxJQUFJO29CQUNYLFFBQVEsRUFBRSwyQkFBMkI7b0JBQ3JDLFNBQVMsRUFBRSxDQUFDLFVBQVUsRUFBRSxRQUFRLENBQUM7aUJBQ2xDO2dCQUNELEVBQUUsRUFBRTtvQkFDRixLQUFLLEVBQUUsSUFBSTtvQkFDWCxTQUFTLEVBQUUsRUFBRTtpQkFDZDthQUNGO1lBQ0QsT0FBTyxFQUFFO2dCQUNQLEtBQUssRUFBRSxNQUFNO2dCQUNiLEVBQUUsRUFBRTtvQkFDRixLQUFLLEVBQUUsUUFBUTtvQkFDZixRQUFRLEVBQUUsMEJBQTBCO29CQUNwQyxTQUFTLEVBQUUsQ0FBQyxVQUFVLEVBQUUsT0FBTyxDQUFDO2lCQUNqQztnQkFDRCxFQUFFLEVBQUU7b0JBQ0YsS0FBSyxFQUFFLFFBQVE7b0JBQ2YsU0FBUyxFQUFFLEVBQUU7aUJBQ2Q7YUFDRjtTQUNGO0tBQ0ssQ0FBQyxDQUFDO0lBR0MsYUFBUSxHQUFHLEtBQUEsaUJBQWlCLEVBQUUsQ0FBQztJQUUvQixzQkFBaUIsR0FBRyxHQUFHLEVBQUUsQ0FBQyxJQUFBLDJCQUFrQixFQUFDO1FBQ3RELEtBQUssRUFBRTtZQUNMLE9BQU8sRUFBRSxHQUFHO1lBQ1osTUFBTSxFQUFFLE9BQU87WUFDZixnQkFBZ0IsRUFBRSxRQUFRO1lBQzFCLGdCQUFnQixFQUFFLGdDQUF1QjtZQUN6QyxPQUFPLEVBQUUsT0FBTyxFQUFFLHNEQUFzRDtTQUN6RTtRQUNELFVBQVUsRUFBRTtZQUNWLE9BQU8sRUFBRTtnQkFDUCxJQUFJLEVBQUUsUUFBUTtnQkFDZCxRQUFRLEVBQUUsSUFBSTtnQkFDZCxRQUFRLEVBQUUsSUFBSTtnQkFDZCxPQUFPLEVBQUUsR0FBRyxFQUFFLENBQUMsSUFBQSxtQkFBVSxHQUFFO2FBQzVCO1lBQ0QsT0FBTyxFQUFFO2dCQUNQLElBQUksRUFBRSxRQUFRO2dCQUNkLFFBQVEsRUFBRSxJQUFJO2dCQUNkLFFBQVEsRUFBRSxJQUFJO2dCQUNkLE9BQU8sRUFBRSxHQUFHLEVBQUUsQ0FBQyxhQUFhLEVBQUUsZ0RBQWdEO2dCQUM5RSxRQUFRLEVBQUUsSUFBQSxrQ0FBb0IsRUFBQztvQkFDN0IsVUFBVSxFQUFFLEtBQUEsUUFBUSxDQUFDLEtBQUssQ0FBQyxNQUFNO29CQUNqQyxJQUFJLEVBQUUsYUFBYTtvQkFDbkIsV0FBVyxFQUFFLENBQUM7NEJBQ1osTUFBTSxFQUFFLFNBQVM7NEJBQ2pCLE1BQU0sRUFBRSxRQUFRO3lCQUNqQixDQUFDO2lCQUNNLENBQUM7YUFDWjtZQUNELElBQUksRUFBRTtnQkFDSixJQUFJLEVBQUUsUUFBUTtnQkFDZCxRQUFRLEVBQUUsSUFBSTthQUNmO1lBQ0QsU0FBUyxFQUFFO2dCQUNULHlDQUF5QztnQkFDekMsSUFBSSxFQUFFLFFBQVE7Z0JBQ2QsUUFBUSxFQUFFLElBQUk7Z0JBQ2QsUUFBUSxFQUFFLElBQUk7Z0JBQ2QsT0FBTyxFQUFFLEdBQUcsRUFBRSxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQyxRQUFRLEVBQUU7Z0JBQ3BDLEdBQUcsRUFBRSxHQUFHLEVBQUUsQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsUUFBUSxFQUFFO2FBQ2pDO1lBQ0QsU0FBUyxFQUFDO2dCQUNSLElBQUksRUFBRSxRQUFRO2dCQUNkLEtBQUssRUFBRSxHQUFHLEVBQUUsNkNBQTZDO2dCQUN6RCxRQUFRLEVBQUUsSUFBSTtnQkFDZCxRQUFRLEVBQUUsSUFBSTtnQkFDZCxPQUFPLEVBQUUsR0FBRyxFQUFFLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDLFFBQVEsRUFBRTtnQkFDcEMsR0FBRyxFQUFFLEdBQUcsRUFBRSxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQyxRQUFRLEVBQUU7YUFDakM7U0FDRjtRQUNELE9BQU8sRUFBRTtZQUNQLE9BQU8sRUFBRTtnQkFDUCxFQUFFLEVBQUU7b0JBQ0YsS0FBSyxFQUFFLElBQUk7b0JBQ1gsUUFBUSxFQUFFLDJCQUEyQjtvQkFDckMsU0FBUyxFQUFFLENBQUMsVUFBVSxFQUFFLFFBQVEsQ0FBQztpQkFDbEM7Z0JBQ0QsRUFBRSxFQUFFO29CQUNGLEtBQUssRUFBRSxJQUFJO29CQUNYLFNBQVMsRUFBRSxFQUFFO2lCQUNkO2FBQ0Y7U0FDRjtLQUNLLENBQUMsQ0FBQztJQUdDLGFBQVEsR0FBRyxLQUFBLGlCQUFpQixFQUFFLENBQUM7QUFJaEQsQ0FBQyxFQTdRZ0IsSUFBSSxvQkFBSixJQUFJLFFBNlFwQjtBQUVELE1BQU0sd0JBQXdCLEdBQUk7SUFDOUIsV0FBVyxFQUFFLEVBQUUsS0FBSyxFQUFFO1lBQ2xCLFFBQVEsRUFBRSxFQUFFLEVBQUUsRUFBRSxhQUFhLEVBQUU7U0FDbEMsRUFBQztJQUNGLFlBQVksRUFBRSxFQUFFLEtBQUssRUFBRTtZQUNuQixLQUFLLEVBQUUsRUFBRSxFQUFFLEVBQUUsaUJBQWlCLEVBQUU7U0FDbkMsRUFBQztJQUNGLGNBQWMsRUFBRSxFQUFFLE1BQU0sRUFBRTtZQUN0QixNQUFNLEVBQUUsRUFBRSxHQUFHLEVBQUUsRUFBRSxFQUFFO1NBQ3RCLEVBQUM7Q0FDSSxDQUFDO0FBRVgsTUFBTSxpQkFBaUIsR0FBZ0Y7SUFDbkcsUUFBUSxFQUFFO1FBQ1IsUUFBUSxFQUFFLFFBQVE7UUFDbEIsR0FBRyxFQUFFLE1BQU07UUFDWCxNQUFNLEVBQUUsQ0FBQyxHQUFXLEVBQThCLEVBQUU7WUFDbEQsc0VBQXNFO1lBQ3RFLE9BQU8sQ0FBQyxDQUFDLEdBQUcsQ0FBQztRQUNmLENBQUM7S0FDRjtJQUNELFdBQVcsRUFBRTtRQUNYLFNBQVMsRUFBRSxFQUFFO1FBQ2IsT0FBTyxFQUFFLFlBQVk7UUFDckIsc0RBQXNEO1FBQ3RELFNBQVMsRUFBRTtZQUNULEtBQUssRUFBRSxFQUFFO1lBQ1QsT0FBTyxFQUFFLHNCQUFzQjtTQUNoQztRQUNELDJEQUEyRDtRQUMzRCxFQUFFLEVBQUU7WUFDRixTQUFTLEVBQUUsQ0FBQyxLQUF5QixFQUFrQyxFQUFFO2dCQUN2RSxPQUFPLE9BQU8sQ0FBQyxPQUFPLENBQUM7b0JBQ3JCLElBQUksRUFBRSxLQUFLLEtBQUssU0FBUyxJQUFJLEtBQUssSUFBSSxLQUFLO29CQUMzQyxRQUFRLEVBQUUsQ0FBQyxRQUFRLEVBQUUsVUFBVSxDQUFDO29CQUNoQyxRQUFRLEVBQUUsQ0FBQyxLQUFLLENBQUM7b0JBQ2pCLE9BQU8sRUFBRSxvQkFBb0I7aUJBQzlCLENBQUMsQ0FBQztZQUNMLENBQUM7U0FDRjtRQUNELHNDQUFzQztRQUN0QyxNQUFNLEVBQUU7WUFDTixPQUFPLEVBQUUsbURBQW1EO1lBQzVELFNBQVMsRUFBRSxDQUFDLEtBQUssRUFBaUMsRUFBRTtnQkFDaEQsT0FBTyxPQUFPLENBQUMsT0FBTyxDQUFDO29CQUNyQixJQUFJLEVBQUUsS0FBSyxLQUFLLFNBQVM7b0JBQ3pCLFFBQVEsRUFBRSxDQUFDLFVBQVUsRUFBRSxPQUFPLENBQUM7b0JBQy9CLFFBQVEsRUFBRSxDQUFDLEtBQUssQ0FBQztpQkFDbEIsQ0FBQyxDQUFDO1lBQ1AsQ0FBQztTQUNGO0tBRUY7SUFDRCxLQUFLLEVBQUU7UUFDTCxpR0FBaUc7UUFDakcsU0FBUyxFQUFFLENBQUMsS0FBYSxFQUFzQyxFQUFFO1lBQy9ELE1BQU0sR0FBRyxHQUFvQztnQkFDM0MsSUFBSSxFQUFFLENBQUMsQ0FBQyxLQUFLO2dCQUNiLGFBQWEsRUFBRSx3SUFBd0k7YUFDeEosQ0FBQztZQUVGLHNDQUFzQztZQUV0QyxPQUFPLE9BQU8sQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDOUIsQ0FBQztLQUNGO0NBQ0osQ0FBQztBQUVGLE1BQU0sa0JBQWtCLEdBQW1GO0lBQ3pHLFVBQVUsRUFBRSx3QkFBd0I7SUFDcEMsTUFBTSxFQUFFO1FBQ04sS0FBSyxFQUFFO1lBQ0gsUUFBUSxFQUFFLENBQUMsRUFBRSxFQUFFLEVBQUUsYUFBYSxFQUFFLENBQUM7U0FDcEM7UUFDRCxNQUFNLEVBQUU7WUFDSixNQUFNLEVBQUUsQ0FBQyxFQUFFLEdBQUcsRUFBRSxFQUFFLEVBQUUsQ0FBQztTQUN4QjtRQUNELEtBQUssRUFBRTtZQUNILE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRSxFQUFFLGlCQUFpQixFQUFFLFVBQVUsRUFBRSxDQUFDLENBQUMsZ0JBQWdCLEVBQUUsZ0JBQWdCLENBQUMsRUFBRSxLQUFLLENBQUMsRUFBRyxDQUFDO1NBQ2xHO0tBQ0Y7SUFDRCxNQUFNLEVBQUU7UUFDSixLQUFLLEVBQUU7WUFDSCxRQUFRLEVBQUUsQ0FBQyxFQUFFLEVBQUUsRUFBRSxhQUFhLEVBQUUsQ0FBQztTQUNwQztRQUNELEtBQUssRUFBRTtZQUNILEtBQUssRUFBRSxDQUFDLEVBQUUsRUFBRSxFQUFFLGlCQUFpQixFQUFFLFVBQVUsRUFBRSxDQUFDLGFBQWEsQ0FBQyxFQUFFLENBQUM7U0FDbEU7S0FDSjtJQUNELE1BQU0sRUFBRTtRQUNKLEtBQUssRUFBRTtZQUNILFFBQVEsRUFBRSxDQUFDLEVBQUUsRUFBRSxFQUFFLGFBQWEsRUFBRSxDQUFDO1NBQ3BDO1FBQ0QsS0FBSyxFQUFFO1lBQ0gsS0FBSyxFQUFFLENBQUMsRUFBRSxFQUFFLEVBQUUsaUJBQWlCLEVBQUUsVUFBVSxFQUFFLENBQUMsYUFBYSxDQUFDLEVBQUUsQ0FBQztTQUNsRTtRQUNELE1BQU0sRUFBRTtZQUNKLE1BQU0sRUFBRSxDQUFDLEVBQUUsR0FBRyxFQUFFLEVBQUUsRUFBRSxDQUFDO1NBQ3hCO0tBQ0o7SUFDRCxHQUFHLEVBQUUsRUFBRTtDQUNSLENBQUE7QUE2QkQsVUFBVSxFQUFFLHdCQUF3QixDQUFDO0FBU3JDLE1BQU0sTUFBTSxHQUE4RDtJQUN4RSxTQUFTLEVBQUUsQ0FBQztZQUNaLFVBQVUsRUFBRSxDQUFDLFFBQVEsRUFBRSxRQUFRLENBQUM7WUFDaEMsUUFBUSxFQUFFLElBQUk7WUFDZCxTQUFTLEVBQUUsQ0FBQztZQUNaLFNBQVMsRUFBRSxFQUFFO1lBQ2IsU0FBUyxFQUFFLENBQUMsS0FBSyxFQUFFLEtBQUssQ0FBQztTQUN6QixDQUFDO0lBQ0YsUUFBUSxFQUFFLENBQUM7WUFDVixRQUFRLEVBQUUsSUFBSTtZQUNkLFNBQVMsRUFBRSxDQUFDO1lBQ1osVUFBVSxFQUFFLENBQUMsUUFBUSxDQUFDO1NBQ3RCLENBQUM7SUFDRCxRQUFRLEVBQUUsQ0FBQztZQUNULFVBQVUsRUFBRSxDQUFFLFFBQVEsRUFBRSxLQUFLLENBQUM7WUFDNUIsUUFBUSxFQUFFLElBQUk7WUFDZCxRQUFRLEVBQUUsTUFBTTtTQUNuQixDQUFDO0NBQ0gsQ0FBQTtBQUVELE1BQU0sZUFBZSxHQUEwRTtJQUMzRixLQUFLLEVBQUU7UUFDSCxRQUFRLEVBQUUsQ0FBQztnQkFDUCxFQUFFLEVBQUUsYUFBYTtnQkFDakIsVUFBVSxFQUFFO29CQUNWLFFBQVE7b0JBQ1IsUUFBUTtvQkFDUixLQUFLO29CQUNMLENBQUMsUUFBUSxFQUFFLENBQUMsZ0JBQWdCLEVBQUUsY0FBYyxFQUFFLGFBQWEsQ0FBQyxDQUFDO29CQUM3RCxDQUFDLFFBQVEsRUFBRSxDQUFDLGdCQUFnQixFQUFFLGNBQWMsQ0FBQyxFQUFFLEtBQUssQ0FBQztvQkFDckQsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxnQkFBZ0IsRUFBRSxhQUFhLENBQUMsRUFBRSxLQUFLLENBQUU7aUJBQ3REO2FBQ0osQ0FBQztLQUNMO0lBQ0QsS0FBSyxFQUFFO1FBQ0gsS0FBSyxFQUFFLENBQUM7Z0JBQ0osRUFBRSxFQUFFLGlCQUFpQjtnQkFDckIsVUFBVSxFQUFFLENBQUMsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxjQUFjLEVBQUUsZ0JBQWdCLEVBQUUsYUFBYSxDQUFDLENBQUMsQ0FBQzthQUM5RSxDQUFDO1FBQ0YsTUFBTSxFQUFFLENBQUM7Z0JBQ0wsUUFBUSxFQUFFLElBQUk7Z0JBQ2QsVUFBVSxFQUFFO29CQUNWLENBQUMsUUFBUSxFQUFFLENBQUMsY0FBYyxFQUFFLGdCQUFnQixFQUFFLGFBQWEsQ0FBQyxFQUFFLEtBQUssQ0FBRTtpQkFDdEU7YUFDSixDQUFDO1FBQ0YsUUFBUSxFQUFDLENBQUM7Z0JBQ04sUUFBUSxFQUFFLElBQUk7Z0JBQ2QsVUFBVSxFQUFFO29CQUNWLE1BQU0sRUFBRSxDQUFDOzRCQUNQLFVBQVUsRUFBRSxDQUFDLGdCQUFnQixFQUFFLGdCQUFnQixDQUFDOzRCQUNoRCxLQUFLLEVBQUUsS0FBSzt5QkFDYixDQUFDO2lCQUNIO2FBQ0osQ0FBQztLQUNMO0lBQ0QsTUFBTSxFQUFFO1FBQ0osTUFBTSxFQUFFLENBQUM7Z0JBQ0wsUUFBUSxFQUFFLElBQUk7Z0JBQ2QsVUFBVSxFQUFDLENBQUMsS0FBSyxDQUFDO2FBQ3JCLENBQUM7S0FDTDtDQUNKLENBQUEiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBFbnRpdHlTY2hlbWEsIFJlbGF0aW9uLCBSZWxhdGlvbmFsQXR0cmlidXRlcywgY3JlYXRlRW50aXR5UmVsYXRpb24sIEh5ZHJhdGVPcHRpb25Gb3JFbnRpdHkgfSBmcm9tICcuLy4uL2VudGl0eS9iYXNlLWVudGl0eSc7XG5pbXBvcnQgeyByYW5kb21VVUlEIH0gZnJvbSBcImNyeXB0b1wiO1xuaW1wb3J0IHsgRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsIFRFbnRpdHlPcHNJbnB1dFNjaGVtYXMsIGNyZWF0ZUVudGl0eVNjaGVtYSB9IGZyb20gXCIuLi9lbnRpdHlcIjtcbmltcG9ydCB7IEVudGl0eU9wZXJhdGlvbnNWYWxpZGF0aW9uLCBFbnRpdHlWYWxpZGF0aW9ucywgSW5wdXRBcHBsaWNhYmxlQ29uZGl0aW9uc01hcCwgUHJvcGVydHlBcHBsaWNhYmxlRW50aXR5T3BlcmF0aW9ucywgVGVzdENvbXBsZXhWYWxpZGF0aW9uUnVsZVJlc3VsdCwgVGVzdFZhbGlkYXRpb25SZXN1bHQsIFRlc3RWYWxpZGF0aW9uUnVsZVJlc3VsdCwgSW5wdXRWYWxpZGF0aW9uUnVsZSwgRW50aXR5SW5wdXRWYWxpZGF0aW9ucyB9IGZyb20gXCIuL3R5cGVzXCI7XG5pbXBvcnQgeyBOYXJyb3csIE9taXROZXZlciB9IGZyb20gXCIuLi91dGlsc1wiO1xuXG5pbXBvcnQgeyBkZXNjcmliZSwgZXhwZWN0LCBpdCB9IGZyb20gJ0BqZXN0L2dsb2JhbHMnO1xuaW1wb3J0IHsgRW50aXR5IH0gZnJvbSAnZWxlY3Ryb2RiJztcblxuZGVzY3JpYmUoJ1ZhbGlkYXRpb24udHlwZXMnLCAoKSA9PiB7XG4gIGl0KCdzaG91bGQgbmFycm93JywgKCkgPT4ge1xuICAgICAgICBjb25zdCBhOiBOYXJyb3c8bnVtYmVyPiA9IDE7XG4gICAgICAgIGNvbnN0IGI6IE5hcnJvdzxudW1iZXI+ID0gMjtcbiAgICAgICAgY29uc3QgYzogTmFycm93PG51bWJlcj4gPSAzO1xuICAgICAgICBleHBlY3QoYSkudG9CZSgxKTtcbiAgICAgICAgZXhwZWN0KGIpLnRvQmUoMik7XG4gICAgICAgIGV4cGVjdChjKS50b0JlKDMpO1xuICAgIH0pO1xufSk7XG5cbmV4cG9ydCBuYW1lc3BhY2UgVXNlciB7XG5cbiAgICBleHBvcnQgY29uc3QgY3JlYXRlVXNlclNjaGVtYSA9ICgpID0+IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gICAgICBtb2RlbDoge1xuICAgICAgICB2ZXJzaW9uOiAnMScsXG4gICAgICAgIGVudGl0eTogJ3VzZXInLFxuICAgICAgICBlbnRpdHlOYW1lUGx1cmFsOiAnVXNlcnMnLFxuICAgICAgICBlbnRpdHlPcGVyYXRpb25zOiBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucyxcbiAgICAgICAgc2VydmljZTogJ3VzZXJzJywgLy8gZWxlY3RybyBEQiBzZXJ2aWNlIG5hbWUgW2xvZ2ljYWwgZ3JvdXAgb2YgZW50aXRpZXNdXG4gICAgICB9LFxuICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICB1c2VySWQ6IHtcbiAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICByZWFkT25seTogdHJ1ZSxcbiAgICAgICAgICBkZWZhdWx0OiAoKSA9PiByYW5kb21VVUlEKClcbiAgICAgICAgfSxcbiAgICAgICAgdGVuYW50SWQ6IHtcbiAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICByZWFkT25seTogdHJ1ZSxcbiAgICAgICAgICBkZWZhdWx0OiAoKSA9PiAneHh4LXl5eS16enonIC8vIFRPRE86IGhhdmUgc29tZSBnbG9iYWwgbG9naWMgZHJpdmUgdGhpcyB2YWx1ZVxuICAgICAgICB9LFxuICAgICAgICBmaXJzdE5hbWU6IHtcbiAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgICAgbGFzdE5hbWU6IHtcbiAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgfSxcbiAgICAgICAgZW1haWw6IHtcbiAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgICAgcGFzc3dvcmQ6IHtcbiAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgICAgY3JlYXRlZEF0OiB7XG4gICAgICAgICAgLy8gd2lsbCBiZSBzZXQgb25jZSBhdCB0aGUgdGltZSBvZiBjcmVhdGVcbiAgICAgICAgICB0eXBlOiBcInN0cmluZ1wiLFxuICAgICAgICAgIHJlYWRPbmx5OiB0cnVlLFxuICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgIGRlZmF1bHQ6ICgpID0+IERhdGUubm93KCkudG9TdHJpbmcoKSxcbiAgICAgICAgICBzZXQ6ICgpID0+IERhdGUubm93KCkudG9TdHJpbmcoKSxcbiAgICAgICAgfSxcbiAgICAgICAgdXBkYXRlZEF0OntcbiAgICAgICAgICB0eXBlOiBcInN0cmluZ1wiLFxuICAgICAgICAgIHdhdGNoOiBcIipcIiwgLy8gd2lsbCBiZSBzZXQgZXZlcnkgdGltZSBhbnkgcHJvcCBpcyB1cGRhdGVkXG4gICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgICAgcmVhZE9ubHk6IHRydWUsXG4gICAgICAgICAgZGVmYXVsdDogKCkgPT4gRGF0ZS5ub3coKS50b1N0cmluZygpLFxuICAgICAgICAgIHNldDogKCkgPT4gRGF0ZS5ub3coKS50b1N0cmluZygpLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGluZGV4ZXM6IHtcbiAgICAgICAgcHJpbWFyeToge1xuICAgICAgICAgIHBrOiB7XG4gICAgICAgICAgICBmaWVsZDogJ3BrJyxcbiAgICAgICAgICAgIHRlbXBsYXRlOiBcInRfJHt0ZW5hbnRJZH0jdV8ke3VzZXJJZH1cIixcbiAgICAgICAgICAgIGNvbXBvc2l0ZTogWyd0ZW5hbnRJZCcsICd1c2VySWQnXSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHNrOiB7XG4gICAgICAgICAgICBmaWVsZDogJ3NrJyxcbiAgICAgICAgICAgIGNvbXBvc2l0ZTogW10sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgYnlFbWFpbDoge1xuICAgICAgICAgIGluZGV4OiAnZ3NpMScsXG4gICAgICAgICAgcGs6IHtcbiAgICAgICAgICAgIGZpZWxkOiAnZ3NpMXBrJyxcbiAgICAgICAgICAgIHRlbXBsYXRlOiBcInRfJHt0ZW5hbnRJZH0jdV8ke2VtYWlsfVwiLFxuICAgICAgICAgICAgY29tcG9zaXRlOiBbJ3RlbmFudElkJywgJ2VtYWlsJ10sXG4gICAgICAgICAgfSxcbiAgICAgICAgICBzazoge1xuICAgICAgICAgICAgZmllbGQ6ICdnc2kxc2snLFxuICAgICAgICAgICAgY29tcG9zaXRlOiBbXSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9IGFzIGNvbnN0KTtcblxuICAgIGV4cG9ydCB0eXBlIFRVc2VyU2NoZW1hID0gUmV0dXJuVHlwZTx0eXBlb2YgY3JlYXRlVXNlclNjaGVtYT5cblxuICAgIGNvbnN0IHVzZXJTY2gxID0gY3JlYXRlVXNlclNjaGVtYSgpO1xuXG4gICAgZXhwb3J0IGNvbnN0IGNyZWF0ZVVzZXJTY2hlbWEyID0gKCkgPT4gY3JlYXRlRW50aXR5U2NoZW1hKHtcbiAgICAgICAgbW9kZWw6IHtcbiAgICAgICAgICB2ZXJzaW9uOiAnMicsXG4gICAgICAgICAgZW50aXR5OiAndXNlcjInLFxuICAgICAgICAgIGVudGl0eU5hbWVQbHVyYWw6ICdVc2VyczInLFxuICAgICAgICAgIGVudGl0eU9wZXJhdGlvbnM6IHtcbiAgICAgICAgICAgICAgZ2V0OiBcImdldFwiLFxuICAgICAgICAgICAgICBsaXN0OiBcImxpc3RcIixcbiAgICAgICAgICAgICAgY3JlYXRlOiBcImNyZWF0ZVwiLFxuICAgICAgICAgICAgICB1cGRhdGU6IFwidXBkYXRlXCIsXG4gICAgICAgICAgICAgIHVwc2VydDogXCJ1cHNlcnRcIixcbiAgICAgICAgICAgICAgZGVsZXRlOiBcImRlbGV0ZVwiLFxuICAgICAgICAgICAgICBxdWVyeTogXCJxdWVyeVwiLFxuICAgICAgICAgICAgICBkdXBsaWNhdGU6IFwiZHVwbGljYXRlXCIsXG4gICAgICAgICAgICAgIHh4eDogXCJ4eHhcIixcbiAgICAgICAgICAgICAgeXl5OiBcInl5eVwiXG4gICAgICAgICAgfSxcbiAgICAgICAgICBzZXJ2aWNlOiAndXNlcnMnLCAvLyBlbGVjdHJvIERCIHNlcnZpY2UgbmFtZSBbbG9naWNhbCBncm91cCBvZiBlbnRpdGllc11cbiAgICAgICAgfSxcbiAgICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAgIHVzZXJJZDoge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICAgIHJlYWRPbmx5OiB0cnVlLFxuICAgICAgICAgICAgZGVmYXVsdDogKCkgPT4gcmFuZG9tVVVJRCgpXG4gICAgICAgICAgfSxcbiAgICAgICAgICB0ZW5hbnRJZDoge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICAgIHJlYWRPbmx5OiB0cnVlLFxuICAgICAgICAgICAgZGVmYXVsdDogKCkgPT4gJ3h4eC15eXktenp6JywgLy8gVE9ETzogaGF2ZSBzb21lIGdsb2JhbCBsb2dpYyBkcml2ZSB0aGlzIHZhbHVlXG4gICAgICAgICAgICByZWxhdGlvbjogY3JlYXRlRW50aXR5UmVsYXRpb24oe1xuICAgICAgICAgICAgICBlbnRpdHlOYW1lOiB1c2VyU2NoMS5tb2RlbC5lbnRpdHksXG4gICAgICAgICAgICAgIHR5cGU6ICdtYW55LXRvLW9uZScsXG4gICAgICAgICAgICAgIGF0dHJpYnV0ZXM6IFsndXNlcklkJywgJ3VwZGF0ZWRBdCcsICdjcmVhdGVkQXQnXSxcbiAgICAgICAgICAgICAgaWRlbnRpZmllcnM6IFt7XG4gICAgICAgICAgICAgICAgc291cmNlOiAndGVuYW50SWQnLFxuICAgICAgICAgICAgICAgIHRhcmdldDogJ3VzZXJJZCdcbiAgICAgICAgICAgICAgfV0sXG4gICAgICAgICAgICB9IGFzIGNvbnN0KVxuICAgICAgICAgIH0sXG4gICAgICAgICAgZmlyc3ROYW1lOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgbGFzdE5hbWU6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgc3RhdHVzOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHBhcmVudElkOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGVtYWlsOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgcGFzc3dvcmQ6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBjcmVhdGVkQXQ6IHtcbiAgICAgICAgICAgIC8vIHdpbGwgYmUgc2V0IG9uY2UgYXQgdGhlIHRpbWUgb2YgY3JlYXRlXG4gICAgICAgICAgICB0eXBlOiBcInN0cmluZ1wiLFxuICAgICAgICAgICAgcmVhZE9ubHk6IHRydWUsXG4gICAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICAgIGRlZmF1bHQ6ICgpID0+IERhdGUubm93KCkudG9TdHJpbmcoKSxcbiAgICAgICAgICAgIHNldDogKCkgPT4gRGF0ZS5ub3coKS50b1N0cmluZygpLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgdXBkYXRlZEF0OntcbiAgICAgICAgICAgIHR5cGU6IFwic3RyaW5nXCIsXG4gICAgICAgICAgICB3YXRjaDogXCIqXCIsIC8vIHdpbGwgYmUgc2V0IGV2ZXJ5IHRpbWUgYW55IHByb3AgaXMgdXBkYXRlZFxuICAgICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgICAgICByZWFkT25seTogdHJ1ZSxcbiAgICAgICAgICAgIGRlZmF1bHQ6ICgpID0+IERhdGUubm93KCkudG9TdHJpbmcoKSxcbiAgICAgICAgICAgIHNldDogKCkgPT4gRGF0ZS5ub3coKS50b1N0cmluZygpLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgZGVsZXRlZEF0OntcbiAgICAgICAgICAgIHR5cGU6IFwic3RyaW5nXCIsXG4gICAgICAgICAgICByZWFkT25seTogZmFsc2VcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICBpbmRleGVzOiB7XG4gICAgICAgICAgcHJpbWFyeToge1xuICAgICAgICAgICAgcGs6IHtcbiAgICAgICAgICAgICAgZmllbGQ6ICdwaycsXG4gICAgICAgICAgICAgIHRlbXBsYXRlOiBcInRfJHt0ZW5hbnRJZH0jdV8ke3VzZXJJZH1cIixcbiAgICAgICAgICAgICAgY29tcG9zaXRlOiBbJ3RlbmFudElkJywgJ3VzZXJJZCddLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHNrOiB7XG4gICAgICAgICAgICAgIGZpZWxkOiAnc2snLFxuICAgICAgICAgICAgICBjb21wb3NpdGU6IFtdLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGJ5RW1haWw6IHtcbiAgICAgICAgICAgIGluZGV4OiAnZ3NpMScsXG4gICAgICAgICAgICBwazoge1xuICAgICAgICAgICAgICBmaWVsZDogJ2dzaTFwaycsXG4gICAgICAgICAgICAgIHRlbXBsYXRlOiBcInRfJHt0ZW5hbnRJZH0jdV8ke2VtYWlsfVwiLFxuICAgICAgICAgICAgICBjb21wb3NpdGU6IFsndGVuYW50SWQnLCAnZW1haWwnXSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBzazoge1xuICAgICAgICAgICAgICBmaWVsZDogJ2dzaTFzaycsXG4gICAgICAgICAgICAgIGNvbXBvc2l0ZTogW10sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgfSBhcyBjb25zdCk7XG5cbiAgICBleHBvcnQgdHlwZSBUVXNlclNjaGVtYTIgPSBSZXR1cm5UeXBlPHR5cGVvZiBjcmVhdGVVc2VyU2NoZW1hMj47XG4gICAgZXhwb3J0IGNvbnN0IHVzZXJTY2gyID0gY3JlYXRlVXNlclNjaGVtYTIoKTtcblxuICAgIGV4cG9ydCBjb25zdCBjcmVhdGVHcm91cFNjaGVtYSA9ICgpID0+IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gICAgICAgIG1vZGVsOiB7XG4gICAgICAgICAgdmVyc2lvbjogJzEnLFxuICAgICAgICAgIGVudGl0eTogJ2dyb3VwJyxcbiAgICAgICAgICBlbnRpdHlOYW1lUGx1cmFsOiAnR3JvdXBzJyxcbiAgICAgICAgICBlbnRpdHlPcGVyYXRpb25zOiBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucyxcbiAgICAgICAgICBzZXJ2aWNlOiAndXNlcnMnLCAvLyBlbGVjdHJvIERCIHNlcnZpY2UgbmFtZSBbbG9naWNhbCBncm91cCBvZiBlbnRpdGllc11cbiAgICAgICAgfSxcbiAgICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAgIGdyb3VwSWQ6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgICAgICByZWFkT25seTogdHJ1ZSxcbiAgICAgICAgICAgIGRlZmF1bHQ6ICgpID0+IHJhbmRvbVVVSUQoKVxuICAgICAgICAgIH0sXG4gICAgICAgICAgYWRtaW5JZDoge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICAgIHJlYWRPbmx5OiB0cnVlLFxuICAgICAgICAgICAgZGVmYXVsdDogKCkgPT4gJ3h4eC15eXktenp6JywgLy8gVE9ETzogaGF2ZSBzb21lIGdsb2JhbCBsb2dpYyBkcml2ZSB0aGlzIHZhbHVlXG4gICAgICAgICAgICByZWxhdGlvbjogY3JlYXRlRW50aXR5UmVsYXRpb24oe1xuICAgICAgICAgICAgICBlbnRpdHlOYW1lOiB1c2VyU2NoMi5tb2RlbC5lbnRpdHksXG4gICAgICAgICAgICAgIHR5cGU6ICdtYW55LXRvLW9uZScsXG4gICAgICAgICAgICAgIGlkZW50aWZpZXJzOiBbe1xuICAgICAgICAgICAgICAgIHNvdXJjZTogJ2FkbWluSWQnLFxuICAgICAgICAgICAgICAgIHRhcmdldDogJ3VzZXJJZCdcbiAgICAgICAgICAgICAgfV0sXG4gICAgICAgICAgICB9IGFzIGNvbnN0KVxuICAgICAgICAgIH0sXG4gICAgICAgICAgbmFtZToge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGNyZWF0ZWRBdDoge1xuICAgICAgICAgICAgLy8gd2lsbCBiZSBzZXQgb25jZSBhdCB0aGUgdGltZSBvZiBjcmVhdGVcbiAgICAgICAgICAgIHR5cGU6IFwic3RyaW5nXCIsXG4gICAgICAgICAgICByZWFkT25seTogdHJ1ZSxcbiAgICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgICAgZGVmYXVsdDogKCkgPT4gRGF0ZS5ub3coKS50b1N0cmluZygpLFxuICAgICAgICAgICAgc2V0OiAoKSA9PiBEYXRlLm5vdygpLnRvU3RyaW5nKCksXG4gICAgICAgICAgfSxcbiAgICAgICAgICB1cGRhdGVkQXQ6e1xuICAgICAgICAgICAgdHlwZTogXCJzdHJpbmdcIixcbiAgICAgICAgICAgIHdhdGNoOiBcIipcIiwgLy8gd2lsbCBiZSBzZXQgZXZlcnkgdGltZSBhbnkgcHJvcCBpcyB1cGRhdGVkXG4gICAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICAgIHJlYWRPbmx5OiB0cnVlLFxuICAgICAgICAgICAgZGVmYXVsdDogKCkgPT4gRGF0ZS5ub3coKS50b1N0cmluZygpLFxuICAgICAgICAgICAgc2V0OiAoKSA9PiBEYXRlLm5vdygpLnRvU3RyaW5nKCksXG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBpbmRleGVzOiB7XG4gICAgICAgICAgcHJpbWFyeToge1xuICAgICAgICAgICAgcGs6IHtcbiAgICAgICAgICAgICAgZmllbGQ6ICdwaycsXG4gICAgICAgICAgICAgIHRlbXBsYXRlOiBcInRfJHt0ZW5hbnRJZH0jdV8ke3VzZXJJZH1cIixcbiAgICAgICAgICAgICAgY29tcG9zaXRlOiBbJ3RlbmFudElkJywgJ3VzZXJJZCddLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHNrOiB7XG4gICAgICAgICAgICAgIGZpZWxkOiAnc2snLFxuICAgICAgICAgICAgICBjb21wb3NpdGU6IFtdLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgfSBhcyBjb25zdCk7XG5cbiAgICBleHBvcnQgdHlwZSBUR3JvdXBTY2hlbWEgPSBSZXR1cm5UeXBlPHR5cGVvZiBjcmVhdGVHcm91cFNjaGVtYT47XG4gICAgZXhwb3J0IGNvbnN0IGdyb3VwU2NoID0gY3JlYXRlR3JvdXBTY2hlbWEoKTtcblxuICAgIHR5cGUgdHQgPSBSZWxhdGlvbmFsQXR0cmlidXRlczxUVXNlclNjaGVtYTI+O1xuICAgIHR5cGUgdHggPSBOYXJyb3c8SHlkcmF0ZU9wdGlvbkZvckVudGl0eTxUVXNlclNjaGVtYT4+O1xufVxuXG5jb25zdCBVc2VyVmFsaWRhdGlvbkNvbmRpdGlvbnMgPSAge1xuICAgIHRlbmFudElzWFlaOiB7IGFjdG9yOiB7XG4gICAgICAgIHRlbmFudElkOiB7IGVxOiAneHh4LXl5eS16enonIH1cbiAgICB9fSxcbiAgICBpbnB1dElzTml0aW46IHsgaW5wdXQ6IHsgXG4gICAgICAgIGVtYWlsOiB7IGVxOiAnbml0aW5AZ21haWwuY29tJyB9XG4gICAgfX0sXG4gICAgcmVjb3JkSXNOb3ROZXc6IHsgcmVjb3JkOiB7XG4gICAgICAgIHVzZXJJZDogeyBuZXE6ICcnIH1cbiAgICB9fSxcbn0gYXMgY29uc3Q7XG5cbmNvbnN0IFNpZ25JblZhbGlkYXRpb25zOiBJbnB1dFZhbGlkYXRpb25SdWxlPHtlbWFpbDogc3RyaW5nLCBsYXN0TmFtZTogc3RyaW5nLCBhbm90aGVyUHJvcDogc3RyaW5nfT4gPSB7XG4gICAgbGFzdE5hbWU6IHtcbiAgICAgIGRhdGF0eXBlOiAnc3RyaW5nJyxcbiAgICAgIG5lcTogXCJCbGFoXCIsXG4gICAgICBjdXN0b206ICh2YWw6IHN0cmluZyk6IGJvb2xlYW4gfCBQcm9taXNlPGJvb2xlYW4+ID0+IHtcbiAgICAgICAgLy8geW91IGNhbiBkZWZpbmUgYSBjdXN0b20gZnVuY3Rpb24gdG8gdmFsaWRhdGUgdGhlIGlucHV0IFsnbGFzdE5hbWUnXVxuICAgICAgICByZXR1cm4gISF2YWw7XG4gICAgICB9XG4gICAgfSxcbiAgICBhbm90aGVyUHJvcDoge1xuICAgICAgbWF4TGVuZ3RoOiAzMCxcbiAgICAgIHBhdHRlcm46IC9eW2EteixBLVpdLyxcbiAgICAgIC8vICoqIHN0YW5kYXJkIHZhbGlkYXRvciB3aXRoIG92ZXJyaWRkZW4gZXJyb3ItbWVzc2FnZVxuICAgICAgbWluTGVuZ3RoOiB7XG4gICAgICAgIHZhbHVlOiAxMCxcbiAgICAgICAgbWVzc2FnZTogJ2N1c3RvbSBlcnJvciBtZXNzYWdlJ1xuICAgICAgfSxcbiAgICAgIC8vICoqIHN0YW5kYXJkIHZhbGlkYXRvciB3aXRoIG92ZXJyaWRkZW4gdmFsaWRhdG9yLWZ1bmN0aW9uXG4gICAgICBlcTogeyAgXG4gICAgICAgIHZhbGlkYXRvcjogKHZhbHVlOiBzdHJpbmcgfCB1bmRlZmluZWQpOiBQcm9taXNlPFRlc3RWYWxpZGF0aW9uUmVzdWx0PiAgPT4ge1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe1xuICAgICAgICAgICAgcGFzczogdmFsdWUgIT09IHVuZGVmaW5lZCAmJiB2YWx1ZSA9PSAneHl6JyxcbiAgICAgICAgICAgIGV4cGVjdGVkOiBbJ2N1c3RvbScsICd3aGF0ZXZlciddLFxuICAgICAgICAgICAgcmVjZWl2ZWQ6IFt2YWx1ZV0sXG4gICAgICAgICAgICBtZXNzYWdlOiAnc29tZSBlcnJvciBtZXNzYWdlJ1xuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgLy8gKiogIGN1c3RvbSB2YWxpZGF0b3Igd2l0aCBhIG1lc3NhZ2VcbiAgICAgIGN1c3RvbToge1xuICAgICAgICBtZXNzYWdlOiAnc29tZSBlcnJvciBtZXNzYWdlIGlmIHZhbGlkYXRvciByZXNvbHZlcyB0byBmYWxzZScsXG4gICAgICAgIHZhbGlkYXRvcjogKHZhbHVlKTogUHJvbWlzZTxUZXN0VmFsaWRhdGlvblJlc3VsdD4gPT4ge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh7XG4gICAgICAgICAgICAgIHBhc3M6IHZhbHVlICE9PSB1bmRlZmluZWQgLFxuICAgICAgICAgICAgICBleHBlY3RlZDogWydkYXRhdHlwZScsICdlbWFpbCddLFxuICAgICAgICAgICAgICByZWNlaXZlZDogW3ZhbHVlXSxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICB9LFxuICAgIGVtYWlsOiB7XG4gICAgICAvLyAqKiBjdXN0b20gdmFsaWRhdGlvbiBydWxlLCB3aXRoIGl0J3Mgb3duIHZhbGlkYXRvcjsgYWxsIG90aGVyIHZhbGlkYXRpb25zIHdpbGwgYmUgaWdub3JlZCBoZXJlXG4gICAgICB2YWxpZGF0b3I6IChlbWFpbDogc3RyaW5nICk6IFByb21pc2U8VGVzdFZhbGlkYXRpb25SdWxlUmVzdWx0PiA9PiB7XG4gICAgICAgIGNvbnN0IHJlczogVGVzdENvbXBsZXhWYWxpZGF0aW9uUnVsZVJlc3VsdCA9IHtcbiAgICAgICAgICBwYXNzOiAhIWVtYWlsLFxuICAgICAgICAgIGN1c3RvbU1lc3NhZ2U6IFwieW91IGNhbiByZXR1cm4gYSBjdXN0b20gbWVzc2FnZSBmcm9tIHRoZSB2YWxpZGF0b3IgYXMgd2VsbDsgYW5kIGl0IHRha2VzIHByZWNlZGVuY2Ugb3ZlciB0aGUgZXJyb3ItbWVzc2FnZSBkZWZpbmVkIGluIHRoZSBydWxlKGlmIGFueSlcIlxuICAgICAgICB9O1xuXG4gICAgICAgIC8vLi4uIHlvdXIgbG9naWMgdG8gdmFsaWRhdGUgdGhlIGlucHV0XG5cbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShyZXMpO1xuICAgICAgfVxuICAgIH0sXG59O1xuXG5jb25zdCBVc2VyT3BwVmFsaWRhdGlvbnM6IEVudGl0eU9wZXJhdGlvbnNWYWxpZGF0aW9uPFVzZXIuVFVzZXJTY2hlbWEyLCB0eXBlb2YgVXNlclZhbGlkYXRpb25Db25kaXRpb25zPiA9IHtcbiAgY29uZGl0aW9uczogVXNlclZhbGlkYXRpb25Db25kaXRpb25zLCAgXG4gIGRlbGV0ZToge1xuICAgIGFjdG9yOiB7XG4gICAgICAgIHRlbmFudElkOiBbeyBlcTogJ3h4eC15eXktenp6JyB9XVxuICAgIH0sXG4gICAgcmVjb3JkOiB7XG4gICAgICAgIHVzZXJJZDogW3sgbmVxOiAnJyB9XVxuICAgIH0sXG4gICAgaW5wdXQ6IHtcbiAgICAgICAgdXNlcklkOiBbeyBlcTogJ25pdGluQGdtYWlsLmNvbScsIGNvbmRpdGlvbnM6IFtbJ3JlY29yZElzTm90TmV3JywgJ3JlY29yZElzTm90TmV3J10sICdhbGwnXSAgfV0sXG4gICAgfVxuICB9LFxuICBjcmVhdGU6IHtcbiAgICAgIGFjdG9yOiB7XG4gICAgICAgICAgdGVuYW50SWQ6IFt7IGVxOiAneHh4LXl5eS16enonIH1dXG4gICAgICB9LFxuICAgICAgaW5wdXQ6IHtcbiAgICAgICAgICBlbWFpbDogW3sgZXE6ICduaXRpbkBnbWFpbC5jb20nLCBjb25kaXRpb25zOiBbJ3RlbmFudElzWFlaJ10gfV1cbiAgICAgIH1cbiAgfSxcbiAgdXBkYXRlOiB7XG4gICAgICBhY3Rvcjoge1xuICAgICAgICAgIHRlbmFudElkOiBbeyBlcTogJ3h4eC15eXktenp6JyB9XVxuICAgICAgfSxcbiAgICAgIGlucHV0OiB7XG4gICAgICAgICAgZW1haWw6IFt7IGVxOiAnbml0aW5AZ21haWwuY29tJywgY29uZGl0aW9uczogWyd0ZW5hbnRJc1hZWiddIH1dXG4gICAgICB9LFxuICAgICAgcmVjb3JkOiB7XG4gICAgICAgICAgdXNlcklkOiBbeyBuZXE6ICcnIH1dXG4gICAgICB9XG4gIH0sXG4gIHh4eDoge31cbn1cblxuXG5cbnR5cGUgeXkxID0ga2V5b2YgT21pdE5ldmVyPElucHV0QXBwbGljYWJsZUNvbmRpdGlvbnNNYXA8TmFycm93PFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8VXNlci5UVXNlclNjaGVtYT5bJ2NyZWF0ZSddPiwgdHlwZW9mIFVzZXJWYWxpZGF0aW9uQ29uZGl0aW9ucz4+XG50eXBlIHl5ICA9IGtleW9mIE9taXROZXZlcjxJbnB1dEFwcGxpY2FibGVDb25kaXRpb25zTWFwPE5hcnJvdzxURW50aXR5T3BzSW5wdXRTY2hlbWFzPFVzZXIuVFVzZXJTY2hlbWE+PiwgdHlwZW9mIFVzZXJWYWxpZGF0aW9uQ29uZGl0aW9ucz4+XG50eXBlIGN4eCA9IE5hcnJvdzxURW50aXR5T3BzSW5wdXRTY2hlbWFzPFVzZXIuVFVzZXJTY2hlbWEyPj47XG50eXBlIGNjID0ga2V5b2YgT21pdE5ldmVyPFByb3BlcnR5QXBwbGljYWJsZUVudGl0eU9wZXJhdGlvbnM8XG4gICAgJ3VzZXJJZCcsIFxuICAgIFVzZXIuVFVzZXJTY2hlbWEsIFxuICAgIE5hcnJvdzxURW50aXR5T3BzSW5wdXRTY2hlbWFzPFVzZXIuVFVzZXJTY2hlbWEyPj5cbj4+O1xuXG50eXBlIHhweCA9IGNjIGV4dGVuZHMga2V5b2YgVXNlci5UVXNlclNjaGVtYTJbJ21vZGVsJ11bJ2VudGl0eU9wZXJhdGlvbnMnXSA/ICdjY2MnIDogJyc7XG5cbmludGVyZmFjZSBwcHAgZXh0ZW5kcyBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFVzZXIuVFVzZXJTY2hlbWEyPntcbiAgeHh4OiB7XG4gICAgJ2EnOiB7fSxcbiAgICBiOiB7fVxuICB9XG59XG5cbnR5cGUgdDIgPSBwcHBbJ3h4eCddO1xuXG50eXBlIHJ0eSA9IFxuICBrZXlvZiBPbWl0TmV2ZXI8UHJvcGVydHlBcHBsaWNhYmxlRW50aXR5T3BlcmF0aW9uczwnZW1haWwnLCBVc2VyLlRVc2VyU2NoZW1hLCBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFVzZXIuVFVzZXJTY2hlbWEyPj4+IGV4dGVuZHMgXG4gIGtleW9mIFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8VXNlci5UVXNlclNjaGVtYTI+XG4gID8ga2V5b2YgT21pdE5ldmVyPFByb3BlcnR5QXBwbGljYWJsZUVudGl0eU9wZXJhdGlvbnM8J2VtYWlsJywgVXNlci5UVXNlclNjaGVtYSwgVEVudGl0eU9wc0lucHV0U2NoZW1hczxVc2VyLlRVc2VyU2NoZW1hMj4+PiA6IG5ldmVyXG5cbmNvbmRpdGlvbnM6IFVzZXJWYWxpZGF0aW9uQ29uZGl0aW9ucztcblxudHlwZSBFeHRlbmRlZFNjaGVtYSA9IE5hcnJvdzxURW50aXR5T3BzSW5wdXRTY2hlbWFzPFVzZXIuVFVzZXJTY2hlbWEyPiAmIHtcbiAgICAneHh4Jzoge1xuICAgICAgICBwYXJlbnRJZDogc3RyaW5nO1xuICAgICAgICBzdGF0dXM6IG51bWJlcjtcbiAgICB9XG59PlxuXG5jb25zdCBpbnBWYWw6IEVudGl0eUlucHV0VmFsaWRhdGlvbnM8VXNlci5UVXNlclNjaGVtYTIsIEV4dGVuZGVkU2NoZW1hPiA9IHtcbiAgZmlyc3ROYW1lOiBbe1xuXHRcdG9wZXJhdGlvbnM6IFsnY3JlYXRlJywgJ3VwZGF0ZSddLFxuXHRcdHJlcXVpcmVkOiB0cnVlLFxuXHRcdG1pbkxlbmd0aDogMixcblx0XHRtYXhMZW5ndGg6IDEwLFxuXHRcdG5vdEluTGlzdDogWydBYmMnLCAnWHl6J10sXG5cdH1dLFxuXHRwYXNzd29yZDogW3tcblx0XHRyZXF1aXJlZDogdHJ1ZSxcblx0XHRtaW5MZW5ndGg6IDgsXG5cdFx0b3BlcmF0aW9uczogWydjcmVhdGUnXVxuXHR9XSxcbiAgcGFyZW50SWQ6IFt7XG4gICAgb3BlcmF0aW9uczogWyAndXBkYXRlJywgJ3h4eCddLFxuICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICBkYXRhdHlwZTogJ3V1aWQnXG4gIH1dXG59XG5cbmNvbnN0IFVzZXJWYWxpZGF0aW9uczogRW50aXR5VmFsaWRhdGlvbnM8VXNlci5UVXNlclNjaGVtYTIsIHR5cGVvZiBVc2VyVmFsaWRhdGlvbkNvbmRpdGlvbnM+ID0ge1xuICAgIGFjdG9yOiB7XG4gICAgICAgIHRlbmFudElkOiBbe1xuICAgICAgICAgICAgZXE6ICd4eHgteXl5LXp6eicsXG4gICAgICAgICAgICBvcGVyYXRpb25zOiBbXG4gICAgICAgICAgICAgICdjcmVhdGUnLFxuICAgICAgICAgICAgICAndXBkYXRlJyxcbiAgICAgICAgICAgICAgJ3h4eCcsXG4gICAgICAgICAgICAgIFsndXBkYXRlJywgWydyZWNvcmRJc05vdE5ldycsICdpbnB1dElzTml0aW4nLCAndGVuYW50SXNYWVonXV0sXG4gICAgICAgICAgICAgIFsndXBkYXRlJywgWydyZWNvcmRJc05vdE5ldycsICdpbnB1dElzTml0aW4nXSwgJ2FueSddLFxuICAgICAgICAgICAgICBbJ2RlbGV0ZScsIFsncmVjb3JkSXNOb3ROZXcnLCAndGVuYW50SXNYWVonXSwgJ2FsbCcgXVxuICAgICAgICAgICAgXSxcbiAgICAgICAgfV0sXG4gICAgfSxcbiAgICBpbnB1dDoge1xuICAgICAgICBlbWFpbDogW3tcbiAgICAgICAgICAgIGVxOiAnbml0aW5AZ21haWwuY29tJyxcbiAgICAgICAgICAgIG9wZXJhdGlvbnM6IFtbJ2NyZWF0ZScsIFsnaW5wdXRJc05pdGluJywgJ3JlY29yZElzTm90TmV3JywgJ3RlbmFudElzWFlaJ11dXSxcbiAgICAgICAgfV0sXG4gICAgICAgIHVzZXJJZDogW3tcbiAgICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgICAgb3BlcmF0aW9uczogW1xuICAgICAgICAgICAgICBbJ2NyZWF0ZScsIFsnaW5wdXRJc05pdGluJywgJ3JlY29yZElzTm90TmV3JywgJ3RlbmFudElzWFlaJ10sICdhbnknIF1cbiAgICAgICAgICAgIF0sXG4gICAgICAgIH1dLFxuICAgICAgICBsYXN0TmFtZTpbe1xuICAgICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgICAgICBvcGVyYXRpb25zOiB7XG4gICAgICAgICAgICAgIGNyZWF0ZTogW3tcbiAgICAgICAgICAgICAgICBjb25kaXRpb25zOiBbJ3JlY29yZElzTm90TmV3JywgJ3JlY29yZElzTm90TmV3J10sXG4gICAgICAgICAgICAgICAgc2NvcGU6ICdhbnknLFxuICAgICAgICAgICAgICB9XSxcbiAgICAgICAgICAgIH1cbiAgICAgICAgfV1cbiAgICB9LFxuICAgIHJlY29yZDoge1xuICAgICAgICB1c2VySWQ6IFt7XG4gICAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICAgIG9wZXJhdGlvbnM6Wyd4eHgnXVxuICAgICAgICB9XVxuICAgIH1cbn1cbiJdfQ==