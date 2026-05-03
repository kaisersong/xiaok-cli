export interface LoginRequest { login: string; password: string; }
export interface LoginResponse { access_token: string; token_type: string; }
export interface ErrorEnvelope { code?: unknown; message?: unknown; }
