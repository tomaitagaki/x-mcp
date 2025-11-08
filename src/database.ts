import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { User, Session, UserToken, PairingSession } from './types.js';

export class XDatabase {
  private db: Database.Database;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || join(process.env.HOME || process.cwd(), '.mcp', 'x', 'tokens.db');
    this.ensureDirectory();
    this.db = new Database(this.dbPath);
    this.initializeSchema();
  }

  private ensureDirectory(): void {
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at INTEGER NOT NULL,
        display_name TEXT NOT NULL,
        x_user_id TEXT UNIQUE NOT NULL,
        x_username TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        session_secret_hash TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS user_tokens (
        user_id INTEGER PRIMARY KEY,
        provider TEXT NOT NULL DEFAULT 'x',
        x_user_id TEXT NOT NULL,
        granted_scopes TEXT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS pairing_sessions (
        pairing_code TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        code_verifier TEXT NOT NULL,
        state TEXT NOT NULL,
        user_id INTEGER NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);
      CREATE INDEX IF NOT EXISTS idx_user_tokens_x_user_id ON user_tokens (x_user_id);
      CREATE INDEX IF NOT EXISTS idx_pairing_sessions_expires_at ON pairing_sessions (expires_at);
    `);

    this.cleanupExpiredSessions();
    this.cleanupExpiredPairingSessions();
  }

  createUser(xUserId: string, username: string, displayName?: string): User {
    const stmt = this.db.prepare(`
      INSERT INTO users (created_at, display_name, x_user_id, x_username)
      VALUES (?, ?, ?, ?)
    `);
    
    const now = Date.now();
    const result = stmt.run(now, displayName || username, xUserId, username);
    
    return {
      id: result.lastInsertRowid as number,
      created_at: now,
      display_name: displayName || username,
      x_user_id: xUserId,
      x_username: username
    };
  }

  getUserByXUserId(xUserId: string): User | null {
    const stmt = this.db.prepare('SELECT * FROM users WHERE x_user_id = ?');
    const row = stmt.get(xUserId);
    return row ? row as User : null;
  }

  getUserById(id: number): User | null {
    const stmt = this.db.prepare('SELECT * FROM users WHERE id = ?');
    const row = stmt.get(id);
    return row ? row as User : null;
  }

  updateUser(id: number, updates: Partial<Pick<User, 'display_name' | 'x_username'>>): void {
    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updates);
    
    if (fields) {
      const stmt = this.db.prepare(`UPDATE users SET ${fields} WHERE id = ?`);
      stmt.run(...values, id);
    }
  }

  createSession(userId: number, sessionId: string, sessionSecretHash: string, expiresAt?: number): Session {
    const now = Date.now();
    const expires = expiresAt || (now + (30 * 24 * 60 * 60 * 1000)); // 30 days
    
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, user_id, created_at, expires_at, session_secret_hash)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    stmt.run(sessionId, userId, now, expires, sessionSecretHash);
    
    return {
      id: sessionId,
      user_id: userId,
      created_at: now,
      expires_at: expires,
      session_secret_hash: sessionSecretHash
    };
  }

  getSession(sessionId: string): Session | null {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ? AND expires_at > ?');
    const row = stmt.get(sessionId, Date.now());
    return row ? row as Session : null;
  }

  deleteSession(sessionId: string): void {
    const stmt = this.db.prepare('DELETE FROM sessions WHERE id = ?');
    stmt.run(sessionId);
  }

  cleanupExpiredSessions(): void {
    const stmt = this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?');
    stmt.run(Date.now());
  }

  saveUserTokens(userId: number, tokenData: Omit<UserToken, 'user_id' | 'provider' | 'created_at' | 'updated_at'>): void {
    const now = Date.now();
    
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO user_tokens 
      (user_id, provider, x_user_id, granted_scopes, access_token, refresh_token, expires_at, created_at, updated_at)
      VALUES (?, 'x', ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM user_tokens WHERE user_id = ?), ?), ?)
    `);
    
    stmt.run(
      userId, 
      tokenData.x_user_id, 
      tokenData.granted_scopes,
      tokenData.access_token, 
      tokenData.refresh_token, 
      tokenData.expires_at,
      userId, // for COALESCE
      now, // fallback created_at
      now // updated_at
    );
  }

  getUserTokens(userId: number): UserToken | null {
    const stmt = this.db.prepare('SELECT * FROM user_tokens WHERE user_id = ?');
    const row = stmt.get(userId);
    return row ? row as UserToken : null;
  }

  deleteUserTokens(userId: number): void {
    const stmt = this.db.prepare('DELETE FROM user_tokens WHERE user_id = ?');
    stmt.run(userId);
  }

  createPairingSession(pairingCode: string, codeVerifier: string, state: string, expiresAt?: number): PairingSession {
    const now = Date.now();
    const expires = expiresAt || (now + (10 * 60 * 1000)); // 10 minutes
    
    const stmt = this.db.prepare(`
      INSERT INTO pairing_sessions (pairing_code, created_at, expires_at, code_verifier, state, completed)
      VALUES (?, ?, ?, ?, ?, 0)
    `);
    
    stmt.run(pairingCode, now, expires, codeVerifier, state);
    
    return {
      pairing_code: pairingCode,
      created_at: now,
      expires_at: expires,
      code_verifier: codeVerifier,
      state,
      completed: false
    };
  }

  getPairingSession(pairingCode: string): PairingSession | null {
    const stmt = this.db.prepare('SELECT * FROM pairing_sessions WHERE pairing_code = ? AND expires_at > ?');
    const row = stmt.get(pairingCode, Date.now()) as any;
    
    if (!row) return null;
    
    return {
      pairing_code: row.pairing_code,
      created_at: row.created_at,
      expires_at: row.expires_at,
      code_verifier: row.code_verifier,
      state: row.state,
      user_id: row.user_id || undefined,
      completed: Boolean(row.completed)
    };
  }

  getPairingSessionByState(state: string): PairingSession | null {
    const stmt = this.db.prepare('SELECT * FROM pairing_sessions WHERE state = ? AND expires_at > ?');
    const row = stmt.get(state, Date.now()) as any;
    
    if (!row) return null;
    
    return {
      pairing_code: row.pairing_code,
      created_at: row.created_at,
      expires_at: row.expires_at,
      code_verifier: row.code_verifier,
      state: row.state,
      user_id: row.user_id || undefined,
      completed: Boolean(row.completed)
    };
  }

  getAllUsers(): User[] {
    const stmt = this.db.prepare('SELECT * FROM users ORDER BY created_at DESC');
    return stmt.all() as User[];
  }

  getUserSessionCount(userId: number): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM sessions WHERE user_id = ?');
    const result = stmt.get(userId) as any;
    return result?.count || 0;
  }

  getUserLastActivity(userId: number): number | null {
    const stmt = this.db.prepare('SELECT MAX(created_at) as last_activity FROM sessions WHERE user_id = ?');
    const result = stmt.get(userId) as any;
    return result?.last_activity || null;
  }

  getUserTokenCount(userId: number): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM user_tokens WHERE user_id = ?');
    const result = stmt.get(userId) as any;
    return result?.count || 0;
  }

  completePairingSession(pairingCode: string, userId: number): void {
    const stmt = this.db.prepare(`
      UPDATE pairing_sessions 
      SET user_id = ?, completed = 1 
      WHERE pairing_code = ? AND expires_at > ?
    `);
    
    stmt.run(userId, pairingCode, Date.now());
  }

  deletePairingSession(pairingCode: string): void {
    const stmt = this.db.prepare('DELETE FROM pairing_sessions WHERE pairing_code = ?');
    stmt.run(pairingCode);
  }

  cleanupExpiredPairingSessions(): void {
    const stmt = this.db.prepare('DELETE FROM pairing_sessions WHERE expires_at <= ?');
    stmt.run(Date.now());
  }

  close(): void {
    this.db.close();
  }

  backup(path: string): void {
    this.db.backup(path);
  }
}