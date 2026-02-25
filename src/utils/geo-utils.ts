/**
 * Represents a geographic point with latitude and longitude.
 */
export interface GeoPoint {
    lat: number;
    lng: number;
}

/**
 * Configuration for filtering results by geographic radius.
 */
export interface GeoRadiusFilter {
    center: GeoPoint;
    distanceInMeters: number;
}

/**
 * Configuration for filtering results by geographic bounding box.
 */
export interface GeoBoundingBoxFilter {
    topLeft: GeoPoint;
    bottomRight: GeoPoint;
}

/**
 * Configuration for sorting results by geographic proximity.
 */
export interface GeoSort {
    point: GeoPoint;
    direction?: 'asc' | 'desc';
}

/**
 * Geohash utility for DynamoDB geospatial queries.
 * Based on standard Geohash algorithm (Base32 encoding).
 */
export const GeoHash = {
    BASE32: '0123456789bcdefghjkmnpqrstuvwxyz',

    /**
     * Encodes latitude and longitude into a geohash string.
     */
    encode(lat: number, lng: number, precision: number = 12): string {
        let minLat = -90, maxLat = 90;
        let minLng = -180, maxLng = 180;
        let geohash = '';
        let bit = 0;
        let ch = 0;
        let even = true;

        while (geohash.length < precision) {
            if (even) {
                let mid = (minLng + maxLng) / 2;
                if (lng > mid) {
                    ch |= (1 << (4 - bit));
                    minLng = mid;
                } else {
                    maxLng = mid;
                }
            } else {
                let mid = (minLat + maxLat) / 2;
                if (lat > mid) {
                    ch |= (1 << (4 - bit));
                    minLat = mid;
                } else {
                    maxLat = mid;
                }
            }

            even = !even;
            if (bit < 4) {
                bit++;
            } else {
                geohash += this.BASE32[ch];
                bit = 0;
                ch = 0;
            }
        }
        return geohash;
    },

    /**
     * Decodes a geohash string into latitude and longitude bounds.
     */
    decode(geohash: string): { lat: number, lng: number, error: { lat: number, lng: number } } {
        let even = true;
        let minLat = -90, maxLat = 90;
        let minLng = -180, maxLng = 180;

        for (let i = 0; i < geohash.length; i++) {
            let c = geohash[i];
            let cd = this.BASE32.indexOf(c);
            for (let j = 0; j < 5; j++) {
                let mask = 1 << (4 - j);
                if (even) {
                    let mid = (minLng + maxLng) / 2;
                    if (cd & mask) minLng = mid;
                    else maxLng = mid;
                } else {
                    let mid = (minLat + maxLat) / 2;
                    if (cd & mask) minLat = mid;
                    else maxLat = mid;
                }
                even = !even;
            }
        }

        const lat = (minLat + maxLat) / 2;
        const lng = (minLng + maxLng) / 2;

        return {
            lat,
            lng,
            error: {
                lat: maxLat - lat,
                lng: maxLng - lng
            }
        };
    },

    /**
     * Finds the neighbor geohash in a given direction.
     */
    neighbor(geohash: string, direction: 'n' | 's' | 'e' | 'w'): string {
        geohash = geohash.toLowerCase();
        direction = direction.toLowerCase() as any;

        const lastCh = geohash.charAt(geohash.length - 1);
        const type = (geohash.length % 2) ? 'odd' : 'even';
        let base = geohash.substring(0, geohash.length - 1);

        const neighbors: any = {
            n: { even: 'p0r21436x8zb9dcf5h7kjnmqesgutwvy', odd: 'bc0fg45km89npqrstuvwxyz2367dejh' },
            s: { even: '1436x8zb9dcf5h7kjnmqesgutwvy2bc0', odd: '2367dejhbc0fg45km89npqrstuvwxyz' },
            e: { even: 'bc0fg45km89npqrstuvwxyz2367dejh', odd: 'p0r21436x8zb9dcf5h7kjnmqesgutwvy' },
            w: { even: '2367dejhbc0fg45km89npqrstuvwxyz', odd: '1436x8zb9dcf5h7kjnmqesgutwvy2bc0' },
        };

        const borders: any = {
            n: { even: 'prxz', odd: 'bcfguvyz' },
            s: { even: '028b', odd: '0145hjnp' },
            e: { even: 'bcfguvyz', odd: 'prxz' },
            w: { even: '0145hjnp', odd: '028b' },
        };

        if (borders[direction][type].indexOf(lastCh) !== -1) {
            base = this.neighbor(base, direction);
        }

        return base + this.BASE32[neighbors[direction][type].indexOf(lastCh)];
    },

    /**
     * Returns the 8 neighbors of a geohash plus the hash itself.
     */
    neighbors(geohash: string): string[] {
        const n = this.neighbor(geohash, 'n');
        const s = this.neighbor(geohash, 's');
        const e = this.neighbor(geohash, 'e');
        const w = this.neighbor(geohash, 'w');

        return [
            geohash,
            n,
            s,
            e,
            w,
            this.neighbor(n, 'e'),
            this.neighbor(n, 'w'),
            this.neighbor(s, 'e'),
            this.neighbor(s, 'w'),
        ];
    },

    /**
     * Calculates the Haversine distance between two points in meters.
     */
    calculateDistance(p1: GeoPoint, p2: GeoPoint): number {
        const R = 6371e3; // Earth radius in meters
        const phi1 = p1.lat * Math.PI / 180;
        const phi2 = p2.lat * Math.PI / 180;
        const deltaPhi = (p2.lat - p1.lat) * Math.PI / 180;
        const deltaLambda = (p2.lng - p1.lng) * Math.PI / 180;

        const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c;
    }
};
