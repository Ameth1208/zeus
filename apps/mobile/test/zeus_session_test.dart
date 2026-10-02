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
}
