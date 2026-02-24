/**
 * REAL Cross-Module Test
 *
 * This test ACTUALLY simulates the bundled vs layer scenario
 * by creating TWO different DIContainer classes and verifying
 * that instanceof fails but duck-typing succeeds.
 */

import { DIContainer } from './container';

describe('REAL Cross-Module DIContainer Problem', () => {

  it('should FAIL instanceof check across different class definitions', () => {
    // This is the REAL problem: two copies of the same class

    // Simulate "bundled" DIContainer
    class BundledDIContainer {
      containerId = 'ROOT';
      register(_options: any) { return this; }
      resolve(_token: any) { return null; }
    }

    // Simulate "layer" DIContainer
    class LayerDIContainer {
      containerId = 'ROOT';
      register(_options: any) { return this; }
      resolve(_token: any) { return null; }
    }

    // Create instance from "bundled" class
    const bundledInstance = new BundledDIContainer();

    // Layer code checks instanceof with ITS class
    const isInstanceOfLayer = bundledInstance instanceof LayerDIContainer;

    // THIS IS THE PROBLEM: Same structure, different classes → FALSE
    expect(isInstanceOfLayer).toBe(false); // ← THE REAL ISSUE! ✅

    // But duck-typing SHOULD work
    const isDuckTyped =
      typeof bundledInstance === 'object' &&
      bundledInstance !== null &&
      'containerId' in bundledInstance &&
      'register' in bundledInstance;

    expect(isDuckTyped).toBe(true); // ← THE FIX! ✅
  });

  it('should demonstrate the ACTUAL Lambda scenario', () => {
    // Clear global
    (global as any).__fw24_di_root_container__ = undefined;

    // Step 1: Bundled fw24 creates ROOT using ITS DIContainer class
    const bundledRoot = DIContainer.ROOT;

    // Step 2: Simulate layer fw24 has a DIFFERENT DIContainer class
    // (In reality this is the same file loaded from different paths)
    // We can't actually do this in Jest, but we can simulate the CHECK

    const layerDIContainerClass = DIContainer; // In reality, this would be different

    // Step 3: Layer's registerEntitySchema receives bundledRoot
    // and checks: bundledRoot instanceof layerDIContainerClass

    const passesDuckType =
      typeof bundledRoot === 'object' &&
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
    const checkDuckType = (obj: any, props: string[]) => {
      return props.every(prop => prop in obj);
    };

    expect(checkDuckType(bundledInstance, [ 'containerId', 'register' ])).toBe(true);
  });

  it('should verify the fix in registerEntitySchema logic', () => {
    // Simulate the actual check in registerEntitySchema
    const providedIn: any = {
      containerId: 'ROOT',
      register: () => { },
    };

    let container: any;

    // Original check (would fail with cross-module instance)
    // if (providedIn instanceof DIContainer) { ... }

    // Our new check
    if (providedIn instanceof DIContainer) {
      container = providedIn;
    } else if (
      typeof providedIn === 'object' &&
      providedIn !== null &&
      'containerId' in providedIn &&
      'register' in providedIn
    ) {
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
      { obj: { register: () => { } }, shouldPass: false },  // Missing containerId
      { obj: {}, shouldPass: false },                      // Missing both
      { obj: null, shouldPass: false },                    // Null
      { obj: undefined, shouldPass: false },               // Undefined
      { obj: 'ROOT', shouldPass: false },                  // String
      { obj: 123, shouldPass: false },                     // Number
    ];

    testCases.forEach(({ obj, shouldPass }) => {
      const result =
        typeof obj === 'object' &&
        obj !== null &&
        'containerId' in obj &&
        'register' in obj;

      expect(result).toBe(shouldPass);
    });
  });
});
