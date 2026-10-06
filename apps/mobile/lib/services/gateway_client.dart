import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/provider_info.dart';
import '../models/zeus_event.dart';
import '../models/zeus_session.dart';

class GatewayClient {
  GatewayClient({
    required String baseUrl,
    required this.token,
    http.Client? client,
  }) : baseUrl = baseUrl.replaceAll(RegExp(r'/+$'), ''),
       _client = client ?? http.Client();

  final String baseUrl;
  final String token;
  final http.Client _client;

  Map<String, String> get _headers => {
    'Authorization': 'Bearer $token',
    'Content-Type': 'application/json',
  };

  Future<List<ZeusSession>> sessions() async {
    final response = await _client.get(
      Uri.parse('$baseUrl/v1/sessions'),
      headers: _headers,
    );
    _ensureOk(response);
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    return ((body['sessions'] as List?) ?? const [])
        .map((e) => ZeusSession.fromJson((e as Map).cast<String, dynamic>()))
        .toList();
  }

  Future<List<ZeusEvent>> sessionEvents(String sessionId) async {
    final response = await _client.get(
      Uri.parse('$baseUrl/v1/sessions/$sessionId/events'),
      headers: _headers,
    );
    _ensureOk(response);
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    return ((body['events'] as List?) ?? const [])
        .map((e) => ZeusEvent.fromJson((e as Map).cast<String, dynamic>()))
        .toList();
  }

  Future<List<ProviderInfo>> providers() async {
    final response = await _client.get(
      Uri.parse('$baseUrl/v1/providers'),
      headers: _headers,
    );
    _ensureOk(response);
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    return ((body['providers'] as List?) ?? const [])
        .map((e) => ProviderInfo.fromJson((e as Map).cast<String, dynamic>()))
        .toList();
  }

  /// The short session summary, or null when the desktop has not produced one
  /// yet. A phone reads this instead of replaying history.
  Future<SessionDigest?> digest(String sessionId) async {
    final response = await _client.get(
      Uri.parse('$baseUrl/v1/sessions/$sessionId/digest'),
      headers: _headers,
    );
    _ensureOk(response);
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final raw = body['digest'];
    if (raw == null) return null;
    return SessionDigest.fromJson((raw as Map).cast<String, dynamic>());
  }

  /// Answers an approval. The desktop is the authority: it validates the
  /// request id, the session and the workstation, and refuses anything stale,
  /// replayed or already decided. This client never assumes success.
  Future<void> decide({
    required String requestId,
    required String sessionId,
    required bool allow,
  }) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/v1/actions'),
      headers: _headers,
      body: jsonEncode({
        'session_id': sessionId,
        'kind': allow ? 'approve' : 'deny',
        'payload': {'request_id': requestId},
      }),
    );
    _ensureOk(response);
  }

  Future<void> action({
    required ZeusSession session,
    required String kind,
    Map<String, dynamic>? payload,
  }) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/v1/actions'),
      headers: _headers,
      body: jsonEncode({
        'session_id': session.id,
        'agent_id': session.agentId,
        'kind': kind,
        'payload': ?payload,
      }),
    );
    _ensureOk(response);
  }

  Future<String> chat({
    required String providerId,
    required String model,
    required List<Map<String, String>> messages,
  }) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/v1/chat'),
      headers: _headers,
      body: jsonEncode({
        'provider_id': providerId,
        'model': model,
        'messages': messages,
      }),
    );
    _ensureOk(response);
    return (jsonDecode(response.body) as Map<String, dynamic>)['text']
            as String? ??
        '';
  }

  Stream<ZeusEvent> events() async* {
    final request = http.Request('GET', Uri.parse('$baseUrl/v1/events/stream'));
    request.headers.addAll(_headers);
    final response = await _client.send(request);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError('Gateway returned HTTP ${response.statusCode}');
    }
    final lines = response.stream
        .transform(utf8.decoder)
        .transform(const LineSplitter());
    await for (final line in lines) {
      if (!line.startsWith('data:')) continue;
      final raw = line.substring(5).trim();
      if (raw.isEmpty || raw == '{}') continue;
      yield ZeusEvent.fromJson(
        (jsonDecode(raw) as Map).cast<String, dynamic>(),
      );
    }
  }

  static Future<Map<String, String>> completePair({
    required String baseUrl,
    required String code,
    required String deviceName,
    http.Client? client,
  }) async {
    final httpClient = client ?? http.Client();
    final clean = baseUrl.replaceAll(RegExp(r'/+$'), '');
    final response = await httpClient.post(
      Uri.parse('$clean/v1/pair/complete'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'code': code, 'device_name': deviceName}),
    );
    _ensureOk(response);
    final body = (jsonDecode(response.body) as Map).cast<String, dynamic>();
    return {
      'device_id': body['device_id'] as String,
      'token': body['token'] as String,
    };
  }

  static void _ensureOk(http.BaseResponse response) {
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError('Gateway returned HTTP ${response.statusCode}');
    }
  }
}
