import { FormPageConfig } from "../../../ui-config-gen";

export const searchUpdateDocumentsPage: FormPageConfig = {
  pageTitle: "Update Documents",
  pageType: "form",
  routePattern: "/system/search/records/:entityName/update-documents",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search/indices" },
    { label: "Update Documents" }
  ],
  formPageConfig: {
    apiConfig: { apiMethod: "PUT", responseKey: "", apiUrl: "/system/search/records/:entityName" },
    formButtons: [ "Update" ],
    propertiesConfig: [
      { name: "documents", label: "Documents (JSON array of objects)", id: "documents", column: "1", fieldType: "textarea", defaultValue: "[{ \"id\": \"doc1\", \"field\": \"value\" }]" }
    ],
    submitSuccessRedirect: "/system/search/records/:entityName"
  }
}; 