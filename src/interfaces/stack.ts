import { Fw24 } from "../core/fw24";

export interface IStack {
    fw24: Fw24;
    dependencies: string[];
    // outputs from the stack that can be used by other stacks
    // cocnvension for output is to use the resource and name as the key
    // e.g. output: bucket.[bucketName] = bucket; function.[functionName] = function
    output: any;
    construct(): Promise<void>;
}
