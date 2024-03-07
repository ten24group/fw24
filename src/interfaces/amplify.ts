export interface IAmplifyConfig {
    githubOwner: string;
    githubRepo: string;
    githubBranch: string;
    secretKeyName: string;
    buildSpec: any; // BuildSpec.fromObject
}
