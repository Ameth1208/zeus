import 'package:flutter/material.dart';

import '../../models/zeus_session.dart';
import 'glass_surface.dart';

class SessionCard extends StatelessWidget {
  const SessionCard({super.key, required this.session, required this.onAction, required this.onOpen});

  final ZeusSession session;
  final Future<void> Function(String action) onAction;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final statusLabel = switch (session.status) {
      'working' => 'Working',
      'waiting' => 'Needs approval',
      'completed' => 'Completed',
      'failed' => 'Failed',
      _ => session.status,
    };
    final statusIcon = switch (session.status) {
      'working' => Icons.motion_photos_on_rounded,
      'waiting' => Icons.visibility_rounded,
      'completed' => Icons.check_circle_rounded,
      'failed' => Icons.error_rounded,
      _ => Icons.circle_outlined,
    };

    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onOpen,
      child: GlassSurface(
        borderRadius: 26,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(session.project ?? 'Unknown project',
                        style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
                    const SizedBox(height: 3),
                    Text(
                      [session.runtime, session.model].whereType<String>().where((e) => e.isNotEmpty).join(' · '),
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Colors.white60),
                    ),
                  ]),
                ),
                Icon(statusIcon, size: 18),
                const SizedBox(width: 7),
                Text(statusLabel, style: Theme.of(context).textTheme.labelMedium),
              ],
            ),
            const SizedBox(height: 18),
            Text(_eventDescription(session),
                maxLines: 2, overflow: TextOverflow.ellipsis, style: Theme.of(context).textTheme.bodyMedium),
            if (session.needsAttention) ...[
              const SizedBox(height: 18),
              Row(
                children: [
                  Expanded(
                    child: FilledButton.tonal(
                      onPressed: () => onAction('deny'),
                      child: const Text('Deny'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton(
                      onPressed: () => onAction('approve'),
                      child: const Text('Allow'),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  String _eventDescription(ZeusSession session) {
    if (session.message?.isNotEmpty == true) return session.message!;
    return switch (session.lastEvent) {
      'permission.requested' => 'The agent is waiting for your decision.',
      'tool.started' => 'Running an agent tool…',
      'tool.completed' => 'Tool completed. Continuing the task…',
      'command.started' => 'Running a command…',
      'file.changed' => 'Editing project files…',
      'session.completed' => 'The task has finished.',
      _ => session.lastEvent.isEmpty ? 'Connected to Zeus Gateway.' : session.lastEvent,
    };
  }
}
