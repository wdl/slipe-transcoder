# slipe-transcoder v2

청크 분할 + N개 Lambda 병렬 트랜스코딩 서버리스 비디오 트랜스코더. 2026년 기준 표준 스택으로 재작성된 v2.

## 핵심 아키텍처

```
[Client] -- POST /v1/jobs --> ApiHandler (Lambda, container image)
                              |- DynamoDB.put (state=awaiting_upload)
                              `- createPresignedPost -> { url, fields }

[Client] -- multipart POST --> S3 QueueBucket
                                |
                               S3 ObjectCreated event
                                |
                                v
                          QueueHandler (ffprobe -> chunkCount=N)
                                |
                          DynamoDB UpdateItem (state=queued, video_todo=N)
                          fan-out Lambda InvokeAsync:
                            |-- AudioConverter (x1)  ffmpeg -> AAC -> S3 TempBucket
                            `-- VideoConverter (xN)  ffmpeg -> .ts  -> S3 TempBucket
                                  + UpdateItem ADD video_done_set :part
                                |
                          DynamoDB Stream MODIFY
                                |
                                v
                          StreamHandler (size(video_done_set)==video_todo ?)
                                |
                                v
                          MergeHandler (CAS state: queued|processing -> merging)
                                |- ffmpeg concat + mux pipe
                                |- S3 OutputBucket put `${jobId}.mp4`
                                |- DynamoDB update state=completed
                                `- SQS WebhookQueue enqueue
                                                |
                                                v
                                       WebhookDispatcher (HMAC-signed POST to callbackUrl)
                                                |- 5xx/network: backoff retry up to 6
                                                `- 4xx (non-429): permanent DLQ
```

## 기술 스택

| 영역           | 기술                                                            |
|----------------|-----------------------------------------------------------------|
| 런타임         | Node.js 20 (Lambda Container Image, arm64)                      |
| 언어           | TypeScript 5.6, strict, ES modules                              |
| AWS SDK        | v3 modular (@aws-sdk/client-*)                                  |
| 오브젝트 인코딩 | ffmpeg static (johnvansickle) bundled into Lambda image         |
| IaC            | AWS CDK v2 TypeScript                                           |
| API            | API Gateway REST + API Key + Usage Plan                         |
| 데이터         | DynamoDB (single-table, GSI, Streams), SQS, S3 (KMS, lifecycle) |
| 검증           | Zod                                                             |
| 관찰           | AWS Lambda Powertools (Logger / Tracer / Metrics)               |
| 테스트         | Vitest + aws-sdk-client-mock                                    |

## 디렉토리 구조

```
.
├── cdk/                  # CDK app (bin + lib constructs)
├── docker/               # Lambda container image
├── src/
│   ├── handlers/         # Lambda 진입점 7개
│   └── lib/              # 공유 라이브러리
├── tests/
│   ├── unit/             # vitest + aws-sdk-client-mock
│   └── integration/      # e2e against real/localstack
└── .github/workflows/    # CI / Deploy
```

## API

### `POST /v1/jobs`

요청:
```json
{
  "inputFilename": "lecture.mov",
  "inputSizeBytes": 734003200,
  "inputContentType": "video/quicktime",
  "chunkSeconds": 10,
  "delivery": {
    "mode": "webhook",
    "callbackUrl": "https://api.example.com/hooks/slipe",
    "callbackToken": "client-correlation-id"
  },
  "metadata": { "userId": "u-1" }
}
```

응답 201:
```json
{
  "jobId": "01HXYZ...",
  "expiresAt": "2026-05-19T12:00:00Z",
  "upload": { "url": "https://...", "fields": { ... }, "maxBytes": 734003200 },
  "statusUrl": "https://api.example.com/v1/jobs/01HXYZ...",
  "delivery": { "signingSecret": "<base64url; 1회만 반환>" }
}
```

### `GET /v1/jobs/{id}`

응답:
```json
{
  "jobId": "01HXYZ...",
  "state": "processing",
  "progress": { "audioChunksTotal":1, "audioChunksDone":1, "videoChunksTotal":24, "videoChunksDone":17, "percent":72 },
  "durationSeconds": 240,
  "chunkSeconds": 10,
  "createdAt": "...",
  "updatedAt": "...",
  "completedAt": null,
  "failure": null,
  "download": null,
  "metadata": {}
}
```

`state` ∈ `awaiting_upload | queued | processing | merging | completed | failed | canceled`.

### `GET /v1/jobs/{id}/download?ttl=300`

`completed`인 잡의 단기 presigned URL을 반환. `ttl`은 60~86400초.

### `POST /v1/jobs/{id}/cancel`

진행 중인 잡을 취소 (state ∈ {awaiting_upload, queued, processing} 이어야 함). `merging` 이후는 409.

### `GET /v1/healthz`

`{ ok: true, version: "v2.0.0" }`.

### Webhook 페이로드 (delivery.mode=webhook 인 경우)

```
POST <callbackUrl>
Content-Type: application/json
Slipe-Event: job.completed
Slipe-Timestamp: 1747641600
Slipe-Delivery-Id: 7f9b3c...
Slipe-Signature: v1=<hex hmac_sha256(secret, "${ts}.${body}")>

{
  "deliveryId": "...",
  "event": "job.completed",
  "jobId": "...",
  "token": "<callbackToken>",
  "url": "https://...presigned...",
  "expiresAt": "...",
  "sizeBytes": 12345678,
  "metadata": {},
  "occurredAt": "..."
}
```

### 수신자 측 서명 검증 (Node 예시)

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(req: Request, secret: string, rawBody: string): boolean {
  const sig = req.headers.get('slipe-signature') ?? '';
  const ts  = Number(req.headers.get('slipe-timestamp'));
  if (Math.abs(Math.floor(Date.now()/1000) - ts) > 300) return false;
  const expected = 'v1=' + createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

## 빠른 시작

### 사전 요구사항

- Node.js 20+
- Docker (arm64 이미지 빌드용; macOS Apple Silicon에서 네이티브, Linux/x86은 buildx + qemu)
- AWS CLI 설정 (`aws configure`)
- AWS 계정에서 CDK 부트스트랩 1회: `npx cdk bootstrap`

### 로컬 검증

```bash
npm ci
npm run lint
npm run typecheck
npm run test
npm run docker:build
npm run docker:smoke
npm run cdk:synth
```

### 배포

```bash
npm run cdk:deploy -- -c stage=dev
```

배포 후 `Outputs`로 `ApiUrl`과 `DefaultApiKeyId`가 출력됨. API key 값은 `aws apigateway get-api-key --api-key <id> --include-value`로 조회.

### 잡 생성 → 업로드 → 다운로드 e2e

```bash
API=https://...
KEY=$(aws apigateway get-api-key --api-key <id> --include-value --query value --output text)

# 1) 잡 생성
RESP=$(curl -s -X POST "$API/v1/jobs" \
  -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"inputSizeBytes":204800,"inputContentType":"video/mp4","delivery":{"mode":"poll"}}')
JOB_ID=$(echo "$RESP" | jq -r .jobId)

# 2) presigned POST로 업로드
UPLOAD_URL=$(echo "$RESP" | jq -r .upload.url)
echo "$RESP" | jq -r '.upload.fields | to_entries[] | "-F " + .key + "=" + .value' \
  | xargs -- curl -i -X POST "$UPLOAD_URL" -F "Content-Type=video/mp4" -F file=@sample.mp4

# 3) 폴링
while :; do
  STATE=$(curl -s "$API/v1/jobs/$JOB_ID" -H "x-api-key: $KEY" | jq -r .state)
  echo "state=$STATE"
  [ "$STATE" = completed ] && break
  [ "$STATE" = failed ]    && exit 1
  sleep 2
done

# 4) 다운로드
URL=$(curl -s "$API/v1/jobs/$JOB_ID/download" -H "x-api-key: $KEY" | jq -r .url)
curl -fLo out.mp4 "$URL"
ffprobe out.mp4 -show_format -v error
```

## v1 → v2 마이그레이션

v1 코드는 v2.0.0 릴리스 시점에 제거되었다. 만약 아직 운영 중인 v1 스택이 있다면 다음 절차로 컷오버:

1. v2 CDK 스택을 별도 이름(예: `SlipeTranscoder-dev`)으로 배포
2. 통합 테스트 / 동일 입력 비교로 v2 검증
3. 클라이언트 baseURL 을 v2로 변경
4. v1에 신규 잡이 24시간 들어오지 않는 것 확인 후 v1 스택 삭제

v1 핸들러 코드는 git history `v1.x` 태그/브랜치에서 확인할 수 있다.

## 라이센스

ISC
