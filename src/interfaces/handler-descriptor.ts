import type { Route } from "./route";
import type { CapabilityDescriptor, DeploymentUnitDescriptor } from "../manifest/types";

interface HandlerDescriptor {
    handlerClass: any; // The Handler/Controller class itself
    handlerInstance?: any; // An instance of the Handler/Controller
    fileName: string; // The file name
    filePath: string; // The file path
    routes?: Record<string, Route>; // The routes defined in the controller
    handlerHash: string; // The hash of the handler
    manifestCapability?: CapabilityDescriptor; // Manifest data for build-time registration (single capability)
    deploymentUnit?: DeploymentUnitDescriptor; // DU data for build-time registration (grouped capabilities)
    manifestCapabilities?: CapabilityDescriptor[]; // Multiple capabilities for DU-based registration
}

export default HandlerDescriptor;
