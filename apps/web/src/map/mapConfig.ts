import type { GeoPoint } from '@contextia/contracts';
import type { WebConfig } from '../runtimeConfig.js';

export function mapStyleUrl(config: WebConfig['map']): string {
  const url = new URL(`https://maps.geo.${config.region}.amazonaws.com/v2/styles/${config.styleName}/descriptor`);
  url.searchParams.set('key', config.apiKey);
  return url.toString();
}
export function parseMapPoint(latitude: number | string, longitude: number | string): GeoPoint | null {
  if (String(latitude).trim() === '' || String(longitude).trim() === '') return null;
  const lat = Number(latitude); const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90) return null;
  return { latitude: lat, longitude: lng >= -180 && lng <= 180 ? lng : ((lng + 180) % 360 + 360) % 360 - 180 };
}
