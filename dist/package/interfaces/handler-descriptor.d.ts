import type { Route } from "./route";
import type { CapabilityDescriptor, DeploymentUnitDescriptor } from "../manifest/types";
interface HandlerDescriptor {
    handlerClass: any;
    handlerInstance?: any;
    fileName: string;
    filePath: string;
    routes?: Record<string, Route>;
    handlerHash: string;
    manifestCapability?: CapabilityDescriptor;
    deploymentUnit?: DeploymentUnitDescriptor;
    manifestCapabilities?: CapabilityDescriptor[];
}
export default HandlerDescriptor;
