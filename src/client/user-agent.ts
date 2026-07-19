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
export const FW24_UA_APP_ID = 'fw24';
