# Condition System — Developer Quick Reference

> One-page guide: how to add visibility/enablement to your entity, the operator reference, and common patterns.

---

## 1. Core Idea

Every boolean decision (show/hide, enable/disable) and every value decision (which component, which label) in entity config uses the **same condition system**.

- **`Condition`** — evaluates to `true`/`false`. Used for `visibility`, `enablement`, `rowExpandable`.
- **`ConditionalValue<T>`** — evaluates to a **value** (string, etc). Used for `renderer`, `label`, `pageType`, `className`.

Both are evaluated at runtime against an **EvaluationContext** — a bag of all available data (actor, device, feature flags, record, form values, etc).

---

## 2. Where You Use Conditions (Entity Schema)

```typescript
// Field visibility — hide a field unless record is in draft
{
  name: 'internalNotes',
  type: 'string',
  visibility: { record: { status: { eq: 'draft' } } },
}

// Field enablement — disable unless user is admin
{
  name: 'approvalStatus',
  type: 'string',
  enablement: { actor: { groups: { inList: ['admin'] } } },
}

// Action visibility — show delete only for admins
{
  name: 'delete',
  visibility: { actor: { groups: { inList: ['admin'] } } },
}

// Section visibility
sections: [
  {
    name: 'Admin Settings',
    visibility: { actor: { groups: { inList: ['admin'] } } },
    properties: [...]
  }
]

// Table column renderer — conditional component
{
  name: 'description',
  renderer: {
    rules: [
      { when: { device: { isMobile: { eq: true } } }, value: 'CompactText' },
      { when: { featureFlags: { richText: { eq: true } } }, value: 'RichTextRenderer' },
    ],
    default: 'TextRenderer',
  }
}

// Dashboard widget visibility
{
  name: 'revenueChart',
  visibility: { subscription: { tier: { inList: ['pro', 'enterprise'] } } },
}
```

---

## 3. Operator Reference

Every leaf comparison uses an `EvaluationRule`. One operator per rule.

| Operator    | Example                  | Behavior                                                         |
| ----------- | ------------------------ | ---------------------------------------------------------------- |
| `eq`        | `{ eq: 'draft' }`        | Strict equality (`===`)                                          |
| `neq`       | `{ neq: 'archived' }`    | Not equal (`!==`)                                                |
| `gt`        | `{ gt: 0 }`              | Greater than                                                     |
| `gte`       | `{ gte: 5 }`             | Greater than or equal                                            |
| `lt`        | `{ lt: 100 }`            | Less than                                                        |
| `lte`       | `{ lte: 10 }`            | Less than or equal                                               |
| `between`   | `{ between: [1, 10] }`   | Inclusive range (`>=` min `&&` `<=` max)                         |
| `inList`    | `{ inList: ['a', 'b'] }` | Value is in list. If value is an array, checks overlap.          |
| `notInList` | `{ notInList: ['x'] }`   | Value is NOT in list                                             |
| `exists`    | `{ exists: true }`       | Value is not `null`/`undefined`. `false` = value IS null.        |
| `empty`     | `{ empty: true }`        | Value is `null`/`undefined`/`''`/`[]`/`{}`. `false` = NOT empty. |
| `pattern`   | `{ pattern: '^draft' }`  | Regex test (string values only)                                  |
| `contains`  | `{ contains: 'raft' }`   | Case-insensitive substring match                                 |

**`$ref` — dynamic comparison:**
```typescript
// Compare record.ownerId to the current actor's ID
{ record: { ownerId: { eq: { $ref: 'actor.actorId' } } } }
```

---

## 4. Context Fields (What You Can Check)

These are the keys you can use inside a condition. They map to the EvaluationContext:

| Field             | Source                                        | Example                                        |
| ----------------- | --------------------------------------------- | ---------------------------------------------- |
| `actor`           | Authenticated user                            | `{ actor: { groups: { inList: ['admin'] } } }` |
| `featureFlags`    | `configure({ featureFlagProvider })`          | `{ featureFlags: { darkMode: { eq: true } } }` |
| `device`          | Auto-detected (+ responsive if configured)    | `{ device: { isMobile: { eq: true } } }`       |
| `tenant`          | `configure({ tenantProvider })`               | `{ tenant: { tenantId: { eq: 'acme' } } }`     |
| `record`          | Current record data                           | `{ record: { status: { eq: 'published' } } }`  |
| `formValues`      | Current form state                            | `{ formValues: { budget: { gt: 0 } } }`        |
| `context`         | Page-level (pageType, entityName, modalDepth) | `{ context: { pageType: { eq: 'form' } } }`    |
| `queryParams`     | URL query string                              | `{ queryParams: { tab: { eq: 'settings' } } }` |
| `selectedRecords` | Table selection                               | `{ selectedRecords: { length: { gte: 1 } } }`  |
| *any app key*     | `configure({ contextProviders: { ... } })`    | `{ subscription: { tier: { eq: 'pro' } } }`    |

---

## 5. Logical Combinators

```typescript
// AND — all must be true
{ and: [
  { actor: { groups: { inList: ['admin'] } } },
  { record: { status: { eq: 'draft' } } },
] }

// OR — any must be true
{ or: [
  { actor: { groups: { inList: ['admin'] } } },
  { record: { ownerId: { eq: { $ref: 'actor.actorId' } } } },
] }

// NOT — negate
{ not: { record: { status: { eq: 'archived' } } } }

// Nested: admin OR (owner AND draft)
{ or: [
  { actor: { groups: { inList: ['admin'] } } },
  { and: [
    { record: { ownerId: { eq: { $ref: 'actor.actorId' } } } },
    { record: { status: { eq: 'draft' } } },
  ] },
] }
```

**Implicit AND**: Multiple fields in one object are ANDed automatically:
```typescript
// These two are equivalent:
{ actor: { groups: { inList: ['admin'] } }, record: { status: { eq: 'draft' } } }
{ and: [{ actor: { groups: { inList: ['admin'] } } }, { record: { status: { eq: 'draft' } } }] }
```

---

## 6. Named Conditions (Reusable)

Register once, reference by name anywhere:

```typescript
// In your app setup
import { ConditionRegistry } from '@ten24group/ui24';

ConditionRegistry.register('isAdmin', { actor: { groups: { inList: ['admin'] } } });
ConditionRegistry.register('isDraft', { record: { status: { eq: 'draft' } } });
ConditionRegistry.register('isAdminOnDraft', {
  and: [{ ref: 'isAdmin' }, { ref: 'isDraft' }],
});

// In entity config
{ visibility: { ref: 'isAdmin' } }
{ enablement: { ref: 'isAdminOnDraft' } }
```

---

## 7. A/B Testing & Conditional Components

The same system drives component swapping and A/B experiments. Use `ConditionalValue<string>` on `renderer`, `pageType`, `label`, or `className`.

### Step 1: Register an experiments provider

```typescript
// In App.tsx, before <UI24 />
configure({
  featureFlagProvider: {
    getFlags: () => ({
      richText: true,
      'new-dashboard': 'variant-b',  // string variants for A/B
    }),
  },
  contextProviders: {
    experiments: {
      getContext: () => ({
        'checkout-flow': 'variant-b',
        'product-card': 'control',
      }),
      // subscribe: (cb) => { /* listen for experiment changes */ return unsub; }
    },
  },
});
```

### Step 2: Define conditional renderer in entity schema

```typescript
{
  name: 'description',
  type: 'string',
  renderer: {
    rules: [
      // A/B test: show new editor for variant-b users
      { when: { experiments: { 'editor-redesign': { eq: 'variant-b' } } }, value: 'RichTextEditorV2' },
      // Feature flag: show rich text when enabled
      { when: { featureFlags: { richText: { eq: true } } }, value: 'RichTextEditor' },
      // Device adaptation
      { when: { device: { isMobile: { eq: true } } }, value: 'SimpleTextArea' },
    ],
    default: 'TextInput',
  }
}
```

### Step 3: Register the components

```typescript
// In registerExtensions.ts
ExtensionRegistry.registerFieldRenderer('RichTextEditorV2', RichTextEditorV2Component);
ExtensionRegistry.registerFieldRenderer('RichTextEditor', RichTextEditorComponent);
ExtensionRegistry.registerFieldRenderer('SimpleTextArea', SimpleTextAreaComponent);
```

**How it works at runtime:**
```
Entity config: renderer = ConditionalValue<string>
  ↓ useResolve() evaluates conditions against context
Resolved name: "RichTextEditorV2"
  ↓ ExtensionRegistry.getFieldRenderer()
React component: <RichTextEditorV2Component />
```

### Other conditional values:
```typescript
// Conditional label (e.g., change wording based on user tier)
label: {
  rules: [
    { when: { subscription: { tier: { eq: 'enterprise' } } }, value: 'Organization Name' },
  ],
  default: 'Company Name',
}

// Conditional CSS class
className: {
  rules: [
    { when: { device: { isMobile: { eq: true } } }, value: 'compact-layout' },
  ],
  default: 'standard-layout',
}

// Conditional page type
pageType: {
  rules: [
    { when: { device: { isMobile: { eq: true } } }, value: 'details' },
  ],
  default: 'form',
}
```

---

## 8. App Setup Checklist

```typescript
// 1. Import configure
import { configure } from '@ten24group/ui24';

// 2. Call configure() BEFORE rendering <UI24 />
configure({
  featureFlagProvider: {
    getFlags: () => myFeatureFlags,
    subscribe: (cb) => myFlagService.onChange(cb),
  },
  tenantProvider: {
    getTenant: () => ({ tenantId: 'acme', name: 'Acme Corp' }),
  },
  responsiveDevice: true,
  contextProviders: {
    subscription: {
      getContext: () => ({ tier: 'pro', maxUsers: 100 }),
      subscribe: (cb) => subscriptionService.onChange(cb),
    },
  },
});

// 3. Register named conditions (optional)
import { ConditionRegistry } from '@ten24group/ui24';
ConditionRegistry.register('isAdmin', { actor: { groups: { inList: ['admin'] } } });

// 4. Register custom evaluators for complex logic (optional)
import { CustomEvaluatorRegistry } from '@ten24group/ui24';
CustomEvaluatorRegistry.register('hasActiveSubscription', async (ctx) => {
  const sub = await fetchSubscription(ctx.actor.actorId);
  return sub.status === 'active';
});
```

---

## 9. Five Common Patterns

### Pattern 1: Role-based visibility
```typescript
visibility: { actor: { groups: { inList: ['admin', 'manager'] } } }
```

### Pattern 2: Record-state dependent enablement
```typescript
enablement: { record: { status: { eq: 'draft' } } }
```

### Pattern 3: Feature-flagged section
```typescript
sections: [{
  name: 'Beta Features',
  visibility: { featureFlags: { betaAccess: { eq: true } } },
  properties: [...]
}]
```

### Pattern 4: Owner-or-admin editing
```typescript
enablement: {
  or: [
    { actor: { groups: { inList: ['admin'] } } },
    { record: { ownerId: { eq: { $ref: 'actor.actorId' } } } },
  ]
}
```

### Pattern 5: Bulk action requiring selection
```typescript
// Show "Export" action only when 1+ records selected
visibility: { selectedRecords: { length: { gte: 1 } } }
```

---

## 10. Debugging

- **Dev mode warnings**: In non-production, the evaluator warns about unknown operators, unregistered refs, missing providers, and circular references.
- **Debug logging**: Enable detailed evaluation traces:
  ```typescript
  import { conditionEvaluator } from '@ten24group/ui24';
  conditionEvaluator.enableDebug(true);
  ```
- **Console output**: Look for `[Condition]` prefixed messages for all warnings and debug info.

---

## Quick Type Reference

```typescript
import type { Condition, ConditionalValue, EvaluationRule } from 'fw24';

// Condition — boolean expression
type Condition =
  | InlineCondition           // { actor: { ... }, record: { ... } }
  | { ref: string }           // { ref: 'isAdmin' }
  | { custom: string }        // { custom: 'myAsyncCheck' }
  | { and: Condition[] }      // all must be true
  | { or: Condition[] }       // any must be true
  | { not: Condition }        // negate
  | boolean;                  // literal true/false

// ConditionalValue<T> — resolves to a value
type ConditionalValue<T> = {
  rules: Array<{ when: Condition; value: T }>;
  default: T;
};

// EvaluationRule<T> — single comparison
type EvaluationRule<T> = {
  eq?: T; neq?: T; gt?: T; gte?: T; lt?: T; lte?: T;
  between?: [T, T]; inList?: T[]; notInList?: T[];
  exists?: boolean; empty?: boolean;
  pattern?: string; contains?: string;
};
```
