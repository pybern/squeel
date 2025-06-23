import { generateUUID } from '@/lib/utils';
import { DataStreamWriter, tool } from 'ai';
import { z } from 'zod';
import { Session } from 'next-auth';
import {
    artifactKinds,
    documentHandlersByArtifactKind,
} from '@/lib/artifacts/server';

interface CreateReportProps {
    session: Session;
    dataStream: DataStreamWriter;
}

export const createReport = ({ session, dataStream }: CreateReportProps) =>
    tool({
        description:
            'Create a SQL analysis report that displays findings from table analysis, query logs, and query execution results. Use this tool to organize and present SQL-related insights in a structured format.',
        parameters: z.object({
            title: z.string().describe('Title for the SQL analysis report'),
            content: z.string().describe('The complete SQL analysis report content including table findings, query log findings, execution results, and recommendations'),
            kind: z.enum(artifactKinds).describe('Type of report - text for analysis reports, code for SQL examples'),
        }),
        execute: async ({ title, content, kind }) => {
            const id = generateUUID();

            dataStream.writeData({
                type: 'kind',
                content: kind,
            });

            dataStream.writeData({
                type: 'id',
                content: id,
            });

            dataStream.writeData({
                type: 'title',
                content: title,
            });

            dataStream.writeData({
                type: 'clear',
                content: '',
            });

            const documentHandler = documentHandlersByArtifactKind.find(
                (documentHandlerByArtifactKind) =>
                    documentHandlerByArtifactKind.kind === kind,
            );

            if (!documentHandler) {
                throw new Error(`No document handler found for kind: ${kind}`);
            }

            // Store the content in the session or context so the handler can access it
            // For now, write the content directly and let the handler manage the artifact
            dataStream.writeData({
                type: 'text-delta',
                content: content,
            });

            await documentHandler.onCreateDocument({
                id,
                title,
                dataStream,
                session,
            });

            dataStream.writeData({ type: 'finish', content: '' });

            return {
                id,
                title,
                kind,
                content: 'A SQL analysis report was created and is now visible to the user.',
            };
        },
    }); 