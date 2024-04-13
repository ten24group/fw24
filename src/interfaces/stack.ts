import { Fw24 } from "../core/fw24";

export interface IStack {
    fw24: Fw24;
    dependencies: string[];
    construct(): Promise<void>;
}
