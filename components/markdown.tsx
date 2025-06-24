import Link from 'next/link';
import React, { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './code-block';
import { ChartComponent, type ChartComponentType } from './chart-components';

// Chart marker pattern: [chart:chart-type]
const CHART_MARKER_REGEX = /\[chart:([^\]]+)\]/g;

const components: Partial<Components> = {
  // @ts-expect-error
  code: CodeBlock,
  pre: ({ children }) => <>{children}</>,
  ol: ({ node, children, ...props }) => {
    return (
      <ol className="list-decimal list-outside ml-4" {...props}>
        {children}
      </ol>
    );
  },
  li: ({ node, children, ...props }) => {
    return (
      <li className="py-1" {...props}>
        {children}
      </li>
    );
  },
  ul: ({ node, children, ...props }) => {
    return (
      <ul className="list-decimal list-outside ml-4" {...props}>
        {children}
      </ul>
    );
  },
  strong: ({ node, children, ...props }) => {
    return (
      <span className="font-semibold" {...props}>
        {children}
      </span>
    );
  },
  a: ({ node, children, ...props }) => {
    return (
      // @ts-expect-error
      <Link
        className="text-blue-500 hover:underline"
        target="_blank"
        rel="noreferrer"
        {...props}
      >
        {children}
      </Link>
    );
  },
  h1: ({ node, children, ...props }) => {
    return (
      <h1 className="text-3xl font-semibold mt-6 mb-2" {...props}>
        {children}
      </h1>
    );
  },
  h2: ({ node, children, ...props }) => {
    return (
      <h2 className="text-2xl font-semibold mt-6 mb-2" {...props}>
        {children}
      </h2>
    );
  },
  h3: ({ node, children, ...props }) => {
    return (
      <h3 className="text-xl font-semibold mt-6 mb-2" {...props}>
        {children}
      </h3>
    );
  },
  h4: ({ node, children, ...props }) => {
    return (
      <h4 className="text-lg font-semibold mt-6 mb-2" {...props}>
        {children}
      </h4>
    );
  },
  h5: ({ node, children, ...props }) => {
    return (
      <h5 className="text-base font-semibold mt-6 mb-2" {...props}>
        {children}
      </h5>
    );
  },
  h6: ({ node, children, ...props }) => {
    return (
      <h6 className="text-sm font-semibold mt-6 mb-2" {...props}>
        {children}
      </h6>
    );
  },
};

// Create components with chart data support
const createComponentsWithChartData = (chartData?: any[]) => ({
  ...components,
  // Custom paragraph renderer that can handle chart markers
  p: ({ node, children, ...props }: any) => {
    // Convert children to string to check for chart markers
    const content = React.Children.toArray(children).join('');
    
    // Check if this paragraph contains only a chart marker
    const chartMatch = content.match(/^\[chart:([^\]]+)\]$/);
    if (chartMatch) {
      const chartType = chartMatch[1] as ChartComponentType;
      return (
        <div className="my-6">
          <ChartComponent type={chartType} chartData={chartData} />
        </div>
      );
    }
    
    // Check for inline chart markers mixed with other content
    if (CHART_MARKER_REGEX.test(content)) {
      const parts = content.split(CHART_MARKER_REGEX);
      const elements = [];
      
      for (let i = 0; i < parts.length; i++) {
        if (i % 2 === 0) {
          // Regular text
          if (parts[i]) {
            elements.push(parts[i]);
          }
        } else {
          // Chart type
          const chartType = parts[i] as ChartComponentType;
          elements.push(
            <div key={i} className="my-6">
              <ChartComponent type={chartType} chartData={chartData} />
            </div>
          );
        }
      }
      
      return (
        <div {...props}>
          {elements}
        </div>
      );
    }
    
    // Regular paragraph
    return (
      <p {...props}>
        {children}
      </p>
    );
  },
});

const PureMarkdown = memo(
  ({
    children,
    chartData,
    ...props
  }: {
    children: string;
    chartData?: any[];
  } & React.ComponentProps<typeof ReactMarkdown>) => (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={createComponentsWithChartData(chartData)}
      {...props}
    >
      {children}
    </ReactMarkdown>
  ),
);

PureMarkdown.displayName = 'Markdown';

export { PureMarkdown as Markdown };
