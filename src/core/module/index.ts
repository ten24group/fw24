import * as path from "path";

import { IStack } from "../../interfaces/stack";

export interface IModuleConfig{}

export interface IFw24Module{
    getName(): string;
    getBasePath(): string;
    getStacks(): Map<string, IStack>;
    getControllersRelativePath(): string;
}

export abstract class AbstractFw24Module implements IFw24Module {

    constructor( protected readonly config: IModuleConfig){
    }

    abstract getStacks(): Map<string, IStack>;

    abstract getName(): string;

    abstract getBasePath(): string;

    getControllersRelativePath(): string {
        return path.join("./controllers/");
    }
}