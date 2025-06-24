import { smoothStream, streamText } from 'ai';
import { myProvider } from '@/lib/ai/providers';
import { createDocumentHandler } from '@/lib/artifacts/server';
import { updateDocumentPrompt } from '@/lib/ai/prompts';

export const textDocumentHandler = createDocumentHandler<'text'>({
  kind: 'text',
  onCreateDocument: async ({ title, dataStream, sqlAnalysisResults }) => {
    let draftContent = '';

    // Use SQL analysis results if provided, otherwise use regular content generation
    const systemPrompt = sqlAnalysisResults
      ? `You are creating a comprehensive SQL analysis document that displays the final results from multiple specialized agents. Create a well-structured report with clear sections that showcases all the important findings, query results, and recommendations.

## Chart Integration Capabilities:
You can embed interactive charts in your documents using chart markers. Available chart types:
- \`[chart:chart-bar-label]\` - Displays a bar chart with labels (sample data: monthly desktop visitors)

## Document Structure Guidelines:
Create a professional analysis document with these sections:

### 1. Executive Summary
- Brief overview of the analysis
- Key findings and recommendations
- Business impact summary

### 2. Database Schema Analysis
- Relevant tables identified by the table agent
- Column details and relationships
- Schema insights and recommendations

### 3. Historical Query Patterns
- Insights from query log agent
- Successful query patterns found
- Performance trends and optimizations

### 4. Query Execution Results
- Actual query results from analyst agent
- Data insights and patterns
- Performance metrics and analysis

### 5. Data Visualization
- Include relevant charts using chart markers when data visualization would be helpful
- Use \`[chart:chart-bar-label]\` to display sample bar charts
- Charts automatically render as interactive components

### 6. Comprehensive Recommendations
- Best practices based on all agent findings
- Optimization suggestions
- Next steps and action items

### 7. Technical Appendix
- Detailed query examples
- Performance benchmarks
- Additional technical details

## Formatting Requirements:
- Use clear markdown headers (##, ###)
- Include code blocks for SQL queries with proper syntax highlighting
- Use tables for structured data presentation
- Add bullet points for key insights
- Include performance metrics where available
- Highlight important findings with **bold** text
- Embed charts using chart markers when data visualization is beneficial

## Agent Results to Synthesize:
${sqlAnalysisResults}`
      : `Write about the given topic. Markdown is supported. Use headings wherever appropriate.

## Chart Integration:
You can embed interactive charts in your documents using chart markers:
- \`[chart:chart-bar-label]\` - Displays a bar chart with labels

Example usage:
## Data Visualization

Here's an example chart:

[chart:chart-bar-label]

The chart above shows sample data with interactive features.`;

    const prompt = sqlAnalysisResults
      ? `Create a comprehensive SQL Analysis Report titled "${title}" that synthesizes and presents the final results from all database analysis agents. 

Structure the document to clearly showcase:
- The database schema findings from the table agent
- Historical query patterns from the query log agent  
- Actual execution results and insights from the analyst agent
- Combined recommendations based on all three agents

Make this a professional, actionable report that displays all the important findings in an organized, easy-to-read format. Consider including data visualizations using chart markers where appropriate to illustrate key findings.`
      : title;

    const { fullStream } = streamText({
      model: myProvider.languageModel('artifact-model'),
      system: systemPrompt,
      experimental_transform: smoothStream({ chunking: 'word' }),
      prompt: prompt,
    });

    for await (const delta of fullStream) {
      const { type } = delta;

      if (type === 'text-delta') {
        const { textDelta } = delta;

        draftContent += textDelta;

        dataStream.writeData({
          type: 'text-delta',
          content: textDelta,
        });
      }
    }

    return draftContent;
  },
  onUpdateDocument: async ({ document, description, dataStream }) => {
    let draftContent = '';

    const { fullStream } = streamText({
      model: myProvider.languageModel('artifact-model'),
      system: updateDocumentPrompt(document.content, 'text') + `

## Chart Integration:
You can embed interactive charts in documents using chart markers:
- \`[chart:chart-bar-label]\` - Displays a bar chart with labels

When updating documents, you can add charts by including chart markers in the appropriate locations.`,
      experimental_transform: smoothStream({ chunking: 'word' }),
      prompt: description,
      experimental_providerMetadata: {
        openai: {
          prediction: {
            type: 'content',
            content: document.content,
          },
        },
      },
    });

    for await (const delta of fullStream) {
      const { type } = delta;

      if (type === 'text-delta') {
        const { textDelta } = delta;

        draftContent += textDelta;
        dataStream.writeData({
          type: 'text-delta',
          content: textDelta,
        });
      }
    }

    return draftContent;
  },
});
