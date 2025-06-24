import { Artifact } from '@/components/create-artifact';
import { DiffView } from '@/components/diffview';
import { DocumentSkeleton } from '@/components/document-skeleton';
import { Editor } from '@/components/text-editor';
import {
  ClockRewind,
  CopyIcon,
  MessageIcon,
  PenIcon,
  RedoIcon,
  UndoIcon,
  LineChartIcon,
} from '@/components/icons';
import { Suggestion } from '@/lib/db/schema';
import { toast } from 'sonner';
import { getSuggestions } from '../actions';

interface TextArtifactMetadata {
  suggestions: Array<Suggestion>;
  chartData?: any[];
}

export const textArtifact = new Artifact<'text', TextArtifactMetadata>({
  kind: 'text',
  description: 'Useful for text content, like drafting essays and emails. Supports embedded interactive charts.',
  initialize: async ({ documentId, setMetadata }) => {
    console.log('Text artifact initializing for documentId:', documentId);
    
    try {
      const suggestions = await getSuggestions({ documentId });

      const initialMetadata = {
        suggestions: Array.isArray(suggestions) ? suggestions : [],
        chartData: [],
      };
      
      console.log('Text artifact initializing with metadata:', initialMetadata);
      setMetadata(initialMetadata);
    } catch (error) {
      console.error('Error initializing text artifact:', error);
      
      // Fallback to safe defaults
      const fallbackMetadata = {
        suggestions: [],
        chartData: [],
      };
      
      setMetadata(fallbackMetadata);
    }
  },
  onStreamPart: ({ streamPart, setMetadata, setArtifact }) => {
    const timestamp = new Date().toISOString().split('T')[1];
    console.log(`[${timestamp}] Text artifact onStreamPart called with type:`, streamPart.type);
    console.log('Stream part content preview:', typeof streamPart.content === 'string' ? streamPart.content.slice(0, 100) + '...' : streamPart.content);
    
    if (streamPart.type === 'suggestion') {
      setMetadata((metadata) => {
        console.log('Updating metadata for suggestion, current metadata:', metadata);
        return {
          ...metadata,
          suggestions: [
            ...metadata.suggestions,
            streamPart.content as Suggestion,
          ],
        };
      });
    }

    if (streamPart.type === 'chart-data') {
      console.log('🎯 Text artifact received chart data!');
      console.log('Chart data type:', typeof streamPart.content);
      console.log('Chart data is array:', Array.isArray(streamPart.content));
      console.log('Chart data full content:', streamPart.content);
      if (Array.isArray(streamPart.content)) {
        console.log('Chart data array length:', streamPart.content.length);
        console.log('Chart data contents:', JSON.stringify(streamPart.content, null, 2));
      }
      
      setMetadata((metadata) => {
        console.log('Current metadata before chart data update:', metadata);
        const newMetadata = {
          ...metadata,
          chartData: streamPart.content as any[],
        };
        console.log('Updated metadata with chart data:', newMetadata);
        return newMetadata;
      });
    }

    if (streamPart.type === 'text-delta') {
      // Check if this text delta contains chart data
      const content = streamPart.content as string;
      console.log('📝 Text delta received:', content.slice(0, 100) + (content.length > 100 ? '...' : ''));
      
      if (content.includes('__CHART_DATA_START__') && content.includes('__CHART_DATA_END__')) {
        console.log('🎯 Found chart data in text delta!');
        const chartDataMatch = content.match(/__CHART_DATA_START__(.*?)__CHART_DATA_END__/s);
        if (chartDataMatch) {
          try {
            const chartData = JSON.parse(chartDataMatch[1]);
            console.log('📊 Parsed chart data from text delta:', chartData);
            
            setMetadata((metadata) => {
              console.log('Current metadata before chart data update:', metadata);
              const newMetadata = {
                ...metadata,
                chartData: chartData,
              };
              console.log('Updated metadata with parsed chart data:', newMetadata);
              return newMetadata;
            });
            
            // Don't add the chart data marker to the artifact content
            return;
          } catch (error) {
            console.error('Error parsing chart data from text delta:', error);
          }
        }
      }
      
      setArtifact((draftArtifact) => {
        return {
          ...draftArtifact,
          content: draftArtifact.content + (streamPart.content as string),
          isVisible:
            draftArtifact.status === 'streaming' &&
            draftArtifact.content.length > 400 &&
            draftArtifact.content.length < 450
              ? true
              : draftArtifact.isVisible,
          status: 'streaming',
        };
      });
    }

    if (streamPart.type === 'finish') {
      console.log('Stream finished, artifact status will be set to idle');
      setArtifact((draftArtifact) => ({
        ...draftArtifact,
        status: 'idle',
      }));
    }
  },
  content: ({
    mode,
    status,
    content,
    isCurrentVersion,
    currentVersionIndex,
    onSaveContent,
    getDocumentContentById,
    isLoading,
    metadata,
  }) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] Text artifact content function called with metadata:`, metadata);
    
    if (isLoading) {
      return <DocumentSkeleton artifactKind="text" />;
    }

    if (mode === 'diff') {
      const oldContent = getDocumentContentById(currentVersionIndex - 1);
      const newContent = getDocumentContentById(currentVersionIndex);

      return <DiffView oldContent={oldContent} newContent={newContent} />;
    }

    return (
      <>
        <div className="flex flex-row py-8 md:p-20 px-4">
          <Editor
            content={content}
            suggestions={metadata?.suggestions || []}
            isCurrentVersion={isCurrentVersion}
            currentVersionIndex={currentVersionIndex}
            status={status}
            onSaveContent={onSaveContent}
            chartData={metadata?.chartData || []}
          />

          {metadata &&
          metadata.suggestions &&
          metadata.suggestions.length > 0 ? (
            <div className="md:hidden h-dvh w-12 shrink-0" />
          ) : null}
        </div>
      </>
    );
  },
  actions: [
    {
      icon: <ClockRewind size={18} />,
      description: 'View changes',
      onClick: ({ handleVersionChange }) => {
        handleVersionChange('toggle');
      },
      isDisabled: ({ currentVersionIndex, setMetadata }) => {
        if (currentVersionIndex === 0) {
          return true;
        }

        return false;
      },
    },
    {
      icon: <UndoIcon size={18} />,
      description: 'View Previous version',
      onClick: ({ handleVersionChange }) => {
        handleVersionChange('prev');
      },
      isDisabled: ({ currentVersionIndex }) => {
        if (currentVersionIndex === 0) {
          return true;
        }

        return false;
      },
    },
    {
      icon: <RedoIcon size={18} />,
      description: 'View Next version',
      onClick: ({ handleVersionChange }) => {
        handleVersionChange('next');
      },
      isDisabled: ({ isCurrentVersion }) => {
        if (isCurrentVersion) {
          return true;
        }

        return false;
      },
    },
    {
      icon: <CopyIcon size={18} />,
      description: 'Copy to clipboard',
      onClick: ({ content }) => {
        navigator.clipboard.writeText(content);
        toast.success('Copied to clipboard!');
      },
    },
  ],
  toolbar: [
    {
      icon: <PenIcon />,
      description: 'Add final polish',
      onClick: ({ appendMessage }) => {
        appendMessage({
          role: 'user',
          content:
            'Please add final polish and check for grammar, add section titles for better structure, and ensure everything reads smoothly.',
        });
      },
    },
    {
      icon: <LineChartIcon />,
      description: 'Add chart visualization',
      onClick: ({ appendMessage }) => {
        appendMessage({
          role: 'user',
          content:
            'Please add an interactive chart visualization to illustrate the data. Use the chart marker [chart:chart-bar-label] to embed a bar chart with sample data where appropriate.',
        });
      },
    },
    {
      icon: <MessageIcon />,
      description: 'Request suggestions',
      onClick: ({ appendMessage }) => {
        appendMessage({
          role: 'user',
          content:
            'Please add suggestions you have that could improve the writing and consider adding data visualizations where helpful.',
        });
      },
    },
  ],
});
