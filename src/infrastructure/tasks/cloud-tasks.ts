import type { Logger } from 'pino';

type CloudTasksClientLike = {
  queuePath(
    project_id: string,
    location: string,
    queue: string,
  ): string;
  createTask(request: {
    parent: string;
    task: {
      name?: string;
      scheduleTime?: { seconds: number };
      httpRequest?: {
        body?: Buffer;
        headers?: Record<string, string>;
        httpMethod?: string;
        oidcToken?: {
          audience: string;
          serviceAccountEmail: string;
        };
        url: string;
      };
    };
  }): Promise<[{ name?: string | null }]>;
};

type CloudTasksModule = {
  CloudTasksClient: new () => CloudTasksClientLike;
};

export interface EnqueueOrchestratorRunInput {
  idempotency_key?: string;
  schedule_time?: Date;
  thread_id: string;
}

export interface OrchestratorTaskClient {
  enqueueOrchestratorRun(
    input: EnqueueOrchestratorRunInput,
  ): Promise<{ name?: string }>;
}

export interface CloudTasksOrchestratorClientParams {
  handler_url: string;
  location: string;
  logger: Logger;
  project_id: string;
  queue_name: string;
  service_account_email: string;
}

export class CloudTasksOrchestratorClient implements OrchestratorTaskClient {
  private readonly client: CloudTasksClientLike;
  private readonly handler_url: string;
  private readonly logger: Logger;
  private readonly parent: string;
  private readonly service_account_email: string;

  constructor(params: CloudTasksOrchestratorClientParams) {
    const tasks_module = require('@google-cloud/tasks') as CloudTasksModule;
    this.client = new tasks_module.CloudTasksClient();
    this.handler_url = params.handler_url;
    this.logger = params.logger;
    this.parent = this.client.queuePath(
      params.project_id,
      params.location,
      params.queue_name,
    );
    this.service_account_email = params.service_account_email;
  }

  async enqueueOrchestratorRun(input: EnqueueOrchestratorRunInput) {
    const body = Buffer.from(
      JSON.stringify({
        idempotency_key: input.idempotency_key,
        thread_id: input.thread_id,
      }),
    );

    const [task] = await this.client.createTask({
      parent: this.parent,
      task: {
        ...(input.idempotency_key
          ? { name: `${this.parent}/tasks/${input.idempotency_key}` }
          : {}),
        ...(input.schedule_time
          ? {
              scheduleTime: {
                seconds: Math.floor(input.schedule_time.getTime() / 1000),
              },
            }
          : {}),
        httpRequest: {
          body,
          headers: {
            'content-type': 'application/json',
          },
          httpMethod: 'POST',
          oidcToken: {
            audience: this.handler_url,
            serviceAccountEmail: this.service_account_email,
          },
          url: this.handler_url,
        },
      },
    });

    this.logger.info(
      {
        task_name: task.name,
        thread_id: input.thread_id,
      },
      'orchestrator task enqueued',
    );

    return { name: task.name ?? undefined };
  }
}

export class InMemoryOrchestratorTaskClient implements OrchestratorTaskClient {
  private readonly logger: Logger;
  private readonly calls: EnqueueOrchestratorRunInput[] = [];

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async enqueueOrchestratorRun(input: EnqueueOrchestratorRunInput) {
    this.calls.push(input);
    this.logger.debug(
      { thread_id: input.thread_id },
      'in-memory task enqueue (no cloud tasks configured)',
    );
    return { name: `in-memory:${input.thread_id}` };
  }

  getEnqueueHistory() {
    return [...this.calls];
  }
}
