import {
  Auth,
  AuthLoginResponse,
  DownloadStation,
  DownloadStation2,
  FileStation,
  Info,
  SynologyResponse,
  SessionName,
  SynologyFailureResponse,
} from "./rest";
import type { BaseRequest } from "./rest/shared";

const NO_PERMISSIONS_ERROR_CODE = 105;
const SESSION_TIMEOUT_ERROR_CODE = 106;

export interface ExtraLoginInfo {
  extra: {
    // If we're using version 1 of the login API for compatibility reasons, we will get Set-Cookie headers that we
    // don't want, which will override the existing login session in the normal browing space. We should warn our
    // callers about this!
    isLegacyLogin: boolean;
  };
}

export interface ApiClientSettings {
  baseUrl?: string;
  account?: string;
  passwd?: string;
  session?: SessionName;
}

const SETTING_NAME_KEYS = (function () {
  const _settingNames: Record<keyof ApiClientSettings, true> = {
    baseUrl: true,
    account: true,
    passwd: true,
    session: true,
  };
  return Object.keys(_settingNames) as (keyof ApiClientSettings)[];
})();

export type ConnectionFailure =
  | {
      type: "missing-config";
    }
  | {
      type:
        | "probable-wrong-protocol"
        | "probable-wrong-url-or-no-connection-or-cert-error"
        | "timeout"
        | "unknown";
      error: any;
    };

const ConnectionFailure = {
  from: (error: any): ConnectionFailure => {
    if (error && error.response && error.response.status === 400) {
      return { type: "probable-wrong-protocol", error };
    } else if (error && error.message === "Network Error") {
      return { type: "probable-wrong-url-or-no-connection-or-cert-error", error };
    } else if (error && /timeout of \d+ms exceeded/.test(error.message)) {
      // This is a best-effort which I expect to start silently falling back onto 'unknown error' at some point in the future.
      return { type: "timeout", error };
    } else {
      return { type: "unknown", error };
    }
  },
};

export function isConnectionFailure(
  result: SynologyResponse<{}> | ConnectionFailure,
): result is ConnectionFailure {
  return (
    (result as ConnectionFailure).type != null && (result as SynologyResponse<{}>).success == null
  );
}

type LoginResponse = SynologyResponse<AuthLoginResponse & ExtraLoginInfo>;

export class ApiClient {
  private loginPromise: Promise<LoginResponse> | undefined;
  private settingsVersion: number = 0;
  private onSettingsChangeListeners: (() => void)[] = [];

  constructor(private settings: ApiClientSettings) {}

  public updateSettings(settings: ApiClientSettings) {
    if (
      settings != null &&
      (this.settings == null || SETTING_NAME_KEYS.some((k) => settings[k] !== this.settings[k]))
    ) {
      this.settingsVersion++;
      this.settings = settings;
      this.maybeLogout();
      return true;
    } else {
      return false;
    }
  }

  public onSettingsChange(listener: () => void) {
    this.onSettingsChangeListeners.push(listener);
    let isSubscribed = true;
    return () => {
      if (isSubscribed) {
        this.onSettingsChangeListeners = this.onSettingsChangeListeners.filter(
          (l) => l !== listener,
        );
        isSubscribed = false;
      }
    };
  }

  private isFullyConfigured() {
    return SETTING_NAME_KEYS.every((k) => {
      const v = this.settings[k];
      return v != null && v.length > 0;
    });
  }

  private async login(request: BaseRequest | undefined): Promise<LoginResponse> {
    const cachedSettings = this.settings;
    const apiVersions = await Info.Query(cachedSettings.baseUrl!, {
      query: [Auth.API_NAME],
    });
    const authApiVersion: 1 | 4 =
      apiVersions.success && apiVersions.data[Auth.API_NAME].maxVersion >= 4 ? 4 : 1;
    const response = await Auth.Login(cachedSettings.baseUrl!, {
      ...request,
      account: cachedSettings.account!,
      passwd: cachedSettings.passwd!,
      session: cachedSettings.session!,
      version: authApiVersion,
    });

    if (response.success) {
      return {
        ...response,
        data: {
          ...response.data,
          extra: {
            isLegacyLogin: authApiVersion === 1,
          },
        },
      };
    } else {
      return response;
    }
  }

  private maybeLogin = async (request?: BaseRequest) => {
    if (!this.isFullyConfigured()) {
      const failure: ConnectionFailure = {
        type: "missing-config",
      };
      return failure;
    } else if (!this.loginPromise) {
      this.loginPromise = this.login(request);
    }

    try {
      return await this.loginPromise;
    } catch (e) {
      return ConnectionFailure.from(e);
    }
  };

  // Note that this method is a BEST EFFORT.
  // (1) Because the client auto-re-logs in when you make new queries, this method will attempt to
  //     only log out the current session. The next non-logout call is guaranteed to attempt to log
  //     back in.
  // (2) The result of this call, either success or failure, has no bearing on future API calls. It
  //     is provided to the caller only for convenience, and may not reflect the true state of the
  //     client or session at the time the promise is resolved.
  private maybeLogout = async (
    request?: BaseRequest,
  ): Promise<SynologyResponse<{}> | ConnectionFailure | "not-logged-in"> => {
    const stashedLoginPromise = this.loginPromise;
    this.loginPromise = undefined;

    if (!stashedLoginPromise) {
      return "not-logged-in" as const;
    } else if (!this.isFullyConfigured()) {
      const failure: ConnectionFailure = {
        type: "missing-config",
      };
      return failure;
    } else {
      let response: LoginResponse;
      const { baseUrl, session } = this.settings;

      try {
        response = await stashedLoginPromise;
      } catch (e) {
        return ConnectionFailure.from(e);
      }

      if (response.success) {
        try {
          return await Auth.Logout(baseUrl!, {
            ...request,
            sid: response.data.sid,
            session: session!,
          });
        } catch (e) {
          return ConnectionFailure.from(e);
        }
      } else {
        return response;
      }
    }
  };

  private proxy<T, U>(
    fn: (baseUrl: string, sid: string, options: T) => Promise<SynologyResponse<U>>,
  ): (options: T) => Promise<SynologyResponse<U> | ConnectionFailure> {
    const wrappedFunction = async (
      options: T,
      shouldRetryRoutineFailures: boolean = true,
    ): Promise<SynologyResponse<U> | ConnectionFailure> => {
      const versionAtInit = this.settingsVersion;

      const maybeLogoutAndRetry = (response: ConnectionFailure | SynologyFailureResponse) => {
        if (
          shouldRetryRoutineFailures &&
          (isConnectionFailure(response) ||
            response.error.code === SESSION_TIMEOUT_ERROR_CODE ||
            response.error.code === NO_PERMISSIONS_ERROR_CODE)
        ) {
          this.loginPromise = undefined;
          return wrappedFunction(options, false);
        } else {
          return response;
        }
      };

      try {
        // `await`s in this block aren't necessary to adhere to the type signature, but it changes
        // who's responsible for handling the errors. Currently, errors unhandled by lower levels
        // are bubbled up to the outermost `catch`.

        const loginResponse = await this.maybeLogin();

        if (this.settingsVersion !== versionAtInit) {
          return await wrappedFunction(options);
        } else if (isConnectionFailure(loginResponse) || !loginResponse.success) {
          return await maybeLogoutAndRetry(loginResponse);
        } else {
          const response = await fn(this.settings.baseUrl!, loginResponse.data.sid, options);

          if (this.settingsVersion !== versionAtInit) {
            return await wrappedFunction(options);
          } else if (response.success) {
            return response;
          } else {
            return await maybeLogoutAndRetry(response);
          }
        }
      } catch (e) {
        return ConnectionFailure.from(e);
      }
    };

    return wrappedFunction;
  }

  private proxyOptionalArgs<T, U>(
    fn: (baseUrl: string, sid: string, options?: T) => Promise<SynologyResponse<U>>,
  ): (options?: T) => Promise<SynologyResponse<U> | ConnectionFailure> {
    return this.proxy(fn);
  }

  private proxyWithoutAuth<T, U>(
    fn: (baseUrl: string, options: T) => Promise<SynologyResponse<U>>,
  ): (options: T) => Promise<SynologyResponse<U> | ConnectionFailure> {
    return async (options: T) => {
      if (!this.isFullyConfigured()) {
        const response: ConnectionFailure = {
          type: "missing-config",
        };
        return response;
      } else {
        return fn(this.settings.baseUrl!, options);
      }
    };
  }

  public Auth = {
    Login: this.maybeLogin,
    Logout: this.maybeLogout,
  };

  public Info = {
    Query: this.proxyWithoutAuth(Info.Query),
  };

  public DownloadStation = {
    Info: {
      GetInfo: this.proxyOptionalArgs(DownloadStation.Info.GetInfo),
      GetConfig: this.proxyOptionalArgs(DownloadStation.Info.GetConfig),
      SetServerConfig: this.proxy(DownloadStation.Info.SetServerConfig),
    },
    Schedule: {
      GetConfig: this.proxyOptionalArgs(DownloadStation.Schedule.GetConfig),
      SetConfig: this.proxy(DownloadStation.Schedule.SetConfig),
    },
    Statistic: {
      GetInfo: this.proxyOptionalArgs(DownloadStation.Statistic.GetInfo),
    },
    Task: {
      List: this.proxyOptionalArgs(DownloadStation.Task.List),
      GetInfo: this.proxy(DownloadStation.Task.GetInfo),
      Create: this.proxy(DownloadStation.Task.Create),
      Delete: this.proxy(DownloadStation.Task.Delete),
      Pause: this.proxy(DownloadStation.Task.Pause),
      Resume: this.proxy(DownloadStation.Task.Resume),
      Edit: this.proxy(DownloadStation.Task.Edit),
    },
  };

  public DownloadStation2 = {
    Task: {
      Create: this.proxy(DownloadStation2.Task.Create),
    },
  };

  public FileStation = {
    Info: {
      get: this.proxy(FileStation.Info.get),
    },
    List: {
      list_share: this.proxyOptionalArgs(FileStation.List.list_share),
      list: this.proxy(FileStation.List.list),
      getinfo: this.proxy(FileStation.List.getinfo),
    },
  };
}
