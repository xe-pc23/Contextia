import * as Location from 'expo-location';
import type { LocationContext } from '@contextia/contracts';
import type { LocationReadResult, LocationSource } from './types';

export class ExpoLocationSource implements LocationSource {
  async readCurrentLocation(): Promise<LocationReadResult> {
    try {
      const current = await Location.getForegroundPermissionsAsync();
      const permission = current.granted
        ? current
        : current.canAskAgain
          ? await Location.requestForegroundPermissionsAsync()
          : current;
      if (!permission.granted) return { status: 'denied' };
      if (!(await Location.hasServicesEnabledAsync())) return { status: 'unavailable' };

      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const location: LocationContext = {
        latitude: fix.coords.latitude,
        longitude: fix.coords.longitude,
        ...(fix.coords.accuracy === null ? {} : { accuracyMeters: fix.coords.accuracy }),
        capturedAt: new Date(fix.timestamp).toISOString(),
        source: 'gps'
      };
      return { status: 'granted', location };
    } catch {
      return { status: 'unavailable' };
    }
  }
}
