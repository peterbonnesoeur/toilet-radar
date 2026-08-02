'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMap } from 'react-leaflet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, MapPin, X } from 'lucide-react';
import { GeocodingService, GeocodingResult } from '@/lib/services/geocoding';
import { MapControlWrapper } from './MapControlWrapper';
import { LocationSearchProps, UserLocation } from './types';
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
  const [searchError, setSearchError] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const debouncedSearch = useCallback(
    debounce(async (query: string) => {
      if (query.length < 3) {
        setSearchResults([]);
        setShowResults(false);
        return;
      }

      setIsSearching(true);
      setSearchError(false);
      try {
        const results = await GeocodingService.searchLocation(query);
        setSearchResults(results);
        setShowResults(true);
      } catch (error) {
        setSearchResults([]);
        setSearchError(true);
        setShowResults(true);
      } finally {
        setIsSearching(false);
      }
    }, 500),
    []
  );

  useEffect(() => () => debouncedSearch.cancel(), [debouncedSearch]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    debouncedSearch(value);
  };

  const closeSearch = () => {
    setIsExpanded(false);
    setSearchQuery('');
    setShowResults(false);
    setSearchResults([]);
    setSearchError(false);
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
    closeSearch();
  };

  // Close on Escape and on clicks outside the control.
  useEffect(() => {
    if (!isExpanded) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSearch();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeSearch();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [isExpanded]);

  return (
    <MapControlWrapper
      id={id}
      position={position}
      mobilePosition={mobilePosition}
      priority={priority}
      className={`bg-background rounded-md shadow-lg ${className}`}
    >
      <div className="relative" ref={containerRef}>
        {!isExpanded && (
          <Button
            variant="ghost"
            size="icon"
            className="w-11 h-11 rounded-md"
            onClick={() => setIsExpanded(true)}
            aria-label="Search for a location"
            title="Search for a location"
          >
            <Search className="w-5 h-5" aria-hidden="true" />
          </Button>
        )}

        {isExpanded && (
          <div className="flex items-center gap-1 p-1 max-w-[calc(100vw-2rem)]">
            <div className="relative flex-1 min-w-[180px] sm:min-w-[280px]">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
                <Input
                  type="text"
                  placeholder="Search location..."
                  aria-label="Search for a location"
                  value={searchQuery}
                  onChange={handleInputChange}
                  className="pl-8 pr-4 text-sm h-9"
                  autoFocus
                />
              </div>

              {showResults && searchResults.length > 0 && (
                <div
                  role="listbox"
                  aria-label="Location results"
                  className="absolute top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-y-auto z-20"
                >
                  {searchResults.map((result, index) => (
                    <button
                      key={index}
                      role="option"
                      aria-selected={false}
                      onClick={() => selectLocation(result)}
                      className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted border-b last:border-b-0 flex items-start gap-2"
                    >
                      <MapPin className="w-3 h-3 mt-0.5 text-muted-foreground flex-shrink-0" aria-hidden="true" />
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
                  <div role="status" className="text-sm text-muted-foreground text-center">
                    {searchError
                      ? 'Search failed — check your connection and try again.'
                      : `No locations found for "${searchQuery}"`}
                  </div>
                </div>
              )}

              {isSearching && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg p-3 z-20">
                  <div role="status" className="text-sm text-muted-foreground text-center">
                    Searching...
                  </div>
                </div>
              )}
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="w-11 h-11 rounded-md flex-shrink-0"
              onClick={closeSearch}
              aria-label="Close search"
              title="Close search"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>
    </MapControlWrapper>
  );
}
