import type {
  GeocodedPlace, Place, ProviderNeed, ProviderResult, RouteSummary, ScenarioContextInput,
  ScenarioId, TriggerType, UserPreferences, WeatherSnapshot
} from '@contextia/contracts';

export interface ScenarioFixture {
  id: ScenarioId;
  label: string;
  primaryTrigger: TriggerType;
  providerNeeds: ProviderNeed[];
  context: ScenarioContextInput;
  preferences: UserPreferences;
  providers: {
    geocoding: ProviderResult<GeocodedPlace[]>;
    places: ProviderResult<Place[]>;
    weather: ProviderResult<WeatherSnapshot>;
    routes: ProviderResult<RouteSummary[]>;
  };
}
