# syntax=docker/dockerfile:1.7

# -------- Stage 1: fetch ffmpeg static (arm64) --------
FROM public.ecr.aws/amazonlinux/amazonlinux:2023 AS ffmpeg
RUN dnf -y install tar xz && \
    curl -fL "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz" \
      -o /tmp/ffmpeg.tar.xz && \
    mkdir -p /opt/ffmpeg && \
    tar -xJf /tmp/ffmpeg.tar.xz --strip-components=1 -C /opt/ffmpeg && \
    /opt/ffmpeg/ffmpeg -version

# -------- Stage 2: TypeScript build --------
FROM public.ecr.aws/lambda/nodejs:24-arm64 AS build
WORKDIR /build
COPY package.json package-lock.json* tsconfig.json tsconfig.build.json ./
# install with dev deps for the build
RUN npm install --include=dev --no-audit --no-fund
COPY src ./src
RUN npx tsc -p tsconfig.build.json && \
    npm prune --omit=dev

# -------- Stage 3: Runtime image --------
FROM public.ecr.aws/lambda/nodejs:24-arm64
COPY --from=ffmpeg /opt/ffmpeg/ffmpeg  /usr/local/bin/ffmpeg
COPY --from=ffmpeg /opt/ffmpeg/ffprobe /usr/local/bin/ffprobe
RUN chmod +x /usr/local/bin/ffmpeg /usr/local/bin/ffprobe
COPY --from=build /build/dist          ${LAMBDA_TASK_ROOT}/dist
COPY --from=build /build/node_modules  ${LAMBDA_TASK_ROOT}/node_modules
COPY --from=build /build/package.json  ${LAMBDA_TASK_ROOT}/

# Default entry point; CDK overrides per-function via cmd
CMD ["dist/handlers/api.handler"]
