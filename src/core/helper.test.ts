import { Helper } from "./helper";
import { describe, expect, it } from '@jest/globals';

describe('Helper', () => {

    it('hydrateConfig', () => {
        const config = {
            configA: "A",
            configB: "B",
            configC: undefined
        };
        process.env.APP_CONFIG_C = "C";

        Helper.hydrateConfig(config, 'APP');

        expect(config.configA).toBe("A");
        expect(config.configB).toBe("B");
        expect(config.configC).toBe("C");
    });
});


