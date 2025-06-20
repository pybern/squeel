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

    const messages = appendClientMessage({
      // @ts-expect-error: todo add type conversion from DBMessage[] to UIMessage[]
      messages: previousMessages,
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
Analyze and synthesize the results from the table agent, query log agent, and analyst agent to provide the most complete and actionable SQL insights for the user's question.

## Table Agent Analysis Results:
${tableAgentResult}

## Query Log Agent Analysis Results:
${queryLogAgentResult}

## Analyst Agent Execution Results:
${analystResult}

## CRITICAL REQUIREMENT:
**ALWAYS INCLUDE THE ANALYST AGENT RESULTS** - If the analyst agent has provided query execution results, data outputs, or analysis findings, you MUST include these actual results in your response. Do not just reference or summarize them - show the actual data, query results, error messages, or analytical findings that the analyst agent discovered.

## Instructions:
1. **Cross-Reference Information**: Compare table schema findings with historical query patterns
2. **Assess Relevance**: Determine which tables and past queries are most relevant to the user's specific question
3. **Learn from History**: Use successful query patterns from the logs to inform your recommendations
4. **Suggest Optimized Queries**: Combine schema knowledge with proven query patterns for better results
5. **Provide Concrete Examples**: Give specific SQL examples based on both schema and historical patterns
6. **Explain Reasoning**: Explain why certain approaches are recommended based on both sources
7. **Identify Best Practices**: Point out patterns from successful historical queries
8. **Show Actual Results**: When the analyst agent has executed queries or analysis, present the actual results, data, or findings

## Response Format:
- Start with a brief summary of the most relevant tables and historical query patterns
- **If analyst results contain actual data or query outputs, display them prominently**
- Suggest 1-2 specific SQL query approaches with example code based on both schema and query logs
- Explain key relationships between tables and how they've been used in past queries
- Highlight important columns and filtering patterns from successful queries
- Provide performance tips based on historical query complexity and patterns
- Suggest alternative approaches when multiple patterns exist

## Guidelines:
- Prioritize approaches that have been successful in historical queries
- Use proper SQL syntax that matches patterns from the query logs
- Explain complex JOINs or concepts clearly, referencing similar successful queries
- Consider performance implications based on historical query complexity scores
- Adapt historical queries to the current question while maintaining proven patterns
- When historical queries exist, explain how to modify them for the current use case
- **ALWAYS present actual analyst results when they contain concrete data, outputs, or findings**

Focus on providing SQL recommendations that combine the reliability of proven query patterns with the accuracy of current schema information, and always include actual results from the analyst agent when available.`,
            messages,
            experimental_transform: smoothStream({ chunking: 'word' }),
            experimental_generateMessageId: generateUUID,
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
