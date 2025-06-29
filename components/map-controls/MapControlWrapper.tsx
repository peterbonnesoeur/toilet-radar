'use client';

import React, { useEffect, useState } from 'react';
import { UILayoutManager } from '@/lib/managers/ui-layout';
import { MapControlProps } from './types';

interface MapControlWrapperProps extends MapControlProps {
  children: React.ReactNode;
}

export function MapControlWrapper({
  id,
  position = 'top-right',
  mobilePosition,
  priority = 1,
  className = '',
  children
}: MapControlWrapperProps) {
  const [layoutResult, setLayoutResult] = useState(() => {
    // Register control and get initial layout
    UILayoutManager.registerControl({
      id,
      position,
      mobilePosition,
      priority
    });
    return UILayoutManager.getControlLayout(id);
  });

  useEffect(() => {
    // Update layout on window resize
    const handleResize = () => {
      setLayoutResult(UILayoutManager.getControlLayout(id));
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      UILayoutManager.unregisterControl(id);
    };
  }, [id]);

  return (
    <div
      className={`leaflet-control leaflet-bar ${className}`}
      style={{
        ...layoutResult.style,
        zIndex: layoutResult.zIndex
      }}
    >
      {children}
    </div>
  );
} 