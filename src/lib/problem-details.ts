import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

const BASE_TYPE_URL = 'https://errors.slipe.example.com/v1/';

export type ProblemCode =
  | 'validation-failed'
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'conflict'
  | 'job-expired'
  | 'rate-limited'
  | 'internal'
  | 'dependency-failed';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  requestId?: string;
  errors?: Array<{ path: string; message: string }>;
}

const TITLE: Record<ProblemCode, string> = {
  'validation-failed': 'Request body failed validation',
  unauthorized: 'Authentication required',
  forbidden: 'Access denied',
  'not-found': 'Resource not found',
  conflict: 'State conflict',
  'job-expired': 'Job upload window has expired',
  'rate-limited': 'Rate limit exceeded',
  internal: 'Internal server error',
  'dependency-failed': 'Upstream dependency failed',
};

export function problem(
  status: number,
  code: ProblemCode,
  detail?: string,
  errors?: ProblemDetails['errors'],
  instance?: string,
  requestId?: string,
): APIGatewayProxyStructuredResultV2 {
  const body: ProblemDetails = {
    type: `${BASE_TYPE_URL}${code}`,
    title: TITLE[code],
    status,
    ...(detail !== undefined ? { detail } : {}),
    ...(errors !== undefined ? { errors } : {}),
    ...(instance !== undefined ? { instance } : {}),
    ...(requestId !== undefined ? { requestId } : {}),
  };
  return {
    statusCode: status,
    headers: { 'content-type': 'application/problem+json' },
    body: JSON.stringify(body),
  };
}

export function ok(status: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}
