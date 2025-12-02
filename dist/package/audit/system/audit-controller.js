"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DynamoDBAuditSystemController = void 0;
const di_1 = require("../../di");
const entity_1 = require("../../entity");
const audit_entity_service_1 = require("./audit-entity-service");
// @Controller('/system/auditlog')
let DynamoDBAuditSystemController = class DynamoDBAuditSystemController extends entity_1.BaseEntityController {
    auditService;
    constructor(auditService) {
        super(auditService);
        this.auditService = auditService;
    }
};
exports.DynamoDBAuditSystemController = DynamoDBAuditSystemController;
exports.DynamoDBAuditSystemController = DynamoDBAuditSystemController = __decorate([
    __param(0, (0, di_1.Inject)(audit_entity_service_1.DynamoDBAuditEntityService))
], DynamoDBAuditSystemController);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXVkaXQtY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9hdWRpdC9zeXN0ZW0vYXVkaXQtY29udHJvbGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7QUFDQSxpQ0FBa0M7QUFDbEMseUNBQW9EO0FBRXBELGlFQUFvRTtBQUVwRSxrQ0FBa0M7QUFDM0IsSUFBTSw2QkFBNkIsR0FBbkMsTUFBTSw2QkFBOEIsU0FBUSw2QkFBMkM7SUFHL0U7SUFGYixZQUVhLFlBQXdDO1FBRWpELEtBQUssQ0FBQyxZQUFZLENBQUMsQ0FBQztRQUZYLGlCQUFZLEdBQVosWUFBWSxDQUE0QjtJQUduRCxDQUFDO0NBQ0osQ0FBQTtBQVBZLHNFQUE2Qjt3Q0FBN0IsNkJBQTZCO0lBRW5DLFdBQUEsSUFBQSxXQUFNLEVBQUMsaURBQTBCLENBQUMsQ0FBQTtHQUY1Qiw2QkFBNkIsQ0FPekMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBDb250cm9sbGVyIH0gZnJvbSBcIi4uLy4uL2RlY29yYXRvcnNcIjtcbmltcG9ydCB7IEluamVjdCB9IGZyb20gXCIuLi8uLi9kaVwiO1xuaW1wb3J0IHsgQmFzZUVudGl0eUNvbnRyb2xsZXIgfSBmcm9tIFwiLi4vLi4vZW50aXR5XCI7XG5pbXBvcnQgeyBBdWRpdEVudGl0eVNjaGVtYVR5cGUgfSBmcm9tIFwiLi4vbG9nZ2Vycy9keW5hbW9kYlwiO1xuaW1wb3J0IHsgRHluYW1vREJBdWRpdEVudGl0eVNlcnZpY2UgfSBmcm9tIFwiLi9hdWRpdC1lbnRpdHktc2VydmljZVwiO1xuXG4vLyBAQ29udHJvbGxlcignL3N5c3RlbS9hdWRpdGxvZycpXG5leHBvcnQgY2xhc3MgRHluYW1vREJBdWRpdFN5c3RlbUNvbnRyb2xsZXIgZXh0ZW5kcyBCYXNlRW50aXR5Q29udHJvbGxlcjxBdWRpdEVudGl0eVNjaGVtYVR5cGU+IHtcbiAgY29uc3RydWN0b3IoXG4gICAgICBASW5qZWN0KER5bmFtb0RCQXVkaXRFbnRpdHlTZXJ2aWNlKVxuICAgICAgcmVhZG9ubHkgYXVkaXRTZXJ2aWNlOiBEeW5hbW9EQkF1ZGl0RW50aXR5U2VydmljZVxuICAgICkge1xuICAgICAgc3VwZXIoYXVkaXRTZXJ2aWNlKTtcbiAgICB9XG59Il19