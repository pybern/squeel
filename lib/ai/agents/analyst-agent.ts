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

interface AnalysisResult {
    query: string
    results: QueryResult
    insights: string[]
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

    // Check if it's a SELECT statement
    if (!trimmedQuery.startsWith('select')) {
        return { isValid: false, error: 'Only SELECT queries are allowed' };
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
        ]) as any[];

        const executionTime = Date.now() - startTime;

        // Extract field information from the first row
        const fields = result.length > 0 ? Object.keys(result[0]).map(key => ({ name: key })) : [];

        await sql.end();

        return {
            rows: result,
            fields,
            rowCount: result.length,
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

## Available Information:
### Table Schema:
${tableSchema}

### Historical Query Logs:
${queryLogs}

## Guidelines:
- Only execute SELECT queries - no data modification allowed
- Analyze query performance and suggest optimizations
- Provide clear explanations of the results
- Suggest alternative approaches when applicable
- Use insights from historical queries to inform your analysis
- Include relevant business context in your analysis

User's context:
- Question: "${userMessage}"
- Business domains: ${intent.businessDomains.map((d) => `${d.domain} (${Math.round(d.relevance * 100)}% relevant)`).join(", ")}
- Collection: ${selectedCollectionId}

You MUST use the execute_sql_query tool to run queries and analyze results. Always explain your approach and findings.`,
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

                        const analysis: AnalysisResult = {
                            query,
                            results,
                            insights
                        };

                        console.log("Query executed successfully:", {
                            rowCount: results.rowCount,
                            executionTime: results.executionTime,
                            fieldsCount: results.fields.length
                        });

                        return {
                            success: true,
                            analysis,
                            summary: `Query executed successfully. ${results.rowCount} rows returned in ${results.executionTime}ms.`
                        };
                    } catch (error: any) {
                        console.error("Query execution error:", error.message);

                        const analysis: AnalysisResult = {
                            query,
                            results: { rows: [], fields: [], rowCount: 0, executionTime: 0 },
                            insights: [],
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
            if (toolResults) allToolResults.push(...toolResults);
        }
    });

    console.log("Analyst agent results:", {
        result: result.slice(0, 200) + "...",
        toolCallsCount: allToolCalls.length,
        toolResultsCount: allToolResults.length,
        toolCalls: allToolCalls.map((tc) => ({ type: tc.toolName, args: Object.keys(tc.args) })),
        toolResults: allToolResults.map((tr) => ({
            type: tr.toolName,
            success: tr.result?.success,
            error: tr.result?.error?.slice(0, 100)
        })),
    });

    return result;
}
