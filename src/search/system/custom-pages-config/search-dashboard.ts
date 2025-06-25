import { DashboardPageConfig } from "../../../ui-config-gen";

export const searchDashboardPage: DashboardPageConfig = {
  pageTitle: "Search Dashboard",
  pageType: "dashboard",
  routePattern: "/system/search",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search Dashboard" }
  ],
  dashboardPageConfig: {
    widgets: [
      {
        type: 'actions',
        title: 'Search Management',
        colSpan: 4,
        options: {
          actions: [
            { label: 'Search Indices', url: '/system/search/indices' },
            { label: 'Searchable Entities', url: '/system/search/entities' },
            { label: 'Initialize All Indices', url: '/system/search/initIndices' }
          ]
        }
      },
      {
        type: 'actions',
        title: 'MeiliSearch Engine',
        colSpan: 4,
        options: {
          actions: [
            { label: 'Engine Stats', url: '/system/search/meili/stats' },
            { label: 'Health Status', url: '/system/search/meili/health' },
            { label: 'Version Info', url: '/system/search/meili/version' },
            { label: 'API Keys', url: '/system/search/meili/api-keys' },
            { label: 'Tasks', url: '/system/search/meili/tasks' }
          ]
        }
      },
      {
        type: 'actions',
        title: 'Advanced Operations',
        colSpan: 4,
        options: {
          actions: [
            { label: 'Create Dump', url: '/system/search/meili/dumps' },
            { label: 'Create Snapshot', url: '/system/search/meili/snapshots' },
            { label: 'Swap Indices', url: '/system/search/meili/indices/swap' },
            { label: 'Multi-Search', url: '/system/search/meili/multi-search' },
            { label: 'Experimental Features', url: '/system/search/meili/experimental-features' }
          ]
        }
      }
    ]
  }
}; 