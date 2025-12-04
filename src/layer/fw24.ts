/**
 * FW24 Lambda Layer Entry Point
 * 
 * This file is the entry point for the fw24 Lambda layer.
 * When imported, it automatically loads entry packages (DI layers).
 * This ensures ALL Lambdas have DI initialized, not just those with decorators.
 */

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS - All fw24 runtime modules
// ═══════════════════════════════════════════════════════════════════════════

export * from "./../interfaces";
export * from "./../decorators";
// It is important to make sure that we only include the things needed by the fw24-runtime
export * from "./../core/runtime";
export * from './../entity';
export * from './../logging';
export * from './../client';
export * from './../validation';
export * from './../utils';
export * from './../di';
export * from '../const/';
export * from '../errors';
export * from '../search';
export * from '../audit';
export * from '../observability';

// ═══════════════════════════════════════════════════════════════════════════
// AUTO-INITIALIZATION
// 
// Automatically load entry packages when fw24 layer is imported.
// This ensures custom Lambdas (not using decorators) also have DI initialized.
// ═══════════════════════════════════════════════════════════════════════════

import { tryImportingEntryPackagesFor } from '../decorators/decorator-utils';

// Load entry packages on import
tryImportingEntryPackagesFor('fw24-layer');
