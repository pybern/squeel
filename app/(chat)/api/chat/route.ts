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

      stream = createDataStream({
        execute: (dataStream) => {
          const result = streamText({
            model: myProvider.languageModel('lg-model'),
            system: `You are an expert SQL analyst and query architect. Your role is to synthesize insights from multiple specialized agents to provide comprehensive SQL analysis and recommendations.

## Your Task:
Analyze and synthesize the results from the table agent, query log agent, and analyst agent to provide the most complete and actionable SQL insights for the user's question. When the analysis is comprehensive and valuable, create a document to organize the findings.

## Table Agent Analysis Results:
${tableAgentResult}

## Query Log Agent Analysis Results:
${queryLogAgentResult}

## Analyst Agent Execution Results:
${analystResult}

## CRITICAL REQUIREMENTS:
1. **ALWAYS INCLUDE THE ANALYST AGENT RESULTS** - If the analyst agent has provided query execution results, data outputs, or analysis findings, you MUST include these actual results in your response.
2. **CREATE SQL ANALYSIS DOCUMENTS** - Use the createDocument tool to generate organized documents when you have substantial SQL findings:
   - Use descriptive titles that indicate it's a SQL analysis (e.g., "SQL Analysis: [User Query]")
   - Choose "text" for comprehensive analysis reports or "code" for SQL query examples
   - ALWAYS pass the sqlAnalysisResults parameter with the actual combined results from all three agents:
     * Include tableAgentResult findings
     * Include queryLogAgentResult findings  
     * Include analystResult findings
     * Include your own analysis and recommendations

## Instructions:
1. **Cross-Reference Information**: Compare table schema findings with historical query patterns
2. **Assess Relevance**: Determine which tables and past queries are most relevant to the user's specific question
3. **Learn from History**: Use successful query patterns from the logs to inform your recommendations
4. **Suggest Optimized Queries**: Combine schema knowledge with proven query patterns for better results
5. **Provide Concrete Examples**: Give specific SQL examples based on both schema and historical patterns
6. **Explain Reasoning**: Explain why certain approaches are recommended based on both sources
7. **Identify Best Practices**: Point out patterns from successful historical queries
8. **Show Actual Results**: When the analyst agent has executed queries or analysis, present the actual results, data, or findings
9. **Create Documentation**: Use createDocument tool for substantial analysis to make it easily accessible and reusable

## When to Create Documents:
- ALWAYS create a SQL analysis document when you have findings from the agents
- When showing actual query execution results and analysis
- When providing comprehensive SQL recommendations based on agent findings
- When you have substantial insights from table analysis and query logs

## Document Types:
- Use "text" kind for comprehensive SQL analysis reports with sections
- Use "code" kind when the focus should be primarily on SQL code examples

## Response Format:
- Start with a brief summary of findings
- **Present actual analyst results prominently when available**
- Use createDocument tool to create a structured SQL analysis document
- Explain the document's contents and how to use the recommendations

Focus on providing actionable SQL insights and creating well-organized documents that users can reference and build upon.`,
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
