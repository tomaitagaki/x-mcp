#!/usr/bin/env node

import { existsSync } from 'fs';
import { join } from 'path';
import { XDatabase } from './database.js';
import { TokenStorage } from './storage.js';
import { encryption } from './encryption.js';

async function checkAuthStatus() {
  console.log('🔍 Checking for authenticated users...\n');

  // Check legacy token storage (JSON file)
  console.log('📁 Checking legacy token storage...');
  const tokenStorage = new TokenStorage();
  const legacyTokens = await tokenStorage.loadTokens();
  
  if (legacyTokens) {
    console.log('✅ Found legacy tokens:');
    console.log(`   Token path: ${tokenStorage.getTokenPath()}`);
    console.log(`   Scopes: ${legacyTokens.scope}`);
    console.log(`   Expires at: ${new Date(legacyTokens.expires_at).toISOString()}`);
    console.log(`   Status: ${Date.now() < legacyTokens.expires_at ? '✅ Valid' : '❌ Expired'}\n`);
  } else {
    console.log('❌ No legacy tokens found\n');
  }

  // Check multi-user database
  console.log('📁 Checking multi-user database...');
  const dbPath = join(process.env.HOME || process.cwd(), '.mcp', 'x', 'tokens.db');
  
  if (existsSync(dbPath)) {
    const db = new XDatabase(dbPath);
    
    // Get all users
    const users = db.getAllUsers();
    console.log(`   Found ${users.length} user(s) in database\n`);
    
    if (users.length > 0) {
      for (const user of users) {
        console.log(`👤 User: @${user.x_username} (${user.display_name})`);
        console.log(`   X User ID: ${user.x_user_id}`);
        console.log(`   Created: ${new Date(user.created_at).toISOString()}`);
        
        const tokens = db.getUserTokens(user.id);
        if (tokens) {
          const isExpired = Date.now() >= tokens.expires_at;
          console.log(`   ✅ Has tokens`);
          console.log(`   Scopes: ${tokens.granted_scopes}`);
          console.log(`   Expires at: ${new Date(tokens.expires_at).toISOString()}`);
          console.log(`   Status: ${isExpired ? '❌ Expired' : '✅ Valid'}`);
          console.log(`   Updated: ${new Date(tokens.updated_at).toISOString()}`);
        } else {
          console.log(`   ❌ No tokens found`);
        }
        console.log('');
      }
    } else {
      console.log('❌ No users found in database\n');
    }
    
    db.close();
  } else {
    console.log(`❌ Database not found at: ${dbPath}\n`);
  }

  console.log('✅ Check complete!');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  checkAuthStatus().catch(error => {
    console.error('❌ Error checking auth status:', error);
    process.exit(1);
  });
}

