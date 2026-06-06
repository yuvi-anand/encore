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
export async function geocodeCity(query: string): Promise<HomeCity> {
  const fallback: HomeCity = {
    city: query.trim(),
    state: '',
    country: 'US',
    lat: 0,
    lng: 0,
  };

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
      query
    )}&format=json&addressdetails=1&limit=1`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Encore/1.0 (concert alerts app)',
        Accept: 'application/json',
      },
    });
    if (!res.ok) return fallback;
    const data: NominatimResult[] = await res.json();
    const top = data[0];
    if (!top) return fallback;

    const addr = top.address ?? {};
    return {
      city: addr.city ?? addr.town ?? addr.village ?? query.trim(),
      state: addr.state ?? '',
      country: addr.country_code ? addr.country_code.toUpperCase() : 'US',
      lat: parseFloat(top.lat),
      lng: parseFloat(top.lon),
    };
  } catch (e) {
    console.error('geocodeCity error:', e);
    return fallback;
  }
}
