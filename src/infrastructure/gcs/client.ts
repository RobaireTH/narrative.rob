import {
  Storage,
} from '@google-cloud/storage';

export interface GoogleCloudStorageClientConfig {
  project_id?: string;
}

export function createGoogleCloudStorageClient(
  config: GoogleCloudStorageClientConfig = {},
) {
  return new Storage({
    ...(config.project_id
      ? {
          projectId: config.project_id,
        }
      : {}),
  });
}
