'use client';

import { useMemo, useEffect } from 'react';
import useSWR from 'swr';

export type CollectionType = string;

const COLLECTION_STORAGE_KEY = 'selected-collection';

export function useCollectionSelection({
    chatId,
    initialCollectionId,
}: {
    chatId: string;
    initialCollectionId: string;
}) {
    // Get the stored collection ID from localStorage
    const getStoredCollectionId = () => {
        if (typeof window === 'undefined') return initialCollectionId;
        const stored = localStorage.getItem(`${COLLECTION_STORAGE_KEY}-${chatId}`);
        return stored || initialCollectionId;
    };

    const { data: localCollectionId, mutate: setLocalCollectionId } = useSWR(
        `${chatId}-collection`,
        getStoredCollectionId,
        {
            fallbackData: initialCollectionId,
        },
    );

    const collectionId = useMemo(() => {
        return localCollectionId;
    }, [localCollectionId]);

    const setCollectionId = (updatedCollectionId: CollectionType) => {
        // Store in localStorage
        if (typeof window !== 'undefined') {
            localStorage.setItem(`${COLLECTION_STORAGE_KEY}-${chatId}`, updatedCollectionId);
        }
        setLocalCollectionId(updatedCollectionId);
    };

    // Initialize from localStorage on mount
    useEffect(() => {
        const stored = getStoredCollectionId();
        if (stored !== localCollectionId) {
            setLocalCollectionId(stored);
        }
    }, [chatId]);

    return { collectionId, setCollectionId };
} 