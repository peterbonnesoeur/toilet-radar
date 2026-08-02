// Types for map controls
import { ControlPosition } from '@/lib/managers/ui-layout';

export type UserLocation = {
  latitude: number;
  longitude: number;
};

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
