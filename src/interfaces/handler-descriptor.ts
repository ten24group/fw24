import type { Route } from "./route";

interface HandlerDescriptor {
    handlerClass: any; // The Handler/Controller class itself
    handlerInstance?: any; // An instance of the Handler/Controller
    fileName: string; // The file name
    filePath: string; // The file path
    routes?: Record<string, Route>; // The routes defined in the controller
}

export default HandlerDescriptor;
