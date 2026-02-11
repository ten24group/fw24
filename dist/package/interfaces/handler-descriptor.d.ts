import type { Route } from "./route";
interface HandlerDescriptor {
    handlerClass: any;
    handlerInstance?: any;
    fileName: string;
    filePath: string;
    routes?: Record<string, Route>;
    handlerHash: string;
}
export default HandlerDescriptor;
