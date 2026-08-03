/**
 * DIMetadataStore must be shared across fw24 copies in one process.
 *
 * A Lambda holds more than one copy of the fw24 core (one bundled into the handler, one in the
 * fw24 layer). ROOT is already a global singleton, so a `ROOT.module(X)` call can execute in a
 * different copy than the one whose `@DIModule()` decorator wrote X's metadata. With a per-copy
 * static store that read misses and the entry-package load dies with
 * "Module X does not have any metadata" (observed in prod: AuthModule / TrialsModule).
 *
 * `jest.isolateModules` evaluates a second, independent instance of the module graph — exactly
 * what a duplicated bundle is at runtime.
 */

function loadFreshCopy<T>(load: () => T): T {
    let copy!: T;
    jest.isolateModules(() => { copy = load(); });
    return copy;
}

describe('DIMetadataStore is shared across fw24 core copies', () => {
    it('module metadata written via one copy is readable via another', () => {
        const metaA = require('./metadata');
        const metaB = loadFreshCopy(() => require('./metadata'));
        expect(metaB).not.toBe(metaA); // genuinely two module-graph copies

        class CrossCopyProbeModule { }
        metaA.registerModuleMetadata(CrossCopyProbeModule, {});

        // Before the fix each copy had its own static store and this returned undefined.
        expect(metaB.getModuleMetadata(CrossCopyProbeModule)).toBeDefined();
    });

    it('both copies expose the SAME store object', () => {
        const copyA = require('./container').DIContainer;
        const copyB = loadFreshCopy(() => require('./container').DIContainer);
        expect(copyB).not.toBe(copyA); // two distinct class objects

        expect(copyA.DIMetadataStore).toBe(copyB.DIMetadataStore);
    });
});
