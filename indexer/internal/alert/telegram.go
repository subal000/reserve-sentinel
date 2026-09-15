// Package alert delivers risk-band-change notifications to Telegram — the
// "warning" half of the warning system. Scores on-chain are the record; alerts
// are what actually reach a holder before they get hurt.
package alert

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// Telegram sends messages via the Bot API. A missing token/chat makes every
// Send a no-op, so the indexer runs fine without alerts configured.
type Telegram struct {
	token   string
	chatID  string
	http    *http.Client
	enabled bool
}

func NewTelegram(token, chatID string) *Telegram {
	return &Telegram{
		token:   token,
		chatID:  chatID,
		http:    &http.Client{Timeout: 10 * time.Second},
		enabled: token != "" && chatID != "",
	}
}

func (t *Telegram) Enabled() bool { return t.enabled }

// Send posts a Markdown message to the configured chat. Best-effort: a failed
// send is returned to the caller to log, never fatal.
func (t *Telegram) Send(ctx context.Context, text string) error {
	if !t.enabled {
		return nil
	}
	body, _ := json.Marshal(map[string]any{
		"chat_id":                  t.chatID,
		"text":                     text,
		"parse_mode":               "Markdown",
		"disable_web_page_preview": true,
	})
	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", t.token)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := t.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("telegram status %d", resp.StatusCode)
	}
	return nil
}
