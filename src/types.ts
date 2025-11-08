export interface XConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  hostedMode?: boolean;
  baseUrl?: string;
}

export interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
}

export interface User {
  id: number;
  created_at: number;
  display_name: string;
  x_user_id: string;
  x_username: string;
}

export interface Session {
  id: string;
  user_id: number;
  created_at: number;
  expires_at: number;
  session_secret_hash: string;
}

export interface UserToken {
  user_id: number;
  provider: 'x';
  x_user_id: string;
  granted_scopes: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  created_at: number;
  updated_at: number;
}

export interface PairingSession {
  pairing_code: string;
  created_at: number;
  expires_at: number;
  code_verifier: string;
  state: string;
  user_id?: number;
  completed: boolean;
}

export interface AuthStartResponse {
  pairing_code?: string;
  login_url?: string;
  authorize_url?: string;
}

export interface AuthStatusResponse {
  verified: boolean;
  user?: {
    id: number;
    display_name: string;
    x_username: string;
  };
}

export interface AuthError extends Error {
  code: 'auth_reauth_required' | 'auth_invalid_session' | 'auth_expired' | 'auth_scope_insufficient';
  login_url?: string;
  missing_scopes?: string[];
}

export interface XUser {
  id: string;
  username: string;
  name: string;
}

export interface Tweet {
  id: string;
  text: string;
  created_at: string;
  author_id?: string;
  public_metrics?: {
    retweet_count: number;
    like_count: number;
    reply_count: number;
    quote_count: number;
    bookmark_count?: number;
  };
}

export interface BookmarksResponse {
  data?: Tweet[];
  meta?: {
    result_count: number;
    next_token?: string;
  };
}

export interface RateLimitInfo {
  remaining: number;
  reset: number;
  limit: number;
}

export interface XApiError {
  detail: string;
  title: string;
  type: string;
  resource_type?: string;
  parameter?: string;
  value?: string;
}

export interface XApiResponse<T = any> {
  data?: T;
  errors?: XApiError[];
  meta?: any;
}