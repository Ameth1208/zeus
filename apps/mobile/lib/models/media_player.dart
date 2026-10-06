/// A desktop's now-playing snapshot, as the gateway last heard it.
class MediaPlayer {
  const MediaPlayer({
    required this.machineId,
    this.title = '',
    this.artist = '',
    this.playing = false,
    this.updatedAt,
  });

  final String machineId;
  final String title;
  final String artist;
  final bool playing;
  final DateTime? updatedAt;

  bool get hasTrack => title.isNotEmpty;

  factory MediaPlayer.fromJson(Map<String, dynamic> json) => MediaPlayer(
    machineId: json['machine_id'] as String,
    title: json['title'] as String? ?? '',
    artist: json['artist'] as String? ?? '',
    playing: json['playing'] as bool? ?? false,
    updatedAt: DateTime.tryParse(json['updated_at'] as String? ?? ''),
  );
}
