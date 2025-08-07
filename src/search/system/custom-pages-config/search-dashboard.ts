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
        type: 'description',
        title: 'Engine Health',
        colSpan: 4,
        dataConfig: {
          apiUrl: '/system/search/is-healthy',
          apiMethod: 'GET'
        },
        options: {
          bordered: true,
          size: 'small',
          items: [
            { key: 'isHealthy', label: 'Is Healthy' }
          ]
        }
      },
      {
        type: 'description',
        title: 'Engine Version',
        colSpan: 4,
        dataConfig: {
          apiUrl: '/system/search/version',
          apiMethod: 'GET'
        },
        options: {
          bordered: true,
          size: 'small',
          items: [
            { key: 'pkgVersion', label: 'Version' },
            { key: 'commitSha', label: 'Commit SHA' },
            { key: 'commitDate', label: 'Commit Date' },
            { key: 'pkgName', label: 'Package Name' }
          ]
        }
      },
      {
        type: 'actions',
        title: 'Search Management',
        colSpan: 4,
        options: {
          actions: [
            { label: 'Search Indices', url: '/system/search/indices' },
            { label: 'Searchable Entities', url: '/system/search/entities' },
            { label: 'View Tasks', url: '/system/search/tasks' },
            { label: 'View Batches', url: '/system/search/batches' },
            { label: 'View API Keys', url: '/system/search/api-keys' },
          ]
        }
      },
      {
        type: 'actions',
        title: 'Advanced Operations',
        colSpan: 4,
        options: {
          actions: [
            { 
              label: 'Swap Indices', 
              openInModal: true,
              modalConfig: {
                modalType: "form",
                modalPageConfig: {
                  title: "Swap Indices",
                  formButtons: ["Swap"],
                  propertiesConfig: [
                    {
                      name: "swaps",
                      label: "Index Pairs (JSON array)",
                      fieldType: "textarea",
                      defaultValue: "[[\"index1\",\"index2\"]]"
                    }
                  ]
                },
                apiConfig: {
                  apiMethod: "POST",
                  apiUrl: "/system/search/indices/swap"
                },
                submitSuccessRedirect: "/system/search/tasks"
              }
            },
            { label: 'Experimental Features', url: '/system/search/experimental-features' },
            { 
              label: 'Create Dump', 
              openInModal: true,
              modalConfig: {
                modalType: "confirm",
                modalPageConfig: {
                  title: "Create Database Dump",
                  content: "This will create a full database dump. This operation may take some time."
                },
                apiConfig: {
                  apiMethod: "POST",
                  apiUrl: "/system/search/dumps"
                },
                submitSuccessRedirect: "/system/search/tasks/:taskUid"
              }
            },
            { 
              label: 'Create Snapshot', 
              openInModal: true,
              modalConfig: {
                modalType: "confirm",
                modalPageConfig: {
                  title: "Create Database Snapshot",
                  content: "This will create a database snapshot. This operation may take some time. Note: Snapshot functionality requires Meilisearch to be configured with snapshot support."
                },
                apiConfig: {
                  apiMethod: "POST",
                  apiUrl: "/system/search/snapshots"
                },
                submitSuccessRedirect: "/system/search/tasks/:taskUid",
              }
            }
          ]
        }
      },
      {
        type: 'description',
        title: 'Database Statistics',
        colSpan: 4,
        dataConfig: {
          apiUrl: '/system/search/stats',
          apiMethod: 'GET'
        },
        options: {
          bordered: true,
          size: 'small',
          items: [
            { key: 'databaseSize', label: 'Database Size' },
            { key: 'lastUpdate', label: 'Last Update' },
            { key: 'indexes', label: 'Total Indexes' }
          ]
        }
      }
    ]
  }
}; 