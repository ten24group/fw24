import { DetailsPageConfig } from "../../../ui-config-gen";

export const searchIndexSettingsDetailsConfig: DetailsPageConfig = {
  pageTitle: "Search Index Settings",
  pageType: "details",
  routePattern: "/system/search/indices/:entityName/settings-details",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search" },
    { label: "Indices", url: "/system/search/indices" },
    { label: "Index Details", url: "/system/search/indices/:entityName" },
    { label: "Settings" }
  ],
  pageHeaderActions: [
    { 
      label: "Edit Settings", 
      url: "/system/search/indices/:entityName/settings-edit", 
      type: "button" 
    },
    {
      label: "Sync from Schema",
      openInModal: true,
      modalConfig: {
        modalType: "confirm",
        modalPageConfig: {
          title: "Sync Settings from Entity Schema",
          content: "This will update index settings to match your entity schema (searchable/filterable/sortable attributes). This will overwrite manually configured settings. Use this when you've updated your entity schema and want to sync those changes to the index."
        },
        apiConfig: {
          apiMethod: "POST",
          apiUrl: "/system/search/indices/:entityName/apply-default-settings"
        },
        responseConfig: {
          showModal: true,
          modalTitle: "Settings Synced from Schema"
        },
        submitSuccessRedirect: "/system/search/indices/:entityName/settings-details"
      }
    },
    {
      label: "Reset to Meilisearch Defaults",
      openInModal: true,
      modalConfig: {
        modalType: "confirm",
        modalPageConfig: {
          title: "Reset to Meilisearch Defaults",
          content: "This will reset all index settings to Meilisearch's default values (searchableAttributes: ['*'], filterableAttributes: [], etc.). Use this to clear all custom configuration. This action cannot be undone."
        },
        apiConfig: {
          apiMethod: "POST",
          apiUrl: "/system/search/indices/:entityName/reset-settings"
        },
        submitSuccessRedirect: "/system/search/indices/:entityName/settings-details"
      }
    },
  ],
  detailsPageConfig: {
    detailApiConfig: { 
      apiMethod: "GET", 
      apiUrl: "/system/search/indices/:entityName/settings" 
    },
    propertiesConfig: [
      {
        name: "status",
        label: "📊 Comparison Status",
        id: "status",
        column: "status",
        fieldType: "text",
        helpText: "Shows differences between current index settings and entity schema configuration. This is informational - manual changes to index settings are common and expected."
      }
    ],
    sectionsConfig: {
      renderMode: "tabs",
      lazyLoad: false,
      keepMounted: true,
      sections: {
        diff: {
          label: "🔍 Schema vs Index",
          sortOrder: 1,
          pageType: "details",
          detailsPageConfig: {
            useParentData: true,
            propertiesConfig: [
              { 
                name: "diff", 
                label: "Differences",
                id: "diff", 
                column: "diff", 
                fieldType: "json",
                helpText: "Comparison of searchable/filterable/sortable attributes. 'added' = fields in entity schema but not in index, 'removed' = fields in index but not in schema. Manual differences are normal if you've customized settings."
              }
            ]
          }
        },
        schema: {
          label: "📋 Default Settings",
          sortOrder: 2,
          pageType: "details",
          detailsPageConfig: {
            useParentData: true,
            propertiesConfig: [
              { 
                name: "schemaSettings", 
                label: "Schema-Derived Settings", 
                id: "schemaSettings", 
                column: "schemaSettings", 
                fieldType: "json",
                helpText: "Settings derived from your entity schema. These reflect what fields are marked as searchable/filterable/sortable in your code. Use 'Sync from Schema' if you want to apply these."
              }
            ]
          }
        },
        index: {
          label: "🎯 Live Settings",
          sortOrder: 3,
          pageType: "details",
          detailsPageConfig: {
            useParentData: true,
            propertiesConfig: [
              { 
                name: "settings", 
                label: "Current Index Settings", 
                id: "settings", 
                column: "settings", 
                fieldType: "json",
                helpText: "Complete settings currently active in your Meilisearch index. Includes both framework-managed fields and any manual Meilisearch-specific configuration you've added."
              }
            ]
          }
        }
      }
    }
  }
}; 