class ZeusConfig {
  const ZeusConfig._();

  static const defaultGateway = String.fromEnvironment(
    'ZEUS_GATEWAY_URL',
    defaultValue: 'http://127.0.0.1:8080',
  );
}
