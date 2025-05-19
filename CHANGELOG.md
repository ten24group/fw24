# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [1.0.1](https://github.com/ten24group/fw24/compare/v1.0.0...v1.0.1) (2025-05-19)

## [1.0.0](https://github.com/ten24group/fw24/compare/v0.1.1-beta.25...v1.0.0) (2025-05-12)

### [0.1.1-beta.25](https://github.com/ten24group/fw24/compare/v0.1.1-beta.24...v0.1.1-beta.25) (2025-05-09)

### [0.1.1-beta.24](https://github.com/ten24group/fw24/compare/v0.1.1-beta.23...v0.1.1-beta.24) (2025-05-01)

### [0.1.1-beta.23](https://github.com/ten24group/fw24/compare/v0.1.1-beta.22...v0.1.1-beta.23) (2025-04-30)

### [0.1.1-beta.22](https://github.com/ten24group/fw24/compare/v0.1.1-beta.21...v0.1.1-beta.22) (2025-04-29)

### [0.1.1-beta.21](https://github.com/ten24group/fw24/compare/v0.1.1-beta.20...v0.1.1-beta.21) (2025-04-28)

### [0.1.1-beta.20](https://github.com/ten24group/fw24/compare/v0.1.1-beta.19...v0.1.1-beta.20) (2025-04-23)

### [0.1.1-beta.19](https://github.com/ten24group/fw24/compare/v0.1.1-beta.18...v0.1.1-beta.19) (2025-04-22)

### [0.1.1-beta.18](https://github.com/ten24group/fw24/compare/v0.1.1-beta.17...v0.1.1-beta.18) (2025-04-17)

### [0.1.1-beta.17](https://github.com/ten24group/fw24/compare/v0.1.1-beta.16...v0.1.1-beta.17) (2025-04-14)

### [0.1.1-beta.16](https://github.com/ten24group/fw24/compare/v0.1.1-beta.15...v0.1.1-beta.16) (2025-04-07)

### [0.1.1-beta.15](https://github.com/ten24group/fw24/compare/v0.1.1-beta.14...v0.1.1-beta.15) (2025-04-01)

### [0.1.1-beta.14](https://github.com/ten24group/fw24/compare/v0.1.1-beta.13...v0.1.1-beta.14) (2025-03-28)

### [0.1.1-beta.13](https://github.com/ten24group/fw24/compare/v0.1.1-beta.12...v0.1.1-beta.13) (2025-03-26)

### [0.1.1-beta.12](https://github.com/ten24group/fw24/compare/v0.1.1-beta.11...v0.1.1-beta.12) (2025-03-14)


### Bug Fixes

* failing fw24 tests ([deb2fa3](https://github.com/ten24group/fw24/commit/deb2fa34271db41e1d441fb5bce413869c3c993b))
* failing-test for inferRelationshipsForEntitySelections ([0cbeb62](https://github.com/ten24group/fw24/commit/0cbeb62ba1508d73c025d37aacb7165693218742))

### [0.1.1-beta.11](https://github.com/ten24group/fw24/compare/v0.1.1-beta.10...v0.1.1-beta.11) (2025-03-12)


### Bug Fixes

* error handling ([dbcd8d5](https://github.com/ten24group/fw24/commit/dbcd8d5cd131321eb468c468bdbc0f4e23b7f15c))

### [0.1.1-beta.10](https://github.com/ten24group/fw24/compare/v0.1.1-beta.9...v0.1.1-beta.10) (2025-03-10)


### Bug Fixes

* entity-attributes nit showing up in UI ([101d822](https://github.com/ten24group/fw24/commit/101d82216c4b944da9b985a9a326081cbbe75ba2))
* logic to resolve environmentVariables for lambdas ([8c14759](https://github.com/ten24group/fw24/commit/8c147590f622e406554982161f5c37ca0a369f48))

### [0.1.1-beta.9](https://github.com/ten24group/fw24/compare/v0.1.1-beta.7...v0.1.1-beta.9) (2025-02-28)

### [0.1.1-beta.6](https://github.com/ten24group/fw24/compare/v0.1.1-beta.5...v0.1.1-beta.6) (2025-02-21)

### [0.1.1-beta.5](https://github.com/ten24group/fw24/compare/v0.1.1-beta.4...v0.1.1-beta.5) (2025-02-06)

### [0.1.1-beta.8](https://github.com/ten24group/fw24/compare/v0.1.1-beta.7...v0.1.1-beta.8) (2025-02-28)

### [0.1.1-beta.7](https://github.com/ten24group/fw24/compare/v0.1.1-beta.4...v0.1.1-beta.7) (2025-02-28)


### Bug Fixes

* base-entity-controller's dependency on entity name when services are injected lazily ([286feb3](https://github.com/ten24group/fw24/commit/286feb338ba2a197d8aa11aea5348dcf7c17c71e))
* base-entity-service inferRelationshipsForEntitySelections to handle circular relation, and Fix: issues in registerEntitySchema ([b03fa55](https://github.com/ten24group/fw24/commit/b03fa554b549fff68564744de52c2e1bd9eb4661))
* compilation issue in ui-config-gen ([eec6891](https://github.com/ten24group/fw24/commit/eec6891aad82254e5e45cd1e6ac4d2a16fd8dc53))
* DI-container's registerProvider function to consider the provider type and entity ([c9e26d3](https://github.com/ten24group/fw24/commit/c9e26d3e365841675617c89ca0f5ccc9c68faccf))
* hard-error when env-key value is missing ([cd1e2f1](https://github.com/ten24group/fw24/commit/cd1e2f1d97e70632af64da50dfd9d2795328ceb9))
* InjectEntitySchema/Service decorators not registering right metadata and leading ro error ([3f01c05](https://github.com/ten24group/fw24/commit/3f01c05e4896e5de10436f4a78997cac02ad9252))
* resolveEntitySchema/Service methods not working properly due to token mismatch, even though token shouldn't matter in these methods ([ecad272](https://github.com/ten24group/fw24/commit/ecad27231c0cd541e2110c318414e485b9c46b61))
* type in @InjectEntitySchema ([f242852](https://github.com/ten24group/fw24/commit/f24285215a3c5d19a815e7d40204e4689f9d5c9b))
* wrong key in relation metadata in BaseEntityService: entityAttributeToIOSchemaAttribute leading to errors ([32b5a4a](https://github.com/ten24group/fw24/commit/32b5a4acad3e89bf98e3bbc7e55ca00d4653bb31))

### [0.1.1-beta.6](https://github.com/ten24group/fw24/compare/v0.1.1-beta.4...v0.1.1-beta.6) (2025-02-28)


### Bug Fixes

* base-entity-controller's dependency on entity name when services are injected lazily ([286feb3](https://github.com/ten24group/fw24/commit/286feb338ba2a197d8aa11aea5348dcf7c17c71e))
* base-entity-service inferRelationshipsForEntitySelections to handle circular relation, and Fix: issues in registerEntitySchema ([b03fa55](https://github.com/ten24group/fw24/commit/b03fa554b549fff68564744de52c2e1bd9eb4661))
* compilation issue in ui-config-gen ([eec6891](https://github.com/ten24group/fw24/commit/eec6891aad82254e5e45cd1e6ac4d2a16fd8dc53))
* DI-container's registerProvider function to consider the provider type and entity ([c9e26d3](https://github.com/ten24group/fw24/commit/c9e26d3e365841675617c89ca0f5ccc9c68faccf))
* hard-error when env-key value is missing ([cd1e2f1](https://github.com/ten24group/fw24/commit/cd1e2f1d97e70632af64da50dfd9d2795328ceb9))
* InjectEntitySchema/Service decorators not registering right metadata and leading ro error ([3f01c05](https://github.com/ten24group/fw24/commit/3f01c05e4896e5de10436f4a78997cac02ad9252))
* resolveEntitySchema/Service methods not working properly due to token mismatch, even though token shouldn't matter in these methods ([ecad272](https://github.com/ten24group/fw24/commit/ecad27231c0cd541e2110c318414e485b9c46b61))
* type in @InjectEntitySchema ([f242852](https://github.com/ten24group/fw24/commit/f24285215a3c5d19a815e7d40204e4689f9d5c9b))
* wrong key in relation metadata in BaseEntityService: entityAttributeToIOSchemaAttribute leading to errors ([32b5a4a](https://github.com/ten24group/fw24/commit/32b5a4acad3e89bf98e3bbc7e55ca00d4653bb31))

### [0.1.1-beta.5](https://github.com/ten24group/fw24/compare/v0.1.1-beta.4...v0.1.1-beta.5) (2025-02-28)


### Bug Fixes

* base-entity-controller's dependency on entity name when services are injected lazily ([286feb3](https://github.com/ten24group/fw24/commit/286feb338ba2a197d8aa11aea5348dcf7c17c71e))
* base-entity-service inferRelationshipsForEntitySelections to handle circular relation, and Fix: issues in registerEntitySchema ([b03fa55](https://github.com/ten24group/fw24/commit/b03fa554b549fff68564744de52c2e1bd9eb4661))
* compilation issue in ui-config-gen ([eec6891](https://github.com/ten24group/fw24/commit/eec6891aad82254e5e45cd1e6ac4d2a16fd8dc53))
* DI-container's registerProvider function to consider the provider type and entity ([c9e26d3](https://github.com/ten24group/fw24/commit/c9e26d3e365841675617c89ca0f5ccc9c68faccf))
* hard-error when env-key value is missing ([cd1e2f1](https://github.com/ten24group/fw24/commit/cd1e2f1d97e70632af64da50dfd9d2795328ceb9))
* InjectEntitySchema/Service decorators not registering right metadata and leading ro error ([3f01c05](https://github.com/ten24group/fw24/commit/3f01c05e4896e5de10436f4a78997cac02ad9252))
* resolveEntitySchema/Service methods not working properly due to token mismatch, even though token shouldn't matter in these methods ([ecad272](https://github.com/ten24group/fw24/commit/ecad27231c0cd541e2110c318414e485b9c46b61))
* type in @InjectEntitySchema ([f242852](https://github.com/ten24group/fw24/commit/f24285215a3c5d19a815e7d40204e4689f9d5c9b))
* wrong key in relation metadata in BaseEntityService: entityAttributeToIOSchemaAttribute leading to errors ([32b5a4a](https://github.com/ten24group/fw24/commit/32b5a4acad3e89bf98e3bbc7e55ca00d4653bb31))
### [0.1.1-beta.6](https://github.com/ten24group/fw24/compare/v0.1.1-beta.5...v0.1.1-beta.6) (2025-02-21)

### [0.1.1-beta.4](https://github.com/ten24group/fw24/compare/v0.1.1-beta.3...v0.1.1-beta.4) (2025-01-06)


### Bug Fixes

* type in lambda resource access for queues ([0aa2c4a](https://github.com/ten24group/fw24/commit/0aa2c4a70b036ac86e34060fc9aabedb5446e592))

### [0.1.1-beta.3](https://github.com/ten24group/fw24/compare/v0.1.1-beta.2...v0.1.1-beta.3) (2025-01-03)


### Bug Fixes

* types for env in task and queue decorators ([f910eea](https://github.com/ten24group/fw24/commit/f910eea11e30790109de5c5455fa8a982e5af75d))

### [0.1.1-beta.2](https://github.com/ten24group/fw24/compare/v0.1.1-beta.1...v0.1.1-beta.2) (2024-12-10)

### [0.1.1-beta.1](https://github.com/ten24group/fw24/compare/v0.1.1-alpha.14...v0.1.1-beta.1) (2024-12-03)


### Features

* support for registering classes as the providers in DI modules ([0db879f](https://github.com/ten24group/fw24/commit/0db879f5d4936a89ddb855ecb8919e10240774b5))


### Bug Fixes

* API-controller response not returning user-definied headers and stuff ([9740dc7](https://github.com/ten24group/fw24/commit/9740dc7f165502c30fb279c78c071a5f22a9553e))
* bugs due to circular imports ([466bf2f](https://github.com/ten24group/fw24/commit/466bf2f3827b16278efdff56272557044ac9e2ab))
* DIModule export and types ([8b969b5](https://github.com/ten24group/fw24/commit/8b969b51a454784406283039fe8ea88cd69e9eba))
* env-keys related issues ([f20813e](https://github.com/ten24group/fw24/commit/f20813ebcff33f160066d8ca534ad6af5e65cd5c))
* hard error in MailerConstruct due to the changed path of 'mail-processor.js' ([8e015d5](https://github.com/ten24group/fw24/commit/8e015d5bba2f3dc4f9cdb28678d5ecc5182d8174))
* hard error when module does not have the controllers DIR ([eec0aab](https://github.com/ten24group/fw24/commit/eec0aab60d8792a05a0d521ab700350f1c7fd9bb))
* issue in hasChildContainerById and support for logging child contailers ([945a103](https://github.com/ten24group/fw24/commit/945a10305d416851e34259461dbf12697160620c))
* issue in parsing the request headers and body ([4517446](https://github.com/ten24group/fw24/commit/451744660a6bf39c75e4372c2e52ef687141e8cb))
* issue with core logic to find related entity service ([5cd63e1](https://github.com/ten24group/fw24/commit/5cd63e1ce45e3ecd53b2e3f6f5c4df42195a4f64))
* issues with DI system with entry layers; restructured how providers and modules are registered and how DI-metadata is managed ([c8a0eaa](https://github.com/ten24group/fw24/commit/c8a0eaa09c29cc82229cf8b869a00072db3a6879))
* issues with fall-back DI setup ([0f5a627](https://github.com/ten24group/fw24/commit/0f5a627e00246ebe0cc5d913f59d99ae1493c07d))
* layer layer bundle size ([4b85b52](https://github.com/ten24group/fw24/commit/4b85b52703fa237e3d31f2a179cabc5d5e2016a0))
* log-level not working for DefaultLogger ([dbe2d61](https://github.com/ten24group/fw24/commit/dbe2d6164661a653b35cc3b40fb364235fe39455))
* merge object util to not merge objects of user defined classes ([c4241c4](https://github.com/ten24group/fw24/commit/c4241c496096fc023d3e10a52e9e75422c47f191))
* parsing the request body not handling base-64 encoded json for post requests ([a791751](https://github.com/ten24group/fw24/commit/a791751f0862c4c43e8f4ad9b29839e0cf5790d7))
* providedBy option for DI modules, and hierarchial proxy container management ([452d9b8](https://github.com/ten24group/fw24/commit/452d9b86e5e8ccb18715a51be0ac56b49b037bb9))
* special-char in project-name causing errors ([b3fbc49](https://github.com/ten24group/fw24/commit/b3fbc495a0b238a6df24bb29de348240c7aaa531))
* support for logging and the abitlty to set log-level per lambda ([8e25c6c](https://github.com/ten24group/fw24/commit/8e25c6c1b09d4de9559b63b309cd61ed20da988c))
* type in extractDefaultAuthorizer ([ff6d879](https://github.com/ten24group/fw24/commit/ff6d8790624dbf63106d97fb2bb4238486cec445))

### [0.1.1-alpha.14](https://github.com/ten24group/fw24/compare/v0.1.1-alpha.13...v0.1.1-alpha.14) (2024-10-17)

### [0.1.1-alpha.13](https://github.com/ten24group/fw24/compare/v0.1.1-alpha.12...v0.1.1-alpha.13) (2024-10-04)


### Bug Fixes

* custom domain logic in S3 client's getSignedUrlForFileUpload ([27fdc2b](https://github.com/ten24group/fw24/commit/27fdc2be418adabf33ea9487bc0cbc7e6d41c9a6))
* QueueLambda to not add any batching stuff when it's used for a fifo queue ([bc5d0f2](https://github.com/ten24group/fw24/commit/bc5d0f26a5ffaf6c6cbbbec545b10a80a95357fe))

### [0.1.1-alpha.12](https://github.com/ten24group/fw24/compare/v0.1.1-alpha.11...v0.1.1-alpha.12) (2024-08-16)

### [0.1.1-alpha.11](https://github.com/ten24group/fw24/compare/v0.1.1-alpha.10...v0.1.1-alpha.11) (2024-07-22)


### Features

* support for uniqueue values for entity-attributes and updated `create` and `update` functions to enforce uniqueness ([fb00c32](https://github.com/ten24group/fw24/commit/fb00c32e2d09690f1812ae302bc7f1208cca7844))

### [0.1.1-alpha.10](https://github.com/ten24group/fw24/compare/v0.1.1-alpha.9...v0.1.1-alpha.10) (2024-07-12)


### Bug Fixes

* ui-config for listing delete action ([be1718d](https://github.com/ten24group/fw24/commit/be1718db2a578ec37aa882249fb58118aa3ccd84))
* utils import throwing runtime errors ([b13c098](https://github.com/ten24group/fw24/commit/b13c098125d5b23837fca12c9b563954223a1325))

### [0.1.1-alpha.9](https://github.com/ten24group/fw24/compare/v0.1.1-alpha.8...v0.1.1-alpha.9) (2024-06-24)

### [0.1.1-alpha.8](https://github.com/ten24group/fw24/compare/v0.1.1-alpha.7...v0.1.1-alpha.8) (2024-06-20)


### Bug Fixes

* no data returning for nested map attribtues ([400a951](https://github.com/ten24group/fw24/commit/400a9510378405b9a42f1542a2392a6002cb9ae0))

### [0.1.1-alpha.7](https://github.com/ten24group/fw24/compare/v0.1.1-alpha.6...v0.1.1-alpha.7) (2024-06-19)

### [0.1.1-alpha.6](https://github.com/ten24group/fw24/compare/v0.1.1-alpha.5...v0.1.1-alpha.6) (2024-06-19)


### Bug Fixes

* api's signature issues due to chat casing in endpoint-names ([f0a921c](https://github.com/ten24group/fw24/commit/f0a921c187f6ba4c1bee7d56c1e74a5cc2f2c578))
* default linsting-attribute names ([a60409e](https://github.com/ten24group/fw24/commit/a60409e701ac10720078a2341220eb2a51a19fc5))
* field-type for wysiwyg attribteus ([2ae3db5](https://github.com/ten24group/fw24/commit/2ae3db50392641f8ec77294720f402e025e7cb62))
* hard error in hydrateSingleRelation due to duplicate identifiers in batch ([888743c](https://github.com/ten24group/fw24/commit/888743cb2df921bf4e2e17d2761e47935fda7f36))

### [0.1.1-alpha.5](https://github.com/ten24group/fw24/compare/v0.1.1-alpha.4...v0.1.1-alpha.5) (2024-06-05)

### [0.1.1-alpha.4](https://github.com/ten24group/fw24/compare/v0.1.1-alpha.3...v0.1.1-alpha.4) (2024-06-03)

### [0.1.1-alpha.3](https://github.com/ten24group/fw24/compare/v0.1.1-alpha.2...v0.1.1-alpha.3) (2024-05-23)

### [0.1.1-alpha.2](https://github.com/ten24group/fw24/compare/v0.1.1-alpha.1...v0.1.1-alpha.2) (2024-05-22)

### [0.1.1-alpha.1](https://github.com/ten24group/fw24/compare/v0.1.1-alpha.0...v0.1.1-alpha.1) (2024-05-22)

### [0.1.1-alpha.0](https://github.com/ten24group/fw24/compare/v0.0.21...v0.1.1-alpha.0) (2024-05-22)


### Bug Fixes

* filter example ([b07a1bb](https://github.com/ten24group/fw24/commit/b07a1bb1f5be2620a510c9a28f8b04f8be9ca48c))
* types ([2c2c0c2](https://github.com/ten24group/fw24/commit/2c2c0c221d68b5b4b6b870493074427e865c0f12))
* typos, TS code example block and renamed filter's id and label keys, and add examples for entity-query functions ([455baee](https://github.com/ten24group/fw24/commit/455baeecc458a72b1e19f2a989da5cd7688ca7ad))

### [0.0.21](https://github.com/ten24group/fw24/compare/v0.0.20...v0.0.21) (2024-05-15)


### Bug Fixes

* auth UI config password fields ([7f23994](https://github.com/ten24group/fw24/commit/7f2399489f338aef0ebf74b4a5c0d13c38a65596))

### [0.0.20](https://github.com/ten24group/fw24/compare/v0.0.19...v0.0.20) (2024-05-11)

### [0.0.19](https://github.com/ten24group/fw24/compare/v0.0.18...v0.0.19) (2024-05-10)

### [0.0.18](https://github.com/ten24group/fw24/compare/v0.0.17...v0.0.18) (2024-05-10)

### [0.0.17](https://github.com/ten24group/fw24/compare/v0.0.16...v0.0.17) (2024-05-09)

### [0.0.16](https://github.com/ten24group/fw24/compare/v0.0.15...v0.0.16) (2024-05-08)

### [0.0.15](https://github.com/ten24group/fw24/compare/v0.0.13...v0.0.15) (2024-05-08)

### [0.0.14](https://github.com/ten24group/fw24/compare/v0.0.13...v0.0.14) (2024-05-08)

### [0.0.13](https://github.com/ten24group/fw24/compare/v0.0.12...v0.0.13) (2024-05-08)


### Bug Fixes

* AWS_IAM policy statements for routees with path params ([41a49b2](https://github.com/ten24group/fw24/commit/41a49b2d7de22ee783897645745a6476d81ccb91))

### [0.0.12](https://github.com/ten24group/fw24/compare/v0.0.11...v0.0.12) (2024-05-07)

### [0.0.11](https://github.com/ten24group/fw24/compare/v0.0.10...v0.0.11) (2024-05-06)

### [0.0.10](https://github.com/ten24group/fw24/compare/v0.0.7...v0.0.10) (2024-05-06)


### Bug Fixes

*  issue in stack dependency resolution logic; cleanup code to be consistent ([3675075](https://github.com/ten24group/fw24/commit/36750751e69b2b75a66feb5dec6ca18f41b49102))
* a bunch of errors after refactoring ([d0e8d26](https://github.com/ten24group/fw24/commit/d0e8d265fb18afb5d12f28461e1bacd5bbfc0154))
* default authorizer logic ([3240f95](https://github.com/ten24group/fw24/commit/3240f954e41b66b062110752af07d7907fa7aa6c))
* entity default crud routes, and UI config gen ([934b93c](https://github.com/ten24group/fw24/commit/934b93cbf902404f97b1940725dc7c7f950380a4))
* errors, and add a proper logger ([0c5fbe9](https://github.com/ten24group/fw24/commit/0c5fbe9a78d3ae0487f73bb6aba8ada24bd30306))
* exception due to empty filters ([a595763](https://github.com/ten24group/fw24/commit/a5957633c6146b51848f9e353cfa3132405c2b84))
* exception due to null attributes ([8c90d63](https://github.com/ten24group/fw24/commit/8c90d63c5d0d1b8fe3dfadce6d62a361205670fd))
* failing types and tests after type cleanup ([4b99c12](https://github.com/ten24group/fw24/commit/4b99c122d3563d409707b282f93b2926bfd73601))
* ghost validation errors ([b6cd79a](https://github.com/ten24group/fw24/commit/b6cd79abcce6b4e506999d77eec32f2d751fdeed))
* hard error due to `debug` key lingering in the query-string-params and messing up filters ([51bee4e](https://github.com/ten24group/fw24/commit/51bee4e4052c4c146d0068b619fe64525fe7aad0))
* imports of validator utils ([cbd4dbd](https://github.com/ten24group/fw24/commit/cbd4dbd2708e16091841d6874fdf9dd4c293ff2c))
* issue with minlength/maxlength validation, and refactored error messages into a dedicated file ([3692742](https://github.com/ten24group/fw24/commit/36927422532cf706d084d7f35937e36faf9bc69d))
* issue with queryStringParameters parsing, and isFilterGroup type guard logic ([b41f70a](https://github.com/ten24group/fw24/commit/b41f70a85b2b11a8fddd91044179efdb9d1f2b9e))
* issues with validator ([b354ed0](https://github.com/ten24group/fw24/commit/b354ed0485e93a6c5efabd83abb0c29d1599022b))
* module controllers not being loaded from from .js files /dist folder ([5fa1df4](https://github.com/ten24group/fw24/commit/5fa1df47e7423df9247b2e9d9a3e9f0d3a568ed4))
* type errors due to array literal type definations ([445974a](https://github.com/ten24group/fw24/commit/445974aba541fe81b79906c3fcbb9eaa4dbacbed))
* validateEntity and validateHttpRequest not collecting errors ([1c4395c](https://github.com/ten24group/fw24/commit/1c4395c3b82ea07e6dc39933e35c4a93fa8cffa8))
* validator issues, and cleanup ([decdbee](https://github.com/ten24group/fw24/commit/decdbee439c95bb7e0df704fca04ef1538675f40))

### [0.0.9](https://github.com/ten24group/fw24/compare/v0.0.7...v0.0.9) (2024-05-06)


### Bug Fixes

*  issue in stack dependency resolution logic; cleanup code to be consistent ([3675075](https://github.com/ten24group/fw24/commit/36750751e69b2b75a66feb5dec6ca18f41b49102))
* a bunch of errors after refactoring ([d0e8d26](https://github.com/ten24group/fw24/commit/d0e8d265fb18afb5d12f28461e1bacd5bbfc0154))
* default authorizer logic ([3240f95](https://github.com/ten24group/fw24/commit/3240f954e41b66b062110752af07d7907fa7aa6c))
* entity default crud routes, and UI config gen ([934b93c](https://github.com/ten24group/fw24/commit/934b93cbf902404f97b1940725dc7c7f950380a4))
* errors, and add a proper logger ([0c5fbe9](https://github.com/ten24group/fw24/commit/0c5fbe9a78d3ae0487f73bb6aba8ada24bd30306))
* exception due to empty filters ([a595763](https://github.com/ten24group/fw24/commit/a5957633c6146b51848f9e353cfa3132405c2b84))
* exception due to null attributes ([8c90d63](https://github.com/ten24group/fw24/commit/8c90d63c5d0d1b8fe3dfadce6d62a361205670fd))
* failing types and tests after type cleanup ([4b99c12](https://github.com/ten24group/fw24/commit/4b99c122d3563d409707b282f93b2926bfd73601))
* ghost validation errors ([b6cd79a](https://github.com/ten24group/fw24/commit/b6cd79abcce6b4e506999d77eec32f2d751fdeed))
* hard error due to `debug` key lingering in the query-string-params and messing up filters ([51bee4e](https://github.com/ten24group/fw24/commit/51bee4e4052c4c146d0068b619fe64525fe7aad0))
* imports of validator utils ([cbd4dbd](https://github.com/ten24group/fw24/commit/cbd4dbd2708e16091841d6874fdf9dd4c293ff2c))
* issue with minlength/maxlength validation, and refactored error messages into a dedicated file ([3692742](https://github.com/ten24group/fw24/commit/36927422532cf706d084d7f35937e36faf9bc69d))
* issue with queryStringParameters parsing, and isFilterGroup type guard logic ([b41f70a](https://github.com/ten24group/fw24/commit/b41f70a85b2b11a8fddd91044179efdb9d1f2b9e))
* issues with validator ([b354ed0](https://github.com/ten24group/fw24/commit/b354ed0485e93a6c5efabd83abb0c29d1599022b))
* module controllers not being loaded from from .js files /dist folder ([5fa1df4](https://github.com/ten24group/fw24/commit/5fa1df47e7423df9247b2e9d9a3e9f0d3a568ed4))
* type errors due to array literal type definations ([445974a](https://github.com/ten24group/fw24/commit/445974aba541fe81b79906c3fcbb9eaa4dbacbed))
* validateEntity and validateHttpRequest not collecting errors ([1c4395c](https://github.com/ten24group/fw24/commit/1c4395c3b82ea07e6dc39933e35c4a93fa8cffa8))
* validator issues, and cleanup ([decdbee](https://github.com/ten24group/fw24/commit/decdbee439c95bb7e0df704fca04ef1538675f40))

### [0.0.8](https://github.com/ten24group/fw24/compare/v0.0.7...v0.0.8) (2024-05-06)


### Bug Fixes

*  issue in stack dependency resolution logic; cleanup code to be consistent ([3675075](https://github.com/ten24group/fw24/commit/36750751e69b2b75a66feb5dec6ca18f41b49102))
* a bunch of errors after refactoring ([d0e8d26](https://github.com/ten24group/fw24/commit/d0e8d265fb18afb5d12f28461e1bacd5bbfc0154))
* default authorizer logic ([3240f95](https://github.com/ten24group/fw24/commit/3240f954e41b66b062110752af07d7907fa7aa6c))
* entity default crud routes, and UI config gen ([934b93c](https://github.com/ten24group/fw24/commit/934b93cbf902404f97b1940725dc7c7f950380a4))
* errors, and add a proper logger ([0c5fbe9](https://github.com/ten24group/fw24/commit/0c5fbe9a78d3ae0487f73bb6aba8ada24bd30306))
* exception due to empty filters ([a595763](https://github.com/ten24group/fw24/commit/a5957633c6146b51848f9e353cfa3132405c2b84))
* exception due to null attributes ([8c90d63](https://github.com/ten24group/fw24/commit/8c90d63c5d0d1b8fe3dfadce6d62a361205670fd))
* failing types and tests after type cleanup ([4b99c12](https://github.com/ten24group/fw24/commit/4b99c122d3563d409707b282f93b2926bfd73601))
* ghost validation errors ([b6cd79a](https://github.com/ten24group/fw24/commit/b6cd79abcce6b4e506999d77eec32f2d751fdeed))
* hard error due to `debug` key lingering in the query-string-params and messing up filters ([51bee4e](https://github.com/ten24group/fw24/commit/51bee4e4052c4c146d0068b619fe64525fe7aad0))
* imports of validator utils ([cbd4dbd](https://github.com/ten24group/fw24/commit/cbd4dbd2708e16091841d6874fdf9dd4c293ff2c))
* issue with minlength/maxlength validation, and refactored error messages into a dedicated file ([3692742](https://github.com/ten24group/fw24/commit/36927422532cf706d084d7f35937e36faf9bc69d))
* issue with queryStringParameters parsing, and isFilterGroup type guard logic ([b41f70a](https://github.com/ten24group/fw24/commit/b41f70a85b2b11a8fddd91044179efdb9d1f2b9e))
* issues with validator ([b354ed0](https://github.com/ten24group/fw24/commit/b354ed0485e93a6c5efabd83abb0c29d1599022b))
* module controllers not being loaded from from .js files /dist folder ([5fa1df4](https://github.com/ten24group/fw24/commit/5fa1df47e7423df9247b2e9d9a3e9f0d3a568ed4))
* type errors due to array literal type definations ([445974a](https://github.com/ten24group/fw24/commit/445974aba541fe81b79906c3fcbb9eaa4dbacbed))
* validateEntity and validateHttpRequest not collecting errors ([1c4395c](https://github.com/ten24group/fw24/commit/1c4395c3b82ea07e6dc39933e35c4a93fa8cffa8))
* validator issues, and cleanup ([decdbee](https://github.com/ten24group/fw24/commit/decdbee439c95bb7e0df704fca04ef1538675f40))

### [0.0.7](https://github.com/ten24group/fw24/compare/v0.0.6...v0.0.7) (2024-03-16)

### [0.0.6](https://github.com/ten24group/fw24/compare/v0.0.5...v0.0.6) (2024-03-16)

### [0.0.5](https://github.com/ten24group/fw24/compare/v0.0.4...v0.0.5) (2024-03-16)


### Bug Fixes

* error with event body parsing ([faf0edd](https://github.com/ten24group/fw24/commit/faf0edd08a7a68aec1f26f4271a30d753c6e46e9))
* **temp:** CORS not working: caused by LambdaProxyIntegration ([fd45358](https://github.com/ten24group/fw24/commit/fd45358c031a443cc34a1de7637ec3bb19609075))

### [0.0.4](https://github.com/ten24group/fw24/compare/v0.0.3...v0.0.4) (2024-03-10)

### [0.0.3](https://github.com/ten24group/fw24/compare/v0.0.2...v0.0.3) (2024-03-09)

### [0.0.2](https://github.com/ten24group/fw24/compare/v0.0.1...v0.0.2) (2024-03-08)

### [0.0.1](https://github.com/ten24group/fw24/compare/v1.0.3...v0.0.1) (2024-03-04)

### [1.0.3](https://github.com/ten24group/fw24/compare/v1.0.2...v1.0.3) (2024-03-04)

### [1.0.2](https://github.com/ten24group/fw24/compare/v1.0.1...v1.0.2) (2024-03-04)

### 1.0.1 (2024-03-04)

### [0.3.4](https://github.com/ten24group/fw24-core/compare/v0.3.2...v0.3.4) (2024-02-29)

### [0.3.3](https://github.com/ten24group/fw24-core/compare/v0.3.2...v0.3.3) (2024-02-29)

### 0.3.2 (2024-02-29)
