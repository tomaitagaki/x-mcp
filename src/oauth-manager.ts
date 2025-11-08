import { createHash, randomBytes } from 'crypto';
import { createServer, Server } from 'http';
import { URL } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { XConfig, TokenData, AuthStartResponse, AuthStatusResponse, AuthError } from './types.js';
import { XDatabase } from './database.js';
import { encryption } from './encryption.js';

export class OAuthManager {
  private config: XConfig;
  private db: XDatabase;
  private callbackServer?: Server;

  constructor(config: XConfig, db: XDatabase) {
    this.config = config;
    this.db = db;
  }

  generateCodeVerifier(): string {
    return randomBytes(32).toString('base64url');
  }

  generateCodeChallenge(codeVerifier: string): string {
    return createHash('sha256').update(codeVerifier).digest('base64url');
  }

  generatePairingCode(): string {
    // Generate a user-friendly 8-character code
    const chars = 'ABCDEFGHIJKLMNPQRSTUVWXYZ123456789'; // No O, 0 for clarity
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  private getRequiredScopes(): string[] {
    return [
      'users.read',
      'tweet.read', 
      'tweet.write',
      'bookmark.read',
      'bookmarks.write',
      'offline.access'
    ];
  }

  private getScopesString(): string {
    return this.getRequiredScopes().join(' ');
  }

  getAuthorizationUrl(codeChallenge: string, state?: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.getScopesString(),
      state: state || randomBytes(16).toString('base64url'),
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    });

    return `https://x.com/i/oauth2/authorize?${params.toString()}`;
  }

  async startLoopbackAuth(): Promise<AuthStartResponse> {
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = this.generateCodeChallenge(codeVerifier);
    const state = randomBytes(16).toString('base64url');
    
    const authorizeUrl = this.getAuthorizationUrl(codeChallenge, state);

    // Start callback server
    await this.startCallbackServer(codeVerifier, state);

    return {
      authorize_url: authorizeUrl
    };
  }

  async startHostedAuth(): Promise<AuthStartResponse> {
    const pairingCode = this.generatePairingCode();
    const codeVerifier = this.generateCodeVerifier();
    const state = randomBytes(16).toString('base64url');
    
    // Store pairing session
    this.db.createPairingSession(pairingCode, codeVerifier, state);
    
    const baseUrl = this.config.baseUrl || 'http://localhost:3000';
    const loginUrl = `${baseUrl}/login?pairing_code=${pairingCode}`;

    return {
      pairing_code: pairingCode,
      login_url: loginUrl
    };
  }

  async checkPairingStatus(pairingCode: string): Promise<AuthStatusResponse> {
    const session = this.db.getPairingSession(pairingCode);
    
    if (!session) {
      return { verified: false };
    }

    if (!session.completed || !session.user_id) {
      return { verified: false };
    }

    const user = this.db.getUserById(session.user_id);
    if (!user) {
      return { verified: false };
    }

    return {
      verified: true,
      user: {
        id: user.id,
        display_name: user.display_name,
        x_username: user.x_username
      }
    };
  }

  private async startCallbackServer(codeVerifier: string, expectedState: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.callbackServer = createServer(async (req, res) => {
        try {
          const url = new URL(req.url!, `http://${req.headers.host}`);
          
          if (url.pathname === '/auth/x/cb' || url.pathname === '/callback') {
            await this.handleLoopbackCallback(req, res, codeVerifier, expectedState);
            resolve();
          } else {
            res.writeHead(404, { 'Content-Type': 'text/html' });
            res.end('<h1>404 Not Found</h1>');
          }
        } catch (error) {
          console.error('Callback server error:', error);
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(`<h1>❌ Server Error</h1><p>${error}</p>`);
          reject(error);
        }
      });

      const port = new URL(this.config.redirectUri).port || '3000';
      this.callbackServer.listen(parseInt(port), '127.0.0.1', () => {
        console.log(`🌐 OAuth callback server listening on port ${port}`);
        resolve();
      });

      this.callbackServer.on('error', reject);
    });
  }

  private async handleLoopbackCallback(
    req: any, 
    res: any, 
    codeVerifier: string, 
    expectedState: string
  ): Promise<void> {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(`<h1>❌ Authorization Error</h1><p>${error}</p>`);
      throw new Error(`Authorization error: ${error}`);
    }

    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end('<h1>❌ Missing Authorization Code</h1>');
      throw new Error('No authorization code received');
    }

    if (state !== expectedState) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end('<h1>❌ Invalid State Parameter</h1>');
      throw new Error('Invalid state parameter');
    }

    try {
      console.log('🔄 Exchanging authorization code for tokens...');
      const tokenData = await this.exchangeCodeForToken(code, codeVerifier);
      
      console.log('👤 Fetching user information...');
      const xUser = await this.fetchUserInfo(tokenData.access_token);
      
      console.log('💾 Storing user and tokens...');
      const user = await this.storeUserAndTokens(xUser, tokenData);

      console.log('✅ Authentication successful!');
      console.log(`📊 User: @${user.x_username} (${user.display_name})`);
      console.log(`📊 Granted scopes: ${tokenData.scope}`);
      
      const missingScopes = this.checkRequiredScopes(tokenData.scope);
      if (missingScopes.length > 0) {
        console.warn(`⚠️  Missing required scopes: ${missingScopes.join(', ')}`);
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <h1>✅ Authentication Successful!</h1>
        <p><strong>Welcome, @${user.x_username}!</strong></p>
        <p>You can now close this window and use the X MCP server.</p>
        <p><strong>Granted scopes:</strong> ${tokenData.scope}</p>
        ${missingScopes.length > 0 ? `<p style="color: orange;"><strong>Warning:</strong> Missing some required scopes: ${missingScopes.join(', ')}</p>` : ''}
      `);
      
      if (this.callbackServer) {
        this.callbackServer.close();
        this.callbackServer = undefined;
      }
    } catch (error) {
      console.error('❌ Token exchange failed:', error);
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(`<h1>❌ Authentication Failed</h1><p>${error}</p>`);
      throw error;
    }
  }

  async handleHostedCallback(code: string, state: string): Promise<{ user_id: number; pairing_code?: string }> {
    // Find pairing session by state
    const pairingSession = this.db.db.prepare(
      'SELECT * FROM pairing_sessions WHERE state = ? AND expires_at > ?'
    ).get(state, Date.now());

    if (!pairingSession) {
      throw new Error('Invalid or expired pairing session');
    }

    const tokenData = await this.exchangeCodeForToken(code, pairingSession.code_verifier);
    const xUser = await this.fetchUserInfo(tokenData.access_token);
    const user = await this.storeUserAndTokens(xUser, tokenData);

    // Complete the pairing session
    this.db.completePairingSession(pairingSession.pairing_code, user.id);

    return {
      user_id: user.id,
      pairing_code: pairingSession.pairing_code
    };
  }

  private async exchangeCodeForToken(code: string, codeVerifier: string): Promise<TokenData> {
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
    return {
      access_token: tokenResponse.access_token,
      refresh_token: tokenResponse.refresh_token,
      expires_at: Date.now() + (tokenResponse.expires_in * 1000),
      scope: tokenResponse.scope
    };
  }

  private async fetchUserInfo(accessToken: string): Promise<{ id: string; username: string; name: string }> {
    const response = await fetch('https://api.x.com/2/users/me', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch user info: ${error}`);
    }

    const userData = await response.json();
    if (!userData.data) {
      throw new Error('Invalid user data response');
    }

    return {
      id: userData.data.id,
      username: userData.data.username,
      name: userData.data.name || userData.data.username
    };
  }

  private async storeUserAndTokens(xUser: { id: string; username: string; name: string }, tokenData: TokenData) {
    // Get or create user
    let user = this.db.getUserByXUserId(xUser.id);
    if (!user) {
      user = this.db.createUser(xUser.id, xUser.username, xUser.name);
    } else {
      // Update user info
      this.db.updateUser(user.id, {
        x_username: xUser.username,
        display_name: xUser.name
      });
      user.x_username = xUser.username;
      user.display_name = xUser.name;
    }

    // Encrypt and store tokens
    const encryptedTokens = {
      x_user_id: xUser.id,
      granted_scopes: tokenData.scope,
      access_token: encryption.encrypt(tokenData.access_token),
      refresh_token: encryption.encrypt(tokenData.refresh_token),
      expires_at: tokenData.expires_at
    };

    this.db.saveUserTokens(user.id, encryptedTokens);
    console.log(`🔐 Tokens encrypted and stored for user ${user.id}`);

    return user;
  }

  private checkRequiredScopes(grantedScopes: string): string[] {
    const required = this.getRequiredScopes();
    const granted = grantedScopes.split(' ');
    
    return required.filter(scope => {
      // Handle bookmark.read vs bookmarks.read
      if (scope === 'bookmark.read') {
        return !granted.includes('bookmark.read') && !granted.includes('bookmarks.read');
      }
      return !granted.includes(scope);
    });
  }

  stop(): void {
    if (this.callbackServer) {
      this.callbackServer.close();
      this.callbackServer = undefined;
    }
  }
}