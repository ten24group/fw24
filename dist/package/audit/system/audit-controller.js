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
const decorators_1 = require("../../decorators");
const di_1 = require("../../di");
const entity_1 = require("../../entity");
const audit_entity_service_1 = require("./audit-entity-service");
let DynamoDBAuditSystemController = class DynamoDBAuditSystemController extends entity_1.BaseEntityController {
    auditService;
    constructor(auditService) {
        super(auditService);
        this.auditService = auditService;
    }
};
exports.DynamoDBAuditSystemController = DynamoDBAuditSystemController;
exports.DynamoDBAuditSystemController = DynamoDBAuditSystemController = __decorate([
    (0, decorators_1.Controller)('/system/auditlog'),
    __param(0, (0, di_1.Inject)(audit_entity_service_1.DynamoDBAuditEntityService))
], DynamoDBAuditSystemController);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXVkaXQtY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9hdWRpdC9zeXN0ZW0vYXVkaXQtY29udHJvbGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7QUFBQSxpREFBOEM7QUFDOUMsaUNBQWtDO0FBQ2xDLHlDQUFvRDtBQUVwRCxpRUFBb0U7QUFHN0QsSUFBTSw2QkFBNkIsR0FBbkMsTUFBTSw2QkFBOEIsU0FBUSw2QkFBMkM7SUFHL0U7SUFGYixZQUVhLFlBQXdDO1FBRWpELEtBQUssQ0FBQyxZQUFZLENBQUMsQ0FBQztRQUZYLGlCQUFZLEdBQVosWUFBWSxDQUE0QjtJQUduRCxDQUFDO0NBQ0osQ0FBQTtBQVBZLHNFQUE2Qjt3Q0FBN0IsNkJBQTZCO0lBRHpDLElBQUEsdUJBQVUsRUFBQyxrQkFBa0IsQ0FBQztJQUd4QixXQUFBLElBQUEsV0FBTSxFQUFDLGlEQUEwQixDQUFDLENBQUE7R0FGNUIsNkJBQTZCLENBT3pDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ29udHJvbGxlciB9IGZyb20gXCIuLi8uLi9kZWNvcmF0b3JzXCI7XG5pbXBvcnQgeyBJbmplY3QgfSBmcm9tIFwiLi4vLi4vZGlcIjtcbmltcG9ydCB7IEJhc2VFbnRpdHlDb250cm9sbGVyIH0gZnJvbSBcIi4uLy4uL2VudGl0eVwiO1xuaW1wb3J0IHsgQXVkaXRFbnRpdHlTY2hlbWFUeXBlIH0gZnJvbSBcIi4uL2xvZ2dlcnMvZHluYW1vZGJcIjtcbmltcG9ydCB7IER5bmFtb0RCQXVkaXRFbnRpdHlTZXJ2aWNlIH0gZnJvbSBcIi4vYXVkaXQtZW50aXR5LXNlcnZpY2VcIjtcblxuQENvbnRyb2xsZXIoJy9zeXN0ZW0vYXVkaXRsb2cnKVxuZXhwb3J0IGNsYXNzIER5bmFtb0RCQXVkaXRTeXN0ZW1Db250cm9sbGVyIGV4dGVuZHMgQmFzZUVudGl0eUNvbnRyb2xsZXI8QXVkaXRFbnRpdHlTY2hlbWFUeXBlPiB7XG4gIGNvbnN0cnVjdG9yKFxuICAgICAgQEluamVjdChEeW5hbW9EQkF1ZGl0RW50aXR5U2VydmljZSlcbiAgICAgIHJlYWRvbmx5IGF1ZGl0U2VydmljZTogRHluYW1vREJBdWRpdEVudGl0eVNlcnZpY2VcbiAgICApIHtcbiAgICAgIHN1cGVyKGF1ZGl0U2VydmljZSk7XG4gICAgfVxufSJdfQ==