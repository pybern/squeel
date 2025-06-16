# Squeel - Agentic SQL Analysis System

<p align="center">
    An intelligent SQL analysis system powered by AI agents that work together to provide comprehensive database insights and query assistance.
</p>

<p align="center">
  <a href="#overview"><strong>Overview</strong></a> ·
  <a href="#agentic-workflow"><strong>Agentic Workflow</strong></a> ·
  <a href="#agents-in-detail"><strong>Agents in Detail</strong></a> ·
  <a href="#how-it-works"><strong>How It Works</strong></a> ·
  <a href="#setup"><strong>Setup</strong></a>
</p>

## Overview

Squeel is an advanced SQL analysis system that uses multiple AI agents working in coordination to provide intelligent database query assistance. The system automatically classifies user questions, identifies relevant database tables, searches historical query patterns, and executes safe SQL queries with detailed analysis.

## Agentic Workflow

The system employs a sophisticated multi-agent architecture where each agent has a specialized role:

```mermaid
graph TD
    A[User Query] --> B[Intent Agent]
    B --> C{SQL Related?}
    C -->|Yes| D[Table Agent]
    C -->|Yes| E[Query Log Agent]
    C -->|Yes| F[Analyst Agent]
    C -->|No| G[Standard Chat Response]
    
    D --> H[Table Schema Results]
    E --> I[Historical Query Patterns]
    F --> J[SQL Execution & Analysis]
    
    H --> K[Response Synthesis]
    I --> K
    J --> K
    K --> L[Final Response to User]
    
    subgraph "Parallel Processing"
        D
        E
    end
    
    subgraph "Database Operations"
        M[Vector Search for Tables]
        N[Vector Search for Queries]
        O[Safe SQL Execution]
        D --> M
        E --> N
        F --> O
    end
```

## Agents in Detail

### 1. Intent Agent
**Location**: `lib/ai/agents/intent-agent.ts`

**Purpose**: Classifies user queries and determines if they're SQL-related

**Key Functions**:
- Analyzes user messages to determine if they involve SQL, databases, or data queries
- Maps queries to business domains (finance, sales, marketing, HR, etc.)
- Provides confidence scores and reasoning for classifications
- Distinguishes between system-defined and custom business domains

**Output**: Intent classification with business domain mapping and confidence scores

### 2. Table Agent
**Location**: `lib/ai/agents/table-agent.ts`

**Purpose**: Identifies relevant database tables and columns using semantic search

**Key Functions**:
- Uses embedding similarity to find relevant tables
- Searches across database schemas using vector similarity
- Filters results by collection/database ID
- Groups results by table name with column details
- Provides table relevance scores

**Tools**:
- `find_relevant_tables`: Semantic search for database tables using embeddings

**Output**: Structured information about relevant tables, columns, and their relationships

### 3. Query Log Agent
**Location**: `lib/ai/agents/query-log-agent.ts`

**Purpose**: Searches historical query patterns for similar use cases

**Key Functions**:
- Finds similar historical queries using embedding similarity
- Filters by query type (SELECT, INSERT, UPDATE, DELETE)
- Categorizes queries by semantic meaning
- Provides actual SQL code examples from historical logs
- Analyzes query complexity and patterns

**Tools**:
- `find_relevant_queries`: Semantic search for historical SQL queries using embeddings

**Output**: Historical query patterns with SQL examples and complexity analysis

### 4. Analyst Agent
**Location**: `lib/ai/agents/analyst-agent.ts`

**Purpose**: Executes SQL queries safely and provides comprehensive analysis

**Key Functions**:
- Validates SQL queries for safety (only SELECT operations allowed)
- Executes queries with timeouts and resource limits
- Generates performance insights and optimization suggestions
- Provides query execution statistics
- Offers concrete recommendations based on results

**Tools**:
- `execute_sql_query`: Safe SQL execution with analysis
- `analyze_query_performance`: Performance analysis and optimization suggestions

**Safety Features**:
- Query validation to prevent dangerous operations
- Connection pooling with limits
- 30-second query timeout
- Resource usage monitoring

## How It Works

### 1. Query Classification
When a user submits a question, the **Intent Agent** first analyzes it to determine:
- Is this SQL-related?
- What business domains are relevant?
- What's the confidence level?

### 2. Parallel Information Gathering
If the query is SQL-related, two agents work in parallel:

**Table Agent**:
- Generates embeddings for the user's question
- Searches vector database for similar table schemas
- Returns relevant tables with column information

**Query Log Agent**:
- Searches historical query embeddings
- Finds similar past queries with actual SQL code
- Provides patterns and complexity analysis

### 3. Query Execution & Analysis
The **Analyst Agent** takes the results from the previous agents and:
- Synthesizes table schema information with historical patterns
- Generates and executes safe SQL queries
- Provides performance analysis and optimization suggestions
- Generates insights based on query results

### 4. Response Synthesis
The system combines all agent outputs to provide:
- Relevant table schemas and relationships
- Historical query patterns and examples
- Executed query results with analysis
- Performance recommendations
- Suggested alternative approaches

## Key Features

### Safety & Security
- **Query Validation**: Only SELECT queries are allowed
- **Timeout Protection**: 30-second execution limit
- **Resource Limits**: Connection pooling and resource monitoring
- **Dangerous Keyword Filtering**: Prevents harmful operations

### Performance Optimization
- **Parallel Agent Execution**: Table and Query Log agents run simultaneously
- **Vector Search**: Fast semantic similarity search for tables and queries
- **Connection Pooling**: Efficient database connection management
- **Query Performance Analysis**: Automatic optimization suggestions

### Business Domain Intelligence
- **Domain Mapping**: Automatic classification into business domains
- **Collection Filtering**: Support for multiple database collections
- **Historical Pattern Learning**: Learns from successful query patterns
- **Context-Aware Responses**: Tailored responses based on business context

## Setup

### Prerequisites
- Node.js 18+
- PostgreSQL database
- Supabase account (for vector embeddings)
- Azure OpenAI API access

### Environment Variables
```bash
POSTGRES_URL=your_postgres_connection_string
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
AZURE_OPENAI_API_KEY=your_azure_openai_key
AZURE_OPENAI_ENDPOINT=your_azure_openai_endpoint
```

### Installation
```bash
npm install
npm run dev
```

### Database Setup
The system requires vector embeddings stored in Supabase with the following functions:
- `match_table_embeddings`: For table schema search
- `match_query_embeddings`: For historical query search

## Development Mode Authentication Bypass

For easier development and testing, the application includes an authentication bypass feature:

- **Development Mode**: Automatic mock user session, no OAuth setup required
- **Production Mode**: Full authentication flow with configured OAuth providers
- **Quick Start**: Simply run `npm run dev` and access `localhost:3000`

## Example: Real Agent Workflow

Here's a real example of how the agents work together to answer the question **"how much is the largest account?"**

### 1. Intent Agent Classification
```json
{
  "isSqlRelated": true,
  "confidence": 0.9,
  "businessDomains": [
    { "domain": "finance", "relevance": 0.8, "workspaceType": "system" },
    { "domain": "analytics", "relevance": 0.6, "workspaceType": "system" }
  ],
  "reasoning": "The question is SQL-related as it involves retrieving data about accounts, likely from a database. The finance domain is relevant due to the context of accounts, while analytics is relevant for data analysis."
}
```

### 2. Table Agent Results
**Found 3 relevant tables** with semantic similarity scores:

```javascript
[
  {
    table_name: 'accounts',
    db_id: 'small_bank_1',
    columns: [
      { column_name: 'name', column_type: 'text' },
      { column_name: 'customer_id', column_type: 'integer' }
    ],
    similarity: 0.358711085242699
  },
  {
    table_name: 'checking',
    db_id: 'small_bank_1', 
    columns: [
      { column_name: 'balance', column_type: 'numeric' }
    ],
    similarity: 0.316891548077741
  },
  {
    table_name: 'savings',
    db_id: 'small_bank_1',
    columns: [
      { column_name: 'balance', column_type: 'numeric' }
    ],
    similarity: 0.311994355202072
  }
]
```

**Table Agent Analysis**:
- Identified `checking` and `savings` tables contain balance information
- Suggested queries for finding largest balances across account types
- Recommended UNION approach for cross-table comparison

### 3. Query Log Agent Results
```javascript
{
  queries: [],
  searchQuery: "largest account balance maximum",
  resultsCount: 0,
  selectedCollection: "small_bank_1"
}
```

**Query Log Agent Response**:
- No historical queries found for this specific pattern
- Provided SQL query recommendations based on table structure
- Suggested multiple approaches with performance tips

### 4. Analyst Agent Execution
**Executed 2 SQL queries in parallel**:

**Query 1**: `SELECT MAX(balance) AS largest_checking_balance FROM checking;`
- **Result**: $10,000.00
- **Execution time**: 269ms
- **Row count**: 1

**Query 2**: `SELECT MAX(balance) AS largest_savings_balance FROM savings;`
- **Result**: $15,000.00  
- **Execution time**: 558ms
- **Row count**: 1

**Analyst Agent Insights**:
- Fast query execution (< 1 second for both)
- Well-optimized queries
- Clear comparison between account types
- Recommendations for JOIN queries if customer details needed

### 5. Final Synthesis
The system combined all agent outputs to provide:
- **Answer**: Largest account balance is $15,000.00 (from savings)
- **Context**: Comparison between checking ($10,000) and savings ($15,000)
- **SQL Examples**: Multiple query approaches with explanations
- **Performance Analysis**: Fast execution times indicate good optimization
- **Recommendations**: Suggestions for extended queries with customer information

This example demonstrates how the multi-agent system provides comprehensive analysis beyond just answering the question, including context, alternatives, and optimization insights.

## Architecture Benefits

### Modularity
Each agent has a single responsibility, making the system maintainable and extensible.

### Scalability
Agents can be scaled independently based on workload requirements.

### Accuracy
Multiple specialized agents provide more accurate and comprehensive responses than a single general-purpose agent.

### Safety
Multi-layer validation ensures safe query execution and prevents harmful operations.

### Learning
The system learns from historical query patterns to improve future recommendations.
