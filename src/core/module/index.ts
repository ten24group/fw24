import * as path from "path";


export interface IStack {}

export interface IModuleConfig{}

export interface IFw24Module{
    getName(): string;
    getBasePath(): string;
    getStacks(): Map<string, IStack>;
}

export abstract class AbstractFw24Module implements IFw24Module {

    constructor( protected readonly config: IModuleConfig){
    }

    abstract getStacks(): Map<string, IStack>;

    abstract getName(): string;

    abstract getBasePath(): string;
}