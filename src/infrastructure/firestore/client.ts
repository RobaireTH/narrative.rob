import {
  Firestore,
  type Settings as FirestoreSettings,
} from '@google-cloud/firestore';

export interface FirestoreClientConfig {
  database_id?: string;
  project_id?: string;
}

export function createFirestoreClient(
  config: FirestoreClientConfig = {},
) {
  const settings: FirestoreSettings = {};

  if (config.project_id) {
    settings.projectId = config.project_id;
  }

  if (config.database_id) {
    settings.databaseId = config.database_id;
  }

  return new Firestore(settings);
}
