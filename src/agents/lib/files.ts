import type { FileData } from 'deepagents';

/**
 * Parameters for creating a Deep Agents text file entry.
 */
export interface CreateTextFileDataParams {
  content: string;
  created_at?: string;
  mime_type?: string;
  modified_at?: string;
  now?: Date;
}

/**
 * Create a Deep Agents `FileData` record for a text file.
 *
 * This helper is used to seed runtime workspace files like `narrative.json`,
 * `portfolio.json`, and `execution_plan.json`.
 */
export function createTextFileData(
  params: CreateTextFileDataParams,
): FileData {
  const timestamp = params.now?.toISOString() ?? new Date().toISOString();

  return {
    content: params.content,
    created_at: params.created_at ?? timestamp,
    mimeType: params.mime_type ?? 'application/json',
    modified_at: params.modified_at ?? timestamp,
  };
}

/**
 * Create a Deep Agents `FileData` record from a JSON-serializable value.
 */
export function createJsonFileData(
  value: unknown,
  params?: Omit<CreateTextFileDataParams, 'content'>,
): FileData {
  return createTextFileData({
    ...params,
    content: JSON.stringify(value, null, 2),
  });
}
