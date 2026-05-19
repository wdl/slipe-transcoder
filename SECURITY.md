# Security Policy

## 지원되는 버전

| 버전 | 지원 상태   |
|------|-------------|
| 2.x  | 활성 지원   |
| 1.x  | 보안 패치만 (2026년 말 EOL 예정) |

## 취약점 보고

공개 GitHub 이슈로 보고하지 말아 주세요.

대신 메인테이너에게 비공개로 보고해 주세요:

- GitHub Security Advisories (권장): 이 레포의 **Security** 탭 → **Report a vulnerability**
- 또는 메인테이너에게 직접 이메일

다음 정보를 포함해 주시면 분류가 빠릅니다:

- 영향 범위 (어떤 컴포넌트, 어떤 권한이 있는 공격자가 무엇을 할 수 있는지)
- 재현 절차 (가능하면 PoC)
- 영향을 받는 버전 / 커밋 SHA

72시간 내에 회신을 드리는 것을 목표로 합니다.

## 알려진 보안 설계 사항

이 프로젝트는 다음과 같은 방어 layer를 가집니다:

- **SSRF 가드**: 콜백 URL 등록·전달 시점에 DNS resolve 후 A/AAAA 레코드가 모두 공개 IP인지 검증 ([src/lib/url-guard.ts](src/lib/url-guard.ts)). https-only, 포트 443만 기본 허용.
- **Webhook HMAC 서명**: `v1=hmac_sha256(secret, "${ts}.${body}")` (Stripe 스타일), 타임스탬프 윈도우 5분 ([src/lib/hmac.ts](src/lib/hmac.ts)). 서명 시크릿은 잡 생성 응답에서 1회만 평문 반환.
- **입력 검증**: 모든 API 입력은 Zod 스키마로 검증 ([src/lib/schemas.ts](src/lib/schemas.ts)). 파일 크기 20 GiB cap, content-type 화이트리스트.
- **암호화 at rest**: S3 / DynamoDB / SQS 모두 customer-managed KMS 키 + 키 로테이션.
- **암호화 in transit**: S3 `enforceSSL`, API Gateway HTTPS only.
- **IAM 최소 권한**: 함수별로 `grantPut` / `grantRead` 등 좁은 권한만 부여, `s3:*` 같은 와일드카드 사용하지 않음.
- **DLQ + 알람**: 청크 실패와 Webhook 영구 실패는 SQS DLQ로 격리되고 CloudWatch 알람이 SNS로 발송.
