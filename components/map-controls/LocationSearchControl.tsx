'use client';

import React, { useState, useCallback } from 'react';
import { useMap } from 'react-leaflet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, MapPin } from 'lucide-react';
import { GeocodingService, GeocodingResult } from '@/lib/services/geocoding';
import { UserLocation } from '@/lib/services/geolocation';
import { MapControlWrapper } from './MapControlWrapper';
import { LocationSearchProps } from './types';
import debounce from 'lodash.debounce';

export function LocationSearchControl({
  id = 'location-search',
  position = 'top-left',
  mobilePosition = 'top-left',
  priority = 10,
  onLocationSelect,
  className = ''
}: LocationSearchProps) {
  const map = useMap();
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<GeocodingResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const debouncedSearch = useCallback(
    debounce(async (query: string) => {
      if (query.length < 3) {
        setSearchResults([]);
        setShowResults(false);
        return;
      }

      setIsSearching(true);
      try {
        const results = await GeocodingService.searchLocation(query);
        setSearchResults(results);
        setShowResults(true);
      } catch (error) {
        console.error('[LocationSearchControl] Search failed:', error);
        setSearchResults([]);
        setShowResults(false);
      } finally {
        setIsSearching(false);
      }
    }, 500),
    []
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    debouncedSearch(value);
  };

  const selectLocation = (result: GeocodingResult) => {
    if (map && map.getContainer && map.getContainer()) {
      try {
        map.setView([result.lat, result.lng], 14);
      } catch (error) {
        console.error('[LocationSearchControl] Error setting view:', error);
      }
    }

    const userLocation: UserLocation = {
      latitude: result.lat,
      longitude: result.lng
    };
    onLocationSelect?.(userLocation);

    setSearchQuery('');
    setShowResults(false);
    setSearchResults([]);
  };

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
    if (!isExpanded) {
      setSearchQuery('');
      setShowResults(false);
      setSearchResults([]);
    }
  };

  return (
    <MapControlWrapper
      id={id}
      position={position}
      mobilePosition={mobilePosition}
      priority={priority}
      className={`bg-background rounded-md shadow-lg ${className}`}
    >
      <div className="relative">
        {!isExpanded && (
          <Button
            variant="ghost"
            size="icon"
            className="w-10 h-10 rounded-md"
            onClick={toggleExpanded}
            title="Search for a location"
          >
            <Search className="w-4 h-4" />
          </Button>
        )}

        {isExpanded && (
          <div className="flex items-center gap-1 p-1">
            <div className="relative flex-1 min-w-[200px] sm:min-w-[280px]">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search location..."
                  value={searchQuery}
                  onChange={handleInputChange}
                  className="pl-8 pr-4 text-sm h-8"
                  disabled={isSearching}
                  autoFocus
                />
              </div>

              {showResults && searchResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-y-auto z-20">
                  {searchResults.map((result, index) => (
                    <button
                      key={index}
                      onClick={() => selectLocation(result)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted border-b last:border-b-0 flex items-start gap-2"
                    >
                      <MapPin className="w-3 h-3 mt-0.5 text-muted-foreground flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate text-xs sm:text-sm">
                          {result.display_name}
                        </div>
                        {result.type && (
                          <div className="text-xs text-muted-foreground capitalize">
                            {result.type}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {showResults && searchResults.length === 0 && !isSearching && searchQuery.length > 2 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg p-3 z-20">
                  <div className="text-sm text-muted-foreground text-center">
                    No locations found for "{searchQuery}"
                  </div>
                </div>
              )}

              {isSearching && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg p-3 z-20">
                  <div className="text-sm text-muted-foreground text-center">
                    Searching...
                  </div>
                </div>
              )}
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="w-8 h-8 rounded-md flex-shrink-0"
              onClick={toggleExpanded}
              title="Close search"
            >
              <span className="text-lg leading-none">×</span>
            </Button>
          </div>
        )}
      </div>
    </MapControlWrapper>
  );
} 