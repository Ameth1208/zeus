//! Now-playing and transport control through the Windows Global System Media
//! Transport Controls (GSMTC). This is host capability, not engine domain: the
//! engine must stay platform-agnostic, so the media module lives in the host
//! crate and is only compiled on Windows.

use serde::Serialize;

/// What the island's media view renders. `None` fields mean the current
/// session did not publish them. Timestamps are seconds; `position_secs` is
/// extrapolated to "now" by the reader.
#[derive(Debug, Clone, Default, Serialize)]
pub struct NowPlaying {
    pub available: bool,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub playing: bool,
    pub position_secs: f64,
    pub duration_secs: f64,
    /// `data:image/...` URL of the album art, empty when the source publishes
    /// none. Sent inline because the webview and the phone both accept it
    /// without a file server.
    pub thumbnail: String,
}

/// Transport commands the island and the phone can send.
#[derive(Debug, Clone, Copy)]
pub enum MediaCommand {
    PlayPause,
    Next,
    Previous,
}

impl MediaCommand {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "play_pause" | "playpause" => Some(Self::PlayPause),
            "next" => Some(Self::Next),
            "previous" | "prev" => Some(Self::Previous),
            _ => None,
        }
    }
}

#[cfg(windows)]
mod imp {
    use super::{MediaCommand, NowPlaying};
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
    };

    fn session_manager() -> Result<Manager, String> {
        Manager::RequestAsync()
            .map_err(|e| e.to_string())?
            .get()
            .map_err(|e| e.to_string())
    }

    pub fn now_playing() -> Result<NowPlaying, String> {
        let manager = session_manager()?;
        let Ok(session) = manager.GetCurrentSession() else {
            return Ok(NowPlaying::default());
        };
        let props = session
            .TryGetMediaPropertiesAsync()
            .map_err(|e| e.to_string())?
            .get()
            .map_err(|e| e.to_string())?;
        let info = session.GetPlaybackInfo().map_err(|e| e.to_string())?;
        let playing = info
            .PlaybackStatus()
            .map(|s| s == PlaybackStatus::Playing)
            .unwrap_or(false);

        // The timeline position is only fresh as of LastUpdatedTime; add the
        // wall-clock delta while playing so the bar does not stutter between
        // GSMTC updates.
        let mut position_secs = 0.0;
        let mut duration_secs = 0.0;
        if let Ok(timeline) = session.GetTimelineProperties() {
            duration_secs = timeline
                .EndTime()
                .map(|t| t.Duration as f64 / 10_000_000.0)
                .unwrap_or(0.0);
            let base = timeline
                .Position()
                .map(|t| t.Duration as f64 / 10_000_000.0)
                .unwrap_or(0.0);
            position_secs = base;
            if playing {
                if let Ok(updated) = timeline.LastUpdatedTime() {
                    use windows::Win32::System::SystemInformation::GetSystemTime;
                    // GetSystemTime returns the current UTC time by value in
                    // this windows-rs generation.
                    let now = unsafe { GetSystemTime() };
                    let now_unix = system_time_unix(now);
                    let updated_unix =
                        updated.UniversalTime as f64 / 10_000_000.0 - 11_644_473_600.0;
                    let delta = (now_unix - updated_unix).max(0.0);
                    position_secs = base + delta;
                }
            }
            if duration_secs > 0.0 {
                position_secs = position_secs.min(duration_secs);
            }
        }

        Ok(NowPlaying {
            available: true,
            title: props.Title().map(|s| s.to_string()).unwrap_or_default(),
            artist: props.Artist().map(|s| s.to_string()).unwrap_or_default(),
            album: props
                .AlbumTitle()
                .map(|s| s.to_string())
                .unwrap_or_default(),
            playing,
            position_secs,
            duration_secs,
            thumbnail: thumbnail_data_url_cached(&props).unwrap_or_default(),
        })
    }

    /// Reads the album art as a data URL, cached by track identity: GSMTC
    /// re-opens the stream on every read and a 200 KB decode every 3 s is
    /// wasteful when the song has not changed.
    fn thumbnail_data_url_cached(
        props: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties,
    ) -> Option<String> {
        use std::sync::{Mutex, OnceLock};
        static CACHE: OnceLock<Mutex<(String, Option<String>)>> = OnceLock::new();
        let title = props.Title().ok()?.to_string();
        let artist = props.Artist().map(|s| s.to_string()).unwrap_or_default();
        let key = format!("{title}|{artist}");
        let cache = CACHE.get_or_init(|| Mutex::new((String::new(), None)));
        {
            let guard = cache.lock().unwrap_or_else(|e| e.into_inner());
            if guard.0 == key {
                return guard.1.clone();
            }
        }
        let data = read_thumbnail(props);
        let mut guard = cache.lock().unwrap_or_else(|e| e.into_inner());
        *guard = (key, data.clone());
        data
    }

    fn read_thumbnail(
        props: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties,
    ) -> Option<String> {
        use base64::Engine;
        use windows::Storage::Streams::DataReader;
        let reference = props.Thumbnail().ok()?;
        let stream = reference.OpenReadAsync().ok()?.get().ok()?;
        let size = stream.Size().ok()? as usize;
        // Cover art beyond half a megabyte is a misbehaving source; skip it
        // rather than shove megabytes into every DOM re-render.
        if size == 0 || size > 512 * 1024 {
            return None;
        }
        let reader = DataReader::CreateDataReader(&stream).ok()?;
        reader.LoadAsync(size as u32).ok()?.get().ok()?;
        let mut bytes = vec![0u8; size];
        reader.ReadBytes(&mut bytes).ok()?;
        let mime = match bytes.first() {
            Some(0xFF) => "image/jpeg",
            Some(0x89) => "image/png",
            _ => return None,
        };
        Some(format!(
            "data:{mime};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ))
    }

    /// Unix seconds from a SYSTEMTIME, via the Win32 conversion the API offers.
    fn system_time_unix(st: windows::Win32::Foundation::SYSTEMTIME) -> f64 {
        use windows::Win32::Foundation::FILETIME;
        use windows::Win32::System::Time::SystemTimeToFileTime;
        let mut ft = FILETIME::default();
        unsafe {
            let _ = SystemTimeToFileTime(&st, &mut ft);
        }
        let ticks = ((ft.dwHighDateTime as u64) << 32) | ft.dwLowDateTime as u64;
        ticks as f64 / 10_000_000.0 - 11_644_473_600.0
    }

    pub fn control(command: MediaCommand) -> Result<(), String> {
        let manager = session_manager()?;
        let session = manager.GetCurrentSession().map_err(|e| e.to_string())?;
        let result = match command {
            MediaCommand::PlayPause => session.TryTogglePlayPauseAsync(),
            MediaCommand::Next => session.TrySkipNextAsync(),
            MediaCommand::Previous => session.TrySkipPreviousAsync(),
        };
        result
            .map_err(|e| e.to_string())?
            .get()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(not(windows))]
mod imp {
    use super::{MediaCommand, NowPlaying};

    pub fn now_playing() -> Result<NowPlaying, String> {
        Ok(NowPlaying::default())
    }

    pub fn control(_command: MediaCommand) -> Result<(), String> {
        Err("media control is only implemented on Windows".into())
    }
}

pub fn now_playing() -> Result<NowPlaying, String> {
    imp::now_playing()
}

pub fn control(command: MediaCommand) -> Result<(), String> {
    imp::control(command)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_wire_commands() {
        assert!(matches!(
            MediaCommand::parse("play_pause"),
            Some(MediaCommand::PlayPause)
        ));
        assert!(matches!(
            MediaCommand::parse("next"),
            Some(MediaCommand::Next)
        ));
        assert!(matches!(
            MediaCommand::parse("prev"),
            Some(MediaCommand::Previous)
        ));
        assert!(MediaCommand::parse("shuffle").is_none());
    }

    #[cfg(not(windows))]
    #[test]
    fn non_windows_reports_unavailable() {
        let state = now_playing().expect("now_playing");
        assert!(!state.available);
        assert!(control(MediaCommand::Next).is_err());
    }
}
