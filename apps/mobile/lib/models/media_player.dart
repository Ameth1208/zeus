import 'dart:convert';
import 'dart:typed_data';

/// A desktop's now-playing snapshot, as the gateway last heard it. The
/// position goes stale between heartbeats; [positionNow] extrapolates while
/// playing.
class MediaPlayer {
  const MediaPlayer({
    required this.machineId,
    this.title = '',
    this.artist = '',
    this.album = '',
    this.playing = false,
    this.positionSecs = 0,
    this.durationSecs = 0,
    this.thumbnail = '',
    this.updatedAt,
  });

  final String machineId;
  final String title;
  final String artist;
  final String album;
  final bool playing;
  final double positionSecs;
  final double durationSecs;

  /// `data:image/...` URL of the album art; empty when unpublished.
  final String thumbnail;
  final DateTime? updatedAt;

  bool get hasTrack => title.isNotEmpty;

  /// Decoded album art, or null when absent or malformed.
  Uint8List? get thumbnailBytes {
    if (!thumbnail.startsWith('data:')) return null;
    final comma = thumbnail.indexOf(',');
    if (comma < 0) return null;
    try {
      return base64Decode(thumbnail.substring(comma + 1));
    } on FormatException {
      return null;
    }
  }

  /// Position extrapolated to now. Paused tracks stand still; live tracks
  /// advance by the age of the snapshot.
  double get positionNow {
    if (!playing || updatedAt == null) return positionSecs;
    final age =
        DateTime.now().toUtc().difference(updatedAt!).inMilliseconds / 1000;
    final pos = positionSecs + age;
    return durationSecs > 0 ? pos.clamp(0, durationSecs) : pos;
  }

  double get progress =>
      durationSecs > 0 ? (positionNow / durationSecs).clamp(0.0, 1.0) : 0;

  String get subtitle => [artist, album].where((e) => e.isNotEmpty).join(' — ');

  factory MediaPlayer.fromJson(Map<String, dynamic> json) => MediaPlayer(
    machineId: json['machine_id'] as String,
    title: json['title'] as String? ?? '',
    artist: json['artist'] as String? ?? '',
    album: json['album'] as String? ?? '',
    playing: json['playing'] as bool? ?? false,
    positionSecs: (json['position_secs'] as num?)?.toDouble() ?? 0,
    durationSecs: (json['duration_secs'] as num?)?.toDouble() ?? 0,
    thumbnail: json['thumbnail'] as String? ?? '',
    updatedAt: DateTime.tryParse(json['updated_at'] as String? ?? ''),
  );
}
