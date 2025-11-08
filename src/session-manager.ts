import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { User, Session, AuthError } from './types.js';
import { XDatabase } from './database.js';
import { encryption } from './encryption.js';

export class SessionManager {
  private db: XDatabase;
  private defaultUserId?: number; // For local single-user mode

  constructor(db: XDatabase) {
    this.db = db;
    this.initializeDefaultUser();
  }

  private initializeDefaultUser(): void {
    // In local mode, create or get a default "local_user"
    const DEFAULT_X_USER_ID = 'local_user';
    let user = this.db.getUserByXUserId(DEFAULT_X_USER_ID);
    
    if (!user) {
      user = this.db.createUser(DEFAULT_X_USER_ID, 'local_user', 'Local User');
      console.log(`Created default local user with ID: ${user.id}`);
    }
    
    this.defaultUserId = user.id;
  }

  createSession(userId: number, expiresAt?: number): { sessionId: string; sessionSecret: string } {
    const sessionId = uuidv4();
    const sessionSecret = encryption.generateSecureToken();
    const sessionSecretHash = this.hashSessionSecret(sessionSecret);

    this.db.createSession(userId, sessionId, sessionSecretHash, expiresAt);

    return { sessionId, sessionSecret };
  }

  validateSession(sessionId: string, sessionSecret?: string): Session | null {
    const session = this.db.getSession(sessionId);
    if (!session) return null;

    // For stdio/local mode, we don't require session secret validation
    if (!sessionSecret) {
      return session;
    }

    // For hosted mode, validate the session secret
    if (!this.verifySessionSecret(sessionSecret, session.session_secret_hash)) {
      return null;
    }

    return session;
  }

  getUserFromSession(sessionId?: string, sessionSecret?: string): User | null {
    // If no session provided, use default local user
    if (!sessionId) {
      if (this.defaultUserId) {
        return this.db.getUserById(this.defaultUserId);
      }
      return null;
    }

    const session = this.validateSession(sessionId, sessionSecret);
    if (!session) return null;

    return this.db.getUserById(session.user_id);
  }

  createAuthError(code: AuthError['code'], message: string, options?: { 
    loginUrl?: string; 
    missingScopes?: string[]; 
  }): AuthError {
    const error = new Error(message) as AuthError;
    error.code = code;
    error.login_url = options?.loginUrl;
    error.missing_scopes = options?.missingScopes;
    return error;
  }

  requireUser(sessionId?: string, sessionSecret?: string): User {
    const user = this.getUserFromSession(sessionId, sessionSecret);
    if (!user) {
      throw this.createAuthError('auth_invalid_session', 'Invalid or expired session');
    }
    return user;
  }

  deleteSession(sessionId: string): void {
    this.db.deleteSession(sessionId);
  }

  cleanupExpiredSessions(): void {
    this.db.cleanupExpiredSessions();
  }

  private hashSessionSecret(secret: string): string {
    const { hash } = encryption.hashPassword(secret);
    return hash;
  }

  private verifySessionSecret(secret: string, hash: string): boolean {
    try {
      // Extract salt from hash (assuming we stored hash:salt format)
      const [hashPart, saltPart] = hash.split(':');
      if (!saltPart) {
        // Legacy format without explicit salt
        return encryption.hashPassword(secret).hash === hash;
      }
      
      return encryption.verifyPassword(secret, hashPart, saltPart);
    } catch (error) {
      return false;
    }
  }

  // Context extraction from different transport types
  extractSessionContext(request: any): { sessionId?: string; sessionSecret?: string } {
    // For stdio transport, we typically don't have session context
    // Return undefined to use default local user
    if (!request.meta) {
      return {};
    }

    // For HTTP-based transports, check headers/cookies
    const headers = request.meta.headers || {};
    
    // Check Authorization header for Bearer token
    const authHeader = headers.authorization || headers.Authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const [sessionId, sessionSecret] = token.split(':');
      return { sessionId, sessionSecret };
    }

    // Check cookie for session
    const cookie = headers.cookie;
    if (cookie) {
      const sessionMatch = cookie.match(/session=([^;]+)/);
      if (sessionMatch) {
        const [sessionId, sessionSecret] = sessionMatch[1].split(':');
        return { sessionId, sessionSecret };
      }
    }

    // Check custom headers
    const sessionId = headers['x-session-id'];
    const sessionSecret = headers['x-session-secret'];
    
    return { sessionId, sessionSecret };
  }

  getDefaultUserId(): number | undefined {
    return this.defaultUserId;
  }

  // Helper method for creating local sessions (for CLI tools, etc.)
  createLocalSession(userId?: number): { sessionId: string; sessionSecret: string } {
    const targetUserId = userId || this.defaultUserId;
    if (!targetUserId) {
      throw new Error('No user ID available for session creation');
    }
    
    return this.createSession(targetUserId, Date.now() + (365 * 24 * 60 * 60 * 1000)); // 1 year
  }

  // List all users (for admin/debugging purposes)
  getAllUsers(): User[] {
    const stmt = this.db.db.prepare('SELECT * FROM users ORDER BY created_at DESC');
    return stmt.all() as User[];
  }

  // Get user statistics
  getUserStats(userId: number): {
    sessionCount: number;
    lastActivity?: number;
    hasTokens: boolean;
  } {
    const sessionStmt = this.db.db.prepare('SELECT COUNT(*) as count FROM sessions WHERE user_id = ?');
    const sessionResult = sessionStmt.get(userId) as { count: number };

    const lastActivityStmt = this.db.db.prepare(
      'SELECT MAX(created_at) as last_activity FROM sessions WHERE user_id = ?'
    );
    const lastActivityResult = lastActivityStmt.get(userId) as { last_activity: number | null };

    const tokensStmt = this.db.db.prepare('SELECT COUNT(*) as count FROM user_tokens WHERE user_id = ?');
    const tokensResult = tokensStmt.get(userId) as { count: number };

    return {
      sessionCount: sessionResult.count,
      lastActivity: lastActivityResult.last_activity || undefined,
      hasTokens: tokensResult.count > 0
    };
  }
}