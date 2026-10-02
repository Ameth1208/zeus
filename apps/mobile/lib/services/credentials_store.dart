import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class CredentialsStore {
  CredentialsStore([FlutterSecureStorage? storage]) : _storage = storage ?? const FlutterSecureStorage();

  static const _gatewayKey = 'zeus.gateway.url';
  static const _tokenKey = 'zeus.gateway.token';
  final FlutterSecureStorage _storage;

  Future<String?> readGateway() => _storage.read(key: _gatewayKey);
  Future<String?> readToken() => _storage.read(key: _tokenKey);

  Future<void> save({required String gateway, required String token}) async {
    await _storage.write(key: _gatewayKey, value: gateway);
    await _storage.write(key: _tokenKey, value: token);
  }

  Future<void> clear() async {
    await _storage.delete(key: _gatewayKey);
    await _storage.delete(key: _tokenKey);
  }
}
