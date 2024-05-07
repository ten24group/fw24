# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

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
