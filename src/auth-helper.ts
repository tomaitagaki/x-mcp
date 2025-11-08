#!/usr/bin/env node

import { createServer } from 'http';
import { URL } from 'url';
import { XAuthManager } from './auth.js';
import { TokenStorage } from './storage.js';
import { XConfig } from './types.js';

async function runAuthFlow() {
  const config: XConfig = {
    clientId: process.env.X_CLIENT_ID || '',
    clientSecret: process.env.X_CLIENT_SECRET || '',
    redirectUri: process.env.X_REDIRECT_URI || 'http://localhost:3000/callback'
  };

  if (!config.clientId || !config.clientSecret) {
    console.error('❌ Missing required environment variables:');
    console.error('   X_CLIENT_ID - Your X app client ID');
    console.error('   X_CLIENT_SECRET - Your X app client secret');
    console.error('   X_REDIRECT_URI - OAuth redirect URI (optional, defaults to http://localhost:3000/callback)');
    process.exit(1);
  }

  const authManager = new XAuthManager(config);
  const tokenStorage = new TokenStorage();
  
  const codeVerifier = authManager.generateCodeVerifier();
  const codeChallenge = authManager.generateCodeChallenge(codeVerifier);
  
  console.log('🔐 Starting X API OAuth 2.0 + PKCE authentication...\n');
  
  const authUrl = authManager.getAuthorizationUrl(codeChallenge);
  console.log('📍 Please open this URL in your browser to authorize the application:');
  console.log(authUrl);
  console.log('\n🔄 Waiting for callback...\n');

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, `http://${req.headers.host}`);
      
      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<h1>❌ Authorization Error</h1><p>${error}</p>`);
          console.error(`❌ Authorization error: ${error}`);
          process.exit(1);
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h1>❌ Missing Authorization Code</h1>');
          console.error('❌ No authorization code received');
          process.exit(1);
        }

        try {
          console.log('🔄 Exchanging authorization code for tokens...');
          const tokenData = await authManager.exchangeCodeForToken(code, codeVerifier);
          
          console.log('💾 Saving tokens...');
          await tokenStorage.saveTokens(tokenData);
          
          console.log('✅ Authentication successful!');
          console.log(`📊 Granted scopes: ${tokenData.scope}`);
          console.log(`💾 Tokens saved to: ${tokenStorage.getTokenPath()}`);
          
          const hasRequiredScopes = authManager.hasRequiredScopes();
          if (!hasRequiredScopes) {
            const missing = authManager.getMissingScopes();
            console.warn(`⚠️  Missing required scopes: ${missing.join(', ')}`);
            console.warn('   You may need to re-authenticate with correct scopes.');
          }

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <h1>✅ Authentication Successful!</h1>
            <p>You can now close this window and use the X MCP server.</p>
            <p><strong>Granted scopes:</strong> ${tokenData.scope}</p>
            ${!hasRequiredScopes ? `<p style="color: orange;"><strong>Warning:</strong> Missing some required scopes. You may need to re-authenticate.</p>` : ''}
          `);
          
          server.close();
          process.exit(0);
        } catch (error) {
          console.error('❌ Token exchange failed:', error);
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(`<h1>❌ Token Exchange Failed</h1><p>${error}</p>`);
          process.exit(1);
        }
      } else {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404 Not Found</h1>');
      }
    } catch (error) {
      console.error('❌ Server error:', error);
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(`<h1>❌ Server Error</h1><p>${error}</p>`);
    }
  });

  const port = new URL(config.redirectUri).port || '3000';
  server.listen(parseInt(port), () => {
    console.log(`🌐 Callback server listening on port ${port}`);
  });

  process.on('SIGINT', () => {
    console.log('\n🛑 Authentication cancelled');
    server.close();
    process.exit(0);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAuthFlow().catch(error => {
    console.error('❌ Authentication failed:', error);
    process.exit(1);
  });
}