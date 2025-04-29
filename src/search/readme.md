**Overview**

The search integration allows entities in the system to be indexed and queried using a pluggable and configurable search engine. It is designed to support multiple search providers while offering flexible configuration options at the entity level.

## **Key Features**

1. **Entity-Level Search Configuration**:
   - Enables custom search configurations for specific entities.
   - Allows defining searchable and filterable attributes.
2. **Pluggable Search Engines**:
   - Supports multiple search providers (e.g., MeiliSearch).
   - Default and custom search engines can be registered.
3. **Extensibility**:
   - Support for custom search services and document transformations.
4. **API Endpoints**:
   - `POST /search` for structured query execution.
   - `GET /search` for simple parameterized searches.

---

## **Configuration**

### **1. Enabling Search for an Entity**

To configure search for an entity, update its schema with a `search` configuration:

```typescript name=entity-schema.ts
const schema = {
  model: {
    search: {
      enabled: true, // Enable search for this entity
      config: {
        provider: "meili", // Search engine provider
        indexName: "my-entity-index", // Index name in the search engine
        settings: {
          searchableAttributes: ["name", "description"], // Attributes that can be searched
          filterableAttributes: ["category", "status"], // Attributes that can be filtered
        },
      },
      serviceClass: MyCustomSearchService, // Optional: Custom search service class
      documentTransformer: (entity) => ({
        ...entity,
        fullName: `${entity.firstName} ${entity.lastName}`, // Custom field transformation
      }),
    },
  },
};
```

### **2. Setting Up the Dependency Injection (DI)**

The DI container is used to manage and resolve search engine instances.

```typescript name=di-setup.ts
import { DIContainer } from "./di/container";
import { MeiliSearchEngine } from "./search/engines/meili/engine";

const container = new DIContainer();

// Register the search engine
container.setSearchEngine(
  new MeiliSearchEngine({
    provider: "meili",
    indexName: "global-index",
  })
);
```

---

## **API Endpoints**

The search functionality introduces the following endpoints in the `BaseEntityController`:

### **1. `POST /search`**

Executes a search query with a structured request body.

**Example Request**:

```bash
POST /entities/search
Content-Type: application/json

{
  "search": "example",
  "filters": {
    "category": "electronics",
    "status": "active"
  },
  "pagination": {
    "count": 10,
    "pages": 1
  }
}
```

**Example Response**:

```json
{
  "items": [
    { "id": 1, "name": "Example Item 1" },
    { "id": 2, "name": "Example Item 2" }
  ],
  "facets": {
    "category": ["electronics", "furniture"],
    "status": ["active", "inactive"]
  },
  "total": 100,
  "page": 1,
  "hitsPerPage": 10,
  "processingTimeMs": 5
}
```

### **2. `GET /search`**

Executes a search query using query parameters.

**Example Request**:

```bash
GET /entities/search?q=example&hitsPerPage=10&page=1&filters[category]=electronics
```

**Example Response**:

```json
{
  "items": [
    { "id": 1, "name": "Example Item 1" },
    { "id": 2, "name": "Example Item 2" }
  ],
  "facets": {
    "category": ["electronics", "furniture"],
    "status": ["active", "inactive"]
  },
  "total": 100,
  "page": 1,
  "hitsPerPage": 10,
  "processingTimeMs": 5
}
```

---

## **Custom Search Service**

Developers can implement custom search services by extending the `BaseSearchService`:

```typescript name=custom-search-service.ts
import { BaseSearchService } from "../search/services/base";

class MyCustomSearchService extends BaseSearchService {
  async search(query, ctx) {
    // Custom search logic
    const results = await this.searchEngine.search(query);
    return results;
  }
}
```

---

## **Validation**

### **Search Configuration Validation**

The `BaseEntityService` ensures that the search configuration is valid:

- A `provider` and `indexName` must be specified.
- Searchable and filterable attributes must exist in the entity schema.

### **Error Handling**

Common errors include:

- **Missing Provider**:

  ```text
  Error: Search configuration must specify a provider. Example: { provider: "meili", indexName: "my-index" }
  ```

- **Invalid Attributes**:

  ```text
  Error: Invalid searchable attributes: [attributeName]. Ensure these attributes are defined in your EntitySchema.
  ```

---

## **Extensibility**

### **Adding a New Search Engine**

Add a new search engine by implementing the `ISearchEngine` interface:

```typescript name=custom-search-engine.ts
import { ISearchEngine } from "../search";

class MySearchEngine implements ISearchEngine {
  constructor(config) {
    this.config = config;
  }

  async search(query) {
    // Custom search logic
  }
}
```
