import { AbstractFw24Module, IModuleConfig } from '../../core/module';
import { IStack } from '../../interfaces/stack';
import { CognitoStack, ICognitoConfig } from '../../stacks/cognito';
import { createLogger } from "../../logging";

export interface IAuthModuleConfig extends ICognitoConfig {
    
}

export class AuthModule extends AbstractFw24Module {
    readonly logger = createLogger(CognitoStack.name);

    protected stacks: Map<string, IStack>; 

    constructor( protected readonly config: IAuthModuleConfig){
        super(config);
        this.stacks = new Map();

        const cognito = new CognitoStack({	
            name: 'authmodule',
            ...config,
        });

        this.stacks.set('auth-cognito', cognito );

    }

    getName(): string {
        return 'AuthModule';
    }

    getBasePath(): string {
        return __dirname;
    }

    getStacks(): Map<string, IStack> {
        return this.stacks;
    }
}