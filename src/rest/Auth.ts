import { SynologyResponse, BaseRequest, get, SessionName } from './shared';

const CGI_NAME = 'auth';
const API_NAME = 'SYNO.API.Auth';

export interface AuthLoginRequest extends BaseRequest {
  account: string;
  passwd: string;
  session: SessionName;
  // 1: DSM < 6 compatibility, not recommended.
  // 4: DSM 6+ version that doesn't erroneously send Set-Cookie headers.
  version?: 1 | 4;
}

export interface AuthLoginResponse {
  sid: string;
}

export interface AuthLogoutRequest extends BaseRequest {
  sid: string;
  session: SessionName;
}

function Login(baseUrl: string, options: AuthLoginRequest): Promise<SynologyResponse<AuthLoginResponse>> {
  return get(baseUrl, CGI_NAME, {
    ...options,
    api: API_NAME,
    version: options.version || 4,
    method: 'login',
    format: 'sid',
  });
}

function Logout(baseUrl: string, options: AuthLogoutRequest): Promise<SynologyResponse<{}>> {
  return get(baseUrl, CGI_NAME, {
    ...options,
    api: API_NAME,
    version: 1,
    method: 'logout',
  });
}

export const Auth = {
  API_NAME,
  Login,
  Logout,
};
