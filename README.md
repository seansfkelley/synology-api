# synology-typescript-api

> A Typescript implementation of a Promise-based API for the Synology DiskStation API.

## Deprecation Notice

This project is no longer maintained. It has since been inlined into [Synology Download Manager](https://github.com/seansfkelley/synology-download-manager).

## Usage

`synology-typescript-api` is published to npm as an ES6 module, so you'll have to use an environment or build tools that understand `import`/`export` statements.

### API Documentation

`synology-typescript-api` is based off the [official Synology API documentation](https://www.synology.com/en-us/support/developer#tool), specifically:

- DownloadStation ([documentation](https://global.download.synology.com/download/Document/Software/DeveloperGuide/Package/DownloadStation/All/enu/Synology_Download_Station_Web_API.pdf), [implementation](https://github.com/seansfkelley/synology-typescript-api/blob/master/src/rest/DownloadStation.ts))
- FileStation ([documentation](https://global.download.synology.com/download/Document/Software/DeveloperGuide/Package/FileStation/All/enu/Synology_File_Station_API_Guide.pdf), [implementation](https://github.com/seansfkelley/synology-typescript-api/blob/master/src/rest/FileStation.ts))

The various REST API groups are exported under the (nested) names from the documentation.

The behavior for the REST API is fully defined by the Typescript types, but please read the official documentation to understand the semantics/subtleties of the various API calls! In particular, you will want to check the documentation for the meanings of the various error codes.

### REST API Example

This snippet demonstrates a basic usage of the REST API to log in and fetch the list of DownloadStation tasks.

```ts
import { Auth, DownloadStation } from 'synology-typescript-api';

const BASE_URL = 'path-to-your-diskstation';

Auth.login(BASE_URL, { ... })
  .then(response => {
    if (response.success) {
      return DownloadStation.Task.List(BASE_URL, response.data.sid, {})
        .then(response => {
          if (response.success) {
            return response.data.tasks;
          } else {
            throw new Error('failed to get task list!');
          }
        });
    } else {
      throw new Error('failed to log in!');
    }
  });
```

### API Client Example

In addition to the REST endpoints, a stateful class named `ApiClient` is exported for convenience. This class will:

- keep the session alive by attemping to re-login when necessary
- prevent common permissions failures caused by old sessions or rebooted NASes by automatically retrying
- report some common failure modes, such as connection errors, in a more-useful manner

The various APIs are accessible as (nested) properties on the instance. The following example has the same behavior as the REST API example.

```ts
import { ApiClient, isConnectionFailure } from 'synology-typescript-api';

const client = new ApiClient({ ... });

client.DownloadStation.Task.List({})
  .then(response => {
    if (isConnectionFailure(response) || !response.success) {
      throw new Error('failed to get task list!');
    } else {
      return response.data.tasks;
    }
  });
```

## Caveats

There are a few caveats to using this library to be aware of:

- It has only been tested against a DiskStation running DSM 6.1 (as of this writing).
- The `version` parameter passed to most API endpoints is (usually) fixed at `1`. In practice, this seems to work fine, but could theoretically cause issues in edge cases.
