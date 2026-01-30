"use strict";
/**
 * Compression utilities for observability data
 *
 * Compresses large payloads before storing in DynamoDB to reduce storage costs.
 * Uses gzip compression with base64 encoding for safe storage.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCompressed = isCompressed;
exports.compressIfNeeded = compressIfNeeded;
exports.decompress = decompress;
exports.compressItem = compressItem;
exports.decompressItem = decompressItem;
const zlib_1 = require("zlib");
const logging_1 = require("../logging");
const logger = (0, logging_1.createLogger)('compression');
/**
 * Check if a value is a compressed payload
 */
function isCompressed(value) {
    return (typeof value === 'object' &&
        value !== null &&
        '_compressed' in value &&
        value._compressed === true &&
        '_algorithm' in value &&
        '_data' in value);
}
/**
 * Compress a value if it exceeds the threshold.
 * Returns CompressedPayload in standard format.
 *
 * @param value - Value to compress
 * @param threshold - Minimum size in bytes before compression
 * @returns CompressedPayload if compressed, original value if below threshold
 */
function compressIfNeeded(value, threshold) {
    if (value === null || value === undefined) {
        return value;
    }
    try {
        // Serialize to JSON to measure size
        const json = JSON.stringify(value);
        const sizeBytes = Buffer.byteLength(json, 'utf8');
        // Skip compression if below threshold
        if (sizeBytes < threshold) {
            return value;
        }
        // Compress using gzip
        const compressed = (0, zlib_1.gzipSync)(Buffer.from(json, 'utf8'));
        const compressedSize = compressed.length;
        // Only use compressed version if it's actually smaller
        if (compressedSize >= sizeBytes) {
            logger.debug('Compression did not reduce size, keeping original', {
                originalSize: sizeBytes,
                compressedSize,
            });
            return value;
        }
        const result = {
            _compressed: true,
            _algorithm: 'gzip',
            _data: compressed.toString('base64'),
            _originalSize: sizeBytes,
            _compressedSize: compressedSize,
        };
        logger.debug('Compressed payload', {
            originalSize: sizeBytes,
            compressedSize,
            ratio: (compressedSize / sizeBytes * 100).toFixed(1) + '%',
        });
        return result;
    }
    catch (error) {
        logger.warn('Failed to compress payload, using original:', error);
        return value;
    }
}
/**
 * Decompress a compressed payload
 *
 * @param value - Compressed payload
 * @returns Decompressed value
 */
function decompress(value) {
    if (!isCompressed(value)) {
        return value;
    }
    try {
        if (value._algorithm !== 'gzip') {
            throw new Error(`Unsupported compression algorithm: ${value._algorithm}`);
        }
        const compressed = Buffer.from(value._data, 'base64');
        const decompressed = (0, zlib_1.gunzipSync)(compressed);
        const json = decompressed.toString('utf8');
        return JSON.parse(json);
    }
    catch (error) {
        logger.error('Failed to decompress payload:', error);
        throw new Error(`Decompression failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/**
 * Apply compression to specified fields in an item
 *
 * @param item - Item to compress
 * @param config - Compression configuration
 * @returns Item with compressed fields
 */
function compressItem(item, config) {
    if (!config.enabled) {
        return item;
    }
    const result = { ...item };
    for (const field of config.fields) {
        if (field in result && result[field] !== null && result[field] !== undefined) {
            result[field] = compressIfNeeded(result[field], config.threshold);
        }
    }
    return result;
}
/**
 * Decompress all compressed fields in an item
 *
 * @param item - Item with potentially compressed fields
 * @returns Item with decompressed fields
 */
function decompressItem(item) {
    const result = { ...item };
    for (const key in result) {
        if (isCompressed(result[key])) {
            result[key] = decompress(result[key]);
        }
    }
    return result;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29tcHJlc3Npb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdXRpbHMvY29tcHJlc3Npb24udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7OztHQUtHOztBQTBDSCxvQ0FTQztBQVVELDRDQWtEQztBQVFELGdDQWtCQztBQVNELG9DQWlCQztBQVFELHdDQVVDO0FBbkxELCtCQUE0QztBQUM1Qyx3Q0FBMEM7QUFFMUMsTUFBTSxNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLGFBQWEsQ0FBQyxDQUFDO0FBa0MzQzs7R0FFRztBQUNILFNBQWdCLFlBQVksQ0FBQyxLQUFjO0lBQ3pDLE9BQU8sQ0FDTCxPQUFPLEtBQUssS0FBSyxRQUFRO1FBQ3pCLEtBQUssS0FBSyxJQUFJO1FBQ2QsYUFBYSxJQUFJLEtBQUs7UUFDdEIsS0FBSyxDQUFDLFdBQVcsS0FBSyxJQUFJO1FBQzFCLFlBQVksSUFBSSxLQUFLO1FBQ3JCLE9BQU8sSUFBSSxLQUFLLENBQ2pCLENBQUM7QUFDSixDQUFDO0FBRUQ7Ozs7Ozs7R0FPRztBQUNILFNBQWdCLGdCQUFnQixDQUM5QixLQUFjLEVBQ2QsU0FBaUI7SUFFakIsSUFBSSxLQUFLLEtBQUssSUFBSSxJQUFJLEtBQUssS0FBSyxTQUFTLEVBQUUsQ0FBQztRQUMxQyxPQUFPLEtBQUssQ0FBQztJQUNmLENBQUM7SUFFRCxJQUFJLENBQUM7UUFDSCxvQ0FBb0M7UUFDcEMsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUNuQyxNQUFNLFNBQVMsR0FBRyxNQUFNLENBQUMsVUFBVSxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsQ0FBQztRQUVsRCxzQ0FBc0M7UUFDdEMsSUFBSSxTQUFTLEdBQUcsU0FBUyxFQUFFLENBQUM7WUFDMUIsT0FBTyxLQUFLLENBQUM7UUFDZixDQUFDO1FBRUQsc0JBQXNCO1FBQ3RCLE1BQU0sVUFBVSxHQUFHLElBQUEsZUFB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LENBQUUsS0FBSyxDQUFFLEdBQUcsZ0JBQWdCLENBQUMsTUFBTSxDQUFFLEtBQUssQ0FBRSxFQUFFLE1BQU0sQ0FBQyxTQUFTLENBQUMsQ0FBQztRQUN4RSxDQUFDO0lBQ0gsQ0FBQztJQUVELE9BQU8sTUFBVyxDQUFDO0FBQ3JCLENBQUM7QUFFRDs7Ozs7R0FLRztBQUNILFNBQWdCLGNBQWMsQ0FBb0MsSUFBTztJQUN2RSxNQUFNLE1BQU0sR0FBRyxFQUFFLEdBQUcsSUFBSSxFQUE2QixDQUFDO0lBRXRELEtBQUssTUFBTSxHQUFHLElBQUksTUFBTSxFQUFFLENBQUM7UUFDekIsSUFBSSxZQUFZLENBQUMsTUFBTSxDQUFFLEdBQUcsQ0FBRSxDQUFDLEVBQUUsQ0FBQztZQUNoQyxNQUFNLENBQUUsR0FBRyxDQUFFLEdBQUcsVUFBVSxDQUFDLE1BQU0sQ0FBRSxHQUFHLENBQUUsQ0FBQyxDQUFDO1FBQzVDLENBQUM7SUFDSCxDQUFDO0lBRUQsT0FBTyxNQUFXLENBQUM7QUFDckIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQ29tcHJlc3Npb24gdXRpbGl0aWVzIGZvciBvYnNlcnZhYmlsaXR5IGRhdGFcbiAqIFxuICogQ29tcHJlc3NlcyBsYXJnZSBwYXlsb2FkcyBiZWZvcmUgc3RvcmluZyBpbiBEeW5hbW9EQiB0byByZWR1Y2Ugc3RvcmFnZSBjb3N0cy5cbiAqIFVzZXMgZ3ppcCBjb21wcmVzc2lvbiB3aXRoIGJhc2U2NCBlbmNvZGluZyBmb3Igc2FmZSBzdG9yYWdlLlxuICovXG5cbmltcG9ydCB7IGd6aXBTeW5jLCBndW56aXBTeW5jIH0gZnJvbSAnemxpYic7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tICcuLi9sb2dnaW5nJztcblxuY29uc3QgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdjb21wcmVzc2lvbicpO1xuXG4vKipcbiAqIENvbXByZXNzaW9uIGNvbmZpZ3VyYXRpb24gaW50ZXJmYWNlLlxuICogQ2FuIGJlIHVzZWQgYnkgQU5ZIGVudGl0eS9zZXJ2aWNlIGluIGZ3MjQuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ29tcHJlc3Npb25Db25maWcge1xuICBlbmFibGVkOiBib29sZWFuO1xuICB0aHJlc2hvbGQ6IG51bWJlcjtcbiAgZmllbGRzOiBSZWFkb25seUFycmF5PHN0cmluZz47XG59XG5cbi8qKlxuICogU3RhbmRhcmQgY29tcHJlc3NlZCBwYXlsb2FkIGZvcm1hdC5cbiAqIFxuICogKipDb250cmFjdDoqKlxuICogLSBgX2NvbXByZXNzZWQ6IHRydWVgIC0gQWx3YXlzIHRydWUsIG1hcmtlciBmb3IgZGV0ZWN0aW9uXG4gKiAtIGBfYWxnb3JpdGhtOiAnZ3ppcCdgIC0gQ3VycmVudGx5IG9ubHkgZ3ppcCBzdXBwb3J0ZWRcbiAqIC0gYF9kYXRhOiBzdHJpbmdgIC0gQmFzZTY0LWVuY29kZWQgZ3ppcCBkYXRhXG4gKiAtIGBfb3JpZ2luYWxTaXplOiBudW1iZXJgIC0gT3JpZ2luYWwgc2l6ZSBpbiBieXRlcyAoZm9yIFVJIGRpc3BsYXkpXG4gKiAtIGBfY29tcHJlc3NlZFNpemU6IG51bWJlcmAgLSBDb21wcmVzc2VkIHNpemUgaW4gYnl0ZXMgKGZvciBtZXRyaWNzKVxuICogXG4gKiAqKkZyb250ZW5kIERldGVjdGlvbjoqKlxuICogVUkyNCBjaGVja3MgZm9yIGBfY29tcHJlc3NlZCA9PT0gdHJ1ZWAgYW5kIGBfYWxnb3JpdGhtID09PSAnZ3ppcCdgXG4gKiB0aGVuIGRlY29tcHJlc3NlcyBgX2RhdGFgIChiYXNlNjQg4oaSIGJpbmFyeSDihpIgZ3VuemlwIOKGkiBKU09OLnBhcnNlKVxuICovXG5leHBvcnQgaW50ZXJmYWNlIENvbXByZXNzZWRQYXlsb2FkIHtcbiAgX2NvbXByZXNzZWQ6IHRydWU7XG4gIF9hbGdvcml0aG06ICdnemlwJztcbiAgX2RhdGE6IHN0cmluZztcbiAgX29yaWdpbmFsU2l6ZTogbnVtYmVyO1xuICBfY29tcHJlc3NlZFNpemU6IG51bWJlcjtcbn1cblxuLyoqXG4gKiBDaGVjayBpZiBhIHZhbHVlIGlzIGEgY29tcHJlc3NlZCBwYXlsb2FkXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0NvbXByZXNzZWQodmFsdWU6IHVua25vd24pOiB2YWx1ZSBpcyBDb21wcmVzc2VkUGF5bG9hZCB7XG4gIHJldHVybiAoXG4gICAgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJlxuICAgIHZhbHVlICE9PSBudWxsICYmXG4gICAgJ19jb21wcmVzc2VkJyBpbiB2YWx1ZSAmJlxuICAgIHZhbHVlLl9jb21wcmVzc2VkID09PSB0cnVlICYmXG4gICAgJ19hbGdvcml0aG0nIGluIHZhbHVlICYmXG4gICAgJ19kYXRhJyBpbiB2YWx1ZVxuICApO1xufVxuXG4vKipcbiAqIENvbXByZXNzIGEgdmFsdWUgaWYgaXQgZXhjZWVkcyB0aGUgdGhyZXNob2xkLlxuICogUmV0dXJucyBDb21wcmVzc2VkUGF5bG9hZCBpbiBzdGFuZGFyZCBmb3JtYXQuXG4gKiBcbiAqIEBwYXJhbSB2YWx1ZSAtIFZhbHVlIHRvIGNvbXByZXNzXG4gKiBAcGFyYW0gdGhyZXNob2xkIC0gTWluaW11bSBzaXplIGluIGJ5dGVzIGJlZm9yZSBjb21wcmVzc2lvblxuICogQHJldHVybnMgQ29tcHJlc3NlZFBheWxvYWQgaWYgY29tcHJlc3NlZCwgb3JpZ2luYWwgdmFsdWUgaWYgYmVsb3cgdGhyZXNob2xkXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb21wcmVzc0lmTmVlZGVkKFxuICB2YWx1ZTogdW5rbm93bixcbiAgdGhyZXNob2xkOiBudW1iZXJcbik6IHVua25vd24gfCBDb21wcmVzc2VkUGF5bG9hZCB7XG4gIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgcmV0dXJuIHZhbHVlO1xuICB9XG5cbiAgdHJ5IHtcbiAgICAvLyBTZXJpYWxpemUgdG8gSlNPTiB0byBtZWFzdXJlIHNpemVcbiAgICBjb25zdCBqc29uID0gSlNPTi5zdHJpbmdpZnkodmFsdWUpO1xuICAgIGNvbnN0IHNpemVCeXRlcyA9IEJ1ZmZlci5ieXRlTGVuZ3RoKGpzb24sICd1dGY4Jyk7XG5cbiAgICAvLyBTa2lwIGNvbXByZXNzaW9uIGlmIGJlbG93IHRocmVzaG9sZFxuICAgIGlmIChzaXplQnl0ZXMgPCB0aHJlc2hvbGQpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG5cbiAgICAvLyBDb21wcmVzcyB1c2luZyBnemlwXG4gICAgY29uc3QgY29tcHJlc3NlZCA9IGd6aXBTeW5jKEJ1ZmZlci5mcm9tKGpzb24sICd1dGY4JykpO1xuICAgIGNvbnN0IGNvbXByZXNzZWRTaXplID0gY29tcHJlc3NlZC5sZW5ndGg7XG5cbiAgICAvLyBPbmx5IHVzZSBjb21wcmVzc2VkIHZlcnNpb24gaWYgaXQncyBhY3R1YWxseSBzbWFsbGVyXG4gICAgaWYgKGNvbXByZXNzZWRTaXplID49IHNpemVCeXRlcykge1xuICAgICAgbG9nZ2VyLmRlYnVnKCdDb21wcmVzc2lvbiBkaWQgbm90IHJlZHVjZSBzaXplLCBrZWVwaW5nIG9yaWdpbmFsJywge1xuICAgICAgICBvcmlnaW5hbFNpemU6IHNpemVCeXRlcyxcbiAgICAgICAgY29tcHJlc3NlZFNpemUsXG4gICAgICB9KTtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG5cbiAgICBjb25zdCByZXN1bHQ6IENvbXByZXNzZWRQYXlsb2FkID0ge1xuICAgICAgX2NvbXByZXNzZWQ6IHRydWUsXG4gICAgICBfYWxnb3JpdGhtOiAnZ3ppcCcsXG4gICAgICBfZGF0YTogY29tcHJlc3NlZC50b1N0cmluZygnYmFzZTY0JyksXG4gICAgICBfb3JpZ2luYWxTaXplOiBzaXplQnl0ZXMsXG4gICAgICBfY29tcHJlc3NlZFNpemU6IGNvbXByZXNzZWRTaXplLFxuICAgIH07XG5cbiAgICBsb2dnZXIuZGVidWcoJ0NvbXByZXNzZWQgcGF5bG9hZCcsIHtcbiAgICAgIG9yaWdpbmFsU2l6ZTogc2l6ZUJ5dGVzLFxuICAgICAgY29tcHJlc3NlZFNpemUsXG4gICAgICByYXRpbzogKGNvbXByZXNzZWRTaXplIC8gc2l6ZUJ5dGVzICogMTAwKS50b0ZpeGVkKDEpICsgJyUnLFxuICAgIH0pO1xuXG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBsb2dnZXIud2FybignRmFpbGVkIHRvIGNvbXByZXNzIHBheWxvYWQsIHVzaW5nIG9yaWdpbmFsOicsIGVycm9yKTtcbiAgICByZXR1cm4gdmFsdWU7XG4gIH1cbn1cblxuLyoqXG4gKiBEZWNvbXByZXNzIGEgY29tcHJlc3NlZCBwYXlsb2FkXG4gKiBcbiAqIEBwYXJhbSB2YWx1ZSAtIENvbXByZXNzZWQgcGF5bG9hZFxuICogQHJldHVybnMgRGVjb21wcmVzc2VkIHZhbHVlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZWNvbXByZXNzKHZhbHVlOiB1bmtub3duKTogdW5rbm93biB7XG4gIGlmICghaXNDb21wcmVzc2VkKHZhbHVlKSkge1xuICAgIHJldHVybiB2YWx1ZTtcbiAgfVxuXG4gIHRyeSB7XG4gICAgaWYgKHZhbHVlLl9hbGdvcml0aG0gIT09ICdnemlwJykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBjb21wcmVzc2lvbiBhbGdvcml0aG06ICR7dmFsdWUuX2FsZ29yaXRobX1gKTtcbiAgICB9XG5cbiAgICBjb25zdCBjb21wcmVzc2VkID0gQnVmZmVyLmZyb20odmFsdWUuX2RhdGEsICdiYXNlNjQnKTtcbiAgICBjb25zdCBkZWNvbXByZXNzZWQgPSBndW56aXBTeW5jKGNvbXByZXNzZWQpO1xuICAgIGNvbnN0IGpzb24gPSBkZWNvbXByZXNzZWQudG9TdHJpbmcoJ3V0ZjgnKTtcbiAgICByZXR1cm4gSlNPTi5wYXJzZShqc29uKTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBsb2dnZXIuZXJyb3IoJ0ZhaWxlZCB0byBkZWNvbXByZXNzIHBheWxvYWQ6JywgZXJyb3IpO1xuICAgIHRocm93IG5ldyBFcnJvcihgRGVjb21wcmVzc2lvbiBmYWlsZWQ6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWApO1xuICB9XG59XG5cbi8qKlxuICogQXBwbHkgY29tcHJlc3Npb24gdG8gc3BlY2lmaWVkIGZpZWxkcyBpbiBhbiBpdGVtXG4gKiBcbiAqIEBwYXJhbSBpdGVtIC0gSXRlbSB0byBjb21wcmVzc1xuICogQHBhcmFtIGNvbmZpZyAtIENvbXByZXNzaW9uIGNvbmZpZ3VyYXRpb25cbiAqIEByZXR1cm5zIEl0ZW0gd2l0aCBjb21wcmVzc2VkIGZpZWxkc1xuICovXG5leHBvcnQgZnVuY3Rpb24gY29tcHJlc3NJdGVtPFQgZXh0ZW5kcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj4oXG4gIGl0ZW06IFQsXG4gIGNvbmZpZzogQ29tcHJlc3Npb25Db25maWdcbik6IFQge1xuICBpZiAoIWNvbmZpZy5lbmFibGVkKSB7XG4gICAgcmV0dXJuIGl0ZW07XG4gIH1cblxuICBjb25zdCByZXN1bHQgPSB7IC4uLml0ZW0gfSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcblxuICBmb3IgKGNvbnN0IGZpZWxkIG9mIGNvbmZpZy5maWVsZHMpIHtcbiAgICBpZiAoZmllbGQgaW4gcmVzdWx0ICYmIHJlc3VsdFsgZmllbGQgXSAhPT0gbnVsbCAmJiByZXN1bHRbIGZpZWxkIF0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgcmVzdWx0WyBmaWVsZCBdID0gY29tcHJlc3NJZk5lZWRlZChyZXN1bHRbIGZpZWxkIF0sIGNvbmZpZy50aHJlc2hvbGQpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiByZXN1bHQgYXMgVDtcbn1cblxuLyoqXG4gKiBEZWNvbXByZXNzIGFsbCBjb21wcmVzc2VkIGZpZWxkcyBpbiBhbiBpdGVtXG4gKiBcbiAqIEBwYXJhbSBpdGVtIC0gSXRlbSB3aXRoIHBvdGVudGlhbGx5IGNvbXByZXNzZWQgZmllbGRzXG4gKiBAcmV0dXJucyBJdGVtIHdpdGggZGVjb21wcmVzc2VkIGZpZWxkc1xuICovXG5leHBvcnQgZnVuY3Rpb24gZGVjb21wcmVzc0l0ZW08VCBleHRlbmRzIFJlY29yZDxzdHJpbmcsIHVua25vd24+PihpdGVtOiBUKTogVCB7XG4gIGNvbnN0IHJlc3VsdCA9IHsgLi4uaXRlbSB9IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuXG4gIGZvciAoY29uc3Qga2V5IGluIHJlc3VsdCkge1xuICAgIGlmIChpc0NvbXByZXNzZWQocmVzdWx0WyBrZXkgXSkpIHtcbiAgICAgIHJlc3VsdFsga2V5IF0gPSBkZWNvbXByZXNzKHJlc3VsdFsga2V5IF0pO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiByZXN1bHQgYXMgVDtcbn1cbiJdfQ==