import {
  applicationDefault,
  cert,
  getApp,
  getApps,
  initializeApp,
  type App as FirebaseAdminApp,
} from 'firebase-admin/app';
import {
  getAuth,
} from 'firebase-admin/auth';

import type {
  AuthService,
  AuthenticatedUser,
} from '../../application/auth/service';

export interface FirebaseAdminAuthServiceConfig {
  client_email?: string;
  private_key?: string;
  project_id?: string;
}

function getOrInitFirebaseAdminApp(
  config: FirebaseAdminAuthServiceConfig,
) {
  if (getApps().length > 0) {
    return getApp();
  }

  if (config.client_email && config.private_key && config.project_id) {
    return initializeApp({
      credential: cert({
        clientEmail: config.client_email,
        privateKey: config.private_key.replace(/\\n/g, '\n'),
        projectId: config.project_id,
      }),
      projectId: config.project_id,
    });
  }

  return initializeApp({
    credential: applicationDefault(),
    ...(config.project_id
      ? {
          projectId: config.project_id,
        }
      : {}),
  });
}

export class FirebaseAdminAuthService implements AuthService {
  private readonly app: FirebaseAdminApp;

  constructor(config: FirebaseAdminAuthServiceConfig) {
    this.app = getOrInitFirebaseAdminApp(config);
  }

  async verifyBearerToken(token: string): Promise<AuthenticatedUser> {
    const decoded_token = await getAuth(this.app).verifyIdToken(token);

    return {
      auth_provider: 'firebase',
      ...(typeof decoded_token.email === 'string'
        ? {
            email: decoded_token.email,
          }
        : {}),
      uid: decoded_token.uid,
    };
  }
}
