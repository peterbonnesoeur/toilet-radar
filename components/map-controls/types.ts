// Types for map controls
import { UserLocation } from '@/lib/services/geolocation';
import { ControlPosition } from '@/lib/managers/ui-layout';

export interface MapControlProps {
  id: string;
  position?: ControlPosition;
  mobilePosition?: ControlPosition;
  priority?: number;
  className?: string;
}

export interface LocationSearchProps extends MapControlProps {
  onLocationSelect?: (location: UserLocation) => void;
}

export interface RecenterControlProps extends MapControlProps {
  userLocation: UserLocation | null;
  onRecenter?: () => void;
} 