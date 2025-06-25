import { FormPageConfig } from "../../../ui-config-gen";

export const searchDeleteTasksConfig: FormPageConfig = {
  pageTitle: "Delete Tasks",
  pageType: "form",
  routePattern: "/system/search/meili/tasks/delete",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search" },
    { label: "Tasks", url: "/system/search/meili/tasks" },
    { label: "Delete Tasks" }
  ],
  formPageConfig: {
    apiConfig: { apiMethod: "DELETE", responseKey: "", apiUrl: "/system/search/meili/tasks" },
    formButtons: [ "Delete Tasks", { text: "Back", url: "/system/search/meili/tasks" } ],
    propertiesConfig: [
      {
        name: "uids",
        label: "Task UIDs (JSON array)",
        id: "uids",
        column: "1",
        fieldType: "textarea",
        defaultValue: "[12345, 67890]"
      }
    ],
    submitSuccessRedirect: "/system/search/meili/tasks"
  }
}; 