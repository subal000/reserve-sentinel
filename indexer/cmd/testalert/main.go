// Command testalert sends one sample risk-band alert to Telegram, so you can
// verify TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID are wired correctly before
// running the full indexer.
//
// Usage:
//
//	TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... go run ./cmd/testalert
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/reserve-sentinel/indexer/internal/alert"
)

func main() {
	token := os.Getenv("TELEGRAM_BOT_TOKEN")
	chatID := os.Getenv("TELEGRAM_CHAT_ID")
	if token == "" || chatID == "" {
		fmt.Println("set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID")
		os.Exit(2)
	}

	tg := alert.NewTelegram(token, chatID)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	msg := "🔻 *SPCX* dropped to *Showing warning signs* (52/100)\nwas _Watch this one_\n\n" +
		"premium n/a · 1% depth $8.2k · mint/burn 3.40σ\n\n[open dashboard](https://reserve-sentinel.vercel.app)"

	if err := tg.Send(ctx, msg); err != nil {
		fmt.Println("send failed:", err)
		os.Exit(1)
	}
	fmt.Println("sent — check your Telegram")
}
