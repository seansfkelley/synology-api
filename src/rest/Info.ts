import { SynologyResponse, BaseRequest, get } from './shared';

export interface InfoQueryRequest extends BaseRequest {
  query: 'ALL' | string[];
}

export type InfoQueryResponse = Record<string, {
  minVersion: number;
  maxVersion: number;
  path: string;
  requestFormat: string;
}>;

const CGI_NAME = 'query';
const API_NAME = 'SYNO.API.Info';

function Query(baseUrl: string, options: InfoQueryRequest): Promise<SynologyResponse<InfoQueryResponse>> {
  return get(baseUrl, CGI_NAME, {
    ...options,
    api: API_NAME,
    version: 1,
    method: 'query',
    query: options.query === 'ALL' ? options.query : options.query.join(',')
  });
}

export const Info = {
  API_NAME: API_NAME as typeof API_NAME,
  Query
};
