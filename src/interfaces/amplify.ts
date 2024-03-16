export interface IAmplifyConfig {
    appName: string;
    githubOwner: string;
    githubRepo: string;
    githubBranch: string;
    secretKeyName: string;
    buildSpec: any; // BuildSpec.fromObject
}
