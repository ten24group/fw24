import { Fw24  } from "./fw24";
import { describe, expect, it } from '@jest/globals';

describe('Fw24', () => {
    
    it('getUniqueName', () => {
        const config = {
            name: "fw24",
            env: "dev",
        };
        const fw24 = Fw24.getInstance();
        fw24.setConfig(config);

        fw24.addStack("main", { account: "123456789012" });

        const uniqueName = fw24.getUniqueName("myBucket");
        expect(uniqueName).toBe("myBucket-fw24-dev-123456789012");
    });

    it('getStack', () => {
        const config = {
            name: "fw24",
            env: "dev",
        };
        const fw24 = Fw24.getInstance();
        fw24.setConfig(config);
        fw24.addStack("main", { account: "123456789012" });
        const stack = fw24.getStack("main");
        expect(stack.account).toBe("123456789012");
    });

    it('getLayerARN', () => {
        const config = {
            name: "fw24",
            env: "dev",
            region: "us-east-1",
            coreVersion: 1
        };
        const fw24 = Fw24.getInstance();
        fw24.setConfig(config);
        fw24.addStack("main", { account: "123456789012" });

        const layerARN = fw24.getLayerARN();
        expect(layerARN).toBe("arn:aws:lambda:us-east-1:123456789012:layer:Fw24CoreLayer:1");
    });

    it('getQueueArn', () => {
        const config = {
            name: "fw24",
            env: "dev",
            region: "us-east-1",
            coreVersion: 1
        };
        const fw24 = Fw24.getInstance();
        fw24.setConfig(config);
        fw24.addStack("main", { account: "123456789012" });

        const queueArn = fw24.getArn("sqs","myQueue");
        expect(queueArn).toBe("arn:aws:sqs:us-east-1:123456789012:myQueue");
    });

    it('set', () => {
        const config = {
            name: "fw24",
            env: "dev",
        };
        const fw24 = Fw24.getInstance();
        fw24.setConfig(config);
        fw24.set("myVar", "myVal");
        expect(fw24.get("myVar")).toBe("myVal");
    });

    it('set with prefix', ()    => {
        const config = {
            name: "fw24",
            env: "dev",
        };
        const fw24 = Fw24.getInstance();
        fw24.setConfig(config);
        fw24.set("myVar", "myVal", "APP");
        expect(fw24.get("myVar", "APP")).toBe("myVal");
    });

    it('getAuthorizer with unknown type', () => {
        const config = {
            name: "fw24",
            env: "dev",
        };
        const fw24 = Fw24.getInstance();
        fw24.setConfig(config);
        expect(fw24.getAuthorizer("UNKNOWN")).toBeUndefined();
    });

});
