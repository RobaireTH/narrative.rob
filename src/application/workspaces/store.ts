export interface WorkspaceRecord {
  base_currency: 'USD' | 'NGN';
  created_at: string;
  current_execution_plan_object_key: string;
  current_logs_object_key: string;
  current_narrative_object_key: string;
  current_portfolio_object_key: string;
  narrative_id: string;
  owner_id: string;
  portfolio_id: string;
  thread_id: string;
  updated_at: string;
  version: number;
  workspace_id: string;
}

export interface WorkspaceStore {
  getWorkspace(workspace_id: string): Promise<WorkspaceRecord | null>;
  getWorkspaceByThread(thread_id: string): Promise<WorkspaceRecord | null>;
  listByOwner(owner_id: string): Promise<WorkspaceRecord[]>;
  saveWorkspace(record: WorkspaceRecord): Promise<WorkspaceRecord>;
}

export class InMemoryWorkspaceStore implements WorkspaceStore {
  private readonly workspaces = new Map<string, WorkspaceRecord>();
  private readonly workspace_by_thread = new Map<string, string>();

  async getWorkspace(
    workspace_id: string,
  ): Promise<WorkspaceRecord | null> {
    const record = this.workspaces.get(workspace_id);
    return record ? structuredClone(record) : null;
  }

  async getWorkspaceByThread(
    thread_id: string,
  ): Promise<WorkspaceRecord | null> {
    const workspace_id = this.workspace_by_thread.get(thread_id);
    if (!workspace_id) {
      return null;
    }

    return this.getWorkspace(workspace_id);
  }

  async listByOwner(owner_id: string): Promise<WorkspaceRecord[]> {
    return Array.from(this.workspaces.values())
      .filter((record) => record.owner_id === owner_id)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .map((record) => structuredClone(record));
  }

  async saveWorkspace(record: WorkspaceRecord): Promise<WorkspaceRecord> {
    this.workspaces.set(record.workspace_id, structuredClone(record));
    this.workspace_by_thread.set(record.thread_id, record.workspace_id);
    return structuredClone(record);
  }
}
