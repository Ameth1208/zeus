import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/media_player.dart';
import '../../state/zeus_state.dart';
import 'glass_surface.dart';
import 'zeus_icon.dart';

/// Now-playing on the desktops, with transport controls. Rendered above the
/// session list; absent entirely when no desktop reports media.
class MediaCard extends ConsumerWidget {
  const MediaCard({super.key, required this.player});

  final MediaPlayer player;

  @override
  Widget build(BuildContext context, WidgetRef ref) => GlassSurface(
    borderRadius: 26,
    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
    child: Row(
      children: [
        Builder(
          builder: (_) {
            final cover = player.thumbnailBytes;
            if (cover != null) {
              return ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: Image.memory(
                  cover,
                  width: 40,
                  height: 40,
                  fit: BoxFit.cover,
                  gaplessPlayback: true,
                  errorBuilder: (_, _, _) => const _CoverFallback(),
                ),
              );
            }
            return const _CoverFallback();
          },
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                player.hasTrack ? player.title : 'Nothing playing',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: 13.5,
                ),
              ),
              if (player.subtitle.isNotEmpty)
                Text(
                  player.subtitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: Colors.white54, fontSize: 11.5),
                ),
              if (player.durationSecs > 0) ...[
                const SizedBox(height: 6),
                ClipRRect(
                  borderRadius: BorderRadius.circular(2),
                  child: LinearProgressIndicator(
                    value: player.progress,
                    minHeight: 3,
                    backgroundColor: Colors.white12,
                    valueColor: const AlwaysStoppedAnimation(Colors.white70),
                  ),
                ),
              ],
            ],
          ),
        ),
        _TransportButton(
          symbol: 'backward.fill',
          icon: CupertinoIcons.backward_fill,
          onPressed: () => sendMediaCommand(ref, player, 'previous'),
        ),
        _TransportButton(
          symbol: player.playing ? 'pause.fill' : 'play.fill',
          icon: player.playing
              ? CupertinoIcons.pause_fill
              : CupertinoIcons.play_fill,
          onPressed: () => sendMediaCommand(ref, player, 'play_pause'),
        ),
        _TransportButton(
          symbol: 'forward.fill',
          icon: CupertinoIcons.forward_fill,
          onPressed: () => sendMediaCommand(ref, player, 'next'),
        ),
      ],
    ),
  );
}

class _CoverFallback extends StatelessWidget {
  const _CoverFallback();

  @override
  Widget build(BuildContext context) => Container(
    width: 40,
    height: 40,
    decoration: BoxDecoration(
      color: const Color(0xFF4CC2FF).withValues(alpha: .12),
      borderRadius: BorderRadius.circular(12),
    ),
    child: const ZeusIcon(
      'music.note',
      fallback: CupertinoIcons.music_note,
      size: 18,
      color: Color(0xFF4CC2FF),
    ),
  );
}

class _TransportButton extends StatelessWidget {
  const _TransportButton({
    required this.symbol,
    required this.icon,
    required this.onPressed,
  });

  final String symbol;
  final IconData icon;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => CupertinoButton(
    padding: EdgeInsets.zero,
    minimumSize: const Size.square(38),
    onPressed: onPressed,
    child: ZeusIcon(symbol, fallback: icon, size: 19),
  );
}
