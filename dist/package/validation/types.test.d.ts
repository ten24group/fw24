import { Relation } from './../entity/base-entity';
export declare namespace User {
    const createUserSchema: () => {
        readonly model: {
            readonly version: "1";
            readonly entity: "user";
            readonly entityNamePlural: "Users";
            readonly entityOperations: {
                get: string;
                list: string;
                query: string;
                create: string;
                upsert: string;
                update: string;
                delete: string;
                duplicate: string;
            };
            readonly service: "users";
        };
        readonly attributes: {
            readonly userId: {
                readonly type: "string";
                readonly required: true;
                readonly readOnly: true;
                readonly default: () => `${string}-${string}-${string}-${string}-${string}`;
            };
            readonly tenantId: {
                readonly type: "string";
                readonly required: true;
                readonly readOnly: true;
                readonly default: () => string;
            };
            readonly firstName: {
                readonly type: "string";
                readonly required: true;
            };
            readonly lastName: {
                readonly type: "string";
            };
            readonly email: {
                readonly type: "string";
                readonly required: true;
            };
            readonly password: {
                readonly type: "string";
                readonly required: true;
            };
            readonly createdAt: {
                readonly type: "string";
                readonly readOnly: true;
                readonly required: true;
                readonly default: () => string;
                readonly set: () => string;
            };
            readonly updatedAt: {
                readonly type: "string";
                readonly watch: "*";
                readonly required: true;
                readonly readOnly: true;
                readonly default: () => string;
                readonly set: () => string;
            };
        };
        readonly indexes: {
            readonly primary: {
                readonly pk: {
                    readonly field: "pk";
                    readonly template: "t_${tenantId}#u_${userId}";
                    readonly composite: readonly ["tenantId", "userId"];
                };
                readonly sk: {
                    readonly field: "sk";
                    readonly composite: readonly [];
                };
            };
            readonly byEmail: {
                readonly index: "gsi1";
                readonly pk: {
                    readonly field: "gsi1pk";
                    readonly template: "t_${tenantId}#u_${email}";
                    readonly composite: readonly ["tenantId", "email"];
                };
                readonly sk: {
                    readonly field: "gsi1sk";
                    readonly composite: readonly [];
                };
            };
        };
    };
    type TUserSchema = ReturnType<typeof createUserSchema>;
    const createUserSchema2: () => {
        readonly model: {
            readonly version: "2";
            readonly entity: "user2";
            readonly entityNamePlural: "Users2";
            readonly entityOperations: {
                readonly get: "get";
                readonly list: "list";
                readonly create: "create";
                readonly update: "update";
                readonly upsert: "upsert";
                readonly delete: "delete";
                readonly query: "query";
                readonly duplicate: "duplicate";
                readonly xxx: "xxx";
                readonly yyy: "yyy";
            };
            readonly service: "users";
        };
        readonly attributes: {
            readonly userId: {
                readonly type: "string";
                readonly required: true;
                readonly readOnly: true;
                readonly default: () => `${string}-${string}-${string}-${string}-${string}`;
            };
            readonly tenantId: {
                readonly type: "string";
                readonly required: true;
                readonly readOnly: true;
                readonly default: () => string;
                readonly relation: Relation<any>;
            };
            readonly firstName: {
                readonly type: "string";
                readonly required: true;
            };
            readonly lastName: {
                readonly type: "string";
            };
            readonly status: {
                readonly type: "string";
            };
            readonly parentId: {
                readonly type: "string";
            };
            readonly email: {
                readonly type: "string";
                readonly required: true;
            };
            readonly password: {
                readonly type: "string";
                readonly required: true;
            };
            readonly createdAt: {
                readonly type: "string";
                readonly readOnly: true;
                readonly required: true;
                readonly default: () => string;
                readonly set: () => string;
            };
            readonly updatedAt: {
                readonly type: "string";
                readonly watch: "*";
                readonly required: true;
                readonly readOnly: true;
                readonly default: () => string;
                readonly set: () => string;
            };
            readonly deletedAt: {
                readonly type: "string";
                readonly readOnly: false;
            };
        };
        readonly indexes: {
            readonly primary: {
                readonly pk: {
                    readonly field: "pk";
                    readonly template: "t_${tenantId}#u_${userId}";
                    readonly composite: readonly ["tenantId", "userId"];
                };
                readonly sk: {
                    readonly field: "sk";
                    readonly composite: readonly [];
                };
            };
            readonly byEmail: {
                readonly index: "gsi1";
                readonly pk: {
                    readonly field: "gsi1pk";
                    readonly template: "t_${tenantId}#u_${email}";
                    readonly composite: readonly ["tenantId", "email"];
                };
                readonly sk: {
                    readonly field: "gsi1sk";
                    readonly composite: readonly [];
                };
            };
        };
    };
    type TUserSchema2 = ReturnType<typeof createUserSchema2>;
    const userSch2: {
        readonly model: {
            readonly version: "2";
            readonly entity: "user2";
            readonly entityNamePlural: "Users2";
            readonly entityOperations: {
                readonly get: "get";
                readonly list: "list";
                readonly create: "create";
                readonly update: "update";
                readonly upsert: "upsert";
                readonly delete: "delete";
                readonly query: "query";
                readonly duplicate: "duplicate";
                readonly xxx: "xxx";
                readonly yyy: "yyy";
            };
            readonly service: "users";
        };
        readonly attributes: {
            readonly userId: {
                readonly type: "string";
                readonly required: true;
                readonly readOnly: true;
                readonly default: () => `${string}-${string}-${string}-${string}-${string}`;
            };
            readonly tenantId: {
                readonly type: "string";
                readonly required: true;
                readonly readOnly: true;
                readonly default: () => string;
                readonly relation: Relation<any>;
            };
            readonly firstName: {
                readonly type: "string";
                readonly required: true;
            };
            readonly lastName: {
                readonly type: "string";
            };
            readonly status: {
                readonly type: "string";
            };
            readonly parentId: {
                readonly type: "string";
            };
            readonly email: {
                readonly type: "string";
                readonly required: true;
            };
            readonly password: {
                readonly type: "string";
                readonly required: true;
            };
            readonly createdAt: {
                readonly type: "string";
                readonly readOnly: true;
                readonly required: true;
                readonly default: () => string;
                readonly set: () => string;
            };
            readonly updatedAt: {
                readonly type: "string";
                readonly watch: "*";
                readonly required: true;
                readonly readOnly: true;
                readonly default: () => string;
                readonly set: () => string;
            };
            readonly deletedAt: {
                readonly type: "string";
                readonly readOnly: false;
            };
        };
        readonly indexes: {
            readonly primary: {
                readonly pk: {
                    readonly field: "pk";
                    readonly template: "t_${tenantId}#u_${userId}";
                    readonly composite: readonly ["tenantId", "userId"];
                };
                readonly sk: {
                    readonly field: "sk";
                    readonly composite: readonly [];
                };
            };
            readonly byEmail: {
                readonly index: "gsi1";
                readonly pk: {
                    readonly field: "gsi1pk";
                    readonly template: "t_${tenantId}#u_${email}";
                    readonly composite: readonly ["tenantId", "email"];
                };
                readonly sk: {
                    readonly field: "gsi1sk";
                    readonly composite: readonly [];
                };
            };
        };
    };
    const createGroupSchema: () => {
        readonly model: {
            readonly version: "1";
            readonly entity: "group";
            readonly entityNamePlural: "Groups";
            readonly entityOperations: {
                get: string;
                list: string;
                query: string;
                create: string;
                upsert: string;
                update: string;
                delete: string;
                duplicate: string;
            };
            readonly service: "users";
        };
        readonly attributes: {
            readonly groupId: {
                readonly type: "string";
                readonly required: true;
                readonly readOnly: true;
                readonly default: () => `${string}-${string}-${string}-${string}-${string}`;
            };
            readonly adminId: {
                readonly type: "string";
                readonly required: true;
                readonly readOnly: true;
                readonly default: () => string;
                readonly relation: Relation<any>;
            };
            readonly name: {
                readonly type: "string";
                readonly required: true;
            };
            readonly createdAt: {
                readonly type: "string";
                readonly readOnly: true;
                readonly required: true;
                readonly default: () => string;
                readonly set: () => string;
            };
            readonly updatedAt: {
                readonly type: "string";
                readonly watch: "*";
                readonly required: true;
                readonly readOnly: true;
                readonly default: () => string;
                readonly set: () => string;
            };
        };
        readonly indexes: {
            readonly primary: {
                readonly pk: {
                    readonly field: "pk";
                    readonly template: "t_${tenantId}#u_${userId}";
                    readonly composite: readonly ["tenantId", "userId"];
                };
                readonly sk: {
                    readonly field: "sk";
                    readonly composite: readonly [];
                };
            };
        };
    };
    type TGroupSchema = ReturnType<typeof createGroupSchema>;
    const groupSch: {
        readonly model: {
            readonly version: "1";
            readonly entity: "group";
            readonly entityNamePlural: "Groups";
            readonly entityOperations: {
                get: string;
                list: string;
                query: string;
                create: string;
                upsert: string;
                update: string;
                delete: string;
                duplicate: string;
            };
            readonly service: "users";
        };
        readonly attributes: {
            readonly groupId: {
                readonly type: "string";
                readonly required: true;
                readonly readOnly: true;
                readonly default: () => `${string}-${string}-${string}-${string}-${string}`;
            };
            readonly adminId: {
                readonly type: "string";
                readonly required: true;
                readonly readOnly: true;
                readonly default: () => string;
                readonly relation: Relation<any>;
            };
            readonly name: {
                readonly type: "string";
                readonly required: true;
            };
            readonly createdAt: {
                readonly type: "string";
                readonly readOnly: true;
                readonly required: true;
                readonly default: () => string;
                readonly set: () => string;
            };
            readonly updatedAt: {
                readonly type: "string";
                readonly watch: "*";
                readonly required: true;
                readonly readOnly: true;
                readonly default: () => string;
                readonly set: () => string;
            };
        };
        readonly indexes: {
            readonly primary: {
                readonly pk: {
                    readonly field: "pk";
                    readonly template: "t_${tenantId}#u_${userId}";
                    readonly composite: readonly ["tenantId", "userId"];
                };
                readonly sk: {
                    readonly field: "sk";
                    readonly composite: readonly [];
                };
            };
        };
    };
}
