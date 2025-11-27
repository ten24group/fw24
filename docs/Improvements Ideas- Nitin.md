Improvements Ideas:


1. Context-Aware Actions (HIGH VALUE) 🎯
Problem: teh current approach is limited.. we call it visibility vconfig,a nd mostly care bout visibility and enablement.. but we need lot's fo stff'


```ts
// In IEntityPageAction interface
export interface IEntityPageAction {
  label: string;
  url?: string;
  icon?: string;
  type?: 'button' | 'dropdown';
  items?: Array<Omit<IEntityPageAction, 'items'>>;
  
  // NEW: Dynamic visibility/enablement
  conditions?: {
    /** Show action only if these fields match */
    showWhen?: Record<string, any>;
    /** Hide action if these fields match */
    hideWhen?: Record<string, any>;
    /** Disable action if these fields match */
    disableWhen?: Record<string, any>;
    /** Required user permissions */
    requiredPermissions?: string[];
    /** Custom function name to evaluate (must be registered in frontend) */
    customCondition?: string;
  };
  
  openInModal?: boolean;
  modalConfig?: IEntityPageActionModalConfig;
}
```

### 4. Action Groups for Better Organization (MEDIUM VALUE) 📂

**Problem:** Many actions in dropdown can become cluttered. Hard to organize logically.

**Solution:** Add action grouping within dropdowns

```typescript
export interface IEntityPageAction {
  label: string;
  url?: string;
  icon?: string;
  type?: 'button' | 'dropdown';
  
  // Enhanced dropdown support
  items?: Array<Omit<IEntityPageAction, 'items'> & {
    group?: string; // Group name for dividers
  }>;
  
  // ... rest of properties
}
```

**Usage Example:**
```typescript
viewPageActions: [
  {
    type: 'dropdown',
    label: 'Actions',
    items: [
      { label: 'View Stats', url: '/game/:id/stats', group: 'View' },
      { label: 'View Players', url: '/game/:id/players', group: 'View' },
      { label: 'Edit Details', url: '/edit-game/:id', group: 'Edit' },
      { label: 'Edit Roster', url: '/game/:id/roster', group: 'Edit' },
      { label: 'Delete', url: '/game/:id/delete', group: 'Danger' }
    ]
  }
]
```

### Entity relation handling in detail/table.. currently the relation handling only works when there's a direct relation with main identifier.. but if I want to sue a different identifier it wont work..f ro example the relation with sport entity use sport code.. but the default detail-api can't return data using sport code.. and the query api need to be used to fetch the result data..
