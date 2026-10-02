package internal

import "testing"

func TestActionQueueDrain(t *testing.T) {
	q := NewActionQueue()
	q.Put(Action{ID: "one", AgentID: "a"})
	q.Put(Action{ID: "two", AgentID: "b"})
	if got := q.Drain("a"); len(got) != 1 || got[0].ID != "one" {
		t.Fatalf("got=%v", got)
	}
	if got := q.Drain("a"); len(got) != 0 {
		t.Fatalf("expected drained queue")
	}
	if got := q.Drain("b"); len(got) != 1 || got[0].ID != "two" {
		t.Fatalf("got=%v", got)
	}
}
