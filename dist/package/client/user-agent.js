"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FW24_UA_APP_ID = void 0;
/**
 * A short, stable `userAgentAppId` applied to every fw24-created AWS SDK client.
 *
 * Why this exists: `@aws-lambda-powertools/commons` (pulled in by `@aws-lambda-powertools/logger`
 * and `/metrics`) sets `process.env.AWS_SDK_UA_APP_ID` at import time to
 * `PT/NO-OP/<ver>/PTEnv/<AWS_EXECUTION_ENV>` (and appends if already set). That value exceeds the
 * AWS SDK v3 limit of 50 characters, so every SDK client logs:
 *   "The provided userAgentAppId exceeds the maximum length of 50 characters."
 * Passing an explicit `userAgentAppId` on the client config takes precedence over the env value
 * (`config?.userAgentAppId ?? loadConfig(NODE_APP_ID_CONFIG_OPTIONS)`), so a short valid tag here
 * both silences the warning and keeps a meaningful attribution. Keep it <= 50 chars.
 */
exports.FW24_UA_APP_ID = 'fw24';
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXNlci1hZ2VudC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9jbGllbnQvdXNlci1hZ2VudC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQTs7Ozs7Ozs7Ozs7R0FXRztBQUNVLFFBQUEsY0FBYyxHQUFHLE1BQU0sQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQSBzaG9ydCwgc3RhYmxlIGB1c2VyQWdlbnRBcHBJZGAgYXBwbGllZCB0byBldmVyeSBmdzI0LWNyZWF0ZWQgQVdTIFNESyBjbGllbnQuXG4gKlxuICogV2h5IHRoaXMgZXhpc3RzOiBgQGF3cy1sYW1iZGEtcG93ZXJ0b29scy9jb21tb25zYCAocHVsbGVkIGluIGJ5IGBAYXdzLWxhbWJkYS1wb3dlcnRvb2xzL2xvZ2dlcmBcbiAqIGFuZCBgL21ldHJpY3NgKSBzZXRzIGBwcm9jZXNzLmVudi5BV1NfU0RLX1VBX0FQUF9JRGAgYXQgaW1wb3J0IHRpbWUgdG9cbiAqIGBQVC9OTy1PUC88dmVyPi9QVEVudi88QVdTX0VYRUNVVElPTl9FTlY+YCAoYW5kIGFwcGVuZHMgaWYgYWxyZWFkeSBzZXQpLiBUaGF0IHZhbHVlIGV4Y2VlZHMgdGhlXG4gKiBBV1MgU0RLIHYzIGxpbWl0IG9mIDUwIGNoYXJhY3RlcnMsIHNvIGV2ZXJ5IFNESyBjbGllbnQgbG9nczpcbiAqICAgXCJUaGUgcHJvdmlkZWQgdXNlckFnZW50QXBwSWQgZXhjZWVkcyB0aGUgbWF4aW11bSBsZW5ndGggb2YgNTAgY2hhcmFjdGVycy5cIlxuICogUGFzc2luZyBhbiBleHBsaWNpdCBgdXNlckFnZW50QXBwSWRgIG9uIHRoZSBjbGllbnQgY29uZmlnIHRha2VzIHByZWNlZGVuY2Ugb3ZlciB0aGUgZW52IHZhbHVlXG4gKiAoYGNvbmZpZz8udXNlckFnZW50QXBwSWQgPz8gbG9hZENvbmZpZyhOT0RFX0FQUF9JRF9DT05GSUdfT1BUSU9OUylgKSwgc28gYSBzaG9ydCB2YWxpZCB0YWcgaGVyZVxuICogYm90aCBzaWxlbmNlcyB0aGUgd2FybmluZyBhbmQga2VlcHMgYSBtZWFuaW5nZnVsIGF0dHJpYnV0aW9uLiBLZWVwIGl0IDw9IDUwIGNoYXJzLlxuICovXG5leHBvcnQgY29uc3QgRlcyNF9VQV9BUFBfSUQgPSAnZncyNCc7XG4iXX0=