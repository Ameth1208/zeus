package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

type client struct {
	base, token string
	http        *http.Client
}

func main() {
	base := strings.TrimRight(env("ZEUS_GATEWAY_URL", "http://127.0.0.1:8080"), "/")
	token := os.Getenv("ZEUS_ADMIN_TOKEN")
	if len(os.Args) < 2 {
		usage()
	}
	c := client{base: base, token: token, http: &http.Client{Timeout: 15 * time.Second}}
	cmd := os.Args[1]
	switch cmd {
	case "health":
		c.print("GET", "/health", nil, false)
	case "pair":
		requireToken(token)
		c.print("POST", "/v1/pair/start", map[string]any{}, true)
	case "devices":
		requireToken(token)
		c.print("GET", "/v1/devices", nil, true)
	case "revoke":
		requireToken(token)
		if len(os.Args) < 3 {
			fmt.Fprintln(os.Stderr, "device id required")
			os.Exit(2)
		}
		c.print("DELETE", "/v1/devices/"+os.Args[2], nil, true)
	default:
		usage()
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "zeusctl <health|pair|devices|revoke DEVICE_ID>")
	fmt.Fprintln(os.Stderr, "Uses ZEUS_GATEWAY_URL and ZEUS_ADMIN_TOKEN.")
	os.Exit(2)
}
func requireToken(v string) {
	if v == "" {
		fmt.Fprintln(os.Stderr, "ZEUS_ADMIN_TOKEN is required")
		os.Exit(2)
	}
}
func env(k, v string) string {
	if x := os.Getenv(k); x != "" {
		return x
	}
	return v
}
func (c client) print(method, path string, body any, auth bool) {
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, c.base+path, r)
	if err != nil {
		fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if auth {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		fatal(err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		fmt.Fprintf(os.Stderr, "HTTP %d: %s\n", resp.StatusCode, data)
		os.Exit(1)
	}
	if len(data) > 0 {
		var v any
		if json.Unmarshal(data, &v) == nil {
			out, _ := json.MarshalIndent(v, "", "  ")
			fmt.Println(string(out))
		} else {
			fmt.Print(string(data))
		}
	}
}
func fatal(err error) { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
