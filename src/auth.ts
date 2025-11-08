import { createHash, randomBytes } from 'crypto';
import { XConfig, TokenData } from './types.js';

export class XAuthManager {
  private config: XConfig;
  private tokenData: TokenData | null = null;

  constructor(config: XConfig) {
    this.config = config;
  }

  generateCodeVerifier(): string {
    return randomBytes(32).toString('base64url');
  }

  generateCodeChallenge(codeVerifier: string): string {
    return createHash('sha256').update(codeVerifier).digest('base64url');
  }

  getAuthorizationUrl(codeChallenge: string): string {
      // Allow testing with custom scopes via environment variable
      // Correct scope names: bookmark.read and bookmark.write (singular, not plural!)
      let scopes = process.env.X_API_TEST_SCOPES || 'users.read tweet.read tweet.write bookmark.read bookmark.write offline.access';
      
      // If testing, try with minimal scopes first
      if (process.env.X_API_TEST_SCOPES === 'minimal') {
        scopes = 'users.read tweet.read';
      }
    
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: scopes,
      state: randomBytes(16).toString('base64url'),
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    });

    return `https://x.com/i/oauth2/authorize?${params.toString()}`;
  }

  async exchangeCodeForToken(code: string, codeVerifier: string): Promise<TokenData> {
    const response = await fetch('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.config.redirectUri,
        code_verifier: codeVerifier,
        client_id: this.config.clientId
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    const tokenResponse = await response.json();
    this.tokenData = {
      access_token: tokenResponse.access_token,
      refresh_token: tokenResponse.refresh_token,
      expires_at: Date.now() + (tokenResponse.expires_in * 1000),
      scope: tokenResponse.scope
    };

    return this.tokenData;
  }

  async refreshToken(): Promise<TokenData> {
    if (!this.tokenData?.refresh_token) {
      throw new Error('No refresh token available');
    }

    const response = await fetch('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.tokenData.refresh_token,
        client_id: this.config.clientId
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token refresh failed: ${error}`);
    }

    const tokenResponse = await response.json();
    this.tokenData = {
      access_token: tokenResponse.access_token,
      refresh_token: tokenResponse.refresh_token || this.tokenData.refresh_token,
      expires_at: Date.now() + (tokenResponse.expires_in * 1000),
      scope: tokenResponse.scope
    };

    return this.tokenData;
  }

  async getValidAccessToken(): Promise<string> {
    if (!this.tokenData) {
      throw new Error('No token data available. Please authenticate first.');
    }

    if (Date.now() >= this.tokenData.expires_at - 60000) {
      await this.refreshToken();
    }

    return this.tokenData.access_token;
  }

  setTokenData(tokenData: TokenData): void {
    this.tokenData = tokenData;
  }

  getTokenData(): TokenData | null {
    return this.tokenData;
  }

  hasRequiredScopes(): boolean {
    if (!this.tokenData?.scope) return false;
    
    const requiredScopes = ['bookmark.read', 'bookmark.write', 'tweet.write', 'users.read'];
    const grantedScopes = this.tokenData.scope.split(' ');
    
    return requiredScopes.every(scope => 
      grantedScopes.includes(scope) || 
      (scope === 'bookmark.read' && grantedScopes.includes('bookmarks.read'))
    );
  }

  getMissingScopes(): string[] {
    if (!this.tokenData?.scope) return ['bookmark.read', 'bookmark.write', 'tweet.write', 'users.read'];
    
    const requiredScopes = ['bookmark.read', 'bookmark.write', 'tweet.write', 'users.read'];
    const grantedScopes = this.tokenData.scope.split(' ');
    
    return requiredScopes.filter(scope => 
      !grantedScopes.includes(scope) && 
      !(scope === 'bookmark.read' && grantedScopes.includes('bookmarks.read'))
    );
  }
}