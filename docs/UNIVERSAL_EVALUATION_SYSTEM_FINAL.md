# Universal Evaluation System - Final Implementation Plan

> **⚠️ CRITICAL REVIEW REQUIRED**
> 
> This plan has been thoroughly analyzed and **15 implementation issues** have been identified.
> **See `CRITICAL_ANALYSIS_AND_FIXES.md` for all issues and fixes.**
> 
> **Before implementation:**
> - Review all 5 🔴 CRITICAL issues
> - Apply fixes from analysis document
> - 4 🟡 HIGH issues to fix during implementation
> - 6 🟢 MEDIUM issues can wait until v1.1

---

## Executive Summary

A **comprehensive, serializable evaluation system** for controlling visibility, enablement, and behavior across the entire fw24/ui24 framework.

### Core Innovation
**Define once in backend (serializable), evaluate in frontend (unified registry), leverage existing validation patterns.**

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Existing Codebase Analysis](#existing-codebase-analysis)
3. [Type System & Interfaces](#type-system--interfaces)
4. [Backend Implementation](#backend-implementation)
5. [Frontend Implementation](#frontend-implementation)
6. [Config Generation](#config-generation)
7. [Deprecation Strategy](#deprecation-strategy)
8. [Migration Path](#migration-path)
9. [Implementation Checklist](#implementation-checklist)
10. [Testing & Verification](#testing--verification)
11. [Use Cases & Examples](#use-cases--examples)

---

## System Architecture

### High-Level Flow

```
┌────────────────────────────────────────────────────────────────────┐
│                          BACKEND (fw24)                             │
├────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Entity Schema Definition                                           │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ export const createGameSchema = () => ({                    │   │
│  │   model: {                                                  │   │
│  │     entity: 'game',                                        │   │
│  │     listPageConfig: {                                      │   │
│  │       actions: [{                                          │   │
│  │         label: 'Approve',                                  │   │
│  │         url: '/game/:id/approve',                          │   │
│  │         visibility: {                    // SERIALIZABLE   │   │
│  │           actor: {                                         │   │
│  │             'cognito.groups': { inList: ['admin'] }        │   │
│  │           },                                               │   │
│  │           record: { status: { eq: 'pending' } }            │   │
│  │         }                                                   │   │
│  │       }, {                                                  │   │
│  │         label: 'Complex Logic',                            │   │
│  │         url: '/game/:id/complex',                          │   │
│  │         visibility: { custom: 'canDoComplexThing' } // REF │   │
│  │       }]                                                    │   │
│  │     }                                                       │   │
│  │   }                                                         │   │
│  │ })                                                          │   │
│  └────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
└────────────────────────────────────────────────────────────────────┘
                               │
                               │ Config Generation
                               │ (EntityUIConfigGen.process())
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│                      CONFIG FILES (JSON)                            │
├────────────────────────────────────────────────────────────────────┤
│  {                                                                  │
│    "pages": {                                                       │
│      "list-game": {                                                │
│        "pageHeaderActions": [{                                     │
│          "label": "Approve",                                       │
│          "url": "/game/:id/approve",                               │
│          "visibility": {                   // SERIALIZED AS JSON   │
│            "actor": {                                              │
│              "cognito.groups": { "inList": ["admin"] }             │
│            },                                                       │
│            "record": { "status": { "eq": "pending" } }             │
│          }                                                          │
│        }, {                                                         │
│          "label": "Complex Logic",                                 │
│          "url": "/game/:id/complex",                               │
│          "visibility": { "custom": "canDoComplexThing" } // STRING │
│        }]                                                           │
│      }                                                              │
│    }                                                                │
│  }                                                                  │
└────────────────────────────────────────────────────────────────────┘
                               │
                               │ HTTP/Config Loading
                               │ (useUi24Config)
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│                       FRONTEND (ui24)                               │
├────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  App Bootstrap (App.tsx)                                            │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ // Register custom evaluators ONCE                          │   │
│  │ ConditionEvaluatorRegistry.register(                        │   │
│  │   'canDoComplexThing',                                      │   │
│  │   async (ctx) => {                                          │   │
│  │     // Complex business logic here                          │   │
│  │     return { visible: true, enabled: true };                │   │
│  │   }                                                          │   │
│  │ );                                                           │   │
│  └────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  Component Usage (PageHeader.tsx)                                  │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ const PageHeader = ({ pageHeaderActions }) => {             │   │
│  │   // Batch evaluate all actions                             │   │
│  │   const evaluations = useEvaluationBatch(                   │   │
│  │     pageHeaderActions.map(a => a.visibility)                │   │
│  │   );                                                         │   │
│  │                                                              │   │
│  │   // Filter visible actions                                 │   │
│  │   const visibleActions = pageHeaderActions.filter(          │   │
│  │     (_, i) => evaluations[i]?.visible                       │   │
│  │   );                                                         │   │
│  │                                                              │   │
│  │   return <>{visibleActions.map(...)}</>                     │   │
│  │ }                                                            │   │
│  └────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  Universal Evaluator (UniversalEvaluator.ts)                       │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ class UniversalEvaluator {                                  │   │
│  │   async evaluate(config, context) {                         │   │
│  │     if (config.custom) {                                    │   │
│  │       // Look up in registry                                │   │
│  │       const fn = registry.get(config.custom);               │   │
│  │       return await fn(context);                             │   │
│  │     }                                                        │   │
│  │     // Or evaluate serializable conditions                  │   │
│  │     return this.evaluateCondition(config, context);         │   │
│  │   }                                                          │   │
│  │ }                                                            │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                      │
└────────────────────────────────────────────────────────────────────┘
```

### Key Principles

1. ✅ **Single Source of Truth** - Backend defines, frontend evaluates
2. ✅ **Serializable** - 90% of logic as JSON, 10% as registered functions
3. ✅ **Universal** - Same system for actions, forms, widgets, features, table config
4. ✅ **Context-Rich** - Full access to actor, record, selectedRecords, queryParams, pageType, modalDepth
5. ✅ **Pattern Reuse** - Mirrors existing validation framework (conditions, rules, scope)
6. ✅ **Non-Breaking** - Gradual migration, both old and new work

---

## Existing Codebase Analysis

### Backend (fw24)

#### 1. Entity Schema (`fw24/src/entity/base-entity.ts`)

**Current Structure:**
```typescript
export interface EntitySchema {
  model: {
    // CURRENT (Flat structure)
    listPageActions?: IEntityPageAction[];
    listPageBreadcrumbs?: Array<{ label: string; url?: string }>;
    listPageDefaultSort?: { field: string; order: 'asc' | 'desc' };
    
    viewPageActions?: IEntityPageAction[];
    viewPageBreadcrumbs?: Array<{ label: string; url?: string }>;
    viewPageColumnsConfig?: IEntityPageColumnConfig;
    
    editPageActions?: IEntityPageAction[];
    editPageBreadcrumbs?: Array<{ label: string; url?: string }>;
    editPageColumnsConfig?: IEntityPageColumnConfig;
  }
}

export interface IEntityPageAction {
  label: string;
  url?: string;
  icon?: string;
  type?: 'button' | 'dropdown';
  items?: Array<Omit<IEntityPageAction, 'items'>>;
  openInModal?: boolean;
  modalConfig?: IEntityPageActionModalConfig;
  // ... more properties
}
```

**Issues:**
- Flat structure mixes concerns
- No visibility/evaluation support
- No table-level action config (row actions, bulk actions)
- No form button config
- No nested organization

#### 2. Config Generation (`fw24/src/ui-config-gen/entity-ui-config.gen.ts`)

**Current Flow:**
```typescript
// EntityUIConfigGen.process()
// 1. Scans services (entity schemas)
// 2. Generates configs using templates
// 3. Writes JSON files

// Templates:
// - templates/list-entity.ts   → list page config
// - templates/view-entity.ts   → view page config
// - templates/update-entity.ts → edit page config
// - templates/create-entity.ts → create page config
// - templates/custom-page.ts   → custom pages
```

**Key Functions:**
- `MakeListEntityConfig(options)` - Creates list page config
- `MakeViewEntityConfig(options)` - Creates view page config
- Combines default actions with custom actions
- Maps `listPageActions` → `pageHeaderActions`

**Issues:**
- No visibility config serialization
- No nested structure support
- No table config generation

#### 3. Validation Framework (`fw24/src/validation/`)

**Existing Patterns We Can Reuse:**

```typescript
// types.ts
export type EntityValidationCondition<I, R> = {
  actor?: InputValidationRule<Actor>;
  input?: InputValidationRule<I>;
  record?: InputValidationRule<R>;
};

export type MapOfValidationCondition<I, R> = Record<
  string,
  EntityValidationCondition<I, R>
>;

export type Validations<T> = {
  eq?: T;
  neq?: T;
  gt?: T;
  gte?: T;
  lt?: T;
  lte?: T;
  inList?: Array<T>;
  notInList?: Array<T>;
  custom?: (inputValue: T, ctx?: any) => boolean | Promise<boolean>;
  // ... more
};

// validator.ts
async testConditions(options: {
  conditions: Array<string> | [Array<string>, 'all' | 'any' | 'none'];
  allConditions: MapOfValidationCondition;
  input?: I;
  record?: R;
  actor?: Actor;
}): Promise<boolean>
```

**Perfect Alignment:**
- Same condition structure (actor/input/record)
- Same rule operators (eq, neq, inList, custom, etc.)
- Same scope logic (all/any/none)
- Already tested and proven

### Frontend (ui24)

#### 1. Config Loading (`ui24/src/core/context/UI24Context.tsx`)

**Current System:**
```typescript
export type IUi24Config = {
  baseURL: string;
  uiConfig: {
    auth: IConfigResolver<any>;
    menu: IConfigResolver<any>;
    pages: IConfigResolver<any>;  // ← Entity page configs loaded here
    dashboard: IConfigResolver<any>;
  };
  // ...
};

// Config Resolution
type IConfigResolver<T> = 
  | T                      // Direct object
  | string                 // URL to fetch
  | (() => Promise<T>);    // Async function
```

**Flow:**
1. App loads with `ui24config`
2. Configs resolved (HTTP or direct)
3. Stored in `Ui24Context`
4. Accessed via `useUi24Config().getPageConfig(pageName)`

**Issues:**
- No evaluation context provider
- No registry for custom evaluators

#### 2. Component Consumption

**Page Header** (`ui24/src/pages/PostAuth/PageHeader/PageHeader.tsx`):
```typescript
export interface IPageHeader {
  breadcrumbs?: Array<IBreadcrumbs>;
  pageTitle?: string;
  pageHeaderActions?: IPageActions;  // ← Uses this
  routeParams?: Record<string, string>;
}
```

**Post Auth Page** (`ui24/src/pages/PostAuth/PostAuthPage.tsx`):
```typescript
export interface IRenderFromPageType {
  pageType?: "list" | "form" | "accordion" | "details" | "dashboard";
  listPageConfig?: ITableConfig;
  formPageConfig?: IForm;
  detailsPageConfig?: IDetailsConfig;
  // ...
}
```

**Table** (`ui24/src/table/Table.tsx`):
```typescript
export interface ITableConfig {
  propertiesConfig: Array<ITablePropertiesConfig>;
  apiConfig?: IApiConfig;
  // ...
}
```

**Form** (`ui24/src/forms/Form.tsx`):
```typescript
export interface IForm {
  formConfig?: { name: string };
  propertiesConfig: Array<IFormField>;
  formButtons?: Array<string | IFormButton>;  // ← Buttons here
  apiConfig?: IApiConfig;
  // ...
}
```

**Action Renderer** (`ui24/src/core/utils/actionRenderer.tsx`):
```typescript
export const renderSingleAction = ({
  action,
  isTableRowAction,
  isInModal,
  routeParams,
  record,
  // ...
}): React.ReactNode | MenuItem | null => {
  // Handles: modals, navigation, dropdowns
  // No visibility evaluation
};
```

**Issues:**
- No visibility evaluation in components
- No context provider for evaluation
- No registry for custom functions
- Actions rendered unconditionally

#### 3. Auth Context (`ui24/src/core/context/AuthContext.tsx`)

**Current System:**
```typescript
const AuthContext = createContext<IAuthContext>();

export const useAuth = () => {
  const context = useContext(AuthContext);
  // Provides: user, isLoggedIn, getToken, etc.
};
```

**Important:** No direct `user` object with roles! Need to check AWS Cognito provider for user structure.

---

## Type System & Interfaces

### Backend Types (fw24/src/entity/base-entity.ts)

```typescript
/**
 * NEW: Visibility configuration (SERIALIZABLE)
 * Can be used for actions, form fields, widgets, features
 */
export type VisibilityConfig =
  // OPTION 1: Inline serializable condition
  | {
      actor?: {
        [path: string]: EvaluationRule;
      };
      record?: {
        [path: string]: EvaluationRule;
      };
      selectedRecords?: {
        length?: EvaluationRule<number>;
        all?: { [path: string]: EvaluationRule };
        some?: { [path: string]: EvaluationRule };
        none?: { [path: string]: EvaluationRule };
      };
      queryParams?: {
        [key: string]: EvaluationRule;
      };
      context?: {
        pageType?: EvaluationRule<'list' | 'view' | 'edit' | 'create'>;
        modalDepth?: EvaluationRule<number>;
        entityName?: EvaluationRule<string>;
        [key: string]: EvaluationRule | undefined;
      };
    }
  // OPTION 2: Custom evaluator reference (string)
  | { custom: string }
  // OPTION 3: Named conditions with scope
  | {
      conditions: string[];
      scope?: 'all' | 'any' | 'none';
    }
  // OPTION 4: Shortcuts (most common cases)
  | {
      requiredRoles?: string[];
      excludedRoles?: string[];
      showWhen?: Record<string, any>;
      hideWhen?: Record<string, any>;
    };

/**
 * Evaluation rule (mirrors Validations<T> from validation framework)
 */
export type EvaluationRule<T = any> = {
  eq?: T | string;  // Support template: '{actor.actorId}'
  neq?: T | string;
  gt?: T | string;
  gte?: T | string;
  lt?: T | string;
  lte?: T | string;
  inList?: Array<T>;
  notInList?: Array<T>;
  custom?: string;  // String reference to registered function
  pattern?: string; // Regex pattern as string
  exists?: boolean;
  empty?: boolean;
};

/**
 * ENHANCED: IEntityPageAction with visibility
 */
export interface IEntityPageAction {
  label: string;
  url?: string;
  icon?: string;
  type?: 'button' | 'dropdown';
  items?: Array<Omit<IEntityPageAction, 'items'>>;
  
  openInModal?: boolean;
  modalConfig?: IEntityPageActionModalConfig;
  modalWidth?: number | string;
  modalTitle?: string;
  hideInModal?: boolean;
  openInModalCondition?: 'sm' | 'md' | 'lg' | 'xl';
  
  /**
   * NEW: Visibility configuration
   * Controls when this action is visible/enabled
   * Serialized as JSON and evaluated in frontend
   */
  visibility?: VisibilityConfig;
}

/**
 * NEW: Nested config structure (RECOMMENDED)
 */
export interface EntitySchema {
  model: {
    // ... existing properties
    
    /**
     * List page configuration (RECOMMENDED)
     * Replaces: listPageActions, listPageBreadcrumbs, listPageDefaultSort
     */
    listPageConfig?: {
      /** Page header actions */
      actions?: IEntityPageAction[];
      breadcrumbs?: Array<{ label: string; url?: string }>;
      defaultSort?: { field: string; order: 'asc' | 'desc' };
      
      /** Table configuration */
      tableConfig?: {
        /** Row actions (per-row: view, edit, delete) */
        rowActions?: IEntityPageAction[];
        
        /** Bulk actions (multi-select: delete selected, export selected) */
        bulkActions?: IEntityPageAction[];
        
        /** Row selection config */
        rowSelection?: {
          enabled: boolean;
          visibility?: VisibilityConfig;  // Control who can select
        };
        
        /** Column visibility */
        columns?: Array<{
          field: string;
          visibility?: VisibilityConfig;
        }>;
      };
    };
    
    /**
     * View page configuration (RECOMMENDED)
     */
    viewPageConfig?: {
      actions?: IEntityPageAction[];
      breadcrumbs?: Array<{ label: string; url?: string }>;
      columnsConfig?: IEntityPageColumnConfig;
      
      /** Field visibility */
      fields?: Array<{
        name: string;
        visibility?: VisibilityConfig;
      }>;
    };
    
    /**
     * Edit page configuration (RECOMMENDED)
     */
    editPageConfig?: {
      actions?: IEntityPageAction[];
      breadcrumbs?: Array<{ label: string; url?: string }>;
      columnsConfig?: IEntityPageColumnConfig;
      
      /** Form configuration */
      formConfig?: {
        /** Form buttons with visibility */
        buttons?: Array<{
          text: string;
          action: 'submit' | 'reset' | 'cancel';
          url?: string;
          visibility?: VisibilityConfig;
        }>;
        
        /** Field visibility and enablement */
        fields?: Array<{
          name: string;
          visibility?: VisibilityConfig;
          enablement?: VisibilityConfig;  // Editable vs read-only
        }>;
      };
    };
    
    /**
     * Create page configuration (RECOMMENDED)
     */
    createPageConfig?: {
      breadcrumbs?: Array<{ label: string; url?: string }>;
      columnsConfig?: IEntityPageColumnConfig;
      
      formConfig?: {
        buttons?: Array<{
          text: string;
          action: 'submit' | 'reset' | 'cancel';
          url?: string;
          visibility?: VisibilityConfig;
        }>;
        fields?: Array<{
          name: string;
          visibility?: VisibilityConfig;
        }>;
      };
    };
    
    // OLD STRUCTURE (Deprecated but supported)
    /** @deprecated Use listPageConfig.actions instead */
    listPageActions?: IEntityPageAction[];
    /** @deprecated Use listPageConfig.breadcrumbs instead */
    listPageBreadcrumbs?: Array<{ label: string; url?: string }>;
    /** @deprecated Use listPageConfig.defaultSort instead */
    listPageDefaultSort?: { field: string; order: 'asc' | 'desc' };
    
    /** @deprecated Use viewPageConfig.actions instead */
    viewPageActions?: IEntityPageAction[];
    /** @deprecated Use viewPageConfig.breadcrumbs instead */
    viewPageBreadcrumbs?: Array<{ label: string; url?: string }>;
    /** @deprecated Use viewPageConfig.columnsConfig instead */
    viewPageColumnsConfig?: IEntityPageColumnConfig;
    
    /** @deprecated Use editPageConfig.actions instead */
    editPageActions?: IEntityPageAction[];
    /** @deprecated Use editPageConfig.breadcrumbs instead */
    editPageBreadcrumbs?: Array<{ label: string; url?: string }>;
    /** @deprecated Use editPageConfig.columnsConfig instead */
    editPageColumnsConfig?: IEntityPageColumnConfig;
  };
}
```

### Frontend Types (ui24/src/core/types/evaluation.ts)

```typescript
/**
 * Evaluation context (passed to all evaluations)
 * Provided by EvaluationContextProvider
 */
export interface EvaluationContext {
  /** Current user/actor */
  actor: {
    actorId?: string;
    cognito?: {
      groups?: string[];
      username?: string;
      [key: string]: any;
    };
    [key: string]: any;
  };
  
  /** Current record (view/edit pages, table rows) */
  record?: Record<string, any>;
  
  /** Selected records (bulk actions) */
  selectedRecords?: Array<Record<string, any>>;
  
  /** URL query parameters */
  queryParams?: Record<string, any>;
  
  /** Page type */
  pageType?: 'list' | 'view' | 'edit' | 'create';
  
  /** Entity name */
  entityName?: string;
  
  /** Modal nesting depth (0 = not in modal) */
  modalDepth?: number;
  
  /** Form values (if evaluating within a form) */
  formValues?: Record<string, any>;
  
  /** Additional context from parent */
  [key: string]: any;
}

/**
 * Evaluation result
 */
export interface EvaluationResult {
  /** Is the item visible? */
  visible: boolean;
  
  /** Is the item enabled? (only matters if visible) */
  enabled: boolean;
  
  /** Message to show when disabled */
  disabledMessage?: string;
  
  /** Additional metadata */
  [key: string]: any;
}

/**
 * Custom evaluator function signature
 */
export type CustomEvaluatorFunction = (
  context: EvaluationContext
) => Promise<EvaluationResult> | EvaluationResult;

/**
 * Re-export backend type (for type consistency)
 */
export type { VisibilityConfig } from '@ten24group/fw24';
```

---

## Backend Implementation

### Step 1: Update Entity Schema Types

**File:** `fw24/src/entity/base-entity.ts`

**Changes:**

1. Add `VisibilityConfig` type
2. Add `EvaluationRule` type
3. Add `visibility` property to `IEntityPageAction`
4. Add nested config structures
5. Deprecate old flat properties

**Implementation:**

```typescript
// NEW: Add near top of file
export type EvaluationRule<T = any> = {
  readonly eq?: T | string;
  readonly neq?: T | string;
  readonly gt?: T | string;
  readonly gte?: T | string;
  readonly lt?: T | string;
  readonly lte?: T | string;
  readonly inList?: Array<T>;
  readonly notInList?: Array<T>;
  readonly custom?: string;
  readonly pattern?: string;
  readonly exists?: boolean;
  readonly empty?: boolean;
};

export type VisibilityConfig = {
  // Inline condition
  readonly actor?: {
    [path: string]: EvaluationRule;
  };
  readonly record?: {
    [path: string]: EvaluationRule;
  };
  readonly selectedRecords?: {
    readonly length?: EvaluationRule<number>;
    readonly all?: { [path: string]: EvaluationRule };
    readonly some?: { [path: string]: EvaluationRule };
    readonly none?: { [path: string]: EvaluationRule };
  };
  readonly queryParams?: {
    [key: string]: EvaluationRule;
  };
  readonly context?: {
    readonly pageType?: EvaluationRule<'list' | 'view' | 'edit' | 'create'>;
    readonly modalDepth?: EvaluationRule<number>;
    readonly entityName?: EvaluationRule<string>;
    [key: string]: EvaluationRule | undefined;
  };
} | {
  // Custom evaluator reference
  readonly custom: string;
} | {
  // Named conditions
  readonly conditions: string[];
  readonly scope?: 'all' | 'any' | 'none';
} | {
  // Shortcuts
  readonly requiredRoles?: string[];
  readonly excludedRoles?: string[];
  readonly showWhen?: Record<string, any>;
  readonly hideWhen?: Record<string, any>;
};

// MODIFY: Add visibility to IEntityPageAction
export interface IEntityPageAction {
  // ... existing properties
  
  /**
   * Visibility configuration (SERIALIZABLE)
   * Evaluated in frontend using UniversalEvaluator
   * 
   * Can be:
   * 1. Inline condition (actor, record, selectedRecords, queryParams, context rules)
   * 2. Custom evaluator reference ({ custom: 'functionName' })
   * 3. Named conditions ({ conditions: ['name1', 'name2'], scope: 'all' })
   * 4. Shortcuts ({ requiredRoles: [...], showWhen: {...} })
   */
  readonly visibility?: VisibilityConfig;
}

// NEW: Add nested config interfaces
export interface ListPageConfig {
  readonly actions?: IEntityPageAction[];
  readonly breadcrumbs?: Array<{ label: string; url?: string }>;
  readonly defaultSort?: { field: string; order: 'asc' | 'desc' } | Array<{ field: string; order: 'asc' | 'desc' }> | 'asc' | 'desc';
  readonly tableConfig?: {
    readonly rowActions?: IEntityPageAction[];
    readonly bulkActions?: IEntityPageAction[];
    readonly rowSelection?: {
      enabled: boolean;
      visibility?: VisibilityConfig;
    };
    readonly columns?: Array<{
      field: string;
      visibility?: VisibilityConfig;
    }>;
  };
}

export interface ViewPageConfig {
  readonly actions?: IEntityPageAction[];
  readonly breadcrumbs?: Array<{ label: string; url?: string }>;
  readonly columnsConfig?: IEntityPageColumnConfig;
  readonly fields?: Array<{
    name: string;
    visibility?: VisibilityConfig;
  }>;
}

export interface EditPageConfig {
  readonly actions?: IEntityPageAction[];
  readonly breadcrumbs?: Array<{ label: string; url?: string }>;
  readonly columnsConfig?: IEntityPageColumnConfig;
  readonly formConfig?: {
    readonly buttons?: Array<{
      text: string;
      action: 'submit' | 'reset' | 'cancel';
      url?: string;
      visibility?: VisibilityConfig;
    }>;
    readonly fields?: Array<{
      name: string;
      visibility?: VisibilityConfig;
      enablement?: VisibilityConfig;
    }>;
  };
}

export interface CreatePageConfig {
  readonly breadcrumbs?: Array<{ label: string; url?: string }>;
  readonly columnsConfig?: IEntityPageColumnConfig;
  readonly formConfig?: {
    readonly buttons?: Array<{
      text: string;
      action: 'submit' | 'reset' | 'cancel';
      url?: string;
      visibility?: VisibilityConfig;
    }>;
    readonly fields?: Array<{
      name: string;
      visibility?: VisibilityConfig;
    }>;
  };
}

// MODIFY: EntitySchema to include nested configs
export interface EntitySchema<
  A extends string,
  F extends string,
  C extends string,
  Opp extends TDefaultEntityOperations = TDefaultEntityOperations
> extends Schema<A, F, C> {
  readonly model: Schema<A, F, C>['model'] & {
    // ... existing properties
    
    // NEW NESTED STRUCTURE (RECOMMENDED)
    readonly listPageConfig?: ListPageConfig;
    readonly viewPageConfig?: ViewPageConfig;
    readonly editPageConfig?: EditPageConfig;
    readonly createPageConfig?: CreatePageConfig;
    
    // OLD STRUCTURE (DEPRECATED BUT SUPPORTED)
    /** @deprecated Use listPageConfig.actions instead */
    readonly listPageActions?: IEntityPageAction[];
    /** @deprecated Use listPageConfig.breadcrumbs instead */
    readonly listPageBreadcrumbs?: Array<{ label: string; url?: string }>;
    /** @deprecated Use listPageConfig.defaultSort instead */
    readonly listPageDefaultSort?: { field: string; order: 'asc' | 'desc' } | Array<{ field: string; order: 'asc' | 'desc' }> | 'asc' | 'desc';
    
    /** @deprecated Use viewPageConfig.actions instead */
    readonly viewPageActions?: IEntityPageAction[];
    /** @deprecated Use viewPageConfig.breadcrumbs instead */
    readonly viewPageBreadcrumbs?: Array<{ label: string; url?: string }>;
    /** @deprecated Use viewPageConfig.columnsConfig instead */
    readonly viewPageColumnsConfig?: IEntityPageColumnConfig;
    
    /** @deprecated Use editPageConfig.actions instead */
    readonly editPageActions?: IEntityPageAction[];
    /** @deprecated Use editPageConfig.breadcrumbs instead */
    readonly editPageBreadcrumbs?: Array<{ label: string; url?: string }>;
    /** @deprecated Use editPageConfig.columnsConfig instead */
    readonly editPageColumnsConfig?: IEntityPageColumnConfig;
  };
}
```

**Verification:**
- [ ] Types compile without errors
- [ ] Existing schemas still work
- [ ] JSDoc comments are clear
- [ ] Deprecation warnings visible in IDE

### Step 2: Export Types

**File:** `fw24/src/entity/index.ts`

```typescript
// Add exports
export type {
  VisibilityConfig,
  EvaluationRule,
  ListPageConfig,
  ViewPageConfig,
  EditPageConfig,
  CreatePageConfig,
} from './base-entity';
```

**Verification:**
- [ ] Types exported correctly
- [ ] Available in other modules

---

## Frontend Implementation

### Step 1: Create Type Definitions

**File:** `ui24/src/core/types/evaluation.ts` (NEW)

```typescript
/**
 * Evaluation context for all visibility/enablement checks
 */
export interface EvaluationContext {
  actor: {
    actorId?: string;
    cognito?: {
      groups?: string[];
      username?: string;
      [key: string]: any;
    };
    [key: string]: any;
  };
  
  record?: Record<string, any>;
  selectedRecords?: Array<Record<string, any>>;
  queryParams?: Record<string, any>;
  pageType?: 'list' | 'view' | 'edit' | 'create';
  entityName?: string;
  modalDepth?: number;
  formValues?: Record<string, any>;
  [key: string]: any;
}

/**
 * Evaluation result
 */
export interface EvaluationResult {
  visible: boolean;
  enabled: boolean;
  disabledMessage?: string;
  [key: string]: any;
}

/**
 * Custom evaluator function
 */
export type CustomEvaluatorFunction = (
  context: EvaluationContext
) => Promise<EvaluationResult> | EvaluationResult;

/**
 * Visibility config (matches backend type)
 */
export interface VisibilityConfig {
  actor?: Record<string, any>;
  record?: Record<string, any>;
  selectedRecords?: any;
  queryParams?: Record<string, any>;
  context?: Record<string, any>;
  custom?: string;
  conditions?: string[];
  scope?: 'all' | 'any' | 'none';
  requiredRoles?: string[];
  excludedRoles?: string[];
  showWhen?: Record<string, any>;
  hideWhen?: Record<string, any>;
}
```

**Verification:**
- [ ] Types compile
- [ ] Available for import

### Step 2: Create Universal Registry

**File:** `ui24/src/core/utils/ConditionEvaluatorRegistry.ts` (NEW)

```typescript
import { CustomEvaluatorFunction } from '../types/evaluation';

/**
 * Universal registry for ALL framework evaluation needs
 * 
 * Use cases:
 * - Action visibility
 * - Form control visibility/enablement
 * - Widget availability
 * - Feature flags
 * - Page authorization
 * - Table config (row selection, columns)
 */
export class ConditionEvaluatorRegistry {
  private static evaluators: Map<string, CustomEvaluatorFunction> = new Map();
  
  /**
   * Register a custom evaluator function
   * 
   * @example
   * ConditionEvaluatorRegistry.register('canEditGame', async (ctx) => {
   *   if (ctx.actor?.cognito?.groups?.includes('admin')) {
   *     return { visible: true, enabled: true };
   *   }
   *   if (ctx.record?.createdBy === ctx.actor?.actorId && 
   *       ctx.record?.status === 'draft') {
   *     return { visible: true, enabled: true };
   *   }
   *   return { visible: false, enabled: false };
   * });
   */
  static register(name: string, evaluator: CustomEvaluatorFunction): void {
    if (this.evaluators.has(name)) {
      console.warn(`[ConditionEvaluatorRegistry] Overwriting evaluator: ${name}`);
    }
    this.evaluators.set(name, evaluator);
  }
  
  /**
   * Register multiple evaluators at once
   */
  static registerAll(evaluators: Record<string, CustomEvaluatorFunction>): void {
    Object.entries(evaluators).forEach(([name, fn]) => {
      this.register(name, fn);
    });
  }
  
  /**
   * Get an evaluator by name
   */
  static get(name: string): CustomEvaluatorFunction | undefined {
    return this.evaluators.get(name);
  }
  
  /**
   * Check if evaluator exists
   */
  static has(name: string): boolean {
    return this.evaluators.has(name);
  }
  
  /**
   * Clear all evaluators (useful for testing)
   */
  static clear(): void {
    this.evaluators.clear();
  }
  
  /**
   * Get all registered evaluator names
   */
  static getNames(): string[] {
    return Array.from(this.evaluators.keys());
  }
}

// Export singleton
export const registry = ConditionEvaluatorRegistry;
```

**Verification:**
- [ ] Registry works
- [ ] Can register/get evaluators
- [ ] Clear function works (for tests)

### Step 3: Create Universal Evaluator

**File:** `ui24/src/core/utils/UniversalEvaluator.ts` (NEW)

```typescript
import {
  EvaluationContext,
  EvaluationResult,
  VisibilityConfig,
  CustomVisibilityConfig,
  NamedVisibilityConfig,
  ShortcutVisibilityConfig,
} from '../types/evaluation';
import { getEvaluator } from './ConditionEvaluatorRegistry';

/**
 * FIXED: Universal evaluation engine with proper error handling
 * Supports both sync and async evaluation for performance
 */
export class UniversalEvaluator {
  private cache = new Map<string, { result: EvaluationResult; timestamp: number }>();
  private cacheTimeout = 5000; // 5 seconds
  
  /**
   * FIXED: Synchronous evaluation where possible (better for React)
   * Throws if async required
   */
  evaluateSync(
    config: VisibilityConfig | undefined,
    context: EvaluationContext
  ): EvaluationResult {
    if (!config) {
      return { visible: true, enabled: true };
    }
    
    try {
      // Can handle shortcuts synchronously
      if ('requiredRoles' in config || 'showWhen' in config || 'hideWhen' in config) {
        return this.evaluateShortcutsSync(config as ShortcutVisibilityConfig, context);
      }
      
      // Custom evaluators might be async - can't handle sync
      if ('custom' in config) {
        throw new Error('Custom evaluators require async evaluation');
      }
      
      // Named conditions might be async
      if ('conditions' in config) {
        throw new Error('Named conditions require async evaluation');
      }
      
      // Inline conditions - can handle if no custom functions
      return this.evaluateConditionSync(config, context);
      
    } catch (error) {
      console.error('[UniversalEvaluator] Sync evaluation failed:', error);
      throw error; // Re-throw to trigger async fallback
    }
  }
  
  /**
   * Main async evaluation entry point
   * FIXED: Proper error handling with fail-safe defaults
   */
  async evaluate(
    config: VisibilityConfig | undefined,
    context: EvaluationContext
  ): Promise<EvaluationResult> {
    
    const defaultResult: EvaluationResult = {
      visible: true,
      enabled: true
    };
    
    if (!config) {
      return defaultResult;
    }
    
    try {
      // Check cache first
      const cacheKey = this.getCacheKey(config, context);
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
        return cached.result;
      }
      
      let result: EvaluationResult;
      
      // FIXED: Use discriminated union properly
      if ('custom' in config && typeof config.custom === 'string') {
        result = await this.evaluateCustom(config.custom, context);
      } else if ('conditions' in config && Array.isArray(config.conditions)) {
        result = await this.evaluateNamedConditions(
          (config as NamedVisibilityConfig).conditions,
          (config as NamedVisibilityConfig).scope || 'all',
          context
        );
      } else if ('requiredRoles' in config || 'showWhen' in config || 'hideWhen' in config) {
        result = await this.evaluateShortcuts(config as ShortcutVisibilityConfig, context);
      } else {
        result = await this.evaluateCondition(config, context);
      }
      
      // Cache result
      this.cache.set(cacheKey, { result, timestamp: Date.now() });
      if (this.cache.size > 1000) {
        this.cleanCache();
      }
      
      return result;
      
    } catch (error) {
      console.error('[UniversalEvaluator] Evaluation failed:', error);
      
      // FIXED: Fail-safe - default to hidden on error (security first)
      return {
        visible: false,
        enabled: false,
        disabledMessage: 'Evaluation error',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * Evaluate custom function reference
   */
  private async evaluateCustom(
    name: string,
    context: EvaluationContext
  ): Promise<EvaluationResult> {
    const fn = registry.get(name);
    
    if (!fn) {
      console.error(`[UniversalEvaluator] Custom evaluator not found: "${name}"`);
      return { visible: false, enabled: false };
    }
    
    try {
      const result = await fn(context);
      return result;
    } catch (error) {
      console.error(`[UniversalEvaluator] Error in custom evaluator "${name}":`, error);
      return { visible: false, enabled: false };
    }
  }
  
  /**
   * Evaluate named conditions with scope logic
   */
  private async evaluateNamedConditions(
    names: string[],
    scope: 'all' | 'any' | 'none',
    context: EvaluationContext
  ): Promise<EvaluationResult> {
    
    const results = await Promise.all(
      names.map(name => this.evaluateCustom(name, context))
    );
    
    const visibleResults = results.filter(r => r.visible);
    
    let finalVisible = false;
    switch (scope) {
      case 'all':
        finalVisible = visibleResults.length === names.length;
        break;
      case 'any':
        finalVisible = visibleResults.length > 0;
        break;
      case 'none':
        finalVisible = visibleResults.length === 0;
        break;
    }
    
    return {
      visible: finalVisible,
      enabled: finalVisible
    };
  }
  
  /**
   * Evaluate shortcuts (common cases)
   */
  private async evaluateShortcuts(
    config: any,
    context: EvaluationContext
  ): Promise<EvaluationResult> {
    
    // Required roles
    if (config.requiredRoles && Array.isArray(config.requiredRoles)) {
      const userRoles = context.actor?.cognito?.groups || [];
      const hasRole = config.requiredRoles.some(role => userRoles.includes(role));
      if (!hasRole) {
        return { visible: false, enabled: false };
      }
    }
    
    // Excluded roles
    if (config.excludedRoles && Array.isArray(config.excludedRoles)) {
      const userRoles = context.actor?.cognito?.groups || [];
      const hasExcluded = config.excludedRoles.some(role => userRoles.includes(role));
      if (hasExcluded) {
        return { visible: false, enabled: false };
      }
    }
    
    // Show when (record fields match)
    if (config.showWhen && context.record) {
      const matches = this.matchesObject(config.showWhen, context.record, context);
      if (!matches) {
        return { visible: false, enabled: false };
      }
    }
    
    // Hide when (record fields match)
    if (config.hideWhen && context.record) {
      const matches = this.matchesObject(config.hideWhen, context.record, context);
      if (matches) {
        return { visible: false, enabled: false };
      }
    }
    
    return { visible: true, enabled: true };
  }
  
  /**
   * Evaluate full condition structure
   */
  private async evaluateCondition(
    condition: any,
    context: EvaluationContext
  ): Promise<EvaluationResult> {
    
    // Check actor rules
    if (condition.actor) {
      const passed = await this.evaluateRules(condition.actor, context.actor, context);
      if (!passed) return { visible: false, enabled: false };
    }
    
    // Check record rules
    if (condition.record && context.record) {
      const passed = await this.evaluateRules(condition.record, context.record, context);
      if (!passed) return { visible: false, enabled: false };
    }
    
    // Check selectedRecords rules
    if (condition.selectedRecords && context.selectedRecords) {
      const passed = await this.evaluateSelectedRecordsRules(
        condition.selectedRecords,
        context.selectedRecords,
        context
      );
      if (!passed) return { visible: false, enabled: false };
    }
    
    // Check queryParams rules
    if (condition.queryParams && context.queryParams) {
      const passed = await this.evaluateRules(
        condition.queryParams,
        context.queryParams,
        context
      );
      if (!passed) return { visible: false, enabled: false };
    }
    
    // Check context rules
    if (condition.context) {
      const contextData = {
        pageType: context.pageType,
        modalDepth: context.modalDepth,
        entityName: context.entityName
      };
      const passed = await this.evaluateRules(condition.context, contextData, context);
      if (!passed) return { visible: false, enabled: false };
    }
    
    return { visible: true, enabled: true };
  }
  
  /**
   * Evaluate rules against an object
   */
  private async evaluateRules(
    rules: Record<string, any>,
    data: any,
    context: EvaluationContext
  ): Promise<boolean> {
    
    for (const [path, rule] of Object.entries(rules)) {
      const value = this.getNestedValue(data, path);
      const passed = await this.evaluateRule(rule, value, context);
      if (!passed) return false;
    }
    
    return true;
  }
  
  /**
   * Evaluate selectedRecords rules (supports aggregations)
   */
  private async evaluateSelectedRecordsRules(
    rules: any,
    selectedRecords: Array<Record<string, any>>,
    context: EvaluationContext
  ): Promise<boolean> {
    
    // Length check
    if (rules.length) {
      const passed = await this.evaluateRule(rules.length, selectedRecords.length, context);
      if (!passed) return false;
    }
    
    // All records match
    if (rules.all) {
      const allMatch = await Promise.all(
        selectedRecords.map(record => 
          this.evaluateRules(rules.all, record, context)
        )
      );
      if (!allMatch.every(Boolean)) return false;
    }
    
    // At least one matches
    if (rules.some) {
      const someMatch = await Promise.all(
        selectedRecords.map(record => 
          this.evaluateRules(rules.some, record, context)
        )
      );
      if (!someMatch.some(Boolean)) return false;
    }
    
    // None match
    if (rules.none) {
      const noneMatch = await Promise.all(
        selectedRecords.map(record => 
          this.evaluateRules(rules.none, record, context)
        )
      );
      if (noneMatch.some(Boolean)) return false;
    }
    
    return true;
  }
  
  /**
   * Evaluate single rule
   */
  private async evaluateRule(
    rule: any,
    value: any,
    context: EvaluationContext
  ): Promise<boolean> {
    
    // Template resolution
    const resolve = (val: any) => this.resolveTemplate(val, context);
    
    // Equality checks
    if (rule.eq !== undefined && value !== resolve(rule.eq)) return false;
    if (rule.neq !== undefined && value === resolve(rule.neq)) return false;
    
    // Comparison checks
    if (rule.gt !== undefined && !(Number(value) > Number(resolve(rule.gt)))) return false;
    if (rule.gte !== undefined && !(Number(value) >= Number(resolve(rule.gte)))) return false;
    if (rule.lt !== undefined && !(Number(value) < Number(resolve(rule.lt)))) return false;
    if (rule.lte !== undefined && !(Number(value) <= Number(resolve(rule.lte)))) return false;
    
    // List checks
    if (rule.inList && !rule.inList.includes(value)) return false;
    if (rule.notInList && rule.notInList.includes(value)) return false;
    
    // Pattern matching
    if (rule.pattern) {
      const regex = new RegExp(rule.pattern);
      if (!regex.test(String(value))) return false;
    }
    
    // Existence checks
    if (rule.exists !== undefined) {
      const exists = value !== undefined && value !== null;
      if (exists !== rule.exists) return false;
    }
    
    if (rule.empty !== undefined) {
      const empty = !value || (Array.isArray(value) && value.length === 0) || 
                    (typeof value === 'object' && Object.keys(value).length === 0);
      if (empty !== rule.empty) return false;
    }
    
    // Custom function (string reference)
    if (rule.custom && typeof rule.custom === 'string') {
      const result = await this.evaluateCustom(rule.custom, {
        ...context,
        _currentValue: value
      });
      return result.visible;
    }
    
    return true;
  }
  
  /**
   * Simple object matching (for showWhen/hideWhen)
   */
  private matchesObject(
    expected: Record<string, any>,
    actual: Record<string, any>,
    context: EvaluationContext
  ): boolean {
    return Object.entries(expected).every(([key, value]) => {
      const actualValue = this.getNestedValue(actual, key);
      const resolvedValue = this.resolveTemplate(value, context);
      return actualValue === resolvedValue;
    });
  }
  
  /**
   * Get nested value using dot notation
   */
  private getNestedValue(obj: any, path: string): any {
    if (!obj || !path) return undefined;
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }
  
  /**
   * Resolve template strings like '{actor.actorId}'
   */
  private resolveTemplate(value: any, context: EvaluationContext): any {
    if (typeof value !== 'string') return value;
    
    const match = value.match(/^\{(.+)\}$/);
    if (!match) return value;
    
    const path = match[1];
    
    // Try different context sources
    if (path.startsWith('actor.')) {
      return this.getNestedValue(context.actor, path.substring(6));
    }
    if (path.startsWith('record.')) {
      return this.getNestedValue(context.record, path.substring(7));
    }
    if (path.startsWith('context.')) {
      return this.getNestedValue(context, path.substring(8));
    }
    
    // Direct context property
    return this.getNestedValue(context, path);
  }
}

// Export singleton
export const universalEvaluator = new UniversalEvaluator();
```

**Verification:**
- [ ] Evaluator works
- [ ] Can evaluate all config types
- [ ] Template resolution works
- [ ] Error handling works

### Step 4: Create Context Provider

**File:** `ui24/src/core/context/EvaluationContext.tsx` (NEW)

```typescript
import React, { createContext, useContext, ReactNode, useMemo } from 'react';
import { EvaluationContext as EvalContextType } from '../types/evaluation';
import { useAuth } from './AuthContext';
import { useLocation, useParams } from 'react-router-dom';
import { useModalDepth } from './ModalContext';

interface EvaluationContextProviderProps {
  children: ReactNode;
  additionalContext?: Partial<EvalContextType>;
  record?: Record<string, any>;
  selectedRecords?: Array<Record<string, any>>;
  pageType?: 'list' | 'view' | 'edit' | 'create';
  entityName?: string;
}

const EvalContext = createContext<EvalContextType | null>(null);

export function EvaluationContextProvider({
  children,
  additionalContext = {},
  record,
  selectedRecords,
  pageType,
  entityName
}: EvaluationContextProviderProps) {
  
  const { user } = useAuth();
  const location = useLocation();
  const params = useParams();
  const modalDepth = useModalDepth();
  
  // Build query params
  const queryParams = useMemo(() => {
    return Object.fromEntries(new URLSearchParams(location.search));
  }, [location.search]);
  
  // Auto-detect page type from route if not provided
  const detectedPageType = useMemo(() => {
    if (pageType) return pageType;
    if (location.pathname.includes('/list-')) return 'list';
    if (location.pathname.includes('/view-')) return 'view';
    if (location.pathname.includes('/edit-')) return 'edit';
    if (location.pathname.includes('/create-')) return 'create';
    return undefined;
  }, [location.pathname, pageType]);
  
  // Auto-detect entity name from route
  const detectedEntityName = useMemo(() => {
    if (entityName) return entityName;
    const match = location.pathname.match(/\/(list|view|edit|create)-([^/]+)/);
    return match ? match[2] : undefined;
  }, [location.pathname, entityName]);
  
  const context: EvalContextType = useMemo(() => ({
    actor: {
      actorId: user?.sub || user?.id,
      cognito: {
        groups: user?.['cognito:groups'] || user?.groups || [],
        username: user?.username || user?.email,
        ...user
      },
      ...user
    },
    record,
    selectedRecords,
    queryParams,
    pageType: detectedPageType,
    entityName: detectedEntityName,
    modalDepth,
    ...additionalContext
  }), [
    user,
    record,
    selectedRecords,
    queryParams,
    detectedPageType,
    detectedEntityName,
    modalDepth,
    additionalContext
  ]);
  
  return (
    <EvalContext.Provider value={context}>
      {children}
    </EvalContext.Provider>
  );
}

/**
 * Get current evaluation context
 */
export function useEvaluationContext(): EvalContextType {
  const context = useContext(EvalContext);
  
  if (!context) {
    throw new Error('useEvaluationContext must be used within EvaluationContextProvider');
  }
  
  return context;
}
```

**Verification:**
- [ ] Context provider works
- [ ] Auto-detection works
- [ ] useEvaluationContext hook works

### Step 5: Create Evaluation Hooks

**File:** `ui24/src/core/hooks/useEvaluation.ts` (NEW)

```typescript
import { useMemo, useCallback, useState, useEffect } from 'react';
import { useEvaluationContext } from '../context/EvaluationContext';
import { universalEvaluator } from '../utils/UniversalEvaluator';
import { VisibilityConfig, EvaluationResult, EvaluationContext } from '../types/evaluation';

/**
 * Hook for evaluating visibility conditions
 * 
 * @example Single evaluation
 * const { visible, enabled } = useEvaluation(action.visibility);
 * 
 * @example With additional context
 * const { visible } = useEvaluation(config, { formValues });
 */
export function useEvaluation(
  config: VisibilityConfig | undefined,
  additionalContext?: Partial<EvaluationContext>
): EvaluationResult {
  
  const baseContext = useEvaluationContext();
  
  // Merge contexts
  const context = useMemo(() => ({
    ...baseContext,
    ...additionalContext
  }), [baseContext, additionalContext]);
  
  // State for result
  const [state, setState] = useState<EvaluationResult>({
    visible: true,
    enabled: true
  });
  
  // Evaluate
  useEffect(() => {
    let cancelled = false;
    
    (async () => {
      if (!config) {
        setState({ visible: true, enabled: true });
        return;
      }
      
      const result = await universalEvaluator.evaluate(config, context);
      
      if (!cancelled) {
        setState(result);
      }
    })();
    
    return () => {
      cancelled = true;
    };
  }, [config, context]);
  
  return state;
}

/**
 * Batch evaluation hook
 * Evaluates multiple configs at once (more efficient)
 * 
 * @example
 * const results = useEvaluationBatch(actions.map(a => a.visibility));
 */
export function useEvaluationBatch(
  configs: Array<VisibilityConfig | undefined>,
  additionalContext?: Partial<EvaluationContext>
): EvaluationResult[] {
  
  const baseContext = useEvaluationContext();
  
  const context = useMemo(() => ({
    ...baseContext,
    ...additionalContext
  }), [baseContext, additionalContext]);
  
  const [state, setState] = useState<EvaluationResult[]>(
    configs.map(() => ({ visible: true, enabled: true }))
  );
  
  useEffect(() => {
    let cancelled = false;
    
    (async () => {
      const results = await Promise.all(
        configs.map(config => 
          config 
            ? universalEvaluator.evaluate(config, context)
            : { visible: true, enabled: true }
        )
      );
      
      if (!cancelled) {
        setState(results);
      }
    })();
    
    return () => {
      cancelled = true;
    };
  }, [configs, context]);
  
  return state;
}

/**
 * Imperative evaluation function
 * Use when you need to evaluate on-demand (not in render)
 * 
 * @example
 * const evaluator = useEvaluator();
 * const result = await evaluator(config, { formValues });
 */
export function useEvaluator() {
  const baseContext = useEvaluationContext();
  
  return useCallback(async (
    config: VisibilityConfig | undefined,
    additionalContext?: Partial<EvaluationContext>
  ): Promise<EvaluationResult> => {
    const context = { ...baseContext, ...additionalContext };
    
    if (!config) {
      return { visible: true, enabled: true };
    }
    
    return await universalEvaluator.evaluate(config, context);
  }, [baseContext]);
}
```

**Verification:**
- [ ] useEvaluation works
- [ ] useEvaluationBatch works
- [ ] useEvaluator works
- [ ] Proper memoization
- [ ] No memory leaks

### Step 6: Add ModalDepth Hook

**File:** `ui24/src/core/context/ModalContext.tsx`

```typescript
// ADD to existing ModalContext

import React, { createContext, useContext, ReactNode } from 'react';

// Simple modal depth tracking for stack effect
const ModalDepthContext = createContext(0);

export const useModalDepth = () => useContext(ModalDepthContext);

export const ModalContextProvider = ({ 
  children, 
  depth = 0 
}: { 
  children: ReactNode; 
  depth?: number;
}) => {
  return (
    <ModalDepthContext.Provider value={depth}>
      {children}
    </ModalDepthContext.Provider>
  );
};
```

**Verification:**
- [ ] useModalDepth hook works
- [ ] Tracks modal nesting

---

## Config Generation

### Step 1: Update Template Functions

**File:** `fw24/src/ui-config-gen/templates/list-entity.ts`

```typescript
// MODIFY: makeViewEntityListConfig to pass through visibility
// No changes needed - visibility is already on IEntityPageAction

// MODIFY: Default actions to consider new structure
export default <S extends EntitySchema<string, string, string>>(
  options: ListEntityPageOptions<S>
) => {
  const { entityName, entityNamePlural, properties, breadcrumbs } = options;
  const entityNameLower = entityName.toLowerCase();
  const entityNamePascalCase = pascalCase(entityName);

  const listPageConfig = makeViewEntityListConfig(options);

  // Build default page header actions
  const defaultPageHeaderActions = [];
  if (!options.excludeFromAdminCreate) {
    defaultPageHeaderActions.push({
      label: "Create",
      url: `/create-${entityNameLower}`
    });
  }

  // Combine default actions with custom actions
  // NEW: Support both old and new structure
  const pageHeaderActions = options.pageHeaderActions 
    ? [...defaultPageHeaderActions, ...options.pageHeaderActions]
    : defaultPageHeaderActions;

  return {
    pageTitle: `${entityNamePascalCase} Listing`,
    pageType: "list",
    routePattern: undefined,
    breadcrumbs: breadcrumbs || [],
    pageHeaderActions,  // Already includes visibility if defined
    listPageConfig
  } as const;
};
```

**Verification:**
- [ ] Visibility config passed through
- [ ] Old structure still works

**File:** `fw24/src/ui-config-gen/templates/view-entity.ts`

```typescript
// MODIFY: Same pattern - visibility already included
// No significant changes needed
```

**Verification:**
- [ ] Visibility config passed through
- [ ] Old structure still works

### Step 2: Support Nested Configs

**File:** `fw24/src/ui-config-gen/entity-ui-config.gen.ts`

```typescript
// MODIFY: process() function to handle nested structures

// ADD: Helper function to transform old -> new format
private transformLegacyConfig(schema: EntitySchema<any, any, any>): EntitySchema<any, any, any> {
  const model = schema.model;
  
  // If already using new format, return as-is
  if (model.listPageConfig || model.viewPageConfig || model.editPageConfig || model.createPageConfig) {
    return schema;
  }
  
  // Transform old format
  const transformed = { ...schema, model: { ...model } };
  
  // List page
  if (model.listPageActions || model.listPageBreadcrumbs || model.listPageDefaultSort) {
    transformed.model.listPageConfig = {
      actions: model.listPageActions,
      breadcrumbs: model.listPageBreadcrumbs,
      defaultSort: model.listPageDefaultSort
    };
  }
  
  // View page
  if (model.viewPageActions || model.viewPageBreadcrumbs || model.viewPageColumnsConfig) {
    transformed.model.viewPageConfig = {
      actions: model.viewPageActions,
      breadcrumbs: model.viewPageBreadcrumbs,
      columnsConfig: model.viewPageColumnsConfig
    };
  }
  
  // Edit page
  if (model.editPageActions || model.editPageBreadcrumbs || model.editPageColumnsConfig) {
    transformed.model.editPageConfig = {
      actions: model.editPageActions,
      breadcrumbs: model.editPageBreadcrumbs,
      columnsConfig: model.editPageColumnsConfig
    };
  }
  
  return transformed;
}

// MODIFY: In process() before generating configs
for (const [serviceName, service] of services) {
  // Transform legacy config
  const schema = this.transformLegacyConfig(service.getSchema());
  
  // Continue with existing generation...
}
```

**Verification:**
- [ ] Old configs still work
- [ ] New nested configs work
- [ ] Transformation correct

---

## Deprecation Strategy

### 1. Timeline

**Phase 1 (Current):** Support both old and new
- Old flat structure works
- New nested structure works
- No breaking changes

**Phase 2 (6 months):** Add deprecation warnings
- Console warnings when using old structure
- IDE warnings via JSDoc @deprecated tags

**Phase 3 (12 months):** Stronger warnings
- More prominent warnings
- Migration guide links
- Update all examples to new structure

**Phase 4 (18 months):** Remove old structure
- Breaking change release
- Only new structure supported

### 2. JSDoc Deprecation Tags

Already added in entity schema:

```typescript
/** @deprecated Use listPageConfig.actions instead */
readonly listPageActions?: IEntityPageAction[];
```

### 3. Runtime Warnings

**File:** `fw24/src/ui-config-gen/entity-ui-config.gen.ts`

```typescript
private checkDeprecatedUsage(schema: EntitySchema<any, any, any>): void {
  const model = schema.model;
  const warnings: string[] = [];
  
  if (model.listPageActions) {
    warnings.push('listPageActions is deprecated. Use listPageConfig.actions instead.');
  }
  if (model.listPageBreadcrumbs) {
    warnings.push('listPageBreadcrumbs is deprecated. Use listPageConfig.breadcrumbs instead.');
  }
  if (model.listPageDefaultSort) {
    warnings.push('listPageDefaultSort is deprecated. Use listPageConfig.defaultSort instead.');
  }
  // ... same for view/edit pages
  
  if (warnings.length > 0) {
    this.logger.warn(`Entity "${model.entity}" uses deprecated configuration:`);
    warnings.forEach(w => this.logger.warn(`  - ${w}`));
    this.logger.warn('  See migration guide: https://docs.fw24.io/migration/nested-config');
  }
}

// Call in process()
this.checkDeprecatedUsage(schema);
```

### 4. Migration Guide

**File:** `fw24/docs/MIGRATION_NESTED_CONFIG.md` (NEW)

```markdown
# Migration Guide: Flat to Nested Config

## Overview

We're moving from flat configuration to nested structures for better organization.

## Old Structure

```typescript
export const createGameSchema = () => ({
  model: {
    entity: 'game',
    listPageActions: [...],
    listPageBreadcrumbs: [...],
    listPageDefaultSort: {...},
    viewPageActions: [...],
    // ...
  }
});
```

## New Structure

```typescript
export const createGameSchema = () => ({
  model: {
    entity: 'game',
    listPageConfig: {
      actions: [...],
      breadcrumbs: [...],
      defaultSort: {...},
      tableConfig: {  // NEW!
        rowActions: [...],
        bulkActions: [...]
      }
    },
    viewPageConfig: {
      actions: [...],
      // ...
    }
  }
});
```

## Migration Steps

1. Copy old values to new structure
2. Test thoroughly
3. Remove old properties
4. Done!

## Benefits

- Better organization
- Table-level actions
- Form button config
- Visibility system
```

---

## Migration Path

### For Existing Projects

1. **No immediate action required**
   - Old structure continues working
   - No breaking changes

2. **Start using new features**
   - Add visibility configs
   - Use new nested structure for new entities
   - Gradually migrate old entities

3. **Complete migration**
   - Move all entities to new structure
   - Remove old properties
   - Enjoy cleaner code!

### Migration Tool (Optional)

**File:** `fw24/scripts/migrate-entity-config.ts` (NEW)

```typescript
/**
 * Automated migration tool
 * Converts old flat structure to new nested structure
 * 
 * Usage: npx ts-node scripts/migrate-entity-config.ts src/entities/game.schema.ts
 */

// Implementation here...
```

---

## Implementation Checklist

### Backend (fw24)

#### Phase 1: Types & Interfaces
- [ ] Add `EvaluationRule` type to `base-entity.ts`
- [ ] Add `VisibilityConfig` type to `base-entity.ts`
- [ ] Add `visibility` property to `IEntityPageAction`
- [ ] Add nested config interfaces (`ListPageConfig`, etc.)
- [ ] Update `EntitySchema` interface with nested configs
- [ ] Add deprecation JSDoc tags
- [ ] Export new types in `index.ts`
- [ ] Verify TypeScript compilation
- [ ] Verify existing schemas still compile

#### Phase 2: Config Generation
- [ ] Update `list-entity.ts` template
- [ ] Update `view-entity.ts` template
- [ ] Update `update-entity.ts` template
- [ ] Update `create-entity.ts` template
- [ ] Add `transformLegacyConfig` function
- [ ] Add `checkDeprecatedUsage` function
- [ ] Test with old structure schemas
- [ ] Test with new structure schemas
- [ ] Test with mixed (some old, some new)
- [ ] Verify generated JSON configs

#### Phase 3: Documentation
- [ ] Create migration guide
- [ ] Update entity schema docs
- [ ] Add visibility system docs
- [ ] Add JSDoc examples
- [ ] Update README

### Frontend (ui24)

#### Phase 1: Types & Core
- [ ] Create `evaluation.ts` types file
- [ ] Create `ConditionEvaluatorRegistry.ts`
- [ ] Create `UniversalEvaluator.ts`
- [ ] Create `EvaluationContext.tsx` provider
- [ ] Create `useEvaluation.ts` hooks
- [ ] Update `ModalContext.tsx` with `useModalDepth`
- [ ] Export all from `index.ts`
- [ ] Verify TypeScript compilation

#### Phase 2: Component Integration
- [ ] Update `PageHeader.tsx` to use evaluation
- [ ] Update `actionRenderer.tsx` (if needed)
- [ ] Update `addActionUI.tsx` (table row actions)
- [ ] Update `CreateButtons.tsx` (form buttons)
- [ ] Update `Table.tsx` (bulk actions)
- [ ] Test page header actions
- [ ] Test table row actions
- [ ] Test form buttons
- [ ] Test bulk actions

#### Phase 3: App Setup
- [ ] Add `EvaluationContextProvider` to app root
- [ ] Create evaluator registration point in `App.tsx`
- [ ] Document registration pattern
- [ ] Create example custom evaluators
- [ ] Test with real data

### Testing

#### Unit Tests
- [ ] Test `ConditionEvaluatorRegistry`
- [ ] Test `UniversalEvaluator` (all condition types)
- [ ] Test `useEvaluation` hook
- [ ] Test `useEvaluationBatch` hook
- [ ] Test template resolution
- [ ] Test context merging
- [ ] Test error handling

#### Integration Tests
- [ ] Test config generation (old structure)
- [ ] Test config generation (new structure)
- [ ] Test PageHeader with visibility
- [ ] Test Table row actions with visibility
- [ ] Test Form buttons with visibility
- [ ] Test custom evaluators
- [ ] Test modal depth tracking

#### E2E Tests
- [ ] Test role-based visibility
- [ ] Test record-based visibility
- [ ] Test selectedRecords visibility
- [ ] Test queryParams visibility
- [ ] Test complex multi-condition scenarios
- [ ] Test custom evaluators
- [ ] Test modal chains

---

## Testing & Verification

### Unit Test Examples

```typescript
// fw24/src/entity/base-entity.test.ts
describe('VisibilityConfig Types', () => {
  it('should accept inline conditions', () => {
    const config: VisibilityConfig = {
      actor: {
        'cognito.groups': { inList: ['admin'] }
      }
    };
    expect(config).toBeDefined();
  });
  
  it('should accept custom reference', () => {
    const config: VisibilityConfig = {
      custom: 'canEditGame'
    };
    expect(config).toBeDefined();
  });
  
  it('should accept shortcuts', () => {
    const config: VisibilityConfig = {
      requiredRoles: ['admin'],
      showWhen: { status: 'draft' }
    };
    expect(config).toBeDefined();
  });
});

// ui24/src/core/utils/UniversalEvaluator.test.ts
describe('UniversalEvaluator', () => {
  beforeEach(() => {
    registry.clear();
  });
  
  it('should evaluate requiredRoles shortcut', async () => {
    const config = {
      requiredRoles: ['admin']
    };
    
    const context = {
      actor: {
        cognito: {
          groups: ['admin']
        }
      }
    };
    
    const result = await universalEvaluator.evaluate(config, context);
    
    expect(result.visible).toBe(true);
    expect(result.enabled).toBe(true);
  });
  
  it('should hide when role missing', async () => {
    const config = {
      requiredRoles: ['admin']
    };
    
    const context = {
      actor: {
        cognito: {
          groups: ['user']
        }
      }
    };
    
    const result = await universalEvaluator.evaluate(config, context);
    
    expect(result.visible).toBe(false);
  });
  
  it('should evaluate showWhen conditions', async () => {
    const config = {
      showWhen: { status: 'draft' }
    };
    
    const context = {
      actor: {},
      record: { status: 'draft' }
    };
    
    const result = await universalEvaluator.evaluate(config, context);
    
    expect(result.visible).toBe(true);
  });
  
  it('should call custom evaluator', async () => {
    const mockEvaluator = jest.fn().mockResolvedValue({
      visible: true,
      enabled: false,
      disabledMessage: 'Test message'
    });
    
    registry.register('testEvaluator', mockEvaluator);
    
    const config = {
      custom: 'testEvaluator'
    };
    
    const context = {
      actor: {},
      record: { id: '123' }
    };
    
    const result = await universalEvaluator.evaluate(config, context);
    
    expect(mockEvaluator).toHaveBeenCalledWith(context);
    expect(result.visible).toBe(true);
    expect(result.enabled).toBe(false);
    expect(result.disabledMessage).toBe('Test message');
  });
  
  it('should evaluate selectedRecords.length', async () => {
    const config = {
      selectedRecords: {
        length: { gte: 1 }
      }
    };
    
    const context = {
      actor: {},
      selectedRecords: [{ id: '1' }, { id: '2' }]
    };
    
    const result = await universalEvaluator.evaluate(config, context);
    
    expect(result.visible).toBe(true);
  });
  
  it('should evaluate template substitution', async () => {
    const config = {
      record: {
        createdBy: { eq: '{actor.actorId}' }
      }
    };
    
    const context = {
      actor: { actorId: 'user123' },
      record: { createdBy: 'user123' }
    };
    
    const result = await universalEvaluator.evaluate(config, context);
    
    expect(result.visible).toBe(true);
  });
});
```

---

## Use Cases & Examples

### 1. Simple Role-Based

```typescript
// Backend
export const createGameSchema = () => createEntitySchema({
  model: {
    entity: 'game',
    
    viewPageConfig: {
      actions: [
        {
          label: 'Approve',
          url: '/game/:id/approve',
          icon: 'check',
          visibility: {
            requiredRoles: ['admin', 'team-admin']
          }
        }
      ]
    }
  }
});

// Frontend: Automatic! PageHeader uses useEvaluation
```

### 2. Record State-Based

```typescript
// Backend
viewPageConfig: {
  actions: [
    {
      label: 'Publish',
      url: '/game/:id/publish',
      visibility: {
        requiredRoles: ['admin'],
        showWhen: { status: 'approved' },
        hideWhen: { isPublished: true }
      }
    }
  ]
}
```

### 3. Custom Complex Logic

```typescript
// Frontend: Register once in App.tsx
ConditionEvaluatorRegistry.register('canEditGame', async (ctx) => {
  const { actor, record } = ctx;
  
  // Admins can edit anything
  if (actor?.cognito?.groups?.includes('admin')) {
    return { visible: true, enabled: true };
  }
  
  // Owners can edit drafts
  if (record?.status === 'draft' && 
      record?.createdBy === actor?.actorId) {
    return { visible: true, enabled: true };
  }
  
  return { visible: false, enabled: false };
});

// Backend: Reference by name
viewPageConfig: {
  actions: [
    {
      label: 'Edit',
      url: '/edit-game/:id',
      visibility: { custom: 'canEditGame' }
    }
  ]
}
```

### 4. Bulk Actions with Selection

```typescript
// Backend
listPageConfig: {
  tableConfig: {
    rowSelection: {
      enabled: true,
      visibility: {
        requiredRoles: ['admin', 'team-admin']
      }
    },
    bulkActions: [
      {
        label: 'Delete Selected',
        url: '/game/bulk-delete',
        visibility: {
          requiredRoles: ['admin'],
          selectedRecords: {
            length: { gte: 1 }
          }
        }
      }
    ]
  }
}

// Frontend: Table.tsx
function ListPage() {
  const [selectedRows, setSelectedRows] = useState<any[]>([]);
  
  return (
    <EvaluationContextProvider selectedRecords={selectedRows}>
      <BulkActionBar actions={bulkActions} />
      <Table
        rowSelection={{
          onChange: (keys, rows) => setSelectedRows(rows)
        }}
      />
    </EvaluationContextProvider>
  );
}
```

### 5. Form Buttons

```typescript
// Backend
editPageConfig: {
  formConfig: {
    buttons: [
      {
        text: 'Save Draft',
        action: 'submit',
        visibility: {
          showWhen: { status: 'draft' }
        }
      },
      {
        text: 'Submit for Approval',
        action: 'submit',
        visibility: {
          conditions: ['isOwner'],
          scope: 'all'
        }
      },
      {
        text: 'Approve',
        action: 'submit',
        visibility: {
          requiredRoles: ['admin'],
          showWhen: { status: 'pending' }
        }
      }
    ]
  }
}

// Frontend: CreateButtons.tsx
function FormButton({ button }) {
  const form = Form.useFormInstance();
  const formValues = Form.useWatch([], form);
  
  const { visible, enabled, disabledMessage } = useEvaluation(
    button.visibility,
    { formValues }
  );
  
  if (!visible) return null;
  
  return (
    <Tooltip title={!enabled ? disabledMessage : undefined}>
      <Button {...button} disabled={!enabled}>
        {button.text}
      </Button>
    </Tooltip>
  );
}
```

---

## Summary

This implementation plan provides:

✅ **Complete backward compatibility** - Old code works unchanged
✅ **Gradual migration path** - No big-bang migrations required
✅ **Clear deprecation strategy** - 18-month timeline
✅ **Comprehensive testing** - Unit, integration, E2E
✅ **Real-world examples** - Covering all use cases
✅ **Detailed checklists** - Track progress step-by-step
✅ **Type safety** - Full TypeScript support
✅ **Serializable** - Backend defines, frontend evaluates
✅ **Universal** - Same system for all evaluation needs
✅ **Pattern alignment** - Reuses validation framework patterns

**Next Steps:**
1. Review this plan
2. Approve approach
3. Start with Phase 1: Backend types
4. Move to Phase 2: Frontend implementation
5. Test thoroughly
6. Document
7. Deploy

