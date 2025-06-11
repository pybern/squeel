'use client';

import { useMemo } from 'react';
import useSWR from 'swr';

export type CollectionType = string;

export function useCollectionSelection({
    chatId,
    initialCollectionId,
}: {
    chatId: string;
    initialCollectionId: string;
}) {
    const { data: localCollectionId, mutate: setLocalCollectionId } = useSWR(
        `${chatId}-collection`,
        null,
        {
            fallbackData: initialCollectionId,
        },
    );

    const collectionId = useMemo(() => {
        return localCollectionId;
    }, [localCollectionId]);

    const setCollectionId = (updatedCollectionId: CollectionType) => {
        setLocalCollectionId(updatedCollectionId);
    };

    return { collectionId, setCollectionId };
} 