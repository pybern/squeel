import { azure } from "@ai-sdk/azure"
import { generateText, tool } from "ai" // Import the tool helper
import { z } from "zod"
import { generateEmbedding } from "../embeddings"
import { supabase } from "@/lib/db/supabase"

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

export default async function suggestTables(userMessage: string, intent: IntentResult, messages: any[], selectedCollectionId = 'all') {
  console.log("Table agent called with:", { userMessage, intent, selectedCollectionId })

  const {
    text: result,
    toolCalls,
    toolResults,
  } = await generateText({
    model: azure("gpt-4o-mini"),
    system: `You are a database schema expert. Your job is to help users find relevant database tables and columns.

When the user asks about database tables, you MUST:
1. ALWAYS use the find_relevant_tables tool first to search for relevant tables
2. After getting the results, provide a clear, helpful response that explains:
   - Which tables are most relevant to their question
   - What columns are available in those tables
   - How the tables could be used to answer their question
   - Suggest potential SQL queries if appropriate

You MUST call the find_relevant_tables tool before providing any response. Do not provide a response without using the tool first.

User's context:
- Question: "${userMessage}"
- Business domains: ${intent.businessDomains.map((d) => `${d.domain} (${Math.round(d.relevance * 100)}% relevant)`).join(", ")}`,
    messages: messages,
    tools: {
      find_relevant_tables: tool({
        description: "Search for relevant database tables using embedding similarity",
        parameters: z.object({
          query: z.string().describe("The search query to find relevant tables"),
          limit: z.number().optional().default(5).describe("Maximum number of tables to return"),
          table_name: z.string().optional().describe("Optional specific table name to filter results"),
        }),
        execute: async ({ query, limit = 5, table_name }) => {
          console.log("Searching for tables")
          try {
            // Generate embedding for the search query
            const queryEmbedding = await generateEmbedding(query)

            // Search for similar tables in Supabase using vector similarity with optional collection filtering
            const { data: results, error } = await supabase.rpc("match_table_embeddings", {
              query_embedding: queryEmbedding,
              match_threshold: 0.3,
              match_count: limit,
              filter_db_id: selectedCollectionId === 'all' ? null : selectedCollectionId,
              filter_table_name: table_name || null,
            })

            if (error) {
              console.error("Supabase search error:", error)
              return {
                error: "Failed to search for table embeddings",
                results: [],
              }
            }

            // Group results by table_name for better organization
            const tableGroups = (results || []).reduce((acc: any, row: any) => {
              const tableName = row.table_name
              if (!acc[tableName]) {
                acc[tableName] = {
                  table_name: tableName,
                  db_id: row.db_id,
                  columns: [],
                  similarity: row.similarity,
                }
              }
              acc[tableName].columns.push({
                column_name: row.column_name,
                column_type: row.column_type,
                text_content: row.text_content,
                similarity: row.similarity,
              })
              return acc
            }, {})

            console.log(Object.values(tableGroups))

            return {
              tables: Object.values(tableGroups),
              searchQuery: query,
              resultsCount: results?.length || 0,
              selectedCollection: selectedCollectionId,
            }
          } catch (error) {
            console.error("Table search error:", error)
            return {
              error: "Failed to search for table embeddings",
              results: [],
            }
          }
        },
      }),
    },
    maxSteps: 2, // Allow for tool call and response
  })

  console.log("Table agent results:", {
    result,
    toolCallsCount: toolCalls?.length || 0,
    toolResultsCount: toolResults?.length || 0,
    toolCalls: toolCalls?.map((tc) => ({ type: tc.toolName, args: tc.args })),
    toolResults: toolResults?.map((tr) => ({ type: tr.toolName, result: tr.result })),
  })

  return result
}
