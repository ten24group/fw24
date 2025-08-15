"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DynamoDBEventDataExtractor = exports.BaseSQSEventProcessor = void 0;
var base_sqs_event_processor_1 = require("./base-sqs-event-processor");
Object.defineProperty(exports, "BaseSQSEventProcessor", { enumerable: true, get: function () { return base_sqs_event_processor_1.BaseSQSEventProcessor; } });
var dynamodb_event_data_extractor_1 = require("./dynamodb-event-data-extractor");
Object.defineProperty(exports, "DynamoDBEventDataExtractor", { enumerable: true, get: function () { return dynamodb_event_data_extractor_1.DynamoDBEventDataExtractor; } });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvY29yZS9ydW50aW1lL2V2ZW50LXByb2Nlc3Nvci9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSx1RUFFb0M7QUFEbEMsaUlBQUEscUJBQXFCLE9BQUE7QUFFdkIsaUZBRXlDO0FBRHZDLDJJQUFBLDBCQUEwQixPQUFBIiwic291cmNlc0NvbnRlbnQiOlsiZXhwb3J0IHtcbiAgQmFzZVNRU0V2ZW50UHJvY2Vzc29yXG59IGZyb20gJy4vYmFzZS1zcXMtZXZlbnQtcHJvY2Vzc29yJztcbmV4cG9ydCB7XG4gIER5bmFtb0RCRXZlbnREYXRhRXh0cmFjdG9yXG59IGZyb20gJy4vZHluYW1vZGItZXZlbnQtZGF0YS1leHRyYWN0b3InOyJdfQ==