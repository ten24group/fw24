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
declare function loadFreshCopy<T>(load: () => T): T;
