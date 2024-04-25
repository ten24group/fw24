import {join as pathJoin } from "path";

import { IStack } from "../interfaces/stack";

export interface IModuleConfig{}

export interface IFw24Module{
    getName(): string;
    getBasePath(): string;
    getStacks(): Map<string, IStack>;
    getControllersDirectory(): string;
    getServicesDirectory(): string;
    getQueuesDirectory(): string;
    getQueueFileNames(): string[];
    getDependencies(): string[];
    getTasksDirectory(): string;
    getTaskFileNames(): string[];
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

    // Directory where queues are defined, path is relative to the module base path
    getQueuesDirectory(): string {
        return '';
    }

    // Array of queue file names to be registered
    // if empty, all files in the queues directory will be registered
    getQueueFileNames(): string[] {
        return [];
    }

    // Directory where tasks are defined, path is relative to the module base path
    getTasksDirectory(): string {
        return '';
    }

    // Array of task file names to be registered
    // if empty, all files in the tasks directory will be registered
    getTaskFileNames(): string[] {
        return [];
    }

    getDependencies(): string[] {
        return [];
    }

}