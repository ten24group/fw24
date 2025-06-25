import { FormPageConfig } from "../../../ui-config-gen";

export const meiliSearchMultiSearchPage: FormPageConfig = {
  pageTitle: "Multi-Search",
  pageType: "form",
  routePattern: "/system/search/meili/multi-search",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search/indices" },
    { label: "Multi-Search" }
  ],
  formPageConfig: {
    apiConfig: { apiMethod: "POST", responseKey: "", apiUrl: "/system/search/meili/multi-search" },
    formButtons: [ "Search" ],
    propertiesConfig: [
      {
        name: "queries",
        label: "Queries (JSON array of objects)",
        id: "queries",
        column: "1",
        fieldType: "textarea",
        defaultValue: "[{ \"indexUid\": \"books\", \"query\": \"harry potter\" }]"
      }
    ],
    submitSuccessRedirect: "/system/search/meili/multi-search"
  }
}; 