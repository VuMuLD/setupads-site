export interface FacebookAuthResponse {
  accessToken: string;
  expiresIn: number;
  signedRequest: string;
  userID: string;
}

export interface FacebookLoginStatusResponse {
  status: "connected" | "not_authorized" | "unknown";
  authResponse?: FacebookAuthResponse;
}

export interface FacebookLoginResponse {
  authResponse?: FacebookAuthResponse;
  status?: string;
}

interface FacebookSDK {
  init(params: {
    appId: string;
    cookie?: boolean;
    xfbml?: boolean;
    version: string;
  }): void;
  getLoginStatus(
    callback: (response: FacebookLoginStatusResponse) => void
  ): void;
  login(
    callback: (response: FacebookLoginResponse) => void,
    options?: { scope?: string; config_id?: string }
  ): void;
  logout(callback?: () => void): void;
  AppEvents: {
    logPageView(): void;
  };
}

declare global {
  interface Window {
    FB?: FacebookSDK;
    fbAsyncInit?: () => void;
  }
}

export {};
