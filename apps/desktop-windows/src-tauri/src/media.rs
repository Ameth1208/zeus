//! Now-playing and transport control through the Windows Global System Media
//! Transport Controls (GSMTC). This is host capability, not engine domain: the
//! engine must stay platform-agnostic, so the media module lives in the host
//! crate and is only compiled on Windows.

use serde::Serialize;

/// What the island's media view renders. `None` fields mean the current
/// session did not publish them.
#[derive(Debug, Clone, Default, Serialize)]
pub struct NowPlaying {
    pub available: bool,
    pub title: String,
    pub artist: String,
    pub playing: bool,
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
        let playing = session
            .GetPlaybackInfo()
            .map(|info| {
                info.PlaybackStatus()
                    .map(|s| s == PlaybackStatus::Playing)
                    .unwrap_or(false)
            })
            .unwrap_or(false);
        Ok(NowPlaying {
            available: true,
            title: props.Title().map(|s| s.to_string()).unwrap_or_default(),
            artist: props.Artist().map(|s| s.to_string()).unwrap_or_default(),
            playing,
        })
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
