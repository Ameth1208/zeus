//! In-process fan-out of normalized events.
//!
//! One broadcast channel, many subscribers: the session store, the gateway
//! client, and the webview bridge all listen. A slow subscriber drops events
//! rather than stalling the driver that published them, because a stalled
//! driver would stall the agent.

use crate::event::ZeusEvent;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::broadcast;

const CHANNEL_CAPACITY: usize = 1024;

pub struct EventBus {
    tx: broadcast::Sender<ZeusEvent>,
    published: AtomicU64,
}

impl EventBus {
    pub fn new() -> Arc<Self> {
        let (tx, _rx) = broadcast::channel(CHANNEL_CAPACITY);
        Arc::new(Self {
            tx,
            published: AtomicU64::new(0),
        })
    }

    pub fn publish(&self, event: ZeusEvent) {
        self.published.fetch_add(1, Ordering::Relaxed);
        // Err only when nobody is listening, which is normal at boot.
        let _ = self.tx.send(event);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<ZeusEvent> {
        self.tx.subscribe()
    }

    pub fn published(&self) -> u64 {
        self.published.load(Ordering::Relaxed)
    }

    pub fn listener_count(&self) -> usize {
        self.tx.receiver_count()
    }
}

impl Default for EventBus {
    fn default() -> Self {
        // Unreachable through Arc in practice; keeps clippy happy about Default.
        let (tx, _rx) = broadcast::channel(1);
        Self {
            tx,
            published: AtomicU64::new(0),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::EventKind;

    #[tokio::test]
    async fn fan_out_reaches_every_subscriber() {
        let bus = EventBus::new();
        let mut a = bus.subscribe();
        let mut b = bus.subscribe();
        bus.publish(ZeusEvent::new("s1", "codex", 1, EventKind::AgentThinking));

        assert_eq!(a.recv().await.unwrap().seq, 1);
        assert_eq!(b.recv().await.unwrap().seq, 1);
        assert_eq!(bus.published(), 1);
    }

    #[tokio::test]
    async fn publishing_with_no_listeners_is_not_an_error() {
        let bus = EventBus::new();
        bus.publish(ZeusEvent::new("s1", "agy", 1, EventKind::SessionStarted));
        assert_eq!(bus.published(), 1);
    }
}