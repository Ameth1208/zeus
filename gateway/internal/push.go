package internal

import "log"

// PushDispatcher delivers pushworthy events to paired devices when their app
// is not holding an SSE connection. The FCM implementation plugs in here; the
// contract is intentionally small so the swap touches nothing else.
type PushDispatcher interface {
	// Dispatch delivers one event to every registered push token.
	Dispatch(event Event, pushTokens []string)
}

// NoopPushDispatcher is the default: it records that a push *would* have gone
// out, which keeps the pushworthy filter exercised and visible in logs until
// FCM credentials are configured (ZEUS_FCM_CREDENTIALS, not yet read).
type NoopPushDispatcher struct {
	logger *log.Logger
}

// NewNoopPushDispatcher builds the default dispatcher.
func NewNoopPushDispatcher(logger *log.Logger) *NoopPushDispatcher {
	return &NoopPushDispatcher{logger: logger}
}

func (d *NoopPushDispatcher) Dispatch(event Event, pushTokens []string) {
	if len(pushTokens) == 0 {
		return
	}
	// TODO(fcm): send through Firebase Cloud Messaging once ZEUS_FCM_CREDENTIALS
	// is wired. Until then the mobile app relies on its own local notifications
	// from the live event stream.
	d.logger.Printf("push pending: kind=%s session=%s devices=%d", event.Type, event.SessionID, len(pushTokens))
}
