import { DetailsPageConfig } from "../../../ui-config-gen";

export const searchIndexSettingsDetailsConfig: DetailsPageConfig = {
  pageTitle: "Search Index Settings Details",
  pageType: "details",
  routePattern: "/system/search/indices/:entityName/settings-details",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search" },
    { label: "Indices", url: "/system/search/indices" },
    { label: "Index Details", url: "/system/search/indices/:entityName" },
    { label: "Settings Details" }
  ],
  pageHeaderActions: [
    { 
      label: "Edit Settings", 
      url: "/system/search/indices/:entityName/settings-edit", 
      type: "button" 
    },
    {
      label: "Reset Settings",
      openInModal: true,
      modalConfig: {
        modalType: "confirm",
        modalPageConfig: {
          title: "Reset Index Settings",
          content: "This will reset all index settings to their default values. This action cannot be undone."
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
        name: "settings", 
        label: "Displayed Attributes", 
        id: "settings", 
        column: "settings", 
        fieldType: "json" 
      }
    ]
  }
}; 