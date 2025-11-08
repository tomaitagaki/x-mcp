# X MCP Server v2.0 - Multi-User OAuth

A comprehensive MCP server for X (Twitter) API v2 with multi-user OAuth 2.0 + PKCE authentication, encrypted token storage, and automatic token refresh.

## 🚀 New Features v2.0

- ✅ **Multi-User Support** - Multiple users with isolated tokens and sessions
- ✅ **Two Auth Flows** - Loopback (local) and Hosted Pairing Code (multi-user)
- ✅ **Encrypted Token Storage** - SQLite with OS keychain integration
- ✅ **Automatic Token Refresh** - Background refresh with scope validation
- ✅ **Session Management** - Secure session handling for different transport types
- ✅ **Per-User Isolation** - Complete isolation of user data and permissions

## 🏗️ Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   MCP Client    │────│  MCP Server     │────│   X API v2      │
│   (stdio/http)  │    │   (v2.0)        │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  SQLite + Crypto│
                    │  ~/.mcp/x/      │
                    │  tokens.db      │
                    └─────────────────┘
```

### Core Components

1. **XDatabase** - SQLite schema with users, sessions, tokens, pairing sessions
2. **EncryptionManager** - AES-256 encryption with OS keychain support
3. **SessionManager** - Multi-user session handling and context extraction
4. **TokenManager** - Automatic refresh, scope validation, per-user isolation
5. **OAuthManager** - Dual-mode OAuth (loopback + hosted pairing)
6. **MultiUserXClient** - Session-aware X API client

## 🔐 Authentication Flows

### Flow 1: Loopback OAuth (Local/Single-User)

Perfect for CLI tools, local development, and single-user scenarios.

```bash
# Start loopback auth
curl -X POST http://localhost:3000/mcp \
  -d '{"method": "tools/call", "params": {"name": "auth/start", "arguments": {"mode": "loopback"}}}'

# Response includes authorize_url
# User opens URL → authorizes → automatic callback → tokens stored
```

**Process:**
1. Server starts callback server on `127.0.0.1:PORT`
2. Generates PKCE challenge + state
3. Opens authorization URL in browser
4. User authorizes → callback received
5. Exchanges code for tokens → stores encrypted tokens
6. Associates tokens with default local user

### Flow 2: Hosted Pairing Code (Multi-User)

Perfect for hosted services, multi-tenant applications, and remote scenarios.

```bash
# Start hosted auth
curl -X POST http://localhost:3000/mcp \
  -d '{"method": "tools/call", "params": {"name": "auth/start", "arguments": {"mode": "hosted"}}}'

# Response: {"pairing_code": "ABC12345", "login_url": "https://app.com/login?pairing_code=ABC12345"}

# User visits login_url → completes OAuth → server binds tokens to pairing_code

# Check pairing status
curl -X POST http://localhost:3000/mcp \
  -d '{"method": "tools/call", "params": {"name": "auth/status", "arguments": {"pairing_code": "ABC12345"}}}'
```

**Process:**
1. Server generates 8-character pairing code + PKCE
2. Stores pairing session in database (10min TTL)
3. Returns pairing code + login URL
4. User visits login URL → redirected to X OAuth
5. After authorization → server binds tokens to pairing code
6. MCP client polls pairing status → gets user info when complete

## 🗄️ Database Schema

**SQLite database at `~/.mcp/x/tokens.db`:**

```sql
-- Users table
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  created_at INTEGER NOT NULL,
  display_name TEXT NOT NULL,
  x_user_id TEXT UNIQUE NOT NULL,  -- X's user ID
  x_username TEXT NOT NULL         -- @username
);

-- Sessions table  
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,              -- UUID
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,      -- 30 days default
  session_secret_hash TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id)
);

-- Encrypted tokens table
CREATE TABLE user_tokens (
  user_id INTEGER PRIMARY KEY,
  provider TEXT DEFAULT 'x',
  x_user_id TEXT NOT NULL,
  granted_scopes TEXT NOT NULL,
  access_token TEXT NOT NULL,       -- AES-256 encrypted
  refresh_token TEXT NOT NULL,      -- AES-256 encrypted  
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id)
);

-- Pairing sessions (hosted flow)
CREATE TABLE pairing_sessions (
  pairing_code TEXT PRIMARY KEY,    -- 8-char code
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,      -- 10 min TTL
  code_verifier TEXT NOT NULL,      -- PKCE verifier
  state TEXT NOT NULL,              -- OAuth state
  user_id INTEGER NULL,             -- Set when completed
  completed INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users (id)
);
```

## 🔒 Security Features

### Encryption
- **AES-256-CBC** encryption for all tokens
- **OS Keychain integration** (macOS Keychain, Windows DPAPI)
- **Fallback to file-based** encrypted key storage
- **PBKDF2** password hashing for session secrets

### Token Security
- Tokens **never logged** (masked to last 4 characters)
- **Automatic refresh** 60 seconds before expiry
- **Scope validation** before each API call
- **Immediate revocation** on refresh failure

### Session Security
- **UUID session IDs** with secure random generation
- **HMAC session secrets** for hosted mode
- **Automatic cleanup** of expired sessions
- **Transport-agnostic** context extraction

## 📡 MCP Tools & Resources

### New Auth Tools

#### `auth/start`
Start OAuth flow (loopback or hosted)

**Input:**
```json
{
  "mode": "loopback|hosted"
}
```

**Output (Loopback):**
```json
{
  "authorize_url": "https://x.com/i/oauth2/authorize?..."
}
```

**Output (Hosted):**
```json
{
  "pairing_code": "ABC12345",
  "login_url": "https://yourapp.com/login?pairing_code=ABC12345"
}
```

#### `auth/status`
Check pairing status (hosted mode)

**Input:**
```json
{
  "pairing_code": "ABC12345"
}
```

**Output:**
```json
{
  "verified": true,
  "user": {
    "id": 123,
    "display_name": "John Doe",
    "x_username": "johndoe"
  }
}
```

### Updated Bookmark Tools

All existing tools (`bookmarks.list`, `bookmarks.add`, `bookmarks.remove`, `tweet.create`) now support multi-user contexts automatically.

### Resources

- `mcp://x/user/me` - Current user info (session-specific)
- `mcp://x/bookmarks/latest` - Latest bookmarks (session-specific)

## 🎯 Session Context

The server automatically extracts session context from different transport types:

### stdio Transport
Uses default local user (no explicit session needed)

### HTTP Transport
Supports multiple authentication methods:

```bash
# Bearer token
Authorization: Bearer sessionId:sessionSecret

# Cookie
Cookie: session=sessionId:sessionSecret  

# Custom headers
X-Session-Id: sessionId
X-Session-Secret: sessionSecret
```

## 🔧 Configuration

### Environment Variables

```bash
# Required
export X_CLIENT_ID="your_x_client_id"
export X_CLIENT_SECRET="your_x_client_secret"

# Optional
export X_REDIRECT_URI="http://127.0.0.1:3000/auth/x/cb"  # Loopback
export X_HOSTED_MODE="true"                               # Enable hosted mode  
export X_BASE_URL="https://yourapp.com"                  # Hosted base URL
export X_MCP_ENCRYPTION_KEY="base64_encoded_key"         # Manual encryption key
```

### Database Location

Default: `~/.mcp/x/tokens.db`

Custom: Set database path in constructor or environment variable.

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Build

```bash
npm run build
```

### 3. Configure Environment

```bash
export X_CLIENT_ID="your_client_id"
export X_CLIENT_SECRET="your_client_secret"
```

### 4A. Local/Single-User Mode

```bash
npm start
# Server starts on stdio

# In another terminal, test loopback auth
curl -X POST http://localhost:3000/mcp \
  -d '{"method": "tools/call", "params": {"name": "auth/start", "arguments": {"mode": "loopback"}}}'
```

### 4B. Hosted/Multi-User Mode

```bash
export X_HOSTED_MODE="true"
export X_BASE_URL="https://yourapp.com"
npm start

# Test hosted pairing
curl -X POST http://localhost:3000/mcp \
  -d '{"method": "tools/call", "params": {"name": "auth/start", "arguments": {"mode": "hosted"}}}'
```

## 🧪 Testing

Run comprehensive tests:

```bash
npm test
```

Tests include:
- ✅ Encryption/decryption functionality
- ✅ Database operations and schema
- ✅ Token management and validation
- ✅ OAuth flow simulation
- ✅ Session management
- ✅ Multi-user isolation

## 📊 Rate Limits & Resilience

- **Automatic retry** with exponential backoff on 429/5xx
- **Rate limit header parsing** (`x-rate-limit-*`)
- **Dynamic throttling** based on actual API limits
- **MCP notifications** when rate limits are low
- **Per-user rate limit tracking**

## 🔄 Migration from v1.0

The v2.0 server is **backward compatible** with v1.0 for single-user scenarios:

1. v1.0 tokens in `~/.x-mcp/tokens.json` can be migrated
2. Use `npm run start:legacy` to run v1.0 server
3. Default local user handles stdio transport transparently

## 📈 Performance & Scalability

- **SQLite database** with optimized indexes
- **In-memory user/bookmark caching** per user
- **Automatic cleanup** of expired sessions/pairing codes
- **Efficient encryption** with minimal CPU overhead
- **Concurrent user support** with isolated contexts

## 🛠️ Advanced Usage

### Custom Session Creation

```typescript
import { SessionManager } from './session-manager.js';
import { XDatabase } from './database.js';

const db = new XDatabase();
const sessionManager = new SessionManager(db);

// Create session for specific user
const session = sessionManager.createSession(userId, Date.now() + 86400000); // 24h
```

### Manual Token Refresh

```typescript
import { TokenManager } from './token-manager.js';

const tokenManager = new TokenManager(config, db);
const user = await sessionManager.requireUser(sessionId);

try {
  const accessToken = await tokenManager.validateToolAccess(user, 'bookmarks.list');
  // Use access token for API call
} catch (error) {
  if (error.code === 'auth_reauth_required') {
    // Handle re-authentication
    console.log('Re-auth URL:', error.login_url);
  }
}
```

### Database Backup

```typescript
import { XDatabase } from './database.js';

const db = new XDatabase();
db.backup('/path/to/backup.db');
```

## 🤝 Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/new-feature`
3. Make changes with comprehensive tests
4. Ensure all tests pass: `npm test`
5. Submit pull request

## 📝 License

MIT License - see LICENSE file for details.

---

**X MCP Server v2.0** - Secure, scalable, multi-user X API integration for the Model Context Protocol.