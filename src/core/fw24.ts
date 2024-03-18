import { IApplicationConfig } from '../interfaces/config';
import { Helper } from './helper';

export class Fw24 {
    public appName: string = "fw24";
    private stacks: any = {};
    private authorizer: any

    constructor(private config: IApplicationConfig) {
        // Hydrate the config object with environment variables
        Helper.hydrateConfig(config);

        this.appName = config.name!;
    }

    public getConfig(): IApplicationConfig {
        return this.config;
    }
    
    public addStack(name: string, stack: any): Fw24 {
        this.stacks[name] = stack;
        return this;
    }

    public getStack(name: string): any {
        return this.stacks[name];
    }

    public getLayerARN(): string {
        if(this.stacks['main'] === undefined) {
            throw new Error('Main stack not found');
        }
        return `arn:aws:lambda:${this.config.region}:${this.stacks['main'].account}:layer:Fw24CoreLayer:${this.config.coreVersion}`;
    }

    public setAuthorizer(authorizer: any) {
        this.authorizer = authorizer;
    }

    public getAuthorizer() {
        return this.authorizer;
    }
}