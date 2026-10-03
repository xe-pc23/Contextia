import type { GeoPoint, ProviderResult, WeatherSnapshot } from '@contextia/contracts';

export interface WeatherInput { position: GeoPoint; at: string; timezone?: string }
export interface WeatherProvider {
  // Out-of-coverage scenario times return unavailable. Never rewrite weather history.
  getWeather(input: WeatherInput): Promise<ProviderResult<WeatherSnapshot>>;
}
