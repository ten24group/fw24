import { AbstractFw24Module, IModuleConfig } from '../../core/module';
import { IStack } from '../../interfaces/stack';
import { CognitoStack } from '../../stacks/cognito';

export interface IAuthModuleConfig extends IModuleConfig {
    selfSignUpEnabled?: boolean;
    policyFilePaths?: string[];
}

export class AuthModule extends AbstractFw24Module {

    protected stacks: Map<string, IStack>; 

    constructor( protected readonly config: IAuthModuleConfig){
        super(config);
        this.stacks = new Map();

        const cognito = new CognitoStack({	
            userPool: {
                props: {
                    selfSignUpEnabled: config.selfSignUpEnabled || false,
                    userPoolName: 'authmodule'
                }
            },
            policyFilePaths: config.policyFilePaths,
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