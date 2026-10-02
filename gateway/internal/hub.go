package internal

import "sync"

type Hub[T any] struct {
	mu      sync.RWMutex
	nextID  int
	clients map[int]chan T
}

func NewHub[T any]() *Hub[T] {
	return &Hub[T]{clients: map[int]chan T{}}
}

func (h *Hub[T]) Subscribe(buffer int) (int, <-chan T) {
	h.mu.Lock()
	defer h.mu.Unlock()
	id := h.nextID
	h.nextID++
	ch := make(chan T, buffer)
	h.clients[id] = ch
	return id, ch
}

func (h *Hub[T]) Unsubscribe(id int) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if ch, ok := h.clients[id]; ok {
		delete(h.clients, id)
		close(ch)
	}
}

func (h *Hub[T]) Publish(v T) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, ch := range h.clients {
		select {
		case ch <- v:
		default:
		}
	}
}
