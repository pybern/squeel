import {
  generateObject,
  generateText,
  appendClientMessage,
  appendResponseMessages,
  createDataStream,
  smoothStream,
  streamText,
} from 'ai';
import { getSessionOrDev, type UserType } from '@/app/(auth)/auth';
import { type RequestHints, systemPrompt } from '@/lib/ai/prompts';
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getMessageCountByUserId,
  getMessagesByChatId,
  getStreamIdsByChatId,
  saveChat,
  saveMessages,
} from '@/lib/db/queries';
import { generateUUID, getTrailingMessageId } from '@/lib/utils';
import { generateTitleFromUserMessage } from '../../actions';
import { createDocument } from '@/lib/ai/tools/create-document';
import { updateDocument } from '@/lib/ai/tools/update-document';
import { requestSuggestions } from '@/lib/ai/tools/request-suggestions';
import { getWeather } from '@/lib/ai/tools/get-weather';
import { isProductionEnvironment } from '@/lib/constants';
import { myProvider } from '@/lib/ai/providers';
import { entitlementsByUserType } from '@/lib/ai/entitlements';
import { postRequestBodySchema, type PostRequestBody } from './schema';
import { geolocation } from '@vercel/functions';
import {
  createResumableStreamContext,
  type ResumableStreamContext,
} from 'resumable-stream';
import { after } from 'next/server';
import type { Chat } from '@/lib/db/schema';
import { differenceInSeconds } from 'date-fns';
import { ChatSDKError } from '@/lib/errors';

import classifyIntent from '@/lib/ai/agents/intent-agent';
import suggestTables from '@/lib/ai/agents/table-agent';
import suggestQueryLogs from '@/lib/ai/agents/query-log-agent';
import runAnalystAgent from '@/lib/ai/agents/analyst-agent';

export const maxDuration = 60;

let globalStreamContext: ResumableStreamContext | null = null;

function getStreamContext() {
  if (!globalStreamContext) {
    try {
      globalStreamContext = createResumableStreamContext({
        waitUntil: after,
      });
    } catch (error: any) {
      if (error.message.includes('REDIS_URL')) {
        console.log(
          ' > Resumable streams are disabled due to missing REDIS_URL',
        );
      } else {
        console.error(error);
      }
    }
  }

  return globalStreamContext;
}

export async function POST(request: Request) {
  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
  } catch (_) {
    return new ChatSDKError('bad_request:api').toResponse();
  }

  try {
    const { id, message, selectedChatModel, selectedVisibilityType, selectedCollectionId } =
      requestBody;

    console.log('Backend received selectedCollectionId:', selectedCollectionId);
    console.log('Full requestBody:', JSON.stringify(requestBody, null, 2));

    const session = await getSessionOrDev();

    if (!session?.user) {
      return new ChatSDKError('unauthorized:chat').toResponse();
    }

    const userType: UserType = session.user.type;

    const messageCount = await getMessageCountByUserId({
      id: session.user.id,
      differenceInHours: 24,
    });

    if (messageCount > entitlementsByUserType[userType].maxMessagesPerDay) {
      return new ChatSDKError('rate_limit:chat').toResponse();
    }

    const chat = await getChatById({ id });

    if (!chat) {
      const title = await generateTitleFromUserMessage({
        message,
      });

      await saveChat({
        id,
        userId: session.user.id,
        title,
        visibility: selectedVisibilityType,
      });
    } else {
      if (chat.userId !== session.user.id) {
        return new ChatSDKError('forbidden:chat').toResponse();
      }
    }

    const previousMessages = await getMessagesByChatId({ id });

    // Transform database messages to AI SDK format
    const transformedMessages = previousMessages.map(msg => ({
      id: msg.id,
      role: msg.role as 'user' | 'assistant' | 'system',
      content: typeof msg.parts === 'string' ? msg.parts : JSON.stringify(msg.parts),
      experimental_attachments: Array.isArray(msg.attachments) ? msg.attachments : [],
    }));

    const messages = appendClientMessage({
      messages: transformedMessages,
      message,
    });

    const { longitude, latitude, city, country } = geolocation(request);

    const requestHints: RequestHints = {
      longitude,
      latitude,
      city,
      country,
    };

    await saveMessages({
      messages: [
        {
          chatId: id,
          id: message.id,
          role: 'user',
          parts: message.parts,
          attachments: message.experimental_attachments ?? [],
          createdAt: new Date(),
        },
      ],
    });

    const streamId = generateUUID();
    await createStreamId({ streamId, chatId: id });
    const intent = await classifyIntent(messages[messages.length - 1].content);

    console.log('Selected Collection ID:', selectedCollectionId);

    let stream;
    // reception agent
    if (intent.isSqlRelated) {
      console.log('SQL-related query detected, using collection:', selectedCollectionId);
      const tableAgentResult = await suggestTables(messages[messages.length - 1].content, intent, messages, selectedCollectionId);
      const queryLogAgentResult = await suggestQueryLogs(messages[messages.length - 1].content, intent, messages, selectedCollectionId);

      // Run analyst agent to execute queries and provide insights
      console.log('Running analyst agent for SQL execution and analysis');
      const analystResult = await runAnalystAgent(
        messages[messages.length - 1].content,
        intent,
        messages,
        tableAgentResult,
        queryLogAgentResult,
        selectedCollectionId
      );

      // Format combined agent results for document creation
      const combinedAgentResults = `
=== DATABASE SCHEMA ANALYSIS (Table Agent Results) ===
${tableAgentResult}

=== HISTORICAL QUERY PATTERNS (Query Log Agent Results) ===
${queryLogAgentResult}

=== QUERY EXECUTION & DATA ANALYSIS (Analyst Agent Results) ===
${analystResult}

=== ANALYSIS TIMESTAMP ===
Analysis performed on: ${new Date().toISOString()}
Selected Collection: ${selectedCollectionId}
User Query: "${messages[messages.length - 1].content}"
      `.trim();

      stream = createDataStream({
        execute: (dataStream) => {
          const result = streamText({
            model: myProvider.languageModel('lg-model'),
            system: `You are an expert SQL analyst and query architect. Your role is to synthesize insights from multiple specialized agents to provide comprehensive SQL analysis and recommendations.

## Your Task:
Analyze and synthesize the results from the table agent, query log agent, and analyst agent to provide the most complete and actionable SQL insights for the user's question. **ALWAYS create a comprehensive analysis document** to organize and display the final results from all agents.

## Combined Agent Analysis Results:
${combinedAgentResults}

## CRITICAL REQUIREMENTS:

### 1. MANDATORY DOCUMENT CREATION
- **ALWAYS create a SQL analysis document** - this is required for every SQL-related query
- Use descriptive titles that clearly indicate the analysis scope (e.g., "SQL Analysis: Customer Revenue Trends", "Database Schema Review: Sales Data")
- Choose "text" kind for comprehensive analysis reports that showcase all agent findings

### 2. COMPREHENSIVE AGENT RESULT SYNTHESIS
- **Combine all three agent results** into a cohesive, professional analysis report
- Structure the sqlAnalysisResults parameter to include:
  * Complete table agent findings (relevant tables, columns, relationships)
  * Query log agent findings (successful patterns, optimizations)
  * Analyst agent results (actual query results, data insights, performance metrics)
  * Your synthesis and recommendations combining all agent insights

### 3. DOCUMENT QUALITY STANDARDS
- Create professional, actionable reports that display ALL important findings
- Structure content with clear sections and subsections
- Include actual data results, query examples, and performance metrics
- Provide specific, actionable recommendations based on combined agent insights

## Analysis Instructions:
1. **Cross-Reference Information**: Compare schema findings with historical patterns and execution results
2. **Present Actual Results**: Always include real query results and data insights from the analyst agent
3. **Identify Patterns**: Highlight successful query patterns and optimization opportunities
4. **Provide Context**: Explain business relevance and practical applications
5. **Generate Actionable Insights**: Create specific recommendations users can implement
6. **Document Everything**: Ensure all valuable findings from each agent are preserved in the artifact

## Response Approach:
1. **Brief Introduction**: Summarize what analysis was performed and what agents were used
2. **Create Analysis Document**: Use createDocument tool with the title describing the analysis and kind="text"
   - Pass the complete combined agent results in the sqlAnalysisResults parameter
   - Ensure the document showcases findings from all three agents
3. **Highlight Key Findings**: Point out the most important discoveries and recommendations
4. **Explain Next Steps**: Guide users on how to use the analysis document effectively

The goal is to create a comprehensive, professional analysis artifact that serves as a complete reference for the SQL analysis performed by all three specialized agents. The document should be immediately useful and display all the important findings from the table agent, query log agent, and analyst agent.`,
            messages,
            maxSteps: 5,
            experimental_activeTools: [
              'createDocument',
            ],
            experimental_transform: smoothStream({ chunking: 'word' }),
            experimental_generateMessageId: generateUUID,
            tools: {
              createDocument: createDocument({ session, dataStream }),
            },
            onFinish: async ({ response }) => {
              if (session.user?.id) {
                try {
                  const assistantId = getTrailingMessageId({
                    messages: response.messages.filter(
                      (message) => message.role === 'assistant',
                    ),
                  });

                  if (!assistantId) {
                    throw new Error('No assistant message found!');
                  }

                  const [, assistantMessage] = appendResponseMessages({
                    messages: [message],
                    responseMessages: response.messages,
                  });

                  await saveMessages({
                    messages: [
                      {
                        id: assistantId,
                        chatId: id,
                        role: assistantMessage.role,
                        parts: assistantMessage.parts,
                        attachments:
                          assistantMessage.experimental_attachments ?? [],
                        createdAt: new Date(),
                      },
                    ],
                  });
                } catch (_) {
                  console.error('Failed to save chat');
                }
              }
            },
            experimental_telemetry: {
              isEnabled: isProductionEnvironment,
              functionId: 'stream-text',
            },
          });

          // Write the initial data to the stream
          dataStream.writeData({
            type: 'text-delta',
            content: 'Analyzing database schema and query patterns...\n\n'
          });

          result.consumeStream();

          result.mergeIntoDataStream(dataStream, {
            sendReasoning: true,
          });
        },
        onError: (error) => {
          console.error('Stream error:', error);
          return 'An error occurred while processing your request. Please try again.';
        },
      });
    }
    else {
      stream = createDataStream({
        execute: (dataStream) => {
          const result = streamText({
            model: myProvider.languageModel(selectedChatModel),
            system: systemPrompt({ selectedChatModel, requestHints }),
            messages,
            maxSteps: 5,
            experimental_activeTools:
              selectedChatModel === 'chat-model-reasoning'
                ? []
                : [
                  'getWeather',
                  'createDocument',
                  'updateDocument',
                  'requestSuggestions',
                ],
            experimental_transform: smoothStream({ chunking: 'word' }),
            experimental_generateMessageId: generateUUID,
            tools: {
              getWeather,
              createDocument: createDocument({ session, dataStream }),
              updateDocument: updateDocument({ session, dataStream }),
              requestSuggestions: requestSuggestions({
                session,
                dataStream,
              }),
            },
            onFinish: async ({ response }) => {
              if (session.user?.id) {
                try {
                  const assistantId = getTrailingMessageId({
                    messages: response.messages.filter(
                      (message) => message.role === 'assistant',
                    ),
                  });

                  if (!assistantId) {
                    throw new Error('No assistant message found!');
                  }

                  const [, assistantMessage] = appendResponseMessages({
                    messages: [message],
                    responseMessages: response.messages,
                  });

                  await saveMessages({
                    messages: [
                      {
                        id: assistantId,
                        chatId: id,
                        role: assistantMessage.role,
                        parts: assistantMessage.parts,
                        attachments:
                          assistantMessage.experimental_attachments ?? [],
                        createdAt: new Date(),
                      },
                    ],
                  });
                } catch (_) {
                  console.error('Failed to save chat');
                }
              }
            },
            experimental_telemetry: {
              isEnabled: isProductionEnvironment,
              functionId: 'stream-text',
            },
          });

          result.consumeStream();

          result.mergeIntoDataStream(dataStream, {
            sendReasoning: true,
          });
        },
        onError: () => {
          return 'Oops, an error occurred!';
        },
      });
    }

    const streamContext = getStreamContext();

    if (streamContext) {
      return new Response(
        await streamContext.resumableStream(streamId, () => stream),
      );
    } else {
      return new Response(stream);
    }
  } catch (error) {
    console.error('Chat route error:', error);
    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }
    // Ensure we always return a Response
    return new Response(
      JSON.stringify({ error: 'An unexpected error occurred' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

export async function GET(request: Request) {
  const streamContext = getStreamContext();
  const resumeRequestedAt = new Date();

  if (!streamContext) {
    return new Response(null, { status: 204 });
  }

  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get('chatId');

  if (!chatId) {
    return new ChatSDKError('bad_request:api').toResponse();
  }

  const session = await getSessionOrDev();

  if (!session?.user) {
    return new ChatSDKError('unauthorized:chat').toResponse();
  }

  let chat: Chat;

  try {
    chat = await getChatById({ id: chatId });
  } catch {
    return new ChatSDKError('not_found:chat').toResponse();
  }

  if (!chat) {
    return new ChatSDKError('not_found:chat').toResponse();
  }

  if (chat.visibility === 'private' && chat.userId !== session.user.id) {
    return new ChatSDKError('forbidden:chat').toResponse();
  }

  const streamIds = await getStreamIdsByChatId({ chatId });

  if (!streamIds.length) {
    return new ChatSDKError('not_found:stream').toResponse();
  }

  const recentStreamId = streamIds.at(-1);

  if (!recentStreamId) {
    return new ChatSDKError('not_found:stream').toResponse();
  }

  const emptyDataStream = createDataStream({
    execute: () => { },
  });

  const stream = await streamContext.resumableStream(
    recentStreamId,
    () => emptyDataStream,
  );

  /*
   * For when the generation is streaming during SSR
   * but the resumable stream has concluded at this point.
   */
  if (!stream) {
    const messages = await getMessagesByChatId({ id: chatId });
    const mostRecentMessage = messages.at(-1);

    if (!mostRecentMessage) {
      return new Response(emptyDataStream, { status: 200 });
    }

    if (mostRecentMessage.role !== 'assistant') {
      return new Response(emptyDataStream, { status: 200 });
    }

    const messageCreatedAt = new Date(mostRecentMessage.createdAt);

    if (differenceInSeconds(resumeRequestedAt, messageCreatedAt) > 15) {
      return new Response(emptyDataStream, { status: 200 });
    }

    const restoredStream = createDataStream({
      execute: (buffer) => {
        buffer.writeData({
          type: 'append-message',
          message: JSON.stringify(mostRecentMessage),
        });
      },
    });

    return new Response(restoredStream, { status: 200 });
  }

  return new Response(stream, { status: 200 });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return new ChatSDKError('bad_request:api').toResponse();
  }

  const session = await getSessionOrDev();

  if (!session?.user) {
    return new ChatSDKError('unauthorized:chat').toResponse();
  }

  const chat = await getChatById({ id });

  if (chat.userId !== session.user.id) {
    return new ChatSDKError('forbidden:chat').toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
}
