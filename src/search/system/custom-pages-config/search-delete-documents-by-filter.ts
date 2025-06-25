import { FormPageConfig } from "../../../ui-config-gen";

export const searchDeleteDocumentsByFilterPage: FormPageConfig = {
  pageTitle: "Delete Documents by Filter",
  pageType: "form",
  routePattern: "/system/search/records/:entityName/delete-by-filter",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search/indices" },
    { label: "Delete by Filter" }
  ],
  formPageConfig: {
    apiConfig: { apiMethod: "DELETE", responseKey: "", apiUrl: "/system/search/records/:entityName/by-filter" },
    formButtons: [ "Delete" ],
    propertiesConfig: [
      {
        name: "filter", label: "Filter (JSON)", id: "filter", column: "1", fieldType: "textarea", defaultValue: "{ \"status\": \"active\" }"
      }
    ],
    submitSuccessRedirect: "/system/search/records/:entityName"
  }
}; 