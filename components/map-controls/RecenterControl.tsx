'use client';

import React from 'react';
import { useMap } from 'react-leaflet';
import { Button } from '@/components/ui/button';
import { Crosshair } from 'lucide-react';
import { MapControlWrapper } from './MapControlWrapper';
import { RecenterControlProps } from './types';

export function RecenterControl({
  id = 'recenter-control',
  position = 'bottom-right',
  mobilePosition = 'bottom-right',
  priority = 5,
  userLocation,
  onRecenter,
  className = ''
}: RecenterControlProps) {
  const map = useMap();

  const handleRecenter = () => {
    if (userLocation && map && map.getContainer && map.getContainer()) {
      try {
        map.setView([userLocation.latitude, userLocation.longitude], 15);
        onRecenter?.();
      } catch (error) {
        console.error('[RecenterControl] Error setting view:', error);
      }
    }
  };

  if (!userLocation) {
    return null;
  }

  return (
    <MapControlWrapper
      id={id}
      position={position}
      mobilePosition={mobilePosition}
      priority={priority}
      className={`bg-background rounded-md shadow-lg ${className}`}
    >
      <Button
        variant="ghost"
        size="icon"
        className="w-11 h-11 rounded-md"
        onClick={handleRecenter}
        aria-label="Recenter map on your location"
        title="Recenter map on your location"
      >
        <Crosshair className="w-5 h-5" aria-hidden="true" />
      </Button>
    </MapControlWrapper>
  );
}
