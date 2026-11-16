import { describe, expect, it } from 'vitest';
import { formatLocation, mecpSeverity, splitLocations, validLocation, wrapLon } from '../src/utils/location';

describe('locations in messages', () => {
  it('formats with five decimals and a pin', () => {
    expect(formatLocation({ lat: 49.745123456, lon: 13.377219 })).toBe('📍 49.74512,13.37722');
  });

  it('wraps a longitude dragged around the world', () => {
    expect(wrapLon(373.5)).toBeCloseTo(13.5);
    expect(wrapLon(-190)).toBeCloseTo(170);
  });

  it('finds pinned coordinates and geo: addresses in text', () => {
    const parts = splitLocations('Meet here 📍 49.74512,13.37722 or geo:50.1,14.4 ok');
    const places = parts.filter((p) => 'place' in p) as Array<{ place: { lat: number; lon: number } }>;
    expect(places.map((p) => p.place)).toEqual([{ lat: 49.74512, lon: 13.37722 }, { lat: 50.1, lon: 14.4 }]);
    expect(parts[0]).toEqual({ text: 'Meet here ' });
  });

  it('accepts a space after the comma and none after the pin', () => {
    expect(splitLocations('📍49.7, 13.3').some((p) => 'place' in p)).toBe(true);
  });

  it('ignores numbers that are not a location', () => {
    expect(splitLocations('📍 99.1,13.3')).toEqual([{ text: '📍 99.1,13.3' }]);
    expect(splitLocations('scores 49.7,13.3')).toEqual([{ text: 'scores 49.7,13.3' }]);
    expect(validLocation(0, 0)).toBe(false);
  });
});

describe('MECP messages', () => {
  it('reads the severity', () => {
    expect(mecpSeverity('MECP/0/M01 M07 2pax P05 48.6520,20.1305')).toBe(0);
    expect(mecpSeverity('MECP/3/L01 running late')).toBe(3);
    expect(mecpSeverity('mecp is fun')).toBeNull();
    expect(mecpSeverity('MECP/7/X')).toBeNull();
  });

  it('finds bare coordinates only when asked', () => {
    const text = 'MECP/0/B01 M01 P05 48.65,20.13 @1430';
    expect(splitLocations(text).some((p) => 'place' in p)).toBe(false);
    const places = splitLocations(text, true).filter((p) => 'place' in p) as Array<{ place: { lat: number; lon: number }; label: string }>;
    expect(places).toEqual([{ place: { lat: 48.65, lon: 20.13 }, label: '48.65,20.13' }]);
  });

  it('keeps the pinned form working next to bare pairs', () => {
    const places = splitLocations('MECP/2/T04 📍 49.1,13.2 and 50.5,14.5', true).filter((p) => 'place' in p);
    expect(places).toHaveLength(2);
  });

  it('does not take parts of longer numbers or times', () => {
    expect(splitLocations('MECP/3/D01 version 1.2.3,4.5.6 at 12:30', true).some((p) => 'place' in p)).toBe(false);
  });
});
