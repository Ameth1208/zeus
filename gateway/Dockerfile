FROM golang:1.23-alpine AS build
WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/zeus-gateway ./cmd/zeus-gateway

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/zeus-gateway /zeus-gateway
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/zeus-gateway"]
