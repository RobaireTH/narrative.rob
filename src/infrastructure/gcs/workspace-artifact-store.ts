import type { Storage } from '@google-cloud/storage';

import type {
  WorkspaceArtifactObject,
  WorkspaceArtifactStore,
} from '../../application/workspaces/artifact-store';

export interface GoogleCloudWorkspaceArtifactStoreParams {
  bucket_name: string;
  storage: Storage;
}

export class GoogleCloudWorkspaceArtifactStore
  implements WorkspaceArtifactStore
{
  private readonly bucket_name: string;
  private readonly storage: Storage;

  constructor(params: GoogleCloudWorkspaceArtifactStoreParams) {
    this.bucket_name = params.bucket_name;
    this.storage = params.storage;
  }

  async readTextObject(object_key: string): Promise<WorkspaceArtifactObject> {
    const file = this.storage.bucket(this.bucket_name).file(object_key);
    const [content] = await file.download();
    const [metadata] = await file.getMetadata();

    return {
      content: content.toString('utf8'),
      content_type: metadata.contentType ?? 'application/json',
      object_key,
    };
  }

  async writeTextObject(params: {
    content: string;
    content_type: string;
    object_key: string;
  }): Promise<WorkspaceArtifactObject> {
    await this.storage.bucket(this.bucket_name).file(params.object_key).save(
      params.content,
      {
        contentType: params.content_type,
        resumable: false,
      },
    );

    return {
      content: params.content,
      content_type: params.content_type,
      object_key: params.object_key,
    };
  }
}
