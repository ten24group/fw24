import { ListPageConfig } from "../../../ui-config-gen";

export const searchIndicesConfig: ListPageConfig = {
  pageTitle: "Search Indices",
  pageType: "list",
  routePattern: "/system/search/indices",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search" },
    { label: "Indices" }
  ],
  pageHeaderActions: [
    {
      label: "Initialize All Indices",
      openInModal: true,
      modalConfig: {
        modalType: "confirm",
        modalPageConfig: {
          title: "Are you sure you want to initialize all indices?",
        },
        apiConfig: {
          apiMethod: "POST",
          responseKey: "message",
          apiUrl: "/system/search/initIndices"
        },
        submitSuccessRedirect: "/system/search/indices"
      }
    }
  ],
  listPageConfig: {
    apiConfig: { apiMethod: "GET", responseKey: "indices", apiUrl: "/system/search/indices" },
    propertiesConfig: [
      {
        name: "Entity Name",
        dataIndex: "entityName",
        id: "entityName",
        fieldType: "text",
        isListable: true,
        isIdentifier: true,
        actions: [
          { icon: "view", label: "Details", url: "/system/search/indices/:entityName" }
        ]
      },
      { name: "Index Name", dataIndex: "indexName", id: "indexName", fieldType: "text", isListable: true },
      { name: "Primary Key", dataIndex: "primaryKey", id: "primaryKey", fieldType: "text", isListable: true },
      { name: "Created At", dataIndex: "createdAt", id: "createdAt", fieldType: "datetime", isListable: true },
      { name: "Updated At", dataIndex: "updatedAt", id: "updatedAt", fieldType: "datetime", isListable: true },
      { name: "Error", dataIndex: "error", id: "error", fieldType: "text", isListable: true }

    ]
  }
};