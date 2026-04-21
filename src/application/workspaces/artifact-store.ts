export interface WorkspaceArtifactObject {
  content: string;
  content_type: string;
  object_key: string;
}

export interface WorkspaceArtifactStore {
  readTextObject(object_key: string): Promise<WorkspaceArtifactObject>;
  writeTextObject(params: {
    content: string;
    content_type: string;
    object_key: string;
  }): Promise<WorkspaceArtifactObject>;
}

export class InMemoryWorkspaceArtifactStore
  implements WorkspaceArtifactStore
{
  private readonly objects = new Map<string, WorkspaceArtifactObject>();

  async readTextObject(object_key: string): Promise<WorkspaceArtifactObject> {
    const existing = this.objects.get(object_key);

    if (!existing) {
      throw new Error(`Workspace artifact "${object_key}" was not found.`);
    }

    return {
      ...existing,
    };
  }

  async writeTextObject(params: {
    content: string;
    content_type: string;
    object_key: string;
  }): Promise<WorkspaceArtifactObject> {
    const object: WorkspaceArtifactObject = {
      content: params.content,
      content_type: params.content_type,
      object_key: params.object_key,
    };
    this.objects.set(params.object_key, object);
    return {
      ...object,
    };
  }
}
