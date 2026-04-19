import {
  UnauthorizedError,
} from '../common/errors';

export type AuthProvider = 'disabled' | 'firebase';

export interface AuthenticatedUser {
  auth_provider: AuthProvider;
  email?: string;
  uid: string;
}

export interface AuthService {
  verifyBearerToken(token: string): Promise<AuthenticatedUser>;
}

export class DisabledAuthService implements AuthService {
  async verifyBearerToken(token: string): Promise<AuthenticatedUser> {
    const uid = token.trim();

    if (!uid) {
      throw new UnauthorizedError(
        'A non-empty development token is required when auth is disabled.',
      );
    }

    return {
      auth_provider: 'disabled',
      uid,
    };
  }
}
