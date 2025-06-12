'use client';

import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { useDebounceCallback } from 'usehooks-ts';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { CheckCircleFillIcon, ChevronDownIcon, DatabaseIcon } from './icons';
import { supabase } from '@/lib/db/supabase';

export type CollectionType = string;

interface Collection {
  id: string;
  label: string;
  description?: string;
  tableCount?: number;
}

export function CollectionSelector({
  selectedCollectionId,
  onCollectionChange,
  className,
}: {
  selectedCollectionId: string;
  onCollectionChange: (collectionId: string) => void;
} & React.ComponentProps<typeof Button>) {
  const [open, setOpen] = useState(false);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [actualCollectionCount, setActualCollectionCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Debounce search query updates
  const debouncedSetSearch = useDebounceCallback((query: string) => {
    setDebouncedSearchQuery(query);
  }, 500);

  // Fetch available collections from the collections table
  useEffect(() => {
    async function fetchCollections() {
      try {
        setLoading(true);
        
        // Get collections from the dedicated collections table
        const { data, error } = await supabase
          .from('collections')
          .select('db_id, name, description, table_count, total_embeddings')
          .order('db_id');

        if (error) {
          console.error('Error fetching collections:', error);
          return;
        }

        // Calculate totals
        const totalTables = (data || []).reduce((sum, collection) => sum + collection.table_count, 0);
        const totalEmbeddings = (data || []).reduce((sum, collection) => sum + collection.total_embeddings, 0);
        const actualCount = data?.length || 0;
        
        const collectionsData: Collection[] = [
          {
            id: 'all',
            label: 'All Collections',
            description: `Search across ${totalTables} tables (${totalEmbeddings.toLocaleString()} embeddings) in ${actualCount} collections`,
            tableCount: totalTables
          },
          ...(data || []).map(collection => ({
            id: collection.db_id,
            label: collection.name || collection.db_id,
            description: `${collection.table_count} table${collection.table_count !== 1 ? 's' : ''} • ${collection.total_embeddings.toLocaleString()} embeddings`,
            tableCount: collection.table_count
          }))
        ];

        setCollections(collectionsData);
        setActualCollectionCount(actualCount);
      } catch (error) {
        console.error('Error fetching collections:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchCollections();
  }, []);

  // Update debounced search when search query changes
  useEffect(() => {
    debouncedSetSearch(searchQuery);
  }, [searchQuery, debouncedSetSearch]);

  // Filter collections based on debounced search query
  const filteredCollections = useMemo(() => {
    if (!debouncedSearchQuery) return collections;
    
    return collections.filter(collection =>
      collection.label.toLowerCase().includes(debouncedSearchQuery.toLowerCase()) ||
      collection.description?.toLowerCase().includes(debouncedSearchQuery.toLowerCase())
    );
  }, [collections, debouncedSearchQuery]);

  // Reset highlighted index when filtered collections change
  useEffect(() => {
    setHighlightedIndex(0);
  }, [filteredCollections]);

  // Focus search input when dropdown opens and maintain focus
  useEffect(() => {
    if (open && searchInputRef.current) {
      // Use a small delay to ensure the dropdown is rendered
      const timeoutId = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 10);
      return () => clearTimeout(timeoutId);
    }
  }, [open]);

  // Maintain focus on the search input when collections change
  useEffect(() => {
    if (open && searchInputRef.current && document.activeElement !== searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [filteredCollections, open]);

  const selectedCollection = useMemo(
    () => collections.find((collection) => collection.id === selectedCollectionId),
    [selectedCollectionId, collections],
  );

  const handleCollectionSelect = (collectionId: string) => {
    console.log('Collection changed to:', collectionId);
    onCollectionChange(collectionId);
    setOpen(false);
    setSearchQuery(''); // Clear search when selection is made
    setHighlightedIndex(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((prev) => 
          prev < filteredCollections.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) => prev > 0 ? prev - 1 : prev);
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredCollections[highlightedIndex]) {
          handleCollectionSelect(filteredCollections[highlightedIndex].id);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        setSearchQuery('');
        break;
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    // Prevent the dropdown from closing when typing in the input
    e.stopPropagation();
    
    // Handle navigation keys
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((prev) => 
          prev < filteredCollections.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) => prev > 0 ? prev - 1 : prev);
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredCollections[highlightedIndex]) {
          handleCollectionSelect(filteredCollections[highlightedIndex].id);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        setSearchQuery('');
        break;
    }
  };

  if (loading || collections.length === 0) {
    return (
      <Button
        variant="outline"
        className={cn("md:px-2 md:h-[34px] opacity-50 [&_svg:first-child]:!w-3 [&_svg:first-child]:!h-3", className)}
        disabled
      >
        <DatabaseIcon size={12} />
        Loading...
        <ChevronDownIcon />
      </Button>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        asChild
        className={cn(
          'w-fit data-[state=open]:bg-accent data-[state=open]:text-accent-foreground',
          className,
        )}
      >
        <Button
          data-testid="collection-selector"
          variant="outline"
          className="md:px-2 md:h-[34px] [&_svg:first-child]:!w-3 [&_svg:first-child]:!h-3"
          onKeyDown={handleKeyDown}
        >
          <DatabaseIcon size={12} />
          {selectedCollection?.label || 'Select Collection'}
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="min-w-[350px] max-h-[400px]">
        {/* Search Input */}
        <div className="p-2 border-b" onMouseDown={(e) => e.preventDefault()}>
          <Input
            ref={searchInputRef}
            placeholder="Search collections..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            onFocus={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="h-8"
          />
        </div>

        {/* Collections List */}
        <div className="max-h-[300px] overflow-y-auto">
          {filteredCollections.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground text-sm">
              No collections found matching "{debouncedSearchQuery}"
            </div>
          ) : (
            filteredCollections.map((collection, index) => (
              <DropdownMenuItem
                data-testid={`collection-selector-item-${collection.id}`}
                key={collection.id}
                onSelect={() => handleCollectionSelect(collection.id)}
                className={cn(
                  "gap-4 group/item flex flex-row justify-between items-center cursor-pointer",
                  index === highlightedIndex && "bg-accent"
                )}
                data-active={collection.id === selectedCollectionId}
              >
                <div className="flex flex-col gap-1 items-start">
                  <div className="font-medium">{collection.label}</div>
                  {collection.description && (
                    <div className="text-xs text-muted-foreground">
                      {collection.description}
                    </div>
                  )}
                </div>
                <div className="text-foreground dark:text-foreground opacity-0 group-data-[active=true]/item:opacity-100">
                  <CheckCircleFillIcon />
                </div>
              </DropdownMenuItem>
            ))
          )}
        </div>

        {/* Collection Count */}
        <div className="p-2 border-t text-xs text-muted-foreground text-center">
          {debouncedSearchQuery ? (
            <>Showing {filteredCollections.length - (filteredCollections.some(c => c.id === 'all') ? 1 : 0)} of {actualCollectionCount} collections</>
          ) : (
            <>{actualCollectionCount} collections available</>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
} 