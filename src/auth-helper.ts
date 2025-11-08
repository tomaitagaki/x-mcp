#!/usr/bin/env node

import { createServer } from 'http';
import { createServer as createNetServer } from 'net';
import { URL } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import { XAuthManager } from './auth.js';
import { TokenStorage } from './storage.js';
import { XConfig } from './types.js';
import { loadEnvIfNeeded } from './env-loader.js';

const execAsync = promisify(exec);

/**
 * Opens a URL in the default browser
 */
async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;
  let command: string;

  if (platform === 'darwin') {
    command = `open "${url}"`;
  } else if (platform === 'win32') {
    command = `start "" "${url}"`;
  } else {
    command = `xdg-open "${url}"`;
  }

  try {
    await execAsync(command);
  } catch (error) {
    console.warn('⚠️  Could not automatically open browser. Please open the URL manually.');
  }
}

/**
 * Finds an available port starting from the given port
 */
function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    
    server.listen(startPort, () => {
      const port = (server.address() as any)?.port;
      server.close(() => {
        resolve(port);
      });
    });
    
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        // Try next port
        findAvailablePort(startPort + 1).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });
  });
}

async function runAuthFlow() {
  // Load .env file if env vars aren't already set
  loadEnvIfNeeded();
  
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

  // Find an available port before starting the server
  const requestedPort = parseInt(new URL(config.redirectUri).port || '3000');
  let actualPort: number;
  try {
    actualPort = await findAvailablePort(requestedPort);
    
    // If we had to use a different port, fail with clear instructions
    // X requires the redirect_uri to exactly match what's configured in the app settings
    if (actualPort !== requestedPort) {
      console.error(`\n❌ Port ${requestedPort} is already in use, but X requires the redirect URI to match exactly.`);
      console.error(`\n   To fix this, you have two options:\n`);
      console.error(`   Option 1: Free up port ${requestedPort}`);
      console.error(`   - Find what's using it: lsof -ti:${requestedPort}`);
      console.error(`   - Stop that process, then try again\n`);
      console.error(`   Option 2: Update your X app settings`);
      console.error(`   - Go to https://developer.x.com/en/portal/dashboard`);
      console.error(`   - Edit your app's OAuth 2.0 settings`);
      console.error(`   - Add callback URI: http://localhost:${actualPort}/callback`);
      console.error(`   - Then set X_REDIRECT_URI=http://localhost:${actualPort}/callback in your .env\n`);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Failed to find an available port:', error);
    process.exit(1);
  }

  const authManager = new XAuthManager(config);
  const tokenStorage = new TokenStorage();
  
  const codeVerifier = authManager.generateCodeVerifier();
  const codeChallenge = authManager.generateCodeChallenge(codeVerifier);
  
  console.log('🔐 Starting X API OAuth 2.0 + PKCE authentication...\n');
  
  const authUrl = authManager.getAuthorizationUrl(codeChallenge);
  const urlObj = new URL(authUrl);
  const requestedScopes = urlObj.searchParams.get('scope') || '';
  
  console.log('📋 Configuration:');
  console.log(`   Client ID: ${config.clientId.substring(0, 20)}...`);
  console.log(`   Redirect URI: ${config.redirectUri}`);
  console.log(`   Requested scopes: ${requestedScopes}`);
  console.log(`   Scopes (split): ${requestedScopes.split(' ').map(s => `"${s}"`).join(', ')}`);
  console.log('\n📍 Authorization URL:');
  console.log(authUrl);
  console.log('\n🌐 Opening browser...\n');
  
  // Try to open browser automatically
  await openBrowser(authUrl);
  
  console.log('🔄 Waiting for callback on http://localhost:' + actualPort + '/callback...');
  console.log('   (If browser didn\'t open, copy the URL above and paste it in your browser)\n');

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, `http://${req.headers.host}`);
      
      console.log(`📥 Received request: ${url.pathname}`);
      
      if (url.pathname === '/callback') {
        console.log('✅ Callback received! Processing...');
        console.log(`📋 Full callback URL: ${url.toString()}`);
        console.log(`📋 Query parameters:`, Object.fromEntries(url.searchParams));
        
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');
        const errorDescription = url.searchParams.get('error_description');
        const errorUri = url.searchParams.get('error_uri');
        
        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<h1>❌ Authorization Error</h1><p>${error}</p>${errorDescription ? `<p>${errorDescription}</p>` : ''}`);
          console.error(`\n❌ Authorization error: ${error}`);
          if (errorDescription) {
            console.error(`   Description: ${errorDescription}`);
          }
          if (errorUri) {
            console.error(`   More info: ${errorUri}`);
          }
          console.error(`\n🔍 Debugging info:`);
          console.error(`   Requested scopes: ${requestedScopes}`);
          console.error(`   Scopes (individual): ${requestedScopes.split(' ').map(s => `"${s}"`).join(', ')}`);
          console.error(`   Callback URI: ${config.redirectUri}`);
          console.error(`   Make sure your X app callback URI matches exactly: ${config.redirectUri}`);
          console.error(`\n💡 Try testing with minimal scopes:`);
          console.error(`   X_API_TEST_SCOPES=minimal npm run auth`);
          console.error(`   Or test individual scopes by setting X_API_TEST_SCOPES="users.read"`);
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

  // Handle server errors
  server.on('error', (error: NodeJS.ErrnoException) => {
    console.error('❌ Server error:', error);
    process.exit(1);
  });
  
  server.listen(actualPort, () => {
    console.log(`✅ Callback server is ready on port ${actualPort}`);
    console.log(`   Listening for: http://localhost:${actualPort}/callback\n`);
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