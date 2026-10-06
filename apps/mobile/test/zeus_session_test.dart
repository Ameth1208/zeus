import 'package:flutter_test/flutter_test.dart';
import 'package:zeus_mobile/models/zeus_session.dart';

void main() {
  test('parses pending permission metadata', () {
    final session = ZeusSession.fromJson({
      'id': 's1',
      'agent_id': 'a1',
      'runtime': 'codex',
      'status': 'waiting',
      'machine_id': 'm1',
      'machine_name': 'Workstation',
      'pending_request_id': 'req-1',
      'last_event': 'permission.requested',
      'updated_at': '2026-10-01T12:00:00Z',
      'capabilities': ['approve', 'deny'],
    });

    expect(session.status, 'waiting');
    expect(session.pendingRequestId, 'req-1');
    expect(session.capabilities, contains('approve'));
  });

  // A request the desktop has not confirmed is not answerable from a phone.
  test('needsAttention is false without a pending request id', () {
    final session = ZeusSession.fromJson({
      'id': 's1',
      'agent_id': 'a1',
      'runtime': 'codex',
      'status': 'waiting',
      'last_event': 'permission.requested',
      'updated_at': '2026-10-02T00:00:00Z',
    });
    expect(session.needsAttention, isFalse);
  });

  test('needsAttention is true for a confirmed pending request', () {
    final session = ZeusSession.fromJson({
      'id': 's1',
      'agent_id': 'a1',
      'runtime': 'codex',
      'status': 'waiting',
      'last_event': 'permission.requested',
      'updated_at': '2026-10-02T00:00:00Z',
      'pending_request_id': 'req-1',
    });
    expect(session.needsAttention, isTrue);
    expect(session.canStop, isFalse, reason: 'no capability advertised');
  });

  test('controls follow advertised capabilities', () {
    final session = ZeusSession.fromJson({
      'id': 's1',
      'agent_id': 'a1',
      'runtime': 'claude',
      'status': 'working',
      'last_event': 'agent.thinking',
      'updated_at': '2026-10-02T00:00:00Z',
      'external_session_id': 'nat-1',
      'capabilities': ['send', 'stop', 'resume'],
    });
    expect(session.canStop, isTrue);
    expect(session.canResume, isTrue);
    expect(session.canSend, isTrue);
  });

  test('resume needs a conversation id, not just the capability', () {
    final session = ZeusSession.fromJson({
      'id': 's1',
      'agent_id': 'a1',
      'runtime': 'agy',
      'status': 'completed',
      'last_event': 'session.completed',
      'updated_at': '2026-10-02T00:00:00Z',
      'capabilities': ['resume'],
    });
    expect(session.canResume, isFalse);
  });

  test('usage parses and keeps the estimated flag visible', () {
    final session = ZeusSession.fromJson({
      'id': 's1',
      'agent_id': 'a1',
      'runtime': 'codex',
      'status': 'completed',
      'last_event': 'session.completed',
      'updated_at': '2026-10-02T00:00:00Z',
      'usage': {'input': 16409, 'output': 19, 'cached': 4000, 'estimated': false},
    });
    expect(session.usage.input, 16409);
    expect(session.usage.cached, 4000);
    expect(session.usage.estimated, isFalse);
    expect(session.usage.describe(), contains('16.4k in'));
  });

  test('an estimated count is labelled as such', () {
    const usage = TokenUsage(input: 1000, estimated: true);
    expect(usage.describe(), contains('estimated'));
  });

  test('an empty usage reads as unreported rather than zero', () {
    expect(const TokenUsage().isEmpty, isTrue);
    expect(const TokenUsage().describe(), 'No usage reported');
  });

  test('digest parses and detects emptiness', () {
    final digest = SessionDigest.fromJson({
      'session_id': 's1',
      'goal': 'Ship the engine',
      'decisions': ['Engine lives in Rust'],
      'changed_files': ['src/lib.rs'],
      'last_seq': 12,
    });
    expect(digest.isEmpty, isFalse);
    expect(digest.goal, 'Ship the engine');
    expect(digest.decisions.single, 'Engine lives in Rust');
    expect(digest.lastSeq, 12);
    expect(const SessionDigest(sessionId: 's1').isEmpty, isTrue);
  });
}
