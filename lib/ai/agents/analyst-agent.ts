import { azure } from "@ai-sdk/azure"
import { generateText, tool } from "ai"
import { z } from "zod"
import postgres from 'postgres'

interface IntentResult {
    isSqlRelated: boolean
    confidence: number
    businessDomains: Array<{
        domain: string
        relevance: number
        workspaceType: "system" | "custom"
    }>
    reasoning: string
}

interface QueryResult {
    rows: any[]
    fields: any[]
    rowCount: number
    executionTime: number
}

interface ChartData {
    type: 'bar' | 'line' | 'pie' | 'area'
    title: string
    data: Array<{
        label: string
        value: number
        [key: string]: any
    }>
    xAxis?: string
    yAxis?: string
    description?: string
}

interface AnalysisResult {
    query: string
    results: QueryResult
    insights: string[]
    chartData?: ChartData[]
    errors?: string[]
}

// Create a separate connection for query execution with appropriate settings
const createAnalysisConnection = () => {
    if (!process.env.POSTGRES_URL) {
        throw new Error('POSTGRES_URL environment variable is not set');
    }

    return postgres(process.env.POSTGRES_URL, {
        max: 5, // Limit concurrent connections
        idle_timeout: 30, // Close idle connections after 30 seconds
        connect_timeout: 10, // Connection timeout
    });
};

// SQL query validator to ensure only safe SELECT queries
const validateQuery = (query: string): { isValid: boolean; error?: string } => {
    const trimmedQuery = query.trim().toLowerCase();

    // Check if it's a SELECT statement or CTE (WITH statement)
    if (!trimmedQuery.startsWith('select') && !trimmedQuery.startsWith('with')) {
        return { isValid: false, error: 'Only SELECT queries and CTEs (WITH statements) are allowed' };
    }

    // For WITH statements, ensure they contain SELECT and don't contain dangerous operations
    if (trimmedQuery.startsWith('with')) {
        if (!trimmedQuery.includes('select')) {
            return { isValid: false, error: 'WITH statements must contain a SELECT query' };
        }
    }

    // Check for dangerous keywords
    const dangerousKeywords = [
        'drop', 'delete', 'insert', 'update', 'alter', 'truncate',
        'create', 'grant', 'revoke', 'exec', 'execute', 'call',
        'declare', 'merge', 'replace', 'rename', 'comment'
    ];

    for (const keyword of dangerousKeywords) {
        if (trimmedQuery.includes(keyword)) {
            return { isValid: false, error: `Dangerous keyword '${keyword}' is not allowed` };
        }
    }

    return { isValid: true };
};

// Execute a safe SQL query with timeout and resource limits
const executeSafeQuery = async (query: string): Promise<QueryResult> => {
    const validation = validateQuery(query);
    if (!validation.isValid) {
        throw new Error(validation.error);
    }

    const sql = createAnalysisConnection();

    try {
        const startTime = Date.now();

        // Execute query with a timeout of 30 seconds
        const result = await Promise.race([
            sql.unsafe(query),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Query timeout: execution exceeded 30 seconds')), 30000)
            )
        ]) as any;

        const executionTime = Date.now() - startTime;

        console.log('Raw SQL result structure:', {
            hasData: !!result.data,
            hasStatus: !!result.status,
            resultType: typeof result,
            isArray: Array.isArray(result),
            keys: result ? Object.keys(result) : []
        });

        // Handle different response formats
        let rows: any[] = [];
        if (result && typeof result === 'object') {
            if (Array.isArray(result)) {
                // Direct array response
                rows = result;
            } else if (result.data && Array.isArray(result.data)) {
                // Response with data property
                rows = result.data;
            } else if (result.rows && Array.isArray(result.rows)) {
                // Response with rows property
                rows = result.rows;
            } else {
                console.log('Unknown result format:', result);
                rows = [];
            }
        }

        console.log('Processed rows:', {
            rowCount: rows.length,
            firstRow: rows[0],
            sampleRows: rows.slice(0, 3)
        });

        // Extract field information from the first row
        const fields = rows.length > 0 ? Object.keys(rows[0]).map(key => ({ name: key })) : [];

        await sql.end();

        return {
            rows,
            fields,
            rowCount: rows.length,
            executionTime
        };
    } catch (error: any) {
        await sql.end();
        throw new Error(`Query execution failed: ${error.message}`);
    }
};

// Generate insights from query results
const generateInsights = (query: string, results: QueryResult): string[] => {
    const insights: string[] = [];

    if (results.rowCount === 0) {
        insights.push("No rows returned - the query conditions may be too restrictive or the data doesn't exist");
    } else {
        insights.push(`Query returned ${results.rowCount} rows in ${results.executionTime}ms`);

        if (results.rowCount > 1000) {
            insights.push("Large result set - consider adding LIMIT clause for better performance");
        }

        if (results.executionTime > 5000) {
            insights.push("Slow query execution - consider optimizing with indexes or query restructuring");
        } else if (results.executionTime < 100) {
            insights.push("Fast query execution - well optimized");
        }
    }

    // Analyze fields
    if (results.fields.length > 20) {
        insights.push("Many columns returned - consider selecting specific columns for better performance");
    }

    // Basic data type analysis if we have rows
    if (results.rows.length > 0) {
        const firstRow = results.rows[0];
        const nullFields = Object.keys(firstRow).filter(key => firstRow[key] === null);
        if (nullFields.length > 0) {
            insights.push(`Found NULL values in columns: ${nullFields.join(', ')}`);
        }
    }

    return insights;
};

// Extract chart-worthy data from query results
const extractChartData = (query: string, results: QueryResult): ChartData[] => {
    const charts: ChartData[] = [];

    console.log('extractChartData called with:', {
        query: query.slice(0, 100) + '...',
        rowCount: results.rows.length,
        fieldsCount: results.fields.length
    });

    if (results.rows.length === 0) {
        console.log('No rows returned, no charts to extract');
        return charts;
    }

    const firstRow = results.rows[0];
    const fieldNames = Object.keys(firstRow);

    console.log('Field analysis:', {
        fieldNames,
        firstRowSample: firstRow
    });

    // Look for potential chart patterns
    // Pattern 1: Two columns - one categorical, one numeric
    if (fieldNames.length === 2) {
        console.log('Checking Pattern 1: Two columns');
        const [field1, field2] = fieldNames;
        const field1Values = results.rows.map(row => row[field1]);
        const field2Values = results.rows.map(row => row[field2]);

        // Check if one field is categorical and the other is numeric
        const field1IsNumeric = field1Values.every(val => typeof val === 'number' || !isNaN(Number(val)));
        const field2IsNumeric = field2Values.every(val => typeof val === 'number' || !isNaN(Number(val)));

        console.log('Field type analysis:', {
            field1, field1IsNumeric, field1Sample: field1Values.slice(0, 3),
            field2, field2IsNumeric, field2Sample: field2Values.slice(0, 3)
        });

        let labelField, valueField;
        if (!field1IsNumeric && field2IsNumeric) {
            labelField = field1;
            valueField = field2;
        } else if (field1IsNumeric && !field2IsNumeric) {
            labelField = field2;
            valueField = field1;
        }

        if (labelField && valueField) {
            console.log('Creating chart for Pattern 1:', { labelField, valueField });
            const chartData = {
                type: 'bar' as const,
                title: `${valueField} by ${labelField}`,
                xAxis: labelField,
                yAxis: valueField,
                description: `Distribution of ${valueField} across different ${labelField} values`,
                data: results.rows.map(row => ({
                    label: String(row[labelField] || ''),
                    value: Number(row[valueField]) || 0
                }))
            };
            console.log('Chart data created:', JSON.stringify(chartData, null, 2));
            charts.push(chartData);
        } else {
            console.log('Pattern 1 not matched: both fields have same type or unclear types');
        }
    } else {
        console.log('Pattern 1 skipped: field count is', fieldNames.length);
    }

    // Pattern 2: Multiple numeric columns - could be a multi-series chart
    const numericFields = fieldNames.filter(field => {
        const values = results.rows.map(row => row[field]);
        return values.every(val => typeof val === 'number' || !isNaN(Number(val)));
    });

    const nonNumericFields = fieldNames.filter(field => !numericFields.includes(field));

    console.log('Pattern 2 analysis:', {
        numericFields,
        nonNumericFields,
        numericCount: numericFields.length,
        nonNumericCount: nonNumericFields.length
    });

    if (numericFields.length > 1 && nonNumericFields.length === 1) {
        console.log('Creating chart for Pattern 2');
        const labelField = nonNumericFields[0];

        // Create a multi-series chart
        const chartData = {
            type: 'bar' as const,
            title: `Multi-series Analysis by ${labelField}`,
            xAxis: labelField,
            yAxis: 'Values',
            description: `Comparison of ${numericFields.join(', ')} across ${labelField}`,
            data: results.rows.map(row => ({
                label: String(row[labelField] || ''),
                value: numericFields.reduce((sum, field) => sum + (Number(row[field]) || 0), 0)
            }))
        };
        console.log('Pattern 2 chart data created:', JSON.stringify(chartData, null, 2));
        charts.push(chartData);
    }

    // Pattern 3: Time series data
    const timeFields = fieldNames.filter(field => {
        const values = results.rows.map(row => row[field]);
        return values.some(val => {
            if (!val) return false;
            const date = new Date(val);
            return !isNaN(date.getTime());
        });
    });

    console.log('Pattern 3 analysis:', {
        timeFields,
        numericFields,
        hasTimeFields: timeFields.length > 0,
        hasNumericFields: numericFields.length > 0
    });

    if (timeFields.length > 0 && numericFields.length > 0) {
        console.log('Creating chart for Pattern 3');
        const timeField = timeFields[0];
        const valueField = numericFields[0];

        const chartData = {
            type: 'line' as const,
            title: `${valueField} Over Time`,
            xAxis: timeField,
            yAxis: valueField,
            description: `Time series analysis of ${valueField}`,
            data: results.rows.map(row => ({
                label: String(row[timeField] || ''),
                value: Number(row[valueField]) || 0
            }))
        };
        console.log('Pattern 3 chart data created:', JSON.stringify(chartData, null, 2));
        charts.push(chartData);
    }

    console.log('Chart extraction completed:', {
        totalCharts: charts.length,
        chartTitles: charts.map(c => c.title)
    });

    // Fallback pattern: If no charts were created but we have data, try a generic approach
    if (charts.length === 0 && results.rows.length > 0 && fieldNames.length >= 2) {
        console.log('Attempting fallback chart pattern');

        // Find the first numeric field and first non-numeric field
        let numericField = null;
        let labelField = null;

        for (const field of fieldNames) {
            const values = results.rows.map(row => row[field]);
            const isNumeric = values.every(val => typeof val === 'number' || !isNaN(Number(val)));

            if (isNumeric && !numericField) {
                numericField = field;
            } else if (!isNumeric && !labelField) {
                labelField = field;
            }

            if (numericField && labelField) break;
        }

        console.log('Fallback analysis:', { numericField, labelField });

        if (numericField && labelField) {
            console.log('Creating fallback chart');
            const chartData = {
                type: 'bar' as const,
                title: `Data Analysis: ${numericField} by ${labelField}`,
                xAxis: labelField,
                yAxis: numericField,
                description: `Analysis of ${numericField} across different ${labelField} values`,
                data: results.rows.slice(0, 20).map(row => ({ // Limit to 20 rows for performance
                    label: String(row[labelField] || ''),
                    value: Number(row[numericField]) || 0
                }))
            };
            console.log('Fallback chart data created:', JSON.stringify(chartData, null, 2));
            charts.push(chartData);
        } else if (numericField) {
            // Create a simple value chart if we only have numeric data
            console.log('Creating numeric-only fallback chart');
            const chartData = {
                type: 'bar' as const,
                title: `${numericField} Distribution`,
                xAxis: 'Row',
                yAxis: numericField,
                description: `Distribution of ${numericField} values`,
                data: results.rows.slice(0, 20).map((row, index) => ({
                    label: `Row ${index + 1}`,
                    value: Number(row[numericField]) || 0
                }))
            };
            console.log('Numeric fallback chart data created:', JSON.stringify(chartData, null, 2));
            charts.push(chartData);
        }
    }

    return charts;
};

export default async function runAnalystAgent(
    userMessage: string,
    intent: IntentResult,
    messages: any[],
    tableSchema: string,
    queryLogs: string,
    selectedCollectionId = 'all'
) {
    console.log("Analyst agent called with:", {
        userMessage,
        intent,
        selectedCollectionId,
        hasTableSchema: !!tableSchema,
        hasQueryLogs: !!queryLogs
    });

    let allToolCalls: any[] = [];
    let allToolResults: any[] = [];
    let allChartData: ChartData[] = [];

    const {
        text: result,
        toolCalls,
        toolResults,
    } = await generateText({
        model: azure("gpt-4o"),
        system: `You are an expert SQL analyst with deep database knowledge. Your role is to analyze database schemas, execute SQL queries safely, and provide meaningful insights from the results.

## Your Task:
1. Analyze the provided table schema and query logs
2. Generate and execute SQL queries to answer the user's question
3. Provide insights and recommendations based on the results
4. Ensure all queries are safe and optimized
5. Extract chart-worthy data for visualization when possible

## Available Information:
### Table Schema:
${tableSchema}

### Historical Query Logs:
${queryLogs}

## Guidelines:
- Only execute SELECT queries and CTEs (WITH statements) - no data modification allowed
- CTEs (Common Table Expressions) with WITH clauses are fully supported for complex analysis
- Analyze query performance and suggest optimizations
- Provide clear explanations of the results
- Suggest alternative approaches when applicable
- Use insights from historical queries to inform your analysis
- Include relevant business context in your analysis
- When query results contain data suitable for charts, extract and format the chart data
- Use CTEs to break down complex queries into readable, manageable parts

User's context:
- Question: "${userMessage}"
- Business domains: ${intent.businessDomains.map((d) => `${d.domain} (${Math.round(d.relevance * 100)}% relevant)`).join(", ")}
- Collection: ${selectedCollectionId}

You MUST use the execute_sql_query tool to run queries and analyze results. Always explain your approach and findings. When you find chart-worthy data, include it in your analysis. Feel free to use CTEs (WITH statements) for complex analysis that requires multiple steps or intermediate results.`,
        messages: messages,
        tools: {
            execute_sql_query: tool({
                description: "Execute a SQL query safely and return results with analysis",
                parameters: z.object({
                    query: z.string().describe("The SQL SELECT query to execute"),
                    purpose: z.string().describe("Brief explanation of what this query is trying to accomplish"),
                }),
                execute: async ({ query, purpose }) => {
                    console.log("Executing SQL query:", { query: query.slice(0, 200) + "...", purpose });

                    try {
                        const results = await executeSafeQuery(query);
                        const insights = generateInsights(query, results);
                        const chartData = extractChartData(query, results);

                        console.log("Query results preview:", {
                            rowCount: results.rowCount,
                            fieldsCount: results.fields.length,
                            firstRow: results.rows[0],
                            chartDataGenerated: chartData.length
                        });

                        // Log detailed data for debugging
                        if (results.rows.length > 0) {
                            console.log("Sample data rows:");
                            results.rows.slice(0, 5).forEach((row, index) => {
                                console.log(`Row ${index + 1}:`, row);
                            });
                        }

                        const analysis: AnalysisResult = {
                            query,
                            results,
                            insights,
                            chartData
                        };

                        console.log("Query executed successfully:", {
                            rowCount: results.rowCount,
                            executionTime: results.executionTime,
                            fieldsCount: results.fields.length,
                            chartDataCount: chartData.length
                        });

                        return {
                            success: true,
                            analysis,
                            summary: `Query executed successfully. ${results.rowCount} rows returned in ${results.executionTime}ms. ${chartData.length} charts generated.`
                        };
                    } catch (error: any) {
                        console.error("Query execution error:", error.message);

                        const analysis: AnalysisResult = {
                            query,
                            results: { rows: [], fields: [], rowCount: 0, executionTime: 0 },
                            insights: [],
                            chartData: [],
                            errors: [error.message]
                        };

                        return {
                            success: false,
                            analysis,
                            error: error.message,
                            suggestions: [
                                "Check table and column names for typos",
                                "Verify that referenced tables exist in the current database",
                                "Ensure proper JOIN conditions if using multiple tables",
                                "Check data types in WHERE clause conditions"
                            ]
                        };
                    }
                },
            }),

            analyze_query_performance: tool({
                description: "Analyze query performance and suggest optimizations",
                parameters: z.object({
                    query: z.string().describe("The SQL query to analyze"),
                    executionTime: z.number().describe("Query execution time in milliseconds"),
                    rowCount: z.number().describe("Number of rows returned"),
                }),
                execute: async ({ query, executionTime, rowCount }) => {
                    console.log("Analyzing query performance:", { executionTime, rowCount });

                    const suggestions: string[] = [];

                    // Performance analysis
                    if (executionTime > 10000) {
                        suggestions.push("Very slow query (>10s) - consider major optimization");
                    } else if (executionTime > 5000) {
                        suggestions.push("Slow query (>5s) - optimization recommended");
                    } else if (executionTime > 1000) {
                        suggestions.push("Moderate execution time - minor optimization could help");
                    }

                    if (rowCount > 10000) {
                        suggestions.push("Large result set - consider adding LIMIT clause");
                    }

                    // Query pattern analysis
                    const lowerQuery = query.toLowerCase();

                    if (lowerQuery.includes('select *')) {
                        suggestions.push("Avoid SELECT * - specify only needed columns");
                    }

                    if (lowerQuery.includes('like %')) {
                        suggestions.push("Leading wildcard LIKE patterns are slow - consider full-text search");
                    }

                    if (!lowerQuery.includes('limit') && rowCount > 1000) {
                        suggestions.push("Consider adding LIMIT clause for large datasets");
                    }

                    if (lowerQuery.includes('order by') && !lowerQuery.includes('limit')) {
                        suggestions.push("ORDER BY without LIMIT can be expensive on large datasets");
                    }

                    return {
                        performanceScore: executionTime < 1000 ? 'excellent' :
                            executionTime < 5000 ? 'good' :
                                executionTime < 10000 ? 'fair' : 'poor',
                        suggestions,
                        metrics: {
                            executionTime,
                            rowCount,
                            estimatedComplexity: lowerQuery.includes('join') ? 'high' :
                                lowerQuery.includes('group by') ? 'medium' : 'low'
                        }
                    };
                },
            }),
        },
        maxSteps: 5, // Allow multiple query executions and analysis
        onStepFinish: ({ text, toolCalls, toolResults, finishReason, usage }) => {
            console.log("Analyst agent step finished:", {
                text: text?.slice(0, 100) + "...",
                toolCallsCount: toolCalls?.length || 0,
                toolResultsCount: toolResults?.length || 0,
                finishReason,
                usage
            });

            // Accumulate tool calls and results
            if (toolCalls) allToolCalls.push(...toolCalls);
            if (toolResults) {
                allToolResults.push(...toolResults);
                // Extract chart data from execute_sql_query results
                toolResults.forEach(toolResult => {
                    if (toolResult.toolName === 'execute_sql_query' && toolResult.result?.analysis?.chartData) {
                        allChartData.push(...toolResult.result.analysis.chartData);
                    }
                });
            }
        }
    });

    console.log("Analyst agent results:", {
        result: result.slice(0, 200) + "...",
        toolCallsCount: allToolCalls.length,
        toolResultsCount: allToolResults.length,
        chartDataCount: allChartData.length,
        toolCalls: allToolCalls.map((tc) => ({ type: tc.toolName, args: Object.keys(tc.args) })),
        toolResults: allToolResults.map((tr) => ({
            type: tr.toolName,
            success: tr.result?.success,
            error: tr.result?.error?.slice(0, 100)
        })),
    });

    // Include chart data in the result if available
    let finalResult = result;
    if (allChartData.length > 0) {
        finalResult += `\n\nCHART_DATA_START${JSON.stringify(allChartData)}CHART_DATA_END`;
    }

    return finalResult;
}
