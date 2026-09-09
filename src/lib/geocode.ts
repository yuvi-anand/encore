import { HomeCity } from '../types';

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    country_code?: string;
  };
}

/**
 * Geocodes a free-text city name into a HomeCity with coordinates using the
 * free OpenStreetMap Nominatim API. Returns a best-effort result; if geocoding
 * fails, coordinates fall back to 0/0 (distance features just won't work for it).
 */
// Nominatim is a free service and asks callers to keep the rate down, so
// repeat lookups of the same string (retyping, going back a step) are served
// from memory instead of hitting it again.
const cache = new Map<string, HomeCity>();

/** True when geocoding fell back to 0/0, i.e. distance features won't work. */
export function isUnlocated(city: HomeCity): boolean {
  return city.lat === 0 && city.lng === 0;
}

export async function geocodeCity(query: string): Promise<HomeCity> {
  const fallback: HomeCity = {
    city: query.trim(),
    state: '',
    country: 'US',
    lat: 0,
    lng: 0,
  };

  const cacheKey = query.trim().toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
      query
    )}&format=json&addressdetails=1&limit=1`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Encore/1.0 (concert alerts app)',
        'Accept-Language': 'en',
        Accept: 'application/json',
      },
    });
    if (!res.ok) return fallback;
    const data: NominatimResult[] = await res.json();
    const top = data[0];
    if (!top) return fallback;

    const addr = top.address ?? {};
    const resolved: HomeCity = {
      city: addr.city ?? addr.town ?? addr.village ?? query.trim(),
      state: addr.state ?? '',
      country: addr.country_code ? addr.country_code.toUpperCase() : 'US',
      lat: parseFloat(top.lat),
      lng: parseFloat(top.lon),
    };
    cache.set(cacheKey, resolved);
    return resolved;
  } catch (e) {
    console.error('geocodeCity error:', e);
    return fallback;
  }
}
