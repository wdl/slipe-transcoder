# Changelog

이 프로젝트의 모든 주요 변경 사항을 기록합니다.
포맷은 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)을 따르며 [Semantic Versioning](https://semver.org/)을 사용합니다.

## [2.0.0] — 2026-05-19

### Added

- **AWS CDK v2 (TypeScript)** 기반의 새 인프라 정의. `cdk synth` / `cdk deploy`로 배포.
- **Lambda Container Image** (arm64): ffmpeg/ffprobe static 빌드를 컨테이너 안에 번들 ([docker/Dockerfile](docker/Dockerfile)).
- **API Gateway REST API**:
  - `POST /v1/jobs` — 잡 생성 + S3 presigned POST 발급
  - `GET /v1/jobs/{id}` — 상태 폴링 (state, progress, percent)
  - `GET /v1/jobs/{id}/download` — 단기 presigned GET URL (TTL 60~86400s)
  - `POST /v1/jobs/{id}/cancel` — 잡 취소
  - `GET /v1/healthz` — 헬스체크
- **API Key + Usage Plan** 인증 (rate limit + daily quota).
- **HMAC-서명 웹훅** (Stripe/GitHub 스타일): `Slipe-Signature: v1=<hex>`, 타임스탬프 5분 윈도우.
- **SSRF 가드** ([src/lib/url-guard.ts](src/lib/url-guard.ts)): DNS resolve 후 모든 IP 공개 범위 검증.
- **SQS WebhookQueue + DLQ**: 지수 백오프 6회, 4xx는 즉시 영구실패.
- **Zod 스키마 검증**: 모든 API 입력 + Lambda 이벤트.
- **AWS Lambda Powertools** (Logger / Tracer / Metrics).
- **CloudWatch Dashboard + Alarms**: 함수별 에러율, DLQ depth, Webhook 실패 추적.
- **KMS 암호화**: S3 / DynamoDB / SQS 전체.
- **S3 라이프사이클**: Queue / Temp 24h 자동 만료, Output TTL 설정 가능.
- **DynamoDB Streams + idempotent CAS lock**: 머지 핸들러 race condition 완전 제거.
- **String Set 진행 추적** (`video_done_set ADD :part`) — 청크 재실행 자연 idempotent.
- **Vitest + aws-sdk-client-mock** unit test 36개.
- **GitHub Actions** CI/CD (lint + typecheck + test + cdk synth + docker build).

### Changed

- **Node.js 10.x → 20** (Lambda Container Image, arm64).
- **TypeScript 3.6 → 5.6** + strict + ES Modules.
- **AWS SDK v2 → v3** modular import. callback 래퍼 6곳 제거.
- **Serverless Framework v1 → AWS CDK v2** TypeScript.
- **REST API** 재설계 (v1 breaking change — 자세한 내용은 [README.md](README.md) 참조).
- **uuid → `node:crypto.randomUUID()`** / `ulid` (정렬 가능한 ID).
- **axios → native `fetch`** (Node 20).
- **lodash → native ES** utilities.
- **`bin/merge.sh` bash 스크립트 → Node child_process pipe** ([src/lib/ffmpeg.ts](src/lib/ffmpeg.ts)).

### Removed

- 레거시 v1 핸들러 (`jssrc/*.ts`) 6개.
- 번들된 ffmpeg/ffprobe 바이너리 (`bin/`).
- `serverless.yml`, `build.sh` (Serverless Framework v1).
- `aws-sdk` (v2), `axios`, `lodash`, `uuid` (v3), `ts-node`, `serverless-*` 플러그인.

### Security

- `axios 0.19` CVE-2020-28168 노출 제거 (axios 자체 제거).
- 임의의 callback URL → SSRF 벡터 차단 (DNS resolve + 공개 IP 검증).
- 머지 핸들러 중복 호출 시 잘못된 결과 가능성 → CAS 락으로 차단.
- `s3:*` IAM 와일드카드 → 함수별 최소 권한으로 좁힘.
- `MergeHandler` webhook 실패 silent catch → DLQ + 알람.

## [1.x] — 2019~2024

레거시 v1. 자세한 내용은 git history 참고. 2026년 말 EOL 예정.
