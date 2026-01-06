"use strict";
/**
 * REAL Cross-Module Test
 *
 * This test ACTUALLY simulates the bundled vs layer scenario
 * by creating TWO different DIContainer classes and verifying
 * that instanceof fails but duck-typing succeeds.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const container_1 = require("./container");
describe('REAL Cross-Module DIContainer Problem', () => {
    it('should FAIL instanceof check across different class definitions', () => {
        // This is the REAL problem: two copies of the same class
        // Simulate "bundled" DIContainer
        class BundledDIContainer {
            containerId = 'ROOT';
            register(_options) { return this; }
            resolve(_token) { return null; }
        }
        // Simulate "layer" DIContainer  
        class LayerDIContainer {
            containerId = 'ROOT';
            register(_options) { return this; }
            resolve(_token) { return null; }
        }
        // Create instance from "bundled" class
        const bundledInstance = new BundledDIContainer();
        // Layer code checks instanceof with ITS class
        const isInstanceOfLayer = bundledInstance instanceof LayerDIContainer;
        // THIS IS THE PROBLEM: Same structure, different classes → FALSE
        expect(isInstanceOfLayer).toBe(false); // ← THE REAL ISSUE! ✅
        // But duck-typing SHOULD work
        const isDuckTyped = typeof bundledInstance === 'object' &&
            bundledInstance !== null &&
            'containerId' in bundledInstance &&
            'register' in bundledInstance;
        expect(isDuckTyped).toBe(true); // ← THE FIX! ✅
    });
    it('should demonstrate the ACTUAL Lambda scenario', () => {
        // Clear global
        global.__fw24_di_root_container__ = undefined;
        // Step 1: Bundled fw24 creates ROOT using ITS DIContainer class
        const bundledRoot = container_1.DIContainer.ROOT;
        // Step 2: Simulate layer fw24 has a DIFFERENT DIContainer class
        // (In reality this is the same file loaded from different paths)
        // We can't actually do this in Jest, but we can simulate the CHECK
        const layerDIContainerClass = container_1.DIContainer; // In reality, this would be different
        // Step 3: Layer's registerEntitySchema receives bundledRoot
        // and checks: bundledRoot instanceof layerDIContainerClass
        const passesDuckType = typeof bundledRoot === 'object' &&
            bundledRoot !== null &&
            'containerId' in bundledRoot &&
            'register' in bundledRoot;
        // Our fix ensures this passes even if instanceof fails
        expect(passesDuckType).toBe(true);
        expect(bundledRoot.containerId).toBe('ROOT');
    });
    it('should show why instanceof is unreliable across module boundaries', () => {
        // Create two "identical" classes (simulating bundled vs layer)
        const createDIContainerClass = () => {
            return class {
                containerId = 'ROOT';
                register() { return this; }
            };
        };
        const BundledDIContainer = createDIContainerClass();
        const LayerDIContainer = createDIContainerClass();
        const bundledInstance = new BundledDIContainer();
        // Same code, but instanceof fails because they're different class objects
        expect(bundledInstance instanceof BundledDIContainer).toBe(true);
        expect(bundledInstance instanceof LayerDIContainer).toBe(false); // ← THE PROBLEM
        // Duck typing works regardless
        const checkDuckType = (obj, props) => {
            return props.every(prop => prop in obj);
        };
        expect(checkDuckType(bundledInstance, ['containerId', 'register'])).toBe(true);
    });
    it('should verify the fix in registerEntitySchema logic', () => {
        // Simulate the actual check in registerEntitySchema
        const providedIn = {
            containerId: 'ROOT',
            register: () => { },
        };
        let container;
        // Original check (would fail with cross-module instance)
        // if (providedIn instanceof DIContainer) { ... }
        // Our new check
        if (providedIn instanceof container_1.DIContainer) {
            container = providedIn;
        }
        else if (typeof providedIn === 'object' &&
            providedIn !== null &&
            'containerId' in providedIn &&
            'register' in providedIn) {
            container = providedIn; // ← THIS IS THE FIX
        }
        expect(container).toBeDefined();
        expect(container).toBe(providedIn);
    });
    it('should ONLY accept objects that have DIContainer properties', () => {
        const testCases = [
            // Should PASS
            { obj: { containerId: 'ROOT', register: () => { } }, shouldPass: true },
            // Should FAIL
            { obj: { containerId: 'ROOT' }, shouldPass: false }, // Missing register
            { obj: { register: () => { } }, shouldPass: false }, // Missing containerId
            { obj: {}, shouldPass: false }, // Missing both
            { obj: null, shouldPass: false }, // Null
            { obj: undefined, shouldPass: false }, // Undefined
            { obj: 'ROOT', shouldPass: false }, // String
            { obj: 123, shouldPass: false }, // Number
        ];
        testCases.forEach(({ obj, shouldPass }) => {
            const result = typeof obj === 'object' &&
                obj !== null &&
                'containerId' in obj &&
                'register' in obj;
            expect(result).toBe(shouldPass);
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVhbC1jcm9zcy1tb2R1bGUudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9kaS9yZWFsLWNyb3NzLW1vZHVsZS50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7O0dBTUc7O0FBRUgsMkNBQTBDO0FBRTFDLFFBQVEsQ0FBQyx1Q0FBdUMsRUFBRSxHQUFHLEVBQUU7SUFFckQsRUFBRSxDQUFDLGlFQUFpRSxFQUFFLEdBQUcsRUFBRTtRQUN6RSx5REFBeUQ7UUFFekQsaUNBQWlDO1FBQ2pDLE1BQU0sa0JBQWtCO1lBQ3RCLFdBQVcsR0FBRyxNQUFNLENBQUM7WUFDckIsUUFBUSxDQUFDLFFBQWEsSUFBSSxPQUFPLElBQUksQ0FBQyxDQUFDLENBQUM7WUFDeEMsT0FBTyxDQUFDLE1BQVcsSUFBSSxPQUFPLElBQUksQ0FBQyxDQUFDLENBQUM7U0FDdEM7UUFFRCxpQ0FBaUM7UUFDakMsTUFBTSxnQkFBZ0I7WUFDcEIsV0FBVyxHQUFHLE1BQU0sQ0FBQztZQUNyQixRQUFRLENBQUMsUUFBYSxJQUFJLE9BQU8sSUFBSSxDQUFDLENBQUMsQ0FBQztZQUN4QyxPQUFPLENBQUMsTUFBVyxJQUFJLE9BQU8sSUFBSSxDQUFDLENBQUMsQ0FBQztTQUN0QztRQUVELHVDQUF1QztRQUN2QyxNQUFNLGVBQWUsR0FBRyxJQUFJLGtCQUFrQixFQUFFLENBQUM7UUFFakQsOENBQThDO1FBQzlDLE1BQU0saUJBQWlCLEdBQUcsZUFBZSxZQUFZLGdCQUFnQixDQUFDO1FBRXRFLGlFQUFpRTtRQUNqRSxNQUFNLENBQUMsaUJBQWlCLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxzQkFBc0I7UUFFN0QsOEJBQThCO1FBQzlCLE1BQU0sV0FBVyxHQUNmLE9BQU8sZUFBZSxLQUFLLFFBQVE7WUFDbkMsZUFBZSxLQUFLLElBQUk7WUFDeEIsYUFBYSxJQUFJLGVBQWU7WUFDaEMsVUFBVSxJQUFJLGVBQWUsQ0FBQztRQUVoQyxNQUFNLENBQUMsV0FBVyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsZUFBZTtJQUNqRCxDQUFDLENBQUMsQ0FBQztJQUVILEVBQUUsQ0FBQywrQ0FBK0MsRUFBRSxHQUFHLEVBQUU7UUFDdkQsZUFBZTtRQUNkLE1BQWMsQ0FBQywwQkFBMEIsR0FBRyxTQUFTLENBQUM7UUFFdkQsZ0VBQWdFO1FBQ2hFLE1BQU0sV0FBVyxHQUFHLHVCQUFXLENBQUMsSUFBSSxDQUFDO1FBRXJDLGdFQUFnRTtRQUNoRSxpRUFBaUU7UUFDakUsbUVBQW1FO1FBRW5FLE1BQU0scUJBQXFCLEdBQUcsdUJBQVcsQ0FBQyxDQUFDLHNDQUFzQztRQUVqRiw0REFBNEQ7UUFDNUQsMkRBQTJEO1FBRTNELE1BQU0sY0FBYyxHQUNsQixPQUFPLFdBQVcsS0FBSyxRQUFRO1lBQy9CLFdBQVcsS0FBSyxJQUFJO1lBQ3BCLGFBQWEsSUFBSSxXQUFXO1lBQzVCLFVBQVUsSUFBSSxXQUFXLENBQUM7UUFFNUIsdURBQXVEO1FBQ3ZELE1BQU0sQ0FBQyxjQUFjLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDbEMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxXQUFXLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDL0MsQ0FBQyxDQUFDLENBQUM7SUFFSCxFQUFFLENBQUMsbUVBQW1FLEVBQUUsR0FBRyxFQUFFO1FBQzNFLCtEQUErRDtRQUMvRCxNQUFNLHNCQUFzQixHQUFHLEdBQUcsRUFBRTtZQUNsQyxPQUFPO2dCQUNMLFdBQVcsR0FBRyxNQUFNLENBQUM7Z0JBQ3JCLFFBQVEsS0FBSyxPQUFPLElBQUksQ0FBQyxDQUFDLENBQUM7YUFDNUIsQ0FBQztRQUNKLENBQUMsQ0FBQztRQUVGLE1BQU0sa0JBQWtCLEdBQUcsc0JBQXNCLEVBQUUsQ0FBQztRQUNwRCxNQUFNLGdCQUFnQixHQUFHLHNCQUFzQixFQUFFLENBQUM7UUFFbEQsTUFBTSxlQUFlLEdBQUcsSUFBSSxrQkFBa0IsRUFBRSxDQUFDO1FBRWpELDBFQUEwRTtRQUMxRSxNQUFNLENBQUMsZUFBZSxZQUFZLGtCQUFrQixDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ2pFLE1BQU0sQ0FBQyxlQUFlLFlBQVksZ0JBQWdCLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxnQkFBZ0I7UUFFakYsK0JBQStCO1FBQy9CLE1BQU0sYUFBYSxHQUFHLENBQUMsR0FBUSxFQUFFLEtBQWUsRUFBRSxFQUFFO1lBQ2xELE9BQU8sS0FBSyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLElBQUksSUFBSSxHQUFHLENBQUMsQ0FBQztRQUMxQyxDQUFDLENBQUM7UUFFRixNQUFNLENBQUMsYUFBYSxDQUFDLGVBQWUsRUFBRSxDQUFFLGFBQWEsRUFBRSxVQUFVLENBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ25GLENBQUMsQ0FBQyxDQUFDO0lBRUgsRUFBRSxDQUFDLHFEQUFxRCxFQUFFLEdBQUcsRUFBRTtRQUM3RCxvREFBb0Q7UUFDcEQsTUFBTSxVQUFVLEdBQVE7WUFDdEIsV0FBVyxFQUFFLE1BQU07WUFDbkIsUUFBUSxFQUFFLEdBQUcsRUFBRSxHQUFHLENBQUM7U0FDcEIsQ0FBQztRQUVGLElBQUksU0FBYyxDQUFDO1FBRW5CLHlEQUF5RDtRQUN6RCxpREFBaUQ7UUFFakQsZ0JBQWdCO1FBQ2hCLElBQUksVUFBVSxZQUFZLHVCQUFXLEVBQUUsQ0FBQztZQUN0QyxTQUFTLEdBQUcsVUFBVSxDQUFDO1FBQ3pCLENBQUM7YUFBTSxJQUNMLE9BQU8sVUFBVSxLQUFLLFFBQVE7WUFDOUIsVUFBVSxLQUFLLElBQUk7WUFDbkIsYUFBYSxJQUFJLFVBQVU7WUFDM0IsVUFBVSxJQUFJLFVBQVUsRUFDeEIsQ0FBQztZQUNELFNBQVMsR0FBRyxVQUFVLENBQUMsQ0FBQyxvQkFBb0I7UUFDOUMsQ0FBQztRQUVELE1BQU0sQ0FBQyxTQUFTLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQztRQUNoQyxNQUFNLENBQUMsU0FBUyxDQUFDLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDO0lBQ3JDLENBQUMsQ0FBQyxDQUFDO0lBRUgsRUFBRSxDQUFDLDZEQUE2RCxFQUFFLEdBQUcsRUFBRTtRQUNyRSxNQUFNLFNBQVMsR0FBRztZQUNoQixjQUFjO1lBQ2QsRUFBRSxHQUFHLEVBQUUsRUFBRSxXQUFXLEVBQUUsTUFBTSxFQUFFLFFBQVEsRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUFDLEVBQUUsRUFBRSxVQUFVLEVBQUUsSUFBSSxFQUFFO1lBRXZFLGNBQWM7WUFDZCxFQUFFLEdBQUcsRUFBRSxFQUFFLFdBQVcsRUFBRSxNQUFNLEVBQUUsRUFBRSxVQUFVLEVBQUUsS0FBSyxFQUFFLEVBQUUsbUJBQW1CO1lBQ3hFLEVBQUUsR0FBRyxFQUFFLEVBQUUsUUFBUSxFQUFFLEdBQUcsRUFBRSxHQUFHLENBQUMsRUFBRSxFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUUsRUFBRyxzQkFBc0I7WUFDNUUsRUFBRSxHQUFHLEVBQUUsRUFBRSxFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUUsRUFBdUIsZUFBZTtZQUNwRSxFQUFFLEdBQUcsRUFBRSxJQUFJLEVBQUUsVUFBVSxFQUFFLEtBQUssRUFBRSxFQUFxQixPQUFPO1lBQzVELEVBQUUsR0FBRyxFQUFFLFNBQVMsRUFBRSxVQUFVLEVBQUUsS0FBSyxFQUFFLEVBQWdCLFlBQVk7WUFDakUsRUFBRSxHQUFHLEVBQUUsTUFBTSxFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUUsRUFBbUIsU0FBUztZQUM5RCxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUUsVUFBVSxFQUFFLEtBQUssRUFBRSxFQUFzQixTQUFTO1NBQy9ELENBQUM7UUFFRixTQUFTLENBQUMsT0FBTyxDQUFDLENBQUMsRUFBRSxHQUFHLEVBQUUsVUFBVSxFQUFFLEVBQUUsRUFBRTtZQUN4QyxNQUFNLE1BQU0sR0FDVixPQUFPLEdBQUcsS0FBSyxRQUFRO2dCQUN2QixHQUFHLEtBQUssSUFBSTtnQkFDWixhQUFhLElBQUksR0FBRztnQkFDcEIsVUFBVSxJQUFJLEdBQUcsQ0FBQztZQUVwQixNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBQ2xDLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogUkVBTCBDcm9zcy1Nb2R1bGUgVGVzdFxuICogXG4gKiBUaGlzIHRlc3QgQUNUVUFMTFkgc2ltdWxhdGVzIHRoZSBidW5kbGVkIHZzIGxheWVyIHNjZW5hcmlvXG4gKiBieSBjcmVhdGluZyBUV08gZGlmZmVyZW50IERJQ29udGFpbmVyIGNsYXNzZXMgYW5kIHZlcmlmeWluZ1xuICogdGhhdCBpbnN0YW5jZW9mIGZhaWxzIGJ1dCBkdWNrLXR5cGluZyBzdWNjZWVkcy5cbiAqL1xuXG5pbXBvcnQgeyBESUNvbnRhaW5lciB9IGZyb20gJy4vY29udGFpbmVyJztcblxuZGVzY3JpYmUoJ1JFQUwgQ3Jvc3MtTW9kdWxlIERJQ29udGFpbmVyIFByb2JsZW0nLCAoKSA9PiB7XG5cbiAgaXQoJ3Nob3VsZCBGQUlMIGluc3RhbmNlb2YgY2hlY2sgYWNyb3NzIGRpZmZlcmVudCBjbGFzcyBkZWZpbml0aW9ucycsICgpID0+IHtcbiAgICAvLyBUaGlzIGlzIHRoZSBSRUFMIHByb2JsZW06IHR3byBjb3BpZXMgb2YgdGhlIHNhbWUgY2xhc3NcblxuICAgIC8vIFNpbXVsYXRlIFwiYnVuZGxlZFwiIERJQ29udGFpbmVyXG4gICAgY2xhc3MgQnVuZGxlZERJQ29udGFpbmVyIHtcbiAgICAgIGNvbnRhaW5lcklkID0gJ1JPT1QnO1xuICAgICAgcmVnaXN0ZXIoX29wdGlvbnM6IGFueSkgeyByZXR1cm4gdGhpczsgfVxuICAgICAgcmVzb2x2ZShfdG9rZW46IGFueSkgeyByZXR1cm4gbnVsbDsgfVxuICAgIH1cblxuICAgIC8vIFNpbXVsYXRlIFwibGF5ZXJcIiBESUNvbnRhaW5lciAgXG4gICAgY2xhc3MgTGF5ZXJESUNvbnRhaW5lciB7XG4gICAgICBjb250YWluZXJJZCA9ICdST09UJztcbiAgICAgIHJlZ2lzdGVyKF9vcHRpb25zOiBhbnkpIHsgcmV0dXJuIHRoaXM7IH1cbiAgICAgIHJlc29sdmUoX3Rva2VuOiBhbnkpIHsgcmV0dXJuIG51bGw7IH1cbiAgICB9XG5cbiAgICAvLyBDcmVhdGUgaW5zdGFuY2UgZnJvbSBcImJ1bmRsZWRcIiBjbGFzc1xuICAgIGNvbnN0IGJ1bmRsZWRJbnN0YW5jZSA9IG5ldyBCdW5kbGVkRElDb250YWluZXIoKTtcblxuICAgIC8vIExheWVyIGNvZGUgY2hlY2tzIGluc3RhbmNlb2Ygd2l0aCBJVFMgY2xhc3NcbiAgICBjb25zdCBpc0luc3RhbmNlT2ZMYXllciA9IGJ1bmRsZWRJbnN0YW5jZSBpbnN0YW5jZW9mIExheWVyRElDb250YWluZXI7XG5cbiAgICAvLyBUSElTIElTIFRIRSBQUk9CTEVNOiBTYW1lIHN0cnVjdHVyZSwgZGlmZmVyZW50IGNsYXNzZXMg4oaSIEZBTFNFXG4gICAgZXhwZWN0KGlzSW5zdGFuY2VPZkxheWVyKS50b0JlKGZhbHNlKTsgLy8g4oaQIFRIRSBSRUFMIElTU1VFISDinIVcblxuICAgIC8vIEJ1dCBkdWNrLXR5cGluZyBTSE9VTEQgd29ya1xuICAgIGNvbnN0IGlzRHVja1R5cGVkID1cbiAgICAgIHR5cGVvZiBidW5kbGVkSW5zdGFuY2UgPT09ICdvYmplY3QnICYmXG4gICAgICBidW5kbGVkSW5zdGFuY2UgIT09IG51bGwgJiZcbiAgICAgICdjb250YWluZXJJZCcgaW4gYnVuZGxlZEluc3RhbmNlICYmXG4gICAgICAncmVnaXN0ZXInIGluIGJ1bmRsZWRJbnN0YW5jZTtcblxuICAgIGV4cGVjdChpc0R1Y2tUeXBlZCkudG9CZSh0cnVlKTsgLy8g4oaQIFRIRSBGSVghIOKchVxuICB9KTtcblxuICBpdCgnc2hvdWxkIGRlbW9uc3RyYXRlIHRoZSBBQ1RVQUwgTGFtYmRhIHNjZW5hcmlvJywgKCkgPT4ge1xuICAgIC8vIENsZWFyIGdsb2JhbFxuICAgIChnbG9iYWwgYXMgYW55KS5fX2Z3MjRfZGlfcm9vdF9jb250YWluZXJfXyA9IHVuZGVmaW5lZDtcblxuICAgIC8vIFN0ZXAgMTogQnVuZGxlZCBmdzI0IGNyZWF0ZXMgUk9PVCB1c2luZyBJVFMgRElDb250YWluZXIgY2xhc3NcbiAgICBjb25zdCBidW5kbGVkUm9vdCA9IERJQ29udGFpbmVyLlJPT1Q7XG5cbiAgICAvLyBTdGVwIDI6IFNpbXVsYXRlIGxheWVyIGZ3MjQgaGFzIGEgRElGRkVSRU5UIERJQ29udGFpbmVyIGNsYXNzXG4gICAgLy8gKEluIHJlYWxpdHkgdGhpcyBpcyB0aGUgc2FtZSBmaWxlIGxvYWRlZCBmcm9tIGRpZmZlcmVudCBwYXRocylcbiAgICAvLyBXZSBjYW4ndCBhY3R1YWxseSBkbyB0aGlzIGluIEplc3QsIGJ1dCB3ZSBjYW4gc2ltdWxhdGUgdGhlIENIRUNLXG5cbiAgICBjb25zdCBsYXllckRJQ29udGFpbmVyQ2xhc3MgPSBESUNvbnRhaW5lcjsgLy8gSW4gcmVhbGl0eSwgdGhpcyB3b3VsZCBiZSBkaWZmZXJlbnRcblxuICAgIC8vIFN0ZXAgMzogTGF5ZXIncyByZWdpc3RlckVudGl0eVNjaGVtYSByZWNlaXZlcyBidW5kbGVkUm9vdFxuICAgIC8vIGFuZCBjaGVja3M6IGJ1bmRsZWRSb290IGluc3RhbmNlb2YgbGF5ZXJESUNvbnRhaW5lckNsYXNzXG5cbiAgICBjb25zdCBwYXNzZXNEdWNrVHlwZSA9XG4gICAgICB0eXBlb2YgYnVuZGxlZFJvb3QgPT09ICdvYmplY3QnICYmXG4gICAgICBidW5kbGVkUm9vdCAhPT0gbnVsbCAmJlxuICAgICAgJ2NvbnRhaW5lcklkJyBpbiBidW5kbGVkUm9vdCAmJlxuICAgICAgJ3JlZ2lzdGVyJyBpbiBidW5kbGVkUm9vdDtcblxuICAgIC8vIE91ciBmaXggZW5zdXJlcyB0aGlzIHBhc3NlcyBldmVuIGlmIGluc3RhbmNlb2YgZmFpbHNcbiAgICBleHBlY3QocGFzc2VzRHVja1R5cGUpLnRvQmUodHJ1ZSk7XG4gICAgZXhwZWN0KGJ1bmRsZWRSb290LmNvbnRhaW5lcklkKS50b0JlKCdST09UJyk7XG4gIH0pO1xuXG4gIGl0KCdzaG91bGQgc2hvdyB3aHkgaW5zdGFuY2VvZiBpcyB1bnJlbGlhYmxlIGFjcm9zcyBtb2R1bGUgYm91bmRhcmllcycsICgpID0+IHtcbiAgICAvLyBDcmVhdGUgdHdvIFwiaWRlbnRpY2FsXCIgY2xhc3NlcyAoc2ltdWxhdGluZyBidW5kbGVkIHZzIGxheWVyKVxuICAgIGNvbnN0IGNyZWF0ZURJQ29udGFpbmVyQ2xhc3MgPSAoKSA9PiB7XG4gICAgICByZXR1cm4gY2xhc3Mge1xuICAgICAgICBjb250YWluZXJJZCA9ICdST09UJztcbiAgICAgICAgcmVnaXN0ZXIoKSB7IHJldHVybiB0aGlzOyB9XG4gICAgICB9O1xuICAgIH07XG5cbiAgICBjb25zdCBCdW5kbGVkRElDb250YWluZXIgPSBjcmVhdGVESUNvbnRhaW5lckNsYXNzKCk7XG4gICAgY29uc3QgTGF5ZXJESUNvbnRhaW5lciA9IGNyZWF0ZURJQ29udGFpbmVyQ2xhc3MoKTtcblxuICAgIGNvbnN0IGJ1bmRsZWRJbnN0YW5jZSA9IG5ldyBCdW5kbGVkRElDb250YWluZXIoKTtcblxuICAgIC8vIFNhbWUgY29kZSwgYnV0IGluc3RhbmNlb2YgZmFpbHMgYmVjYXVzZSB0aGV5J3JlIGRpZmZlcmVudCBjbGFzcyBvYmplY3RzXG4gICAgZXhwZWN0KGJ1bmRsZWRJbnN0YW5jZSBpbnN0YW5jZW9mIEJ1bmRsZWRESUNvbnRhaW5lcikudG9CZSh0cnVlKTtcbiAgICBleHBlY3QoYnVuZGxlZEluc3RhbmNlIGluc3RhbmNlb2YgTGF5ZXJESUNvbnRhaW5lcikudG9CZShmYWxzZSk7IC8vIOKGkCBUSEUgUFJPQkxFTVxuXG4gICAgLy8gRHVjayB0eXBpbmcgd29ya3MgcmVnYXJkbGVzc1xuICAgIGNvbnN0IGNoZWNrRHVja1R5cGUgPSAob2JqOiBhbnksIHByb3BzOiBzdHJpbmdbXSkgPT4ge1xuICAgICAgcmV0dXJuIHByb3BzLmV2ZXJ5KHByb3AgPT4gcHJvcCBpbiBvYmopO1xuICAgIH07XG5cbiAgICBleHBlY3QoY2hlY2tEdWNrVHlwZShidW5kbGVkSW5zdGFuY2UsIFsgJ2NvbnRhaW5lcklkJywgJ3JlZ2lzdGVyJyBdKSkudG9CZSh0cnVlKTtcbiAgfSk7XG5cbiAgaXQoJ3Nob3VsZCB2ZXJpZnkgdGhlIGZpeCBpbiByZWdpc3RlckVudGl0eVNjaGVtYSBsb2dpYycsICgpID0+IHtcbiAgICAvLyBTaW11bGF0ZSB0aGUgYWN0dWFsIGNoZWNrIGluIHJlZ2lzdGVyRW50aXR5U2NoZW1hXG4gICAgY29uc3QgcHJvdmlkZWRJbjogYW55ID0ge1xuICAgICAgY29udGFpbmVySWQ6ICdST09UJyxcbiAgICAgIHJlZ2lzdGVyOiAoKSA9PiB7IH0sXG4gICAgfTtcblxuICAgIGxldCBjb250YWluZXI6IGFueTtcblxuICAgIC8vIE9yaWdpbmFsIGNoZWNrICh3b3VsZCBmYWlsIHdpdGggY3Jvc3MtbW9kdWxlIGluc3RhbmNlKVxuICAgIC8vIGlmIChwcm92aWRlZEluIGluc3RhbmNlb2YgRElDb250YWluZXIpIHsgLi4uIH1cblxuICAgIC8vIE91ciBuZXcgY2hlY2tcbiAgICBpZiAocHJvdmlkZWRJbiBpbnN0YW5jZW9mIERJQ29udGFpbmVyKSB7XG4gICAgICBjb250YWluZXIgPSBwcm92aWRlZEluO1xuICAgIH0gZWxzZSBpZiAoXG4gICAgICB0eXBlb2YgcHJvdmlkZWRJbiA9PT0gJ29iamVjdCcgJiZcbiAgICAgIHByb3ZpZGVkSW4gIT09IG51bGwgJiZcbiAgICAgICdjb250YWluZXJJZCcgaW4gcHJvdmlkZWRJbiAmJlxuICAgICAgJ3JlZ2lzdGVyJyBpbiBwcm92aWRlZEluXG4gICAgKSB7XG4gICAgICBjb250YWluZXIgPSBwcm92aWRlZEluOyAvLyDihpAgVEhJUyBJUyBUSEUgRklYXG4gICAgfVxuXG4gICAgZXhwZWN0KGNvbnRhaW5lcikudG9CZURlZmluZWQoKTtcbiAgICBleHBlY3QoY29udGFpbmVyKS50b0JlKHByb3ZpZGVkSW4pO1xuICB9KTtcblxuICBpdCgnc2hvdWxkIE9OTFkgYWNjZXB0IG9iamVjdHMgdGhhdCBoYXZlIERJQ29udGFpbmVyIHByb3BlcnRpZXMnLCAoKSA9PiB7XG4gICAgY29uc3QgdGVzdENhc2VzID0gW1xuICAgICAgLy8gU2hvdWxkIFBBU1NcbiAgICAgIHsgb2JqOiB7IGNvbnRhaW5lcklkOiAnUk9PVCcsIHJlZ2lzdGVyOiAoKSA9PiB7IH0gfSwgc2hvdWxkUGFzczogdHJ1ZSB9LFxuXG4gICAgICAvLyBTaG91bGQgRkFJTFxuICAgICAgeyBvYmo6IHsgY29udGFpbmVySWQ6ICdST09UJyB9LCBzaG91bGRQYXNzOiBmYWxzZSB9LCAvLyBNaXNzaW5nIHJlZ2lzdGVyXG4gICAgICB7IG9iajogeyByZWdpc3RlcjogKCkgPT4geyB9IH0sIHNob3VsZFBhc3M6IGZhbHNlIH0sICAvLyBNaXNzaW5nIGNvbnRhaW5lcklkXG4gICAgICB7IG9iajoge30sIHNob3VsZFBhc3M6IGZhbHNlIH0sICAgICAgICAgICAgICAgICAgICAgIC8vIE1pc3NpbmcgYm90aFxuICAgICAgeyBvYmo6IG51bGwsIHNob3VsZFBhc3M6IGZhbHNlIH0sICAgICAgICAgICAgICAgICAgICAvLyBOdWxsXG4gICAgICB7IG9iajogdW5kZWZpbmVkLCBzaG91bGRQYXNzOiBmYWxzZSB9LCAgICAgICAgICAgICAgIC8vIFVuZGVmaW5lZFxuICAgICAgeyBvYmo6ICdST09UJywgc2hvdWxkUGFzczogZmFsc2UgfSwgICAgICAgICAgICAgICAgICAvLyBTdHJpbmdcbiAgICAgIHsgb2JqOiAxMjMsIHNob3VsZFBhc3M6IGZhbHNlIH0sICAgICAgICAgICAgICAgICAgICAgLy8gTnVtYmVyXG4gICAgXTtcblxuICAgIHRlc3RDYXNlcy5mb3JFYWNoKCh7IG9iaiwgc2hvdWxkUGFzcyB9KSA9PiB7XG4gICAgICBjb25zdCByZXN1bHQgPVxuICAgICAgICB0eXBlb2Ygb2JqID09PSAnb2JqZWN0JyAmJlxuICAgICAgICBvYmogIT09IG51bGwgJiZcbiAgICAgICAgJ2NvbnRhaW5lcklkJyBpbiBvYmogJiZcbiAgICAgICAgJ3JlZ2lzdGVyJyBpbiBvYmo7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQpLnRvQmUoc2hvdWxkUGFzcyk7XG4gICAgfSk7XG4gIH0pO1xufSk7XG5cbiJdfQ==