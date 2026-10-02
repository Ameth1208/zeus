package internal

import "sync"

// ActionQueue closes the small race between a controller posting an action and
// a runtime hook opening its SSE connection. Actions are held per agent until
// the next action stream attaches. Live actions are still also published over
// the Hub for low latency.
type ActionQueue struct {
	mu      sync.Mutex
	byAgent map[string][]Action
}

func NewActionQueue() *ActionQueue { return &ActionQueue{byAgent: map[string][]Action{}} }

func (q *ActionQueue) Put(a Action) {
	q.mu.Lock()
	defer q.mu.Unlock()
	items := append(q.byAgent[a.AgentID], a)
	if len(items) > 32 {
		items = append([]Action(nil), items[len(items)-32:]...)
	}
	q.byAgent[a.AgentID] = items
}

func (q *ActionQueue) Drain(agentID string) []Action {
	q.mu.Lock()
	defer q.mu.Unlock()
	if agentID == "" {
		var all []Action
		for id, items := range q.byAgent {
			all = append(all, items...)
			delete(q.byAgent, id)
		}
		return all
	}
	items := append([]Action(nil), q.byAgent[agentID]...)
	delete(q.byAgent, agentID)
	return items
}
