'use client';

import { exampleSetup } from 'prosemirror-example-setup';
import { inputRules } from 'prosemirror-inputrules';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import React, { memo, useEffect, useRef, useMemo } from 'react';

import type { Suggestion } from '@/lib/db/schema';
import {
  documentSchema,
  handleTransaction,
  headingRule,
} from '@/lib/editor/config';
import {
  buildContentFromDocument,
  buildDocumentFromContent,
  createDecorations,
} from '@/lib/editor/functions';
import {
  projectWithPositions,
  suggestionsPlugin,
  suggestionsPluginKey,
} from '@/lib/editor/suggestions';
import { Markdown } from './markdown';

type EditorProps = {
  content: string;
  onSaveContent: (updatedContent: string, debounce: boolean) => void;
  status: 'streaming' | 'idle';
  isCurrentVersion: boolean;
  currentVersionIndex: number;
  suggestions: Array<Suggestion>;
  chartData?: any[];
};

function PureEditor({
  content,
  onSaveContent,
  suggestions,
  status,
  chartData,
}: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorView | null>(null);

  // Ensure suggestions is always a valid array
  const safeSuggestions = Array.isArray(suggestions) ? suggestions : [];

  // Extract chart data from document content if embedded
  const extractedChartData = useMemo(() => {
    if (chartData && chartData.length > 0) {
      // Use provided chart data first
      return chartData;
    }
    
    // Try to extract from document content
    if (content) {
      const chartDataMatch = content.match(/<!-- CHART_DATA:(.*?) -->/s);
      if (chartDataMatch) {
        try {
          const parsedChartData = JSON.parse(chartDataMatch[1]);
          console.log('📊 Extracted chart data from document content:', parsedChartData);
          return parsedChartData;
        } catch (error) {
          console.error('Error parsing embedded chart data:', error);
        }
      }
    }
    
    return [];
  }, [content, chartData]);

  // Clean content by removing chart data comments for display
  const cleanContent = useMemo(() => {
    return content.replace(/<!-- CHART_DATA:.*? -->/gs, '').trim();
  }, [content]);

  // Check if content contains chart markers
  const hasCharts = cleanContent.includes('[chart:');

  console.log('Text editor received:', {
    hasCharts,
    chartDataCount: extractedChartData ? extractedChartData.length : 0,
    chartData: extractedChartData ? extractedChartData.map((c: any) => ({ title: c?.title, type: c?.type })) : null,
    suggestionsCount: safeSuggestions.length,
    contentLength: cleanContent.length,
  });

  // Log detailed chart data for debugging
  if (extractedChartData && extractedChartData.length > 0) {
    console.log('Detailed chart data in text editor:', JSON.stringify(extractedChartData, null, 2));
  } else if (hasCharts) {
    console.log('Text editor: Content has charts but no chart data received');
  }

  // Use the extracted chart data
  const effectiveChartData = extractedChartData || [];

  useEffect(() => {
    if (containerRef.current && !editorRef.current && !hasCharts) {
      const state = EditorState.create({
        doc: buildDocumentFromContent(cleanContent),
        plugins: [
          ...exampleSetup({ schema: documentSchema, menuBar: false }),
          inputRules({
            rules: [
              headingRule(1),
              headingRule(2),
              headingRule(3),
              headingRule(4),
              headingRule(5),
              headingRule(6),
            ],
          }),
          suggestionsPlugin,
        ],
      });

      editorRef.current = new EditorView(containerRef.current, {
        state,
      });
    }

    return () => {
      if (editorRef.current) {
        editorRef.current.destroy();
        editorRef.current = null;
      }
    };
    // NOTE: we only want to run this effect once
    // eslint-disable-next-line
  }, [hasCharts]);

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.setProps({
        dispatchTransaction: (transaction) => {
          handleTransaction({
            transaction,
            editorRef,
            onSaveContent,
          });
        },
      });
    }
  }, [onSaveContent]);

  useEffect(() => {
    if (editorRef.current && cleanContent && !hasCharts) {
      const currentContent = buildContentFromDocument(
        editorRef.current.state.doc,
      );

      if (status === 'streaming') {
        const newDocument = buildDocumentFromContent(cleanContent);

        const transaction = editorRef.current.state.tr.replaceWith(
          0,
          editorRef.current.state.doc.content.size,
          newDocument.content,
        );

        transaction.setMeta('no-save', true);
        editorRef.current.dispatch(transaction);
        return;
      }

      if (currentContent !== cleanContent) {
        const newDocument = buildDocumentFromContent(cleanContent);

        const transaction = editorRef.current.state.tr.replaceWith(
          0,
          editorRef.current.state.doc.content.size,
          newDocument.content,
        );

        transaction.setMeta('no-save', true);
        editorRef.current.dispatch(transaction);
      }
    }
  }, [cleanContent, status, hasCharts]);

  useEffect(() => {
    if (editorRef.current?.state.doc && cleanContent && !hasCharts) {
      const validSuggestions = safeSuggestions || [];
      const projectedSuggestions = projectWithPositions(
        editorRef.current.state.doc,
        validSuggestions,
      ).filter(
        (suggestion) => suggestion.selectionStart && suggestion.selectionEnd,
      );

      const decorations = createDecorations(
        projectedSuggestions,
        editorRef.current,
      );

      const transaction = editorRef.current.state.tr;
      transaction.setMeta(suggestionsPluginKey, { decorations });
      editorRef.current.dispatch(transaction);
    }
  }, [safeSuggestions, cleanContent, hasCharts]);

  // If content has charts, render with Markdown component instead of ProseMirror
  if (hasCharts) {
    return (
      <div className="relative prose dark:prose-invert max-w-none">
        <Markdown chartData={effectiveChartData}>{cleanContent}</Markdown>
      </div>
    );
  }

  return (
    <div className="relative prose dark:prose-invert" ref={containerRef} />
  );
}

function areEqual(prevProps: EditorProps, nextProps: EditorProps) {
  // Ensure we're comparing valid arrays
  const prevSuggestions = Array.isArray(prevProps.suggestions) ? prevProps.suggestions : [];
  const nextSuggestions = Array.isArray(nextProps.suggestions) ? nextProps.suggestions : [];
  
  return (
    prevSuggestions.length === nextSuggestions.length &&
    prevSuggestions.every((prev, index) => prev.id === nextSuggestions[index]?.id) &&
    prevProps.currentVersionIndex === nextProps.currentVersionIndex &&
    prevProps.isCurrentVersion === nextProps.isCurrentVersion &&
    !(prevProps.status === 'streaming' && nextProps.status === 'streaming') &&
    prevProps.content === nextProps.content &&
    prevProps.onSaveContent === nextProps.onSaveContent &&
    prevProps.chartData === nextProps.chartData
  );
}

export const Editor = memo(PureEditor, areEqual);
