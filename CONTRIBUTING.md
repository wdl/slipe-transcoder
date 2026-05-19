# Contributing to slipe-transcoder

기여에 관심을 가져 주셔서 감사합니다. 작은 패치든 큰 기능이든 환영합니다.

## 개발 환경

- Node.js 20+ ([nvm](https://github.com/nvm-sh/nvm) 권장)
- Docker (Lambda Container Image 빌드용; arm64 빌드를 위해 macOS Apple Silicon 권장 — Linux/Intel은 `docker/setup-qemu-action` 또는 `buildx` 필요)
- AWS CLI v2 (배포 시)
- AWS CDK v2 (`npm ci`로 함께 설치됨)

## 셋업

```bash
git clone https://github.com/<owner>/slipe-transcoder.git
cd slipe-transcoder
npm ci
```

## 일반적인 작업 흐름

```bash
# 코드 작성 → 로컬 검증
npm run lint
npm run typecheck
npm run test
npm run test:watch        # 작성 중

# CDK 변경
npm run cdk:synth         # 템플릿 생성만 (배포 X)
npm run cdk:diff          # 배포된 스택과의 diff

# Docker 이미지 빌드 (선택)
npm run docker:build
npm run docker:smoke
```

## PR 가이드라인

- 한 PR은 한 가지에 집중해 주세요.
- 새로운 코드에는 가능한 한 unit test를 추가해 주세요 ([tests/unit/](tests/unit/)).
- TypeScript strict 모드를 유지합니다 — `any`는 가급적 피해 주세요.
- 커밋 메시지는 [Conventional Commits](https://www.conventionalcommits.org/) 스타일을 권장합니다:
  - `feat: add HLS output`
  - `fix(merge): handle ffmpeg stderr buffer overflow`
  - `chore(deps): bump aws-cdk-lib to 2.165`

## 코드 스타일

- ESLint + Prettier가 강제합니다. `npm run lint:fix && npm run format`으로 자동 수정.
- `import type` 사용을 선호합니다.
- 어색한 한국어 주석보다는 자연스러운 영문 주석을 선호합니다(식별자는 영어 유지).

## 보안 이슈 보고

공개 이슈로 보고하지 말고 [SECURITY.md](SECURITY.md)의 절차를 따라 주세요.

## 행동 강령

이 프로젝트는 [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/)를 따릅니다.
