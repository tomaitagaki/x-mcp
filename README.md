# X MCP Server v2.0

A comprehensive Model Context Protocol (MCP) server for X (Twitter) API v2 with **multi-user OAuth 2.0 + PKCE**, encrypted token storage, and automatic token refresh.

## 🚀 New in v2.0

- ✅ **Multi-User Support** - Multiple users with isolated tokens and sessions
- ✅ **Dual OAuth Flows** - Loopback (local) + Hosted Pairing Code (remote/multi-user)
- ✅ **Encrypted Token Storage** - SQLite database with OS keychain integration  
- ✅ **Automatic Token Refresh** - Background refresh with scope validation
- ✅ **Session Management** - Secure session handling for different transports
- ✅ **Non-Browser Support** - Works without browser access via pairing codes

## Features

- ✅ OAuth 2.0 Authorization Code + PKCE authentication (both flows)
- ✅ Multi-user support with per-user token isolation
- ✅ Encrypted local token storage (AES-256 + OS keychain)
- ✅ Automatic token refresh and persistence
- ✅ Scope verification and re-auth instructions
- ✅ Rate limiting with retry/backoff logic
- ✅ Bookmark management (list, add, remove)
- ✅ Tweet creation (text, media, replies, quotes)
- ✅ Session-aware MCP resources
- ✅ Comprehensive error handling and logging

## Setup

### 1. X Developer Account Setup

1. Create a [X Developer account](https://developer.x.com/)
2. Create a new app in the [Developer Portal](https://developer.x.com/en/portal/dashboard)
3. Configure OAuth 2.0 settings:
   - **App permissions**: Read and Write
   - **Type of App**: Web App
   - **Callback URI**: `http://localhost:3000/callback` (or your custom URI)
   - **Website URL**: Required (can be placeholder)
4. Note your **Client ID** and **Client Secret**

### 2. Installation

```bash
# Clone or create the project directory
cd x-mcp
npm install
npm run build
```

### 3. Environment Setup

Create a `.env` file or export environment variables:

```bash
export X_CLIENT_ID="your_client_id_here"
export X_CLIENT_SECRET="your_client_secret_here"
export X_REDIRECT_URI="http://localhost:3000/callback"  # Optional
```

### 4. Authentication

Run the authentication helper to complete OAuth flow:

```bash
npm run auth
# or
node dist/auth-helper.js
```

This will:
1. Open your browser to X's authorization page
2. Start a local callback server
3. Exchange the authorization code for tokens
4. Save tokens to `~/.x-mcp/tokens.json`

## Quick Start

### V2.0 Multi-User Server (Recommended)

```bash
npm install
npm run build

# Set environment variables
export X_CLIENT_ID="your_client_id"
export X_CLIENT_SECRET="your_client_secret"

# Start multi-user server
npm start
```

### Authentication Flows

#### Local/Single-User (Loopback)
```bash
# Via MCP tool call
{"method": "tools/call", "params": {"name": "auth/start", "arguments": {"mode": "loopback"}}}
# Opens browser for authorization
```

#### Multi-User/Remote (Hosted Pairing)
```bash
# Enable hosted mode
export X_HOSTED_MODE="true"
export X_BASE_URL="https://yourapp.com"

# Via MCP tool call  
{"method": "tools/call", "params": {"name": "auth/start", "arguments": {"mode": "hosted"}}}
# Returns pairing code + login URL

# Check status
{"method": "tools/call", "params": {"name": "auth/status", "arguments": {"pairing_code": "ABC12345"}}}
```

### Legacy V1.0 Server

```bash
npm run start:legacy
# or
node dist/index.js
```

### MCP Tools

The server provides these tools:

#### `bookmarks.list`
List user bookmarks with pagination support.

**Parameters:**
- `user_id` (optional): User ID (defaults to authenticated user)
- `max_results` (optional): Maximum results per page (1-100, default: 10)
- `pagination_token` (optional): Token for next page of results

**Example:**
```json
{
  "tweets": [
    {
      "id": "1234567890",
      "text": "Great tweet content...",
      "created_at": "2023-01-01T00:00:00.000Z",
      "author_id": "987654321",
      "public_metrics": {
        "retweet_count": 5,
        "like_count": 10,
        "reply_count": 2,
        "quote_count": 1
      }
    }
  ],
  "nextToken": "next_page_token"
}
```

#### `bookmarks.add`
Add a tweet to bookmarks.

**Parameters:**
- `tweet_id` (required): ID of the tweet to bookmark
- `user_id` (optional): User ID (defaults to authenticated user)

**Returns:** `{ "ok": true }`

#### `bookmarks.remove`
Remove a tweet from bookmarks.

**Parameters:**
- `tweet_id` (required): ID of the tweet to remove from bookmarks
- `user_id` (optional): User ID (defaults to authenticated user)

**Returns:** `{ "ok": true }`

#### `tweet.create`
Create a new tweet.

**Parameters:**
- `text` (required): Tweet text content (max 280 characters)
- `media_ids` (optional): Array of media IDs to attach
- `reply` (optional): Object with `in_reply_to_tweet_id` for replies
- `quote_tweet_id` (optional): ID of tweet to quote

**Example:**
```json
{
  "id": "1234567890",
  "createdAt": "2023-01-01T00:00:00.000Z"
}
```

### MCP Resources

#### `mcp://x/user/me`
Current authenticated X user information:
```json
{
  "id": "123456789",
  "username": "example_user",
  "name": "Example User"
}
```

#### `mcp://x/bookmarks/latest`
Last fetched bookmarks page with pagination token:
```json
{
  "tweets": [...],
  "nextToken": "pagination_token"
}
```

## Required Scopes

The server requires these X API scopes:
- `bookmark.read` or `bookmarks.read` - Read bookmarks
- `bookmarks.write` - Modify bookmarks  
- `tweet.write` - Post tweets
- `tweet.read` - Read tweets (for tweet creation responses)
- `users.read` - Read user information
- `offline.access` - Refresh token support

If scopes are missing, the server will provide re-authentication instructions.

## Rate Limiting

The server automatically handles X API rate limits:
- ✅ Retries on 429/5xx responses with exponential backoff
- ✅ Reads `x-rate-limit-*` headers for intelligent throttling
- ✅ Surfaces MCP notifications when limits are low
- ✅ Adapts to actual API limits (doesn't hardcode limits)

Current typical limits (may vary by plan):
- GET bookmarks: ~180 requests per 15 minutes
- POST/DELETE bookmarks: ~50 requests per 15 minutes
- POST tweets: ~300 requests per 15 minutes

## File Structure

```
src/
├── index.ts          # Main MCP server
├── auth.ts           # OAuth 2.0 + PKCE implementation
├── auth-helper.ts    # Interactive authentication flow
├── x-client.ts       # X API client with bookmarks/tweets
├── http-client.ts    # HTTP client with retry/rate limiting
├── storage.ts        # Token persistence
└── types.ts          # TypeScript type definitions
```

## Scripts

```bash
npm run build          # Compile TypeScript
npm start              # Start v2.0 multi-user server  
npm run start:legacy   # Start v1.0 legacy server
npm run auth           # Interactive OAuth helper (legacy)
npm test               # Run comprehensive test suite
npm run dev            # Development mode
npm run watch          # Watch mode compilation
```

## Configuration

### V2.0 Environment Variables:
- `X_CLIENT_ID` - X app client ID (required)
- `X_CLIENT_SECRET` - X app client secret (required)  
- `X_REDIRECT_URI` - OAuth redirect URI (default: `http://127.0.0.1:3000/auth/x/cb`)
- `X_HOSTED_MODE` - Enable hosted pairing mode (`true`/`false`)
- `X_BASE_URL` - Base URL for hosted mode (e.g., `https://yourapp.com`)
- `X_MCP_ENCRYPTION_KEY` - Manual encryption key (base64, optional)

### Storage Locations:
- **V2.0 Database:** `~/.mcp/x/tokens.db` (SQLite with encryption)
- **V1.0 Tokens:** `~/.x-mcp/tokens.json` (legacy JSON format)
- **Encryption Key:** OS Keychain or `~/.mcp/x/.encryption_key`

## Error Handling

The server provides detailed error messages for:
- ❌ Missing authentication/tokens
- ❌ Insufficient scopes with re-auth instructions
- ❌ API errors with request IDs (in debug mode)
- ❌ Rate limit violations with retry guidance
- ❌ Network errors with retry logic

## Testing

### Comprehensive Test Suite
```bash
npm test  # Runs all tests including encryption, database, OAuth flows
```

### Manual E2E Testing (V2.0)
1. **Start server**: `npm start`
2. **Loopback auth**: Call `auth/start` with `mode: "loopback"`
3. **Complete OAuth**: Open returned URL, authorize
4. **Test bookmarks**: `bookmarks.list`, `bookmarks.add`, `bookmarks.remove`
5. **Test tweets**: `tweet.create`

### Multi-User Testing (V2.0)
1. **Enable hosted mode**: Set `X_HOSTED_MODE=true`, `X_BASE_URL`
2. **Start pairing**: Call `auth/start` with `mode: "hosted"`
3. **Complete auth**: Visit login URL with pairing code
4. **Check status**: Call `auth/status` with pairing code
5. **Test with session**: Include session context in subsequent calls

### Legacy Testing (V1.0)
1. **Authentication**: `npm run auth`
2. **Start legacy server**: `npm run start:legacy`
3. **Test tools**: Use existing MCP tools

## Troubleshooting

### Authentication Issues
- Verify X_CLIENT_ID and X_CLIENT_SECRET are correct
- Check that redirect URI matches your app configuration
- Ensure your X app has correct permissions (Read and Write)

### Scope Issues
- Re-run `npm run auth` to get updated scopes
- Check that your X app is configured for the required permissions

### Rate Limit Issues
- The server will automatically retry and backoff
- Check the logs for rate limit information
- Consider the plan limits for your X developer account

### Token Issues
- Tokens are auto-refreshed when expired
- **V2.0**: Check database at `~/.mcp/x/tokens.db`, run `npm test` for diagnostics
- **V1.0**: Delete `~/.x-mcp/tokens.json` and re-authenticate if needed

## 📚 Detailed Documentation

For comprehensive documentation on the new multi-user OAuth system, architecture, and advanced usage, see:

**[README-MULTIUSER.md](./README-MULTIUSER.md)** - Complete v2.0 documentation with:
- 🏗️ Detailed architecture overview
- 🔐 Security implementation details  
- 🗄️ Database schema and design
- 📡 Complete API reference
- 🧪 Advanced testing scenarios
- 🛠️ Development and extension guide