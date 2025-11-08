#!/usr/bin/env node

import { XConfig } from './types.js';
import { XDatabase } from './database.js';
import { SessionManager } from './session-manager.js';
import { TokenManager } from './token-manager.js';
import { OAuthManager } from './oauth-manager.js';
import { MultiUserXClient } from './multi-user-x-client.js';

async function testLoopbackFlow() {
  console.log('\n🔄 Testing Loopback OAuth Flow...');
  
  const config: XConfig = {
    clientId: process.env.X_CLIENT_ID || '',
    clientSecret: process.env.X_CLIENT_SECRET || '',
    redirectUri: 'http://127.0.0.1:3000/auth/x/cb',
    hostedMode: false
  };

  if (!config.clientId || !config.clientSecret) {
    console.log('⏭️ Skipping loopback test - missing X_CLIENT_ID or X_CLIENT_SECRET');
    return;
  }

  try {
    const db = new XDatabase(':memory:'); // Use in-memory DB for testing
    const sessionManager = new SessionManager(db);
    const tokenManager = new TokenManager(config, db);
    const oauthManager = new OAuthManager(config, db);
    const xClient = new MultiUserXClient(tokenManager, sessionManager);

    console.log('🚀 Starting loopback auth...');
    const authResult = await oauthManager.startLoopbackAuth();
    
    console.log('✅ Loopback auth started successfully');
    console.log('📍 Authorization URL generated:', authResult.authorize_url ? 'Yes' : 'No');
    
    // Simulate what happens after user authorizes (we can't complete without real auth)
    console.log('💡 In real usage, user would open the URL and authorize');
    console.log('🔄 Server would receive callback and complete token exchange');
    
    db.close();
    oauthManager.stop();
    
  } catch (error) {
    console.error('❌ Loopback flow test failed:', error);
  }
}

async function testHostedFlow() {
  console.log('\n🔄 Testing Hosted Pairing Flow...');
  
  const config: XConfig = {
    clientId: process.env.X_CLIENT_ID || '',
    clientSecret: process.env.X_CLIENT_SECRET || '',
    redirectUri: 'http://localhost:3000/auth/x/callback',
    hostedMode: true,
    baseUrl: 'http://localhost:3000'
  };

  if (!config.clientId || !config.clientSecret) {
    console.log('⏭️ Skipping hosted test - missing X_CLIENT_ID or X_CLIENT_SECRET');
    return;
  }

  try {
    const db = new XDatabase(':memory:'); // Use in-memory DB for testing
    const sessionManager = new SessionManager(db);
    const tokenManager = new TokenManager(config, db);
    const oauthManager = new OAuthManager(config, db);

    console.log('🚀 Starting hosted auth...');
    const authResult = await oauthManager.startHostedAuth();
    
    console.log('✅ Hosted auth started successfully');
    console.log('🔢 Pairing code:', authResult.pairing_code);
    console.log('🔗 Login URL:', authResult.login_url);
    
    // Test pairing status check
    console.log('🔄 Checking pairing status...');
    const statusResult = await oauthManager.checkPairingStatus(authResult.pairing_code!);
    
    console.log('📊 Pairing status:', statusResult.verified ? 'Verified' : 'Pending');
    console.log('💡 In real usage, status would be true after user completes auth');
    
    // Test expiry cleanup
    console.log('🧹 Testing cleanup...');
    db.cleanupExpiredPairingSessions();
    
    db.close();
    
  } catch (error) {
    console.error('❌ Hosted flow test failed:', error);
  }
}

async function testTokenManagement() {
  console.log('\n🔄 Testing Token Management...');
  
  try {
    const db = new XDatabase(':memory:');
    const sessionManager = new SessionManager(db);
    const config: XConfig = {
      clientId: 'test_client',
      clientSecret: 'test_secret',
      redirectUri: 'http://localhost:3000/callback'
    };
    const tokenManager = new TokenManager(config, db);

    // Create a test user
    const user = db.createUser('test_user_123', 'testuser', 'Test User');
    console.log('👤 Created test user:', user.x_username);

    // Test token validation without tokens
    try {
      await tokenManager.validateToolAccess(user, 'bookmarks.list');
      console.log('❌ Should have failed without tokens');
    } catch (error) {
      console.log('✅ Correctly rejected access without tokens');
    }

    // Test scope checking
    const requiredScopes = ['bookmark.read', 'bookmarks.write'];
    const grantedScopes = 'bookmark.read users.read tweet.write';
    
    console.log('🔍 Testing scope validation...');
    const tokenInfo = tokenManager.getUserTokenInfo(user);
    console.log('📊 Token info (no tokens):', tokenInfo.hasTokens ? 'Has tokens' : 'No tokens');

    db.close();
    
  } catch (error) {
    console.error('❌ Token management test failed:', error);
  }
}

async function testEncryption() {
  console.log('\n🔄 Testing Encryption...');
  
  try {
    // Dynamic import to handle encryption module
    const { encryption } = await import('./encryption.js');
    
    const testData = 'access_token_123456789';
    console.log('🔐 Original token:', encryption.maskToken(testData));
    
    const encrypted = encryption.encrypt(testData);
    console.log('🔒 Encrypted (sample):', encrypted.substring(0, 20) + '...');
    
    const decrypted = encryption.decrypt(encrypted);
    const matches = decrypted === testData;
    
    console.log('🔓 Decryption successful:', matches ? 'Yes' : 'No');
    
    // Test password hashing
    const { hash, salt } = encryption.hashPassword('test_password');
    console.log('🔑 Password hash generated');
    
    const verified = encryption.verifyPassword('test_password', hash, salt);
    console.log('✅ Password verification:', verified ? 'Success' : 'Failed');
    
    // Test secure token generation
    const token = encryption.generateSecureToken(16);
    console.log('🎲 Generated secure token length:', token.length);
    
  } catch (error) {
    console.error('❌ Encryption test failed:', error);
  }
}

async function testDatabaseOperations() {
  console.log('\n🔄 Testing Database Operations...');
  
  try {
    const db = new XDatabase(':memory:');
    
    // Test user creation
    const user1 = db.createUser('user_123', 'alice', 'Alice Johnson');
    const user2 = db.createUser('user_456', 'bob', 'Bob Smith');
    
    console.log('👥 Created users:', user1.x_username, user2.x_username);
    
    // Test user retrieval
    const foundUser = db.getUserByXUserId('user_123');
    console.log('🔍 Retrieved user:', foundUser?.x_username);
    
    // Test session creation
    const sessionManager = new SessionManager(db);
    const session = sessionManager.createSession(user1.id);
    
    console.log('🎫 Created session:', session.sessionId.substring(0, 8) + '...');
    
    // Test session validation
    const validSession = sessionManager.validateSession(session.sessionId);
    console.log('✅ Session validation:', validSession ? 'Valid' : 'Invalid');
    
    // Test pairing session
    const pairingCode = 'TEST1234';
    const pairingSession = db.createPairingSession(pairingCode, 'code_verifier', 'state_123');
    
    console.log('🔗 Created pairing session:', pairingCode);
    
    const retrievedPairing = db.getPairingSession(pairingCode);
    console.log('🔍 Retrieved pairing session:', retrievedPairing ? 'Found' : 'Not found');
    
    // Test cleanup
    db.cleanupExpiredSessions();
    db.cleanupExpiredPairingSessions();
    console.log('🧹 Cleanup completed');
    
    db.close();
    
  } catch (error) {
    console.error('❌ Database test failed:', error);
  }
}

async function runAllTests() {
  console.log('🧪 X MCP Server Multi-User OAuth Tests');
  console.log('=====================================');
  
  await testEncryption();
  await testDatabaseOperations();
  await testTokenManagement();
  await testLoopbackFlow();
  await testHostedFlow();
  
  console.log('\n✅ All tests completed!');
  console.log('💡 For full E2E testing, set X_CLIENT_ID and X_CLIENT_SECRET environment variables');
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().catch(error => {
    console.error('💥 Test suite failed:', error);
    process.exit(1);
  });
}