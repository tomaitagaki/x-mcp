import { XConfig, User, UserToken, TokenData, AuthError } from './types.js';
import { XDatabase } from './database.js';
import { encryption } from './encryption.js';

export class TokenManager {
  private config: XConfig;
  private db: XDatabase;

  constructor(config: XConfig, db: XDatabase) {
    this.config = config;
    this.db = db;
  }

  private getRequiredScopes(): string[] {
    return [
      'users.read',
      'tweet.read', 
      'tweet.write',
      'bookmark.read',  // Note: singular, not plural!
      'bookmark.write', // Note: singular, not plural!
      'offline.access'
    ];
  }

  private getToolScopes(toolName: string): string[] {
    switch (toolName) {
      case 'bookmarks.list':
        return ['bookmark.read', 'bookmarks.read']; // Accept both (X uses singular, but check both)
      case 'bookmarks.add':
      case 'bookmarks.remove':
        return ['bookmark.write']; // Note: singular, not plural!
      case 'tweet.create':
        return ['tweet.write'];
      default:
        return ['users.read']; // Default for user info
    }
  }

  async getValidAccessToken(user: User, requiredScopes?: string[]): Promise<string> {
    const tokens = this.db.getUserTokens(user.id);
    
    if (!tokens) {
      throw this.createAuthError('auth_reauth_required', 
        `No tokens found for user ${user.x_username}. Please authenticate.`,
        { loginUrl: this.getLoginUrl() }
      );
    }

    // Decrypt tokens
    let decryptedTokens: TokenData;
    try {
      decryptedTokens = {
        access_token: encryption.decrypt(tokens.access_token),
        refresh_token: encryption.decrypt(tokens.refresh_token),
        expires_at: tokens.expires_at,
        scope: tokens.granted_scopes
      };
    } catch (error) {
      console.error(`Failed to decrypt tokens for user ${user.id}:`, error);
      throw this.createAuthError('auth_reauth_required',
        'Token decryption failed. Please re-authenticate.',
        { loginUrl: this.getLoginUrl() }
      );
    }

    // Check scope requirements
    if (requiredScopes) {
      const missingScopes = this.checkScopes(decryptedTokens.scope, requiredScopes);
      if (missingScopes.length > 0) {
        throw this.createAuthError('auth_scope_insufficient',
          `Missing required scopes: ${missingScopes.join(', ')}`,
          { 
            loginUrl: this.getReAuthUrl(missingScopes),
            missingScopes 
          }
        );
      }
    }

    // Check if token needs refresh (60 second buffer)
    if (Date.now() >= (decryptedTokens.expires_at - 60000)) {
      console.log(`🔄 Refreshing access token for user ${user.x_username} (${encryption.maskToken(decryptedTokens.access_token)})`);
      decryptedTokens = await this.refreshTokens(user, decryptedTokens);
    }

    console.log(`✅ Valid access token for user ${user.x_username} (expires: ${new Date(decryptedTokens.expires_at).toISOString()})`);
    return decryptedTokens.access_token;
  }

  async validateToolAccess(user: User, toolName: string): Promise<string> {
    const requiredScopes = this.getToolScopes(toolName);
    return this.getValidAccessToken(user, requiredScopes);
  }

  private async refreshTokens(user: User, currentTokens: TokenData): Promise<TokenData> {
    try {
      const response = await fetch('https://api.x.com/2/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: currentTokens.refresh_token,
          client_id: this.config.clientId
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Token refresh failed for user ${user.x_username}:`, errorText);
        
        // Clear invalid tokens
        this.db.deleteUserTokens(user.id);
        
        throw this.createAuthError('auth_reauth_required',
          'Token refresh failed. Please re-authenticate.',
          { loginUrl: this.getLoginUrl() }
        );
      }

      const tokenResponse = await response.json();
      const newTokens: TokenData = {
        access_token: tokenResponse.access_token,
        refresh_token: tokenResponse.refresh_token || currentTokens.refresh_token,
        expires_at: Date.now() + (tokenResponse.expires_in * 1000),
        scope: tokenResponse.scope || currentTokens.scope
      };

      // Encrypt and store new tokens
      const encryptedTokens = {
        x_user_id: user.x_user_id,
        granted_scopes: newTokens.scope,
        access_token: encryption.encrypt(newTokens.access_token),
        refresh_token: encryption.encrypt(newTokens.refresh_token),
        expires_at: newTokens.expires_at
      };

      this.db.saveUserTokens(user.id, encryptedTokens);
      console.log(`✅ Tokens refreshed and stored for user ${user.x_username}`);

      return newTokens;

    } catch (error) {
      if (error instanceof Error && (error as AuthError).code) {
        throw error; // Re-throw auth errors
      }
      
      console.error(`Network error during token refresh for user ${user.x_username}:`, error);
      throw this.createAuthError('auth_reauth_required',
        'Network error during token refresh. Please try again or re-authenticate.',
        { loginUrl: this.getLoginUrl() }
      );
    }
  }

  private checkScopes(grantedScopes: string, requiredScopes: string[]): string[] {
    const granted = grantedScopes.split(' ');
    
    return requiredScopes.filter(required => {
      // Handle bookmark.read vs bookmarks.read (both are acceptable - X uses singular)
      if (required === 'bookmark.read') {
        return !granted.includes('bookmark.read') && !granted.includes('bookmarks.read');
      }
      return !granted.includes(required);
    });
  }

  private createAuthError(code: AuthError['code'], message: string, options?: { 
    loginUrl?: string; 
    missingScopes?: string[]; 
  }): AuthError {
    const error = new Error(message) as AuthError;
    error.code = code;
    error.login_url = options?.loginUrl;
    error.missing_scopes = options?.missingScopes;
    return error;
  }

  private getLoginUrl(): string {
    // For hosted mode, return the hosted auth URL
    if (this.config.hostedMode && this.config.baseUrl) {
      return `${this.config.baseUrl}/auth/start`;
    }
    
    // For local mode, suggest running the auth helper
    return 'Please run: npm run auth';
  }

  private getReAuthUrl(missingScopes: string[]): string {
    if (this.config.hostedMode && this.config.baseUrl) {
      const scopeParam = missingScopes.join(',');
      return `${this.config.baseUrl}/auth/start?additional_scopes=${encodeURIComponent(scopeParam)}`;
    }
    
    return `Please re-authenticate with additional scopes: ${missingScopes.join(', ')}`;
  }

  clearUserTokens(userId: number): void {
    this.db.deleteUserTokens(userId);
    console.log(`🗑️ Cleared tokens for user ${userId}`);
  }

  getUserTokenInfo(user: User): { hasTokens: boolean; scopes?: string[]; expiresAt?: Date; maskedToken?: string } {
    const tokens = this.db.getUserTokens(user.id);
    
    if (!tokens) {
      return { hasTokens: false };
    }

    try {
      const accessToken = encryption.decrypt(tokens.access_token);
      return {
        hasTokens: true,
        scopes: tokens.granted_scopes.split(' '),
        expiresAt: new Date(tokens.expires_at),
        maskedToken: encryption.maskToken(accessToken)
      };
    } catch (error) {
      return { hasTokens: false };
    }
  }

  // Check if tokens are valid (not expired and have required scopes)
  async validateUserTokens(user: User, toolName?: string): Promise<{ 
    valid: boolean; 
    reason?: string; 
    missingScopes?: string[];
    expiresAt?: Date;
  }> {
    const tokens = this.db.getUserTokens(user.id);
    
    if (!tokens) {
      return { valid: false, reason: 'No tokens found' };
    }

    try {
      const decryptedAccessToken = encryption.decrypt(tokens.access_token);
      
      // Check expiration (with 60 second buffer)
      const isExpired = Date.now() >= (tokens.expires_at - 60000);
      
      // Check scopes if tool is specified
      let missingScopes: string[] = [];
      if (toolName) {
        const requiredScopes = this.getToolScopes(toolName);
        missingScopes = this.checkScopes(tokens.granted_scopes, requiredScopes);
      }

      if (isExpired && missingScopes.length > 0) {
        return { 
          valid: false, 
          reason: 'Token expired and missing scopes',
          missingScopes,
          expiresAt: new Date(tokens.expires_at)
        };
      }

      if (isExpired) {
        return { 
          valid: false, 
          reason: 'Token expired',
          expiresAt: new Date(tokens.expires_at)
        };
      }

      if (missingScopes.length > 0) {
        return { 
          valid: false, 
          reason: 'Missing required scopes',
          missingScopes 
        };
      }

      return { 
        valid: true,
        expiresAt: new Date(tokens.expires_at)
      };

    } catch (error) {
      return { valid: false, reason: 'Token decryption failed' };
    }
  }
}