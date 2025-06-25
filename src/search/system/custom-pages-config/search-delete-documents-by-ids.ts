import { FormPageConfig } from "../../../ui-config-gen";

export const searchDeleteDocumentsByIdsPage: FormPageConfig = {
  pageTitle: "Delete Documents by IDs",
  pageType: "form",
  routePattern: "/system/search/records/:entityName/delete-by-ids",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search/indices" },
    { label: "Delete by IDs" }
  ],
  formPageConfig: {
    apiConfig: { apiMethod: "DELETE", responseKey: "", apiUrl: "/system/search/records/:entityName/by-ids" },
    formButtons: [ "Delete" ],
    propertiesConfig: [
      {
        name: "ids", label: "IDs (JSON array)", id: "ids", column: "1", fieldType: "textarea", defaultValue: "[\"id1\", \"id2\"]"
      }
    ],
    submitSuccessRedirect: "/system/search/records/:entityName"
  }
}; 