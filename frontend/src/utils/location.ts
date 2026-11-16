/**
 * Locations in messages: "📍 49.74512,13.37721".
 *
 * A location goes into a message as plain text, so every client can read it,
 * and costs about 23 bytes. Chattx shows such text (and geo: addresses) as a
 * link that opens the place on its map, which works offline too.
 */

import { getDeviceConfig } from '../api';
import type { HomeAssistant } from '../types';

export interface LatLon {
  lat: number;
  lon: number;
}

/** Five decimals: about a metre, enough for a meeting point. */
const DECIMALS = 5;

export function validLocation(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
    && !(lat === 0 && lon === 0);
}

/** Longitude back into -180…180 (a map dragged around the world goes past it). */
export function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** The text a location is sent as. */
export function formatLocation(place: LatLon): string {
  return `📍 ${place.lat.toFixed(DECIMALS)},${wrapLon(place.lon).toFixed(DECIMALS)}`;
}

/** A piece of message text: plain text or a location. */
export type LocationPart = { text: string } | { place: LatLon; label: string };

// "📍 49.74512,13.37721" (space and a space after the comma optional) or "geo:49.7,13.3".
const LOCATION = /(?:📍\s?|\bgeo:)(-?\d{1,2}(?:\.\d+)?)\s?,\s?(-?\d{1,3}(?:\.\d+)?)/gu;

// A bare "48.6520,20.1305" (decimal point required), as MECP messages carry it.
const BARE = /(?<![\d.])(-?\d{1,2}\.\d+),\s?(-?\d{1,3}\.\d+)(?![\d.])/gu;

/**
 * Split text into plain parts and locations. `bare` also takes a decimal
 * pair without 📍, for messages whose format says what it is (MECP).
 */
export function splitLocations(text: string, bare = false): LocationPart[] {
  const parts: LocationPart[] = [];
  let last = 0;
  const pattern = bare ? new RegExp(`${LOCATION.source}|${BARE.source}`, 'gu') : LOCATION;
  for (const m of text.matchAll(pattern)) {
    const lat = Number(m[1] ?? m[3]);
    const lon = Number(m[2] ?? m[4]);
    if (!validLocation(lat, lon)) continue;
    const start = m.index ?? 0;
    if (start > last) parts.push({ text: text.slice(last, start) });
    parts.push({ place: { lat, lon }, label: m[0] });
    last = start + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** OpenStreetMap address of a place, for opening it online. */
export function osmUrl(place: LatLon): string {
  return `https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lon}#map=15/${place.lat}/${place.lon}`;
}

/** Where a location to send can come from. */
export type LocationSourceId = 'node' | 'home' | 'map' | 'gps';

export interface LocationSource {
  id: LocationSourceId;
  /** The place, or null when this source has none. Not used for 'map'. */
  get(hass: HomeAssistant, entryId?: string): Promise<LatLon | null>;
  /** False while the source is not finished (GPS). */
  ready: boolean;
}

function fromAttributes(attrs: Record<string, unknown> | undefined): LatLon | null {
  const lat = Number(attrs?.latitude);
  const lon = Number(attrs?.longitude);
  return validLocation(lat, lon) ? { lat, lon } : null;
}

export const LOCATION_SOURCES: LocationSource[] = [
  {
    // The position set on the radio (companion) in Settings → Location.
    id: 'node',
    ready: true,
    async get(hass, entryId) {
      try {
        const c = await getDeviceConfig(hass, entryId);
        const lat = Number(c.latitude);
        const lon = Number(c.longitude);
        return validLocation(lat, lon) ? { lat, lon } : null;
      } catch {
        return null;
      }
    },
  },
  {
    // Home Assistant's home zone.
    id: 'home',
    ready: true,
    async get(hass) {
      return fromAttributes(hass.states['zone.home']?.attributes as Record<string, unknown> | undefined);
    },
  },
  { id: 'map', ready: true, async get() { return null; } },
  {
    // Prepared, not finished: a GPS receiver connected to Home Assistant.
    // The plan is to read a device_tracker or sensor entity with latitude and
    // longitude attributes (for example from gpsd), chosen in Settings, and
    // to refuse a fix that is too old. Until then the option stays disabled.
    id: 'gps',
    ready: false,
    async get(hass) {
      const entityId = gpsEntityId();
      if (!entityId) return null;
      return fromAttributes(hass.states[entityId]?.attributes as Record<string, unknown> | undefined);
    },
  },
];

/** The GPS entity chosen in Settings; none yet (see the 'gps' source). */
export function gpsEntityId(): string | null {
  return null;
}

/**
 * MECP (Mesh Emergency Communication Protocol, CC0): "MECP/<severity>/<codes>
 * [text]", the location as a bare decimal pair after the code P05, for
 * example "MECP/0/M01 M07 2pax P05 48.6520,20.1305". meshcore-tak-bridge turns
 * such a message into an ATAK marker coloured by severity.
 */
export const MECP_SEVERITIES = ['MAYDAY', 'URGENT', 'SAFETY', 'ROUTINE'] as const;

/** The severity of an MECP message (0 MAYDAY … 3 ROUTINE), or null for other text. */
export function mecpSeverity(text: string): number | null {
  const m = /^\s*MECP\/([0-3])\//.exec(text);
  return m ? Number(m[1]) : null;
}
