'use client';

import { useChat } from '@ai-sdk/react';
import { useEffect, useRef } from 'react';
import { artifactDefinitions, ArtifactKind } from './artifact';
import { Suggestion } from '@/lib/db/schema';
import { initialArtifactData, useArtifact } from '@/hooks/use-artifact';

export type DataStreamDelta = {
  type:
    | 'text-delta'
    | 'code-delta'
    | 'sheet-delta'
    | 'image-delta'
    | 'title'
    | 'id'
    | 'suggestion'
    | 'clear'
    | 'finish'
    | 'kind'
    | 'chart-data';
  content: string | Suggestion | any[];
};

export function DataStreamHandler({ id }: { id: string }) {
  const { data: dataStream } = useChat({ id });
  const { artifact, setArtifact, setMetadata } = useArtifact();
  const lastProcessedIndex = useRef(-1);

  useEffect(() => {
    if (!dataStream?.length) return;

    const newDeltas = dataStream.slice(lastProcessedIndex.current + 1);
    lastProcessedIndex.current = dataStream.length - 1;

    console.log('📡 DataStreamHandler processing', newDeltas.length, 'new deltas');
    console.log('Delta types:', newDeltas.map(d => d.type));
    
    // Log all deltas with content info
    newDeltas.forEach((delta, index) => {
      console.log(`Delta ${index}:`, {
        type: delta.type,
        contentType: typeof delta.content,
        contentLength: typeof delta.content === 'string' ? delta.content.length : Array.isArray(delta.content) ? delta.content.length : 'unknown',
        isArray: Array.isArray(delta.content)
      });
    });

    (newDeltas as DataStreamDelta[]).forEach((delta: DataStreamDelta) => {
      console.log('Processing delta:', delta.type, 'artifact kind:', artifact.kind);
      
      // Special logging for chart-data
      if (delta.type === 'chart-data') {
        console.log('🎯 DataStreamHandler: Processing chart-data delta');
        console.log('Chart data content:', delta.content);
        console.log('Chart data is array:', Array.isArray(delta.content));
        console.log('Current artifact:', artifact);
      }
      
      const artifactDefinition = artifactDefinitions.find(
        (artifactDefinition) => artifactDefinition.kind === artifact.kind,
      );

      if (artifactDefinition?.onStreamPart) {
        console.log('✅ Calling onStreamPart for:', delta.type, 'on artifact kind:', artifact.kind);
        artifactDefinition.onStreamPart({
          streamPart: delta,
          setArtifact,
          setMetadata,
        });
      } else {
        console.log('❌ No onStreamPart found for artifact kind:', artifact.kind);
      }

      setArtifact((draftArtifact) => {
        if (!draftArtifact) {
          return { ...initialArtifactData, status: 'streaming' };
        }

        switch (delta.type) {
          case 'id':
            return {
              ...draftArtifact,
              documentId: delta.content as string,
              status: 'streaming',
            };

          case 'title':
            return {
              ...draftArtifact,
              title: delta.content as string,
              status: 'streaming',
            };

          case 'kind':
            return {
              ...draftArtifact,
              kind: delta.content as ArtifactKind,
              status: 'streaming',
            };

          case 'clear':
            return {
              ...draftArtifact,
              content: '',
              status: 'streaming',
            };

          case 'finish':
            return {
              ...draftArtifact,
              status: 'idle',
            };

          default:
            return draftArtifact;
        }
      });
    });
  }, [dataStream, setArtifact, setMetadata, artifact]);

  return null;
}
