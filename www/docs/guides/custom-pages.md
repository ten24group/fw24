---
sidebar_position: 9
---

# Custom Pages & Dynamic Routes

FW24 supports custom UI pages with dynamic routes, enabling you to build both CRUD and non-CRUD admin pages that go beyond standard entity operations. This feature is ideal for dashboards, custom list/detail views, or any page that requires custom logic or layout.

## Key Features
- **Custom Page Configs:** Define custom pages in TypeScript, with full type safety and IntelliSense.
- **Dynamic Routing:** Use `routePattern` (e.g., `/author/:authorId/books`) to support parameterized URLs.
- **Flexible Page Types:** Supports `list`, `form`, and `details` page types, with all the config options available to entity pages.
- **API URL Parameterization:** Route params are automatically injected into API URLs for data fetching.
- **Seamless Integration:** Custom pages appear in the generated UI config and are handled by the frontend router.

## How It Works

### Backend (Config Generation)
- Place your custom page configs in `src/custom-pages/` (or a custom directory via config).
- Each file should export a config object with at least `pageTitle`, `pageType`, and the relevant config (e.g., `listPageConfig`).
- Optionally specify a `routePattern` for dynamic routes.
- The config generator (`EntityUIConfigGen`) scans this directory, validates and registers each custom page, and includes them in the generated `entities.json`.

### Frontend (Dynamic Routing)
- The frontend router matches the current URL against all `routePattern` values in the config.
- Route params (e.g., `authorId`) are extracted and passed to the page component.
- API URLs in the config can use these params (e.g., `/admin/author/:authorId/books` → `/admin/author/123/books`).

## Defining a Custom Page

Here's an example of a custom list page for team members:

```typescript
// src/custom-pages/author-books.ts
import { ListPageConfig } from '@ten24group/fw24';

export const authorBooksPage: ListPageConfig = {
  pageTitle: 'Author Books',
  pageType: 'list',
  routePattern: '/author/:authorId/books', // Dynamic route
  listPageConfig: {
    apiConfig: {
      apiMethod: 'GET',
      responseKey: 'items',
      apiUrl: '/admin/author/:authorId/book', // :authorId will be replaced
    },
    propertiesConfig: [
      { name: 'id', dataIndex: 'id', fieldType: 'string', isIdentifier: true },
      { name: 'title', dataIndex: 'title', fieldType: 'string' },
      // ...
    ]
  }
};
```

## Dynamic Routes with `routePattern`
- Use `routePattern` to define dynamic segments (e.g., `/team/:teamId/users`).
- The frontend will match URLs like `/team/123/users` and extract `teamId = 123`.
- You can use as many params as needed (e.g., `/org/:orgId/team/:teamId/users`).

## API URL Parameterization
- In your page config, use the same param names in `apiUrl` as in `routePattern`.
- The frontend will replace them automatically when making API calls.
- Example:
  - `routePattern: '/team/:teamId/users'`
  - `apiUrl: '/admin/team/:teamId/user'`
  - Visiting `/team/123/users` will call `/admin/team/123/user`.

## Example: Team Members Page
```typescript
export const authorBooksPage: ListPageConfig = {
  pageTitle: 'Author Books',
  pageType: 'list',
  routePattern: '/author/:authorId/books',
  listPageConfig: {
    apiConfig: {
      apiMethod: 'GET',
      responseKey: 'items',
      apiUrl: '/admin/author/:authorId/book',
    },
    propertiesConfig: [
      { name: 'id', dataIndex: 'id', fieldType: 'string', isIdentifier: true },
      { name: 'title', dataIndex: 'title', fieldType: 'string' },
    ]
  }
};
```

## Best Practices & Tips
- **Keep configs type-safe:** Use the provided TypeScript interfaces for page configs.
- **Use descriptive param names:** Match param names in `routePattern` and `apiUrl`.
- **Leverage breadcrumbs and actions:** Custom pages support all standard config options (breadcrumbs, actions, etc).

## Adding Actions to Custom Pages (viewPageActions)

A key aspect of custom pages is the ability to add actions (buttons or dropdowns) to your page header. This is done using the `viewPageActions` property in your page config. Actions can link to other custom pages, entity pages, or trigger modals.

### Example: Adding Actions to an Author Details Page

Suppose you have a custom page for viewing an author's details, and you want to add a dropdown to quickly access related custom pages (like the author's books or awards):

```typescript
// src/custom-pages/author-details.ts
import { DetailsPageConfig } from '@ten24group/fw24';

export const authorDetailsPage: DetailsPageConfig = {
  pageTitle: 'Author Details',
  pageType: 'details',
  routePattern: '/author/:authorId',
  viewPageActions: [
    {
      type: 'dropdown',
      label: 'Actions',
      items: [
        {
          label: 'View Books',
          url: '/author/:authorId/books', // Link to custom books page for this author
        },
        {
          label: 'View Awards',
          url: '/author/:authorId/awards', // Another custom page
        },
      ]
    }
  ],
  detailsPageConfig: {
    detailApiConfig: {
      apiMethod: 'GET',
      responseKey: 'author',
      apiUrl: '/admin/author/:authorId',
    },
    propertiesConfig: [
      { name: 'id', label: 'ID', column: 'id', fieldType: 'string' },
      { name: 'name', label: 'Name', column: 'name', fieldType: 'string' },
      // ...
    ]
  }
};
```

### How It Works
- `viewPageActions` can be a button or a dropdown menu.
- Use the same route param names (e.g., `:authorId`) in the action URLs; these will be replaced with the current page's params.
- This enables users to quickly navigate between related custom pages or entity views.

### UI Result
- The page will show an "Actions" dropdown in the header, with links to "View Books" and "View Awards" for the current author.
- Clicking these will route the user to the corresponding custom page, with the correct `authorId` in the URL.

> **Note:** Adding `viewPageActions` to the entity schema (not just to custom pages) will also add these actions to the default built-in detail pages for that entity. This means your actions (buttons or dropdowns) will appear on both custom and standard detail pages, providing a consistent and powerful navigation experience throughout your admin UI.

---

For more advanced usage, see the source code in `src/ui-config-gen/` and the frontend router logic in your UI project.