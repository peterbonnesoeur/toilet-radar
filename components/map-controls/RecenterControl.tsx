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
    console.log('[RecenterControl] Manual recenter requested');
    
    if (userLocation && map && map.getContainer && map.getContainer()) {
      try {
        console.log(`[RecenterControl] Setting view to: [${userLocation.latitude}, ${userLocation.longitude}]`);
        map.setView([userLocation.latitude, userLocation.longitude], 15);
        onRecenter?.();
      } catch (error) {
        console.error('[RecenterControl] Error setting view:', error);
      }
    }
  };

  // Don't render if no user location
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
        className="w-10 h-10 rounded-md"
        onClick={handleRecenter}
        title="Recenter map on your location"
      >
        <Crosshair className="w-4 h-4" />
      </Button>
    </MapControlWrapper>
  );
} 