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
const dynamodb_1 = require("../loggers/dynamodb");
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
    __param(0, (0, di_1.Inject)(dynamodb_1.DynamoDBAuditEntityService))
], DynamoDBAuditSystemController);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXVkaXQtY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9hdWRpdC9zeXN0ZW0vYXVkaXQtY29udHJvbGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7QUFBQSxpREFBOEM7QUFDOUMsaUNBQWtDO0FBQ2xDLHlDQUFvRDtBQUNwRCxrREFBd0Y7QUFHakYsSUFBTSw2QkFBNkIsR0FBbkMsTUFBTSw2QkFBOEIsU0FBUSw2QkFBMkM7SUFHL0U7SUFGYixZQUVhLFlBQXdDO1FBRWpELEtBQUssQ0FBQyxZQUFZLENBQUMsQ0FBQztRQUZYLGlCQUFZLEdBQVosWUFBWSxDQUE0QjtJQUduRCxDQUFDO0NBQ0osQ0FBQTtBQVBZLHNFQUE2Qjt3Q0FBN0IsNkJBQTZCO0lBRHpDLElBQUEsdUJBQVUsRUFBQyxrQkFBa0IsQ0FBQztJQUd4QixXQUFBLElBQUEsV0FBTSxFQUFDLHFDQUEwQixDQUFDLENBQUE7R0FGNUIsNkJBQTZCLENBT3pDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ29udHJvbGxlciB9IGZyb20gXCIuLi8uLi9kZWNvcmF0b3JzXCI7XG5pbXBvcnQgeyBJbmplY3QgfSBmcm9tIFwiLi4vLi4vZGlcIjtcbmltcG9ydCB7IEJhc2VFbnRpdHlDb250cm9sbGVyIH0gZnJvbSBcIi4uLy4uL2VudGl0eVwiO1xuaW1wb3J0IHsgQXVkaXRFbnRpdHlTY2hlbWFUeXBlLCBEeW5hbW9EQkF1ZGl0RW50aXR5U2VydmljZSB9IGZyb20gXCIuLi9sb2dnZXJzL2R5bmFtb2RiXCI7XG5cbkBDb250cm9sbGVyKCcvc3lzdGVtL2F1ZGl0bG9nJylcbmV4cG9ydCBjbGFzcyBEeW5hbW9EQkF1ZGl0U3lzdGVtQ29udHJvbGxlciBleHRlbmRzIEJhc2VFbnRpdHlDb250cm9sbGVyPEF1ZGl0RW50aXR5U2NoZW1hVHlwZT4ge1xuICBjb25zdHJ1Y3RvcihcbiAgICAgIEBJbmplY3QoRHluYW1vREJBdWRpdEVudGl0eVNlcnZpY2UpXG4gICAgICByZWFkb25seSBhdWRpdFNlcnZpY2U6IER5bmFtb0RCQXVkaXRFbnRpdHlTZXJ2aWNlXG4gICAgKSB7XG4gICAgICBzdXBlcihhdWRpdFNlcnZpY2UpO1xuICAgIH1cbn0iXX0=