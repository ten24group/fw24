for both APIs and UI the user can fetch the record/s for certain high-level operations
either to-view the record, or to-edit the record, to delete the record, to create a new record, or to list the records.
- for viewable, the user can set the visibility of the field, and the values will be converted with display-masks/formats to view them
- for editable, the user can set the visibility of the filed along with some extra information like [validations, input-data-type: [string, number, json], input-control: [select, check-box, date-cal, ...], options, formats, masks, step, is-typeahead, isCreatable ], and the values will be raw to edit them
- either a single record can be fetched oe a list of records
- other than view and edit, the records can be fetched for other operations like delete, create, list
- for deletable only the identifier/s are required
- for create, just the fields meta is required like validations, field-type, options, masks, etc
- for listable, the user can set the visibility of the field in the listing along with if it is filterable, searchable, sortable, removable etc. list can be both viewable and editable.

view: user can set visibility of the field 
   -- view: true/false

edit: user can set the visibility of the filed along with some extra information
    -- edit: true/false | {
        isReadOnly: boolean
        validations: [required, minLength, maxLength, pattern, email, phone, url, ...]
        
        extra metadata for other field types like
          
        for date, time, date-time
        format: 'YYYY-MM-DD HH:mm:ss' | 'YYYY-MM-DD' | 'HH:mm:ss'
        
        for number
        step: 1
        
        for password, and other field types
        mask: '****' | '****-****' | '****-****-****' | '****-****-****-****'
        
        for select, multi-select, radio, checkbox
        
        // * for select, multi-select 
        isTypeahead: boolean, // to search the options
        isCreatable: boolean, // to create a new record for the options
        isMulti: boolean, // to select multiple options 
        options: Array<{value: string, label: string}> | some API config to fetch the options from
     }

list: true/false | {
    isSortable: boolean,
    isFilterable: boolean,
    isSearchable: boolean,
    isRemovable: boolean, // whether the user can remove the field from the listing
}



```ts

type DataType = 'string' | 'number' | 'json' | 'date' | 'time' | 'datetime';

interface FieldOption {
  value: string;
  label: string;
}

interface ListableMetadata {
  sortable?: boolean;
  filterable?: boolean;
  searchable?: boolean;
  removable?: boolean;
}

interface ListableContext {
  editable?: ListableMetadata;
  viewable?: ListableMetadata;
}

interface ConditionalValidation {
  dependsOn: string;
  validations: ('required' | 'minLength' | 'maxLength' | 'pattern' | 'email' | 'phone' | 'url')[];
}

interface BaseOperationMetadata {
  visible?: boolean;
  readOnly?: boolean;
  validations?: ('required' | 'minLength' | 'maxLength' | 'pattern' | 'email' | 'phone' | 'url')[];
  conditionalValidations?: ConditionalValidation[];
  dataType?: DataType;
  defaultValue?: any;
  helpText?: string;
  dependsOn?: string;
  group?: string;
  order?: number;
  listable?: true | false | ListableContext;
}

interface SelectOperationMetadata extends BaseOperationMetadata {
  inputControl: 'select';
  options: FieldOption[];
  typeahead?: boolean;
  creatable?: boolean;
}

interface TextOperationMetadata extends BaseOperationMetadata {
  inputControl: 'text';
  format?: string;
  mask?: string;
}

interface NumberOperationMetadata extends BaseOperationMetadata {
  inputControl: 'number';
  step?: number;
}

type OperationMetadata = SelectOperationMetadata | TextOperationMetadata | NumberOperationMetadata;

interface Field {
  name: string;
  metadata: OperationMetadata;
}

interface Entity {
  entityName: string;
  fields: Field[];
}
```


```ts
interface FieldMetadata {
  view: boolean | ViewableMetadata;
  edit: boolean | EditableMetadata;
  list: boolean | ListableMetadata;
}

interface ViewableMetadata {
  isVisible: boolean;
  dataType: 'string' | 'number' | 'date' | 'time' | 'datetime' | 'json';
  format?: string; // format depends on dataType
}

interface EditableMetadata {
  isVisible: boolean;
  isReadOnly: boolean;
  validations: ('required' | { type: 'minLength', value: number } | { type: 'maxLength', value: number } | { type: 'pattern', value: RegExp } | 'email' | 'phone' | 'url')[];
  dataType: 'string' | 'number' | 'json'; // Input data type
  inputControl: 'text' | 'textarea' | 'select' | 'multi-select' | 'checkbox' | 'radio' | 'date' | 'time' | 'datetime' | 'password'; // Input control type
  options?: Array<{value: string, label: string}> | APIOperation; // for select, multi-select, radio, checkbox
  format?: string; // for date, time, date-time
  step?: number; // for number
  mask?: string; // for password, and other field types
  placeholder?: string; // Placeholder text for input fields
  helpText?: string; // Help text for input fields
  defaultValue?: any; // Default value for input fields
  tooltip?: string; // Tooltip text for input fields
}

interface ListableMetadata {
  isVisible: boolean;
  isFilterable: boolean;
  isSearchable: boolean;
  isSortable: boolean;
  isRemovable: boolean;
}

// simple API operation;
interface APIOperation<TInp = any, Tout = any> {
    
    // not sure if we should care about the method here; as it only applies to HTTP req and we can expose these APIs on other transports
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    
    // can be some other namespace e.g. broker/path/ in case of MessageQueues or WebSockets
    endpoint: string; 
    
    // path can gave some placeholders defined like 'abc/{pqr}/{xyz}' and the params can be used to dynamically replace them
    pathParams?: string[]; 
    
    // the schema for the output of this operation
    output?: Tout;

    // the payload/input for the operation; 
    // [can be serialized to json [into req body, or into the payload of other transports like socket] or into req param in case of GET/DELETE http req]
    payload?: any;  
    // * in case of batch operations the payload can be an array of payloads, or it can be an object coupled with a query, and the same payload is shared among all items fetched by the query. use-cases can be like setting some statuses of a bunch of records by query.


    // query can be simple as record identifier and complex like some advance query dsl in case of complex/batched-operations
    // query may also consist of pagination, shape of the `select-records-graph` [fields, nested-relations, nested-fields of complex data types [ like objects, arrays, maps ], nested pagination, nested item's sorting, nested item's filters]
    // for selected/requested fields, if the field is a virtual field, the client can specify some values of the arguments for the attribute's getter function
    // additionally, the query now has 2 roles: 1- selecting the `records-graph` to perform an operation. 2- selecting `records-graph` to return to the client.
    // in the case when the query has the `select-records-graph`, the type of the output should be the same as the output of the query [hence the type of the output can be inferred]
    query?: any;
    // * when the query may fetch more than one record to perform operations or to return then the operation in a batch-operation
}

interface AdvanceOperation<TInp1 = any, Tout1 = any, TInp2 = any, Tout2 = any> {
    operation?: APIOperation<TInp1, Tout1>,
    preOperation?: APIOperation<TInp2, Tout2>,
}

interface ViewableOperation<T = any, U = any> extends APIOperation<T, U> {
    isViewable: true;
}

interface EditableOperation<T1 = any, U1 = any, T2 = any, U3 = any> extends AdvanceOperation<T1, U1, T2, U2> {
    payload?: TInp;
    isEditable: true;
}

interface DeletableOperation<T1 = any, U1 = any, T2 = any, U3 = any> extends AdvanceOperation<T1, U1, T2, U2> {
    isDeletable: true;
}

interface CreatableOperation<T1 = any, U1 = any, T2 = any, U3 = any> extends AdvanceOperation<T1, U1, T2, U2> {
    isCreatable: true;
}

```

```ts
// Sample entity
interface User {
  id: number;
  name: string;
  email: string;
  password: string;
  createdAt: Date;
  updatedAt: Date;
}

// API Model for the User entity
const UserAPIModel: APIModel = {
  id: {
    view: {
      isVisible: true,
      dataType: 'number',
    },
    edit: {
      isVisible: false,
      isReadOnly: true,
      dataType: 'number',
      inputControl: 'text',
    },
    list: {
      editable: {
        sortable: true,
        filterable: true,
        searchable: true,
        removable: false,
      },
      viewable: {
        sortable: true,
        filterable: true,
        searchable: true,
        removable: false,
      },
    },
  },
  name: {
    view: {
      isVisible: true,
      dataType: 'string',
    },
    edit: {
      isVisible: true,
      isReadOnly: false,
      dataType: 'string',
      inputControl: 'text',
      validations: ['required'],
    },
    list: {
      editable: {
        sortable: true,
        filterable: true,
        searchable: true,
        removable: true,
      },
      viewable: {
        sortable: true,
        filterable: true,
        searchable: true,
        removable: true,
      },
    },
  },
  email: {
    view: {
      isVisible: true,
      dataType: 'string',
    },
    edit: {
      isVisible: true,
      isReadOnly: false,
      dataType: 'string',
      inputControl: 'text',
      validations: ['required', 'email'],
    },
    list: {
      editable: {
        sortable: true,
        filterable: true,
        searchable: true,
        removable: true,
      },
      viewable: {
        sortable: true,
        filterable: true,
        searchable: true,
        removable: true,
      },
    },
  },
  password: {
    view: {
      isVisible: false,
      dataType: 'string',
    },
    edit: {
      isVisible: true,
      isReadOnly: false,
      dataType: 'string',
      inputControl: 'password',
      validations: ['required'],
      mask: '******',
    },
  },
  createdAt: {
    view: {
      isVisible: true,
      dataType: 'date',
      format: 'MM/DD/YYYY',
    },
    edit: {
      isVisible: false,
      isReadOnly: true,
      dataType: 'date',
      inputControl: 'text',
    },
    list: {
      editable: {
        sortable: true,
        filterable: true,
        searchable: false,
        removable: false,
      },
      viewable: {
        sortable: true,
        filterable: true,
        searchable: false,
        removable: false,
      },
    },
  },
  updatedAt: {
    view: {
      isVisible: true,
      dataType: 'date',
      format: 'MM/DD/YYYY',
    },
    edit: {
      isVisible: false,
      isReadOnly: true,
      dataType: 'date',
      inputControl: 'text',
    },
    list: {
      editable: {
        sortable: true,
        filterable: true,
        searchable: false,
        removable: false,
      },
      viewable: {
        sortable: true,
        filterable: true,
        searchable: false,
        removable: false,
      },
    },
  },
};
```

```ts

// simple API operation;
interface BaseAPIOperation<TInp = any, Tout = any> {
    
    // not sure if we should care about the method here; as it only applies to HTTP req and we can expose these APIs on other transports
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    
    // can be some other namespace e.g. broker/path/ in case of MessageQueues or WebSockets
    endpoint: string; 
    
    // path can gave some placeholders defined like 'abc/{pqr}/{xyz}' and the params can be used to dynamically replace them
    pathParams?: string[]; 
    
    // the schema for the output of this operation
    output?: Tout;

    // the payload/input for the operation; 
    // [can be serialized to json [into req body, or into the payload of other transports like socket] or into req param in case of GET/DELETE http req]
    payload?: any;  
    // * in case of batch operations the payload can be an array of payloads, or it can be an object coupled with a query, and the same payload is shared among all items fetched by the query. use-cases can be like setting some statuses of a bunch of records by query.


    // query can be simple as record identifier and complex like some advance query dsl in case of complex/batched-operations
    // query may also consist of pagination, shape of the `select-records-graph` [fields, nested-relations, nested-fields of complex data types [ like objects, arrays, maps ], nested pagination, nested item's sorting, nested item's filters]
    // for selected/requested fields, if the field is a virtual field, the client can specify some values of the arguments for the attribute's getter function
    // additionally, the query now has 2 roles: 1- selecting the `records-graph` to perform an operation. 2- selecting `records-graph` to return to the client.
    // in the case when the query has the `select-records-graph`, the type of the output should be the same as the output of the query [hence the type of the output can be inferred]
    query?: any;
    // * when the query may fetch more than one record to perform operations or to return then the operation in a batch-operation
}

// operations for which the user/client need to fetch some dynamic-data from the server and then prepare the payload
// these type of operations typically require some UI; and the UI can change shape/available options based on the actor's permissions/configurations
interface AdvanceOperation<TInp1 = any, Tout1 = any, TInp2 = any, Tout2 = any> {
    operation?: BaseAPIOperation<TInp1, Tout1>,
    preOperation?: BaseAPIOperation<TInp2, Tout2>,
}

// this type of operations will return the the data ready to display based on the definition of entity/field/relations, and some contexts like actor, locale, preferences, defaults and overrides, tenant specific stuff etc.
// the return data is formatted/translated like the date-formats, the address-display might need a single line with concat address fields, however to edit/create it the user might need extra info like which fields are required, which fields are editable, what are the validation rules, what input control, if it's a select type field then is it a multi-select, what are the options, or from where to fetch the options [like an API call with some criteria] etc.
interface ViewableOperation<T = any, U = any> extends BaseAPIOperation<T, U> {
    isViewable: true;
}

// editable operations can have an input schema as to edit/create record/s the user might need extra info like which fields are required, which fields are editable, what are the validation rules, what input control to render in the form, what's the grouping of the fields, if it's a select type field then is it a multi-select, what are the options, or from where to fetch the options [like an API call with some criteria] etc, if it's a date/time then what format, any disabled dates/time, and so on.
interface EditableOperation<T1 = any, U1 = any, T2 = any, U3 = any> extends AdvanceOperation<T1, U1, T2, U2> {
    inputSchema?: TInp;
    isEditable: true;
}

// the deletable operations are straight forward for teh most part;
// either user can delete one record, or a list of records, or delete by query/criteria
// for each record the system will perform checks to ensure the record is in deletable state and the actor has the permissions to do so; the permissions bit is true for all operations; user/actor can only fetch the records/fields they have permissions for, and can only update fields/records for which they have permissions for, and same goes for create/delete.
interface DeletableOperation<T1 = any, U1 = any, T2 = any, U3 = any> extends AdvanceOperation<T1, U1, T2, U2> {
    isDeletable: true;
}

// creatable operations are the ones which create record/s and just like everything these also support batching.
// create operations for a records can be like some OOPs class constructor, by default there's one one constructor however there can be more than one constructors, with different default values and different criteria.
interface CreatableOperation<T1 = any, U1 = any, T2 = any, U3 = any> extends AdvanceOperation<T1, U1, T2, U2> {
    isCreatable: true;
}

// TODO: figure out how to capture if the operation is a batch operation there can be multiple versions of batch operation
// - batch by query that returns some records
// - list of items[payloads] that are send by the client
// - single-object-payload and a query that returns items 
// - an array of payloads and their individual operations [user can run more than one operation in a single call]



// for select fields the developers can either define the options inline or the options can be resolved from some API.
// the API call can have criteria and the return options are subject to the actor's permissions. e.g. whether the actor can read entity, fields, records specified in the criteria
interface FieldOption {
  value: string;
  label: string;
}

interface ListableMetadata {
  sortable?: boolean;
  filterable?: boolean;
  searchable?: boolean;
  removable?: boolean;
}

interface BaseFieldMetadata {
  isVisible?: boolean; // if the field is visible or hidden for all operations
  isReadOnly?: boolean; // if the field is editable or readonly for all edit-operations
  dataType: DataType;
  placeholder?: string;
  helpText?: string;
  defaultValue?: any;
  tooltip?: string; // maybe this can be inferred from the helpText
  validations?: ('required' | { type: 'minLength', value: number } | { type: 'maxLength', value: number } | { type: 'pattern', value: RegExp } | 'email' | 'phone' | 'url')[];
  list?: ListableMetadata; // 
}

interface TextFieldMetadata extends BaseFieldMetadata {
  inputControl: 'text' | 'textarea' | 'password';
  maxLength?: number;
  mask?: string;
}

interface NumberFieldMetadata extends BaseFieldMetadata {
  inputControl: 'number';
  min?: number;
  max?: number;
  step?: number;
}

interface SelectFieldMetadata extends BaseFieldMetadata {
  inputControl: 'select' | 'multi-select';
  options: Array<FieldOption> | APIOperation;
}

type FieldMetadata = TextFieldMetadata | NumberFieldMetadata | SelectFieldMetadata;


```


Sure, here's an enhanced version of your design document with the suggestions we discussed:

# Enhanced Design Document

## API Operations

### BaseAPIOperation

This is a simple API operation. It includes the following properties:

- `method`: The HTTP method for the operation. This might not be necessary for all transports.
- `endpoint`: The endpoint for the operation. This could be a namespace in the case of MessageQueues or WebSockets.
- `pathParams`: These are placeholders in the path that can be dynamically replaced.
- `output`: The schema for the output of this operation.
- `payload`: The input for the operation. This can be serialized to JSON for the request body or into the payload of other transports like sockets. In the case of batch operations, the payload can be an array of payloads, or it can be an object coupled with a query, and the same payload is shared among all items fetched by the query.
- `query`: This can be as simple as a record identifier or as complex as an advanced query DSL for complex/batched operations. The query may also consist of pagination, the shape of the `select-records-graph`, and more. The query now has two roles: 1) selecting the `records-graph` to perform an operation, and 2) selecting `records-graph` to return to the client.

### AdvanceOperation

This type of operation is used when the client needs to fetch some dynamic data from the server and then prepare the payload. These operations typically require some UI, and the UI can change shape/available options based on the actor's permissions/configurations.

### ViewableOperation

This type of operation will return the data ready to display based on the definition of entity/field/relations, and some contexts like actor, locale, preferences, defaults and overrides, tenant specific stuff etc. The return data is formatted/translated.

### EditableOperation

Editable operations can have an input schema. To edit/create records, the user might need extra info like which fields are required, which fields are editable, what are the validation rules, what input control to render in the form, what's the grouping of the fields, and so on.

### DeletableOperation

The deletable operations are straightforward for the most part. Either user can delete one record, or a list of records, or delete by query/criteria. For each record, the system will perform checks to ensure the record is in a deletable state and the actor has the permissions to do so.

### CreatableOperation

Creatable operations are the ones which create records and just like everything these also support batching. Create operations for a records can be like some OOPs class constructor, by default there's one one constructor however there can be more than one constructors, with different default values and different criteria.

## Field Metadata

### BaseFieldMetadata

This is the base metadata for a field. It includes properties like `isVisible`, `isReadOnly`, `dataType`, `placeholder`, `helpText`, `defaultValue`, `tooltip`, `validations`, and `list`.

### TextFieldMetadata

This extends `BaseFieldMetadata` and includes properties specific to text fields, such as `inputControl`, `maxLength`, and `mask`.

### NumberFieldMetadata

This extends `BaseFieldMetadata` and includes properties specific to number fields, such as `inputControl`, `min`, `max`, and `step`.

### SelectFieldMetadata

This extends `BaseFieldMetadata` and includes properties specific to select fields, such as `inputControl` and `options`.

The `FieldMetadata` type is a union type that can be either `TextFieldMetadata`, `NumberFieldMetadata`, or `SelectFieldMetadata`.

## Future Considerations

- Figure out how to capture if the operation is a batch operation. There can be multiple versions of batch operation.
- For select fields, the developers can either define the options inline or the options can be resolved from some API. The API call can have criteria and the return options are subject to the actor's permissions.

## Enhancements

- Consider adding a `headers` property to the `BaseAPIOperation` to allow for custom headers to be set for the operation.
- For `AdvanceOperation`, consider adding a `postOperation` property for any cleanup or additional operations that need to be performed after the main operation.
- For `ViewableOperation`, consider adding a `format` property to allow for custom formatting of the returned data.
- For `EditableOperation`, consider adding a `validationSchema` property to allow for complex validation rules.
- For `DeletableOperation`, consider adding a `confirmDeletion` property to prompt the user for confirmation before deletion.
- For `CreatableOperation`, consider adding a `defaultValues` property to provide default values for the new record.
- For `BaseFieldMetadata`, consider adding a `label` property for a human-readable label of the field.
- For `TextFieldMetadata`, consider adding a `minLength` property to set a minimum length for the field.
- For `NumberFieldMetadata`, consider adding a `precision` property to set the number of decimal places.
- For `SelectFieldMetadata`, consider adding a `multiple` property to allow for multiple selections.



```ts

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface BaseAPIOperation<TInp = any, Tout = any> {
    method: Method;
    endpoint: string;
    pathParams?: string[];
    output?: Tout;
    payload?: any;
    query?: any;
}

interface OperationOptions<TInp1 = any, Tout1 = any, TInp2 = any, Tout2 = any> {
    operation?: BaseAPIOperation<TInp1, Tout1>,
    preOperation?: BaseAPIOperation<TInp2, Tout2>,
}

interface OperationFlags {
    isViewable?: boolean;
    isEditable?: boolean;
    isDeletable?: boolean;
    isCreatable?: boolean;
}

type APIOperation<TInp1 = any, Tout1 = any, TInp2 = any, Tout2 = any> = BaseAPIOperation<TInp1, Tout1> & OperationOptions<TInp1, Tout1, TInp2, Tout2> & OperationFlags;

interface FieldOption {
  value: string;
  label: string;
}

interface ListableMetadata {
  sortable?: boolean;
  filterable?: boolean;
  searchable?: boolean;
  removable?: boolean;
}

interface BaseFieldMetadata {
  isVisible?: boolean;
  isReadOnly?: boolean;
  dataType: DataType;
  placeholder?: string;
  helpText?: string;
  defaultValue?: any;
  tooltip?: string;
  validations?: ('required' | { type: 'minLength', value: number } | { type: 'maxLength', value: number } | { type: 'pattern', value: RegExp } | 'email' | 'phone' | 'url')[];
  list?: ListableMetadata;
}

interface TextFieldMetadata extends BaseFieldMetadata {
  inputControl: 'text' | 'textarea' | 'password';
  maxLength?: number;
  mask?: string;
}

interface NumberFieldMetadata extends BaseFieldMetadata {
  inputControl: 'number';
  min?: number;
  max?: number;
  step?: number;
}

interface SelectFieldMetadata extends BaseFieldMetadata {
  inputControl: 'select' | 'multi-select';
  options: Array<FieldOption> | APIOperation;
}

type FieldMetadata = TextFieldMetadata | NumberFieldMetadata | SelectFieldMetadata;
```




Sure, here's the consolidated document with the theory and examples:

# Enhanced Design Document

## API Operations

### BaseAPIOperation

This is a simple API operation. It includes the following properties:

```ts
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface BaseAPIOperation<TInp = any, Tout = any> {
    method: Method;
    endpoint: string;
    pathParams?: string[];
    output?: Tout;
    payload?: any;
    query?: any;
}
```

### OperationOptions

This type of operation is used when the client needs to fetch some dynamic data from the server and then prepare the payload. These operations typically require some UI, and the UI can change shape/available options based on the actor's permissions/configurations.

```ts
interface OperationOptions<TInp1 = any, Tout1 = any, TInp2 = any, Tout2 = any> {
    operation?: BaseAPIOperation<TInp1, Tout1>,
    preOperation?: BaseAPIOperation<TInp2, Tout2>,
}
```

### OperationFlags

This type of operation will return the data ready to display based on the definition of entity/field/relations, and some contexts like actor, locale, preferences, defaults and overrides, tenant specific stuff etc. The return data is formatted/translated.

```ts
interface OperationFlags {
    isViewable?: boolean;
    isEditable?: boolean;
    isDeletable?: boolean;
    isCreatable?: boolean;
}
```

### APIOperation

APIOperation is a combination of BaseAPIOperation, OperationOptions, and OperationFlags.

```ts
type APIOperation<TInp1 = any, Tout1 = any, TInp2 = any, Tout2 = any> = BaseAPIOperation<TInp1, Tout1> & OperationOptions<TInp1, Tout1, TInp2, Tout2> & OperationFlags;
```

## Field Metadata

### BaseFieldMetadata

This is the base metadata for a field. It includes properties like `isVisible`, `isReadOnly`, `dataType`, `placeholder`, `helpText`, `defaultValue`, `tooltip`, `validations`, and `list`.

```ts
interface BaseFieldMetadata {
  isVisible?: boolean;
  isReadOnly?: boolean;
  dataType: DataType;
  placeholder?: string;
  helpText?: string;
  defaultValue?: any;
  tooltip?: string;
  validations?: ('required' | { type: 'minLength', value: number } | { type: 'maxLength', value: number } | { type: 'pattern', value: RegExp } | 'email' | 'phone' | 'url')[];
  list?: ListableMetadata;
}
```

### TextFieldMetadata

This extends `BaseFieldMetadata` and includes properties specific to text fields, such as `inputControl`, `maxLength`, and `mask`.

```ts
interface TextFieldMetadata extends BaseFieldMetadata {
  inputControl: 'text' | 'textarea' | 'password';
  maxLength?: number;
  mask?: string;
}
```

### NumberFieldMetadata

This extends `BaseFieldMetadata` and includes properties specific to number fields, such as `inputControl`, `min`, `max`, and `step`.

```ts
interface NumberFieldMetadata extends BaseFieldMetadata {
  inputControl: 'number';
  min?: number;
  max?: number;
  step?: number;
}
```

### SelectFieldMetadata

This extends `BaseFieldMetadata` and includes properties specific to select fields, such as `inputControl` and `options`.

```ts
interface FieldOption {
  value: string;
  label: string;
}

interface SelectFieldMetadata extends BaseFieldMetadata {
  inputControl: 'select' | 'multi-select';
  options: Array<FieldOption> | APIOperation;
}
```

The `FieldMetadata` type is a union type that can be either `TextFieldMetadata`, `NumberFieldMetadata`, or `SelectFieldMetadata`.

```ts
type FieldMetadata = TextFieldMetadata | NumberFieldMetadata | SelectFieldMetadata;
```


Sure, here's the updated design with added comments for clarity:

```typescript
// HTTP methods
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

// Base structure for an API operation
interface BaseAPIOperation<TInp = any, Tout = any> {
    method: Method; // HTTP method
    endpoint: string; // API endpoint
    pathParams?: string[]; // Path parameters if any
    output?: Tout; // Expected output type
    payload?: any; // Payload for POST/PUT requests
    query?: any; // Query parameters if any
}

// Flags to control operation permissions
interface OperationFlags {
    isViewable?: boolean; // Can the user view the data?
    isEditable?: boolean; // Can the user edit the data?
    isDeletable?: boolean; // Can the user delete the data?
    isCreatable?: boolean; // Can the user create new data?
    isExportable?: boolean; // Can the user export the data?
}

// Interface for a batch operation based on a query
interface QueryBasedBatchOperation<TInp = any, Tout = any> extends BaseAPIOperation<TInp, Tout> {
    query: any; // Query that returns some records
}

// Interface for a batch operation based on a list of items
interface ListBasedBatchOperation<TInp = any, Tout = any> extends BaseAPIOperation<TInp, Tout> {
    items: TInp[]; // List of items[payloads] that are sent by the client
}

// Interface for a batch operation based on a single-object-payload and a query
interface SinglePayloadQueryBasedBatchOperation<TInp = any, Tout = any> extends BaseAPIOperation<TInp, Tout> {
    singlePayload: TInp; // Single-object-payload
    query: any; // Query that returns items
}

// Interface for a batch operation based on an array of payloads and their individual operations
interface IndividualOperationsBatchOperation<TInp = any, Tout = any> extends BaseAPIOperation<TInp, Tout> {
    operations: APIOperation<TInp, Tout>[]; // Array of payloads and their individual operations
}

// Union type for all types of batch operations
type BatchOperation<TInp = any, Tout = any> = QueryBasedBatchOperation<TInp, Tout> | ListBasedBatchOperation<TInp, Tout> | SinglePayloadQueryBasedBatchOperation<TInp, Tout> | IndividualOperationsBatchOperation<TInp, Tout>;


// API operation with metadata and operation flags
interface APIOperation<TInp1 = any, Tout1 = any> extends BaseAPIOperation<TInp1, Tout1>, OperationFlags {
    metadata?: {
        description?: string; // Description of the operation
        tags?: string[]; // Tags for categorization
    };
}

// Options for main and pre operations
interface OperationOptions<TInp1 = any, Tout1 = any, TInp2 = any, Tout2 = any> {
    mainOperation: APIOperation<TInp1, Tout1> | BatchAPIOperation<TInp1, Tout1>, // Main operation
    preOperation?: APIOperation<TInp2, Tout2> | BatchAPIOperation<TInp2, Tout2>, // Pre operation (optional)
}

// Possible data types for a field
type DataType = 'string' | 'number' | 'boolean' | 'date' | 'object';

// Metadata for listable fields
interface ListableMetadata {
  sortable?: boolean; // Can the field be sorted?
  filterable?: boolean; // Can the field be filtered?
  searchable?: boolean; // Can the field be searched?
  removable?: boolean; // Can the field be removed from the list?
}

// Display options for a field
interface DisplayOptions {
    displayName?: string; // Display name of the field
    format?: string; // Format of the field (e.g., date format)
}

// Base metadata for a field
interface BaseFieldMetadata {
  isVisible?: boolean; // Is the field visible?
  isReadOnly?: boolean; // Is the field read-only?
  dataType: DataType; // Data type of the field
  placeholder?: string; // Placeholder for the field
  helpText?: string; // Help text for the field
  defaultValue?: any; // Default value of the field
  tooltip?: string; // Tooltip for the field
  list?: ListableMetadata; // Listable metadata
  displayOptions?: DisplayOptions; // Display options
  dependsOn?: string; // Field dependency (optional)
}

// Metadata for a text field
interface TextFieldMetadata extends BaseFieldMetadata {
  inputControl: 'text' | 'textarea' | 'password'; // Type of text input
  maxLength?: number; // Maximum length of the field
  mask?: string; // Mask for the field (e.g., for password or phone number)
}

// Metadata for a number field
interface NumberFieldMetadata extends BaseFieldMetadata {
  inputControl: 'number'; // Type of number input
  min?: number; // Minimum value
  max?: number; // Maximum value
  step?: number; // Step value for increment/decrement
}

// Option for a select field
interface FieldOption {
  value: string; // Value of the option
  label: string; // Label of the option
}

// Metadata for a select field
interface SelectFieldMetadata extends BaseFieldMetadata {
  inputControl: 'select' | 'multi-select'; // Type of select input
  options?: Array<FieldOption>; // Options for the select field
  optionSource?: APIOperation; // Source of options if they are fetched from an API
}

// Field metadata can be one of TextFieldMetadata, NumberFieldMetadata, or SelectFieldMetadata
type FieldMetadata = TextFieldMetadata | NumberFieldMetadata | SelectFieldMetadata;
```

This design now includes detailed comments explaining each part of the design. This should help developers understand the design more clearly and reduce confusion.





Sure, let's consolidate everything for the API operation design. Here's the complete theory and comments:

```typescript

// Metadata for entity fields
// Possible data types for a field
type DataType = 'string' | 'number' | 'boolean' | 'date' | 'object';

// Metadata for listable fields
interface ListableMetadata {
  sortable?: boolean; // Can the field be sorted?
  filterable?: boolean; // Can the field be filtered?
  searchable?: boolean; // Can the field be searched?
  removable?: boolean; // Can the field be removed from the list?
}

// Display options for a field
interface DisplayOptions {
    displayName?: string; // Display name of the field
    format?: string; // Format of the field (e.g., date format)
}

// Base metadata for a field
interface BaseFieldMetadata {
  isVisible?: boolean; // Is the field visible?
  isReadOnly?: boolean; // Is the field read-only?
  dataType: DataType; // Data type of the field
  placeholder?: string; // Placeholder for the field
  helpText?: string; // Help text for the field
  defaultValue?: any; // Default value of the field
  tooltip?: string; // Tooltip for the field
  list?: ListableMetadata; // Listable metadata
  displayOptions?: DisplayOptions; // Display options
  dependsOn?: string; // Field dependency (optional)
}

// Metadata for a text field
interface TextFieldMetadata extends BaseFieldMetadata {
  inputControl: 'text' | 'textarea' | 'password'; // Type of text input
  maxLength?: number; // Maximum length of the field
  mask?: string; // Mask for the field (e.g., for password or phone number)
}

// Metadata for a number field
interface NumberFieldMetadata extends BaseFieldMetadata {
  inputControl: 'number'; // Type of number input
  min?: number; // Minimum value
  max?: number; // Maximum value
  step?: number; // Step value for increment/decrement
}

// Option for a select field
interface FieldOption {
  value: string; // Value of the option
  label: string; // Label of the option
}

// Metadata for a select field
interface SelectFieldMetadata extends BaseFieldMetadata {
  inputControl: 'select' | 'multi-select'; // Type of select input
  options?: Array<FieldOption>; // Options for the select field
  optionSource?: APIOperation; // Source of options if they are fetched from an API
}

// Field metadata can be one of TextFieldMetadata, NumberFieldMetadata, or SelectFieldMetadata
type FieldMetadata = TextFieldMetadata | NumberFieldMetadata | SelectFieldMetadata;

// Metadata for API operations
interface OperationMetadata {
    description?: string; // Description of the operation
    tags?: string[]; // Tags for categorization
    version?: string; // Version of the operation
    createdBy?: string; // Who created the operation
    createdAt?: Date; // When the operation was created
    lastUpdatedBy?: string; // Who last updated the operation
    lastUpdatedAt?: Date; // When the operation was last updated
    deprecated?: boolean; // Whether the operation is deprecated
    alternateOperation?: string; // An alternate operation if this operation is deprecated
}

// Base API operation interface
interface BaseAPIOperation<TInp = any, Tout = any> {
    path: string; // API path
    method: string; // HTTP method
    input: TInp; // Input type
    output: Tout; // Output type
    metadata?: OperationMetadata; // Metadata about the operation
}

// Simple API operation interface
interface SimpleAPIOperation<TInp = any, Tout = any> extends BaseAPIOperation<TInp, Tout> {}

// API operation with pre and post operations
interface PrePostAPIOperation<TInp = any, Tout = any> extends BaseAPIOperation<TInp, Tout> {
    preOperation?: SimpleAPIOperation; // Operation to be performed before the main operation
    postOperation?: SimpleAPIOperation; // Operation to be performed after the main operation
}

// Base interface for a batch operation
interface BaseBatchOperation<TInp = any, Tout = any> extends BaseAPIOperation<TInp, Tout> {
    operations: BaseAPIOperation<TInp, Tout>[]; // Array of operations to be performed in batch
}

// Batch operation for simple operations
interface SimpleBatchOperation<TInp = any, Tout = any> extends BaseBatchOperation<TInp, Tout> {}

// Batch operation for operations with pre and post operations
interface PrePostBatchOperation<TInp = any, Tout = any> extends BaseBatchOperation<TInp, Tout> {
    operations: PrePostAPIOperation<TInp, Tout>[]; // Array of operations with pre and post operations to be performed in batch
}

// APIOperation can be a simple operation, an operation with pre and post operations, a simple batch operation, or a batch operation with pre and post operations
type APIOperation<TInp = any, Tout = any> = SimpleAPIOperation<TInp, Tout> | PrePostAPIOperation<TInp, Tout> | SimpleBatchOperation<TInp, Tout> | PrePostBatchOperation<TInp, Tout>;
```

In this design, we have:

- `OperationMetadata`: This interface holds metadata about the operation, such as description, tags, version, creation and update information, and deprecation status.
- `BaseAPIOperation`: This is the base interface for all API operations. It includes the path, method, input and output types, and optional metadata.
- `SimpleAPIOperation`: This interface represents a simple operation. It extends `BaseAPIOperation`.
- `PrePostAPIOperation`: This interface represents an operation with pre and post operations. It extends `BaseAPIOperation` and includes optional pre and post operations.
- `BaseBatchOperation`: This is the base interface for batch operations. It extends `BaseAPIOperation` and includes an array of operations to be performed in batch.
- `SimpleBatchOperation`: This interface represents a batch of simple operations. It extends `BaseBatchOperation`.
- `PrePostBatchOperation`: This interface represents a batch of operations with pre and post operations. It extends `BaseBatchOperation` and includes an array of pre and post operations to be performed in batch.
- `APIOperation`: This type can be any of the operation interfaces: `SimpleAPIOperation`, `PrePostAPIOperation`, `SimpleBatchOperation`, or `PrePostBatchOperation`.








# Design Document

## Entity Fields Metadata

Entity fields are the properties or attributes of an entity. The metadata for these fields is defined using TypeScript interfaces and types.

### DataType

This is a union type that defines the possible data types for a field. It can be 'string', 'number', 'boolean', 'date', or 'object'.

```typescript
type DataType = 'string' | 'number' | 'boolean' | 'date' | 'object';
```

### ListableMetadata

This interface defines the metadata for listable fields. It includes properties like `sortable`, `filterable`, `searchable`, and `removable` which are all optional and of boolean type.

```typescript
interface ListableMetadata {
  sortable?: boolean; // Can the field be sorted?
  filterable?: boolean; // Can the field be filtered?
  searchable?: boolean; // Can the field be searched?
  removable?: boolean; // Can the field be removed from the list?
}
```

### DisplayOptions

This interface defines the display options for a field. It includes optional properties like `displayName` and `format`.

```typescript
interface DisplayOptions {
    displayName?: string; // Display name of the field
    format?: string; // Format of the field (e.g., date format)
}
```

### BaseFieldMetadata

This interface defines the base metadata for a field. It includes properties like `isVisible`, `isReadOnly`, `dataType`, `placeholder`, `helpText`, `defaultValue`, `tooltip`, `list`, `displayOptions`, and `dependsOn`.

```typescript
interface BaseFieldMetadata {
  isVisible?: boolean; // Is the field visible?
  isReadOnly?: boolean; // Is the field read-only?
  dataType: DataType; // Data type of the field
  placeholder?: string; // Placeholder for the field
  helpText?: string; // Help text for the field
  defaultValue?: any; // Default value of the field
  tooltip?: string; // Tooltip for the field
  list?: ListableMetadata; // Listable metadata
  displayOptions?: DisplayOptions; // Display options
  dependsOn?: string; // Field dependency (optional)
}
```

### TextFieldMetadata, NumberFieldMetadata, SelectFieldMetadata

These interfaces extend `BaseFieldMetadata` and add additional properties specific to their type. For example, `TextFieldMetadata` adds `inputControl`, `maxLength`, and `mask`.

```typescript
interface TextFieldMetadata extends BaseFieldMetadata {
  inputControl: 'text' | 'textarea' | 'password'; // Type of text input
  maxLength?: number; // Maximum length of the field
  mask?: string; // Mask for the field (e.g., for password or phone number)
}

interface NumberFieldMetadata extends BaseFieldMetadata {
  inputControl: 'number'; // Type of number input
  min?: number; // Minimum value
  max?: number; // Maximum value
  step?: number; // Step value for increment/decrement
}

interface SelectFieldMetadata extends BaseFieldMetadata {
  inputControl: 'select' | 'multi-select'; // Type of select input
  options?: Array<FieldOption>; // Options for the select field
  optionSource?: APIOperation; // Source of options if they are fetched from an API
}
```

### FieldMetadata

This is a union type of `TextFieldMetadata`, `NumberFieldMetadata`, and `SelectFieldMetadata`.

```typescript
type FieldMetadata = TextFieldMetadata | NumberFieldMetadata | SelectFieldMetadata;
```

## API Operations Metadata

API operations are the actions that can be performed on an entity. The metadata for these operations is defined using TypeScript interfaces.

### OperationMetadata

This interface defines the metadata for an API operation. It includes properties like `description`, `tags`, `version`, `createdBy`, `createdAt`, `lastUpdatedBy`, `lastUpdatedAt`, `deprecated`, and `alternateOperation`.

```typescript
interface OperationMetadata {
    description?: string; // Description of the operation
    tags?: string[]; // Tags for categorization
    version?: string; // Version of the operation
    createdBy?: string; // Who created the operation
    createdAt?: Date; // When the operation was created
    lastUpdatedBy?: string; // Who last updated the operation
    lastUpdatedAt?: Date; // When the operation was last updated
    deprecated?: boolean; // Whether the operation is deprecated
    alternateOperation?: string; // An alternate operation if this operation is deprecated
}
```

### BaseAPIOperation, SimpleAPIOperation, PrePostAPIOperation, BaseBatchOperation, SimpleBatchOperation, PrePostBatchOperation

These interfaces define the structure of different types of API operations. They include properties like `path`, `method`, `input`, `output`, `metadata`, `preOperation`, `postOperation`, and `operations`.

```typescript
interface BaseAPIOperation<TInp = any, Tout = any> {
    path: string; // API path
    method: string; // HTTP method
    input: TInp; // Input type
    output: Tout; // Output type
    metadata?: OperationMetadata; // Metadata about the operation
}

interface SimpleAPIOperation<TInp = any, Tout = any> extends BaseAPIOperation<TInp, Tout> {}

interface PrePostAPIOperation<TInp = any, Tout = any> extends BaseAPIOperation<TInp, Tout> {
    preOperation?: SimpleAPIOperation; // Operation to be performed before the main operation
    postOperation?: SimpleAPIOperation; // Operation to be performed after the main operation
}

interface BaseBatchOperation<TInp = any, Tout = any> extends BaseAPIOperation<TInp, Tout> {
    operations: BaseAPIOperation<TInp, Tout>[]; // Array of operations to be performed in batch
}

interface SimpleBatchOperation<TInp = any, Tout = any> extends BaseBatchOperation<TInp, Tout> {}

interface PrePostBatchOperation<TInp = any, Tout = any> extends BaseBatchOperation<TInp, Tout> {
    operations: PrePostAPIOperation<TInp, Tout>[]; // Array of operations with pre and post operations to be performed in batch
}
```

### APIOperation

This is a union type of `SimpleAPIOperation`, `PrePostAPIOperation`, `SimpleBatchOperation`, and `PrePostBatchOperation`.

```typescript
type APIOperation<TInp = any, Tout = any> = SimpleAPIOperation<TInp, Tout> | PrePostAPIOperation<TInp, Tout> | SimpleBatchOperation<TInp, Tout> | PrePostBatchOperation<TInp, Tout>;
```

These types and interfaces provide a flexible and extensible way to define the metadata for entity fields and API operations. They can be easily extended or modified to accommodate different requirements.




Sure, let's simplify the design by removing the post operations and provide detailed examples for each component.

```markdown
# Design Document

## Entity Fields Metadata

Entity fields are the properties or attributes of an entity. The metadata for these fields is defined using TypeScript interfaces and types.

### DataType

This is a union type that defines the possible data types for a field. It can be 'string', 'number', 'boolean', 'date', 'object', 'email', 'phone', or 'url'.

```typescript
type DataType = 'string' | 'number' | 'boolean' | 'date' | 'object' | 'email' | 'phone' | 'url';
```

Example:

```typescript
let fieldType: DataType = 'email';
```

### Field

This interface represents a field in an entity. It includes the field's name, type, validations, mask, default value, hint, and additional UI metadata.

```typescript
interface Field {
  name: string;
  type: DataType;
  validations: Validation[];
  mask: string;
  defaultValue: any;
  hint: string;
  isEditable: boolean;
  isVisible: boolean;
}
```

Example:

```typescript
let userField: Field = {
  name: 'email',
  type: 'email',
  validations: [{ type: 'required' }, { type: 'email' }],
  mask: '****',
  defaultValue: '',
  hint: 'Enter your email',
  isEditable: true,
  isVisible: true,
};
```

### RelationshipMetadata

This interface represents the metadata for a relationship between entities. It includes the related entity's name and the relationship type.

```typescript
interface RelationshipMetadata {
  entity: string;
  type: 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';
}
```

Example:

```typescript
let relationshipMetadata: RelationshipMetadata = {
  entity: 'Order',
  type: 'one-to-many',
};
```

## API Operations

API operations are defined using TypeScript interfaces and types. Each operation includes the path, method, input, output, and optional pre operations.

### BaseAPIOperation

This interface represents a base API operation. It includes the path, method, input, and output.

```typescript
interface BaseAPIOperation {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  input: any;
  output: any;
  error?: any; // Optional error handling
}
```

Example:

```typescript
let baseOperation: BaseAPIOperation = {
  path: '/users',
  method: 'GET',
  input: {},
  output: 'User[]',
};
```

### PreAPIOperation

This interface represents an API operation with a pre operation. It extends `BaseAPIOperation` and includes an optional pre operation.

```typescript
interface PreAPIOperation extends BaseAPIOperation {
  preOperation?: BaseAPIOperation;
}
```

Example:

```typescript
let preOperation: PreAPIOperation = {
  path: '/users/{id}',
  method: 'PUT',
  input: 'User',
  output: 'User',
  preOperation: baseOperation,
};
```

### BaseBatchOperation

This interface represents a base batch operation. It includes the path, method, input, output, and an array of operations to be performed in batch.

```typescript
interface BaseBatchOperation extends BaseAPIOperation {
  operations: BaseAPIOperation[];
  pagination?: { page: number, size: number }; // Optional pagination
  sorting?: { field: string, order: 'asc' | 'desc' }; // Optional sorting
}
```

Example:

```typescript
let baseBatchOperation: BaseBatchOperation = {
  path: '/batch',
  method: 'POST',
  input: 'any',
  output: 'any',
  operations: [baseOperation, preOperation],
  pagination: { page: 1, size: 10 },
  sorting: { field: 'name', order: 'asc' },
};
```

### APIOperation

This type can be any of the operation interfaces: `BaseAPIOperation`, `PreAPIOperation`, or `BaseBatchOperation`.

Example:

```typescript
let apiOperation: APIOperation = baseBatchOperation;
```
```

This design includes the enhancements for DataType, Field, RelationshipMetadata, BaseAPIOperation, and BaseBatchOperation. It also includes additional comments for better documentation.


I see, thank you for the clarification. Let's redefine the batch operation to reflect these requirements. Here's the updated design:

```markdown
## API Operations

### BaseAPIOperation

This interface represents a base API operation. It includes the path, method, input, output, and an optional pre-operation.

```typescript
interface BaseAPIOperation<TInput = any, TOutput = any> {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  input: TInput;
  output: TOutput;
  error?: Error;
  preOperation?: BaseAPIOperation<TInput, TOutput>;
}
```

### BatchOperation

This interface represents a batch operation. It can be a list of API operations, a payload of items for a single operation, or a query to perform an operation. It can also have a payload that is shared by all items returned by the query.

```typescript
interface BatchOperation<TInput = any, TOutput = any> extends BaseAPIOperation<TInput, TOutput> {
  operations?: BaseAPIOperation[];
  payload?: any;
  query?: any;
}
```

### APIOperation

This type can be any of the operation interfaces: `BaseAPIOperation` or `BatchOperation`.

```typescript
type APIOperation<TInput = any, TOutput = any> = BaseAPIOperation<TInput, TOutput> | BatchOperation<TInput, TOutput>;
```

This design includes the enhancements for BaseAPIOperation, BatchOperation, and APIOperation. It also includes additional comments for better documentation.