import {join as pathJoin } from "path";

import { IStack } from "../../interfaces/stack";

export interface IModuleConfig{}

export interface IFw24Module{
    getName(): string;
    getBasePath(): string;
    getStacks(): Map<string, IStack>;
    getControllersDirectory(): string;
    getServicesDirectory(): string;
}

export abstract class AbstractFw24Module implements IFw24Module {

    constructor( protected readonly config: IModuleConfig){
    }

    abstract getStacks(): Map<string, IStack>;

    abstract getName(): string;

    abstract getBasePath(): string;

    getControllersDirectory(): string {
        return pathJoin("./controllers/");
    }

    getServicesDirectory(): string {
        return pathJoin("./services/");
    }
}