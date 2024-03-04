import { Route } from "../interfaces/route.interface";
//import { Route } from "fw24-core";

interface ControllerDescriptor {
    controllerClass: any; // The controller class itself
    controllerInstance?: any; // An instance of the controller
    fileName: string; // The file name
    filePath: string; // The file path
    routes?: Record<string, Route>; // The routes defined in the controller
}

export default ControllerDescriptor;
